/**
 * ckf-chat.js — conversational interface to Curtis's Second Brain.
 *
 * Actions:
 *   list_conversations     -> [{id, title, primary_mode, started_at, last_message_at, nz_date}]
 *   open_today             -> {conversation: {...}}   (creates one if needed)
 *   create_conversation    -> {conversation: {...}}
 *   get_conversation       -> {conversation, messages: [{role, content_text, content_blocks, created_at}]}
 *   delete_conversation    -> {success}
 *   send                   -> appends user message, runs the model + tool loop,
 *                              persists the assistant response, returns the new
 *                              messages and the (possibly updated) conversation.
 *
 * The system prompt injects: top memory facts, last 5 diary summaries, active
 * goals state, today's task progress, pending suggestions, and the four hats.
 */
const Anthropic = require('@anthropic-ai/sdk');
const { sbSelect, sbInsert, sbUpdate, sbDelete } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');
const { TOOLS, execute, clip, nzToday } = require('./_lib/ckf-tools.js');

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TURNS = 8;          // tool-use loop cap
const MAX_HISTORY = 30;       // most recent messages we send back to the model
const MEMORY_LIMIT = 50;
const RECENT_DIARY = 5;

// ── System prompt ──
function buildSystemPrompt({ memoryFacts, recentDiary, goals, todayTasks, suggestions, modeHint }) {
  const memBlock = memoryFacts.length
    ? memoryFacts.map((m) => `• [${m.importance}] ${m.topic ? `(${m.topic}) ` : ''}${m.fact}`).join('\n')
    : '(no facts yet — call remember() when you learn something durable)';

  const diaryBlock = recentDiary.length
    ? recentDiary.map((d) =>
        `--- ${d.date}\n` +
        `summary: ${d.ai_summary || '—'}\n` +
        `bad: ${d.personal_bad || '—'}\n` +
        `bottlenecks: ${d.bottlenecks || '—'}\n` +
        `growth: ${d.growth_opportunities || '—'}\n` +
        `physical: ${d.physical_reflection || '—'}\n` +
        `mental: ${d.mental_reflection || '—'}\n` +
        `spiritual: ${d.spiritual_reflection || '—'}`
      ).join('\n\n')
    : '(no diary entries yet)';

  const goalBlock = goals.length
    ? goals.map((g) => `${g.name} (${g.category}, ${g.direction === 'lower_better' ? '↓' : '↑'}): ${g.current_value ?? '—'}${g.unit || ''} → ${g.target_value ?? '—'}${g.unit || ''}`).join('\n')
    : '(no active goals)';

  const taskBlock = todayTasks.length
    ? todayTasks.map((t) => `[${t.log?.status || 'not_started'}] ${t.title} (${t.category})`).join('\n')
    : '(no routine tasks set for today)';

  const suggBlock = suggestions.length
    ? suggestions.slice(0, 5).map((s) => `• ${s.suggestion} — ${s.reason || ''}`).join('\n')
    : '(none pending)';

  return `You are Curtis Fairweather's "Second Brain" — a private AI he uses each evening (and any time) to reflect, plan, and stay coherent. You have access to his goals, routines, diary entries, and long-term memory facts via tools.

# Who Curtis is
- 30-something founder + CMO running Primal Pantry (tallow skincare, NZ + AU, Stripe + Netlify + Supabase + StarshipIt).
- Lives in Christchurch, NZ. Pragmatic, builds his own tools, prefers terse over flowery.

# How to behave — four hats, picked by context
You wear FOUR hats. Default to Therapist. Switch fluidly when the topic warrants — say nothing about switching, just respond as the right voice.

1. **Therapist (default)** — calm, present, direct. Help him understand himself. Ask one good question, not three. Reflect what you hear. No flattery, no platitudes, no "I hear you" filler. Be willing to push back gently when he's avoiding something.

2. **Business advisor** — when he brings up Primal Pantry, marketing, ops, cashflow, delegation, hiring. Concrete, strategic. Cite numbers when you have them via tools (sales, conversion, CPA, etc.).

3. **Personal trainer** — when he brings up training, sleep, body composition, energy, injuries, food. Programme-aware, not generic. Pull his goal data and recent diary physical_reflection lines to ground advice.

4. **Spiritual guide** — when he reaches for purpose, meaning, alignment, presence, values, or doubt. Quiet, grounded, not performative. Don't moralise. Help him notice the gap between what he says he values and how he's living.

# Tone (all hats)
- Peer-to-peer. Never call him "buddy", "champ", or use cheerleader language.
- Specific to what he wrote. Cite his actual words.
- Short paragraphs. No headers in replies unless useful. No emojis unless he uses them.
- Honest. If something he's saying is bullshit, say it. If you don't know, say that too.

# Tool use — be PROACTIVE
- Call read tools BEFORE answering when context would sharpen your reply (e.g. before recommending a habit, check get_today_routine + get_task_completion_pattern; before a body comment, check get_goals + last few diary physical lines).
- Call \`remember(fact, topic, importance)\` whenever you learn something durable — values, relationships, recurring patterns, ongoing struggles, aspirations. Never ephemeral one-day moods. Importance 4–5 only for things that should always be top-of-mind.
- Near the end of a reflective evening conversation, call \`save_diary_entry\` to persist the structured row. Use the actual content from the conversation. Don't invent fields you didn't discuss.
- When a habit suggestion would help, call \`create_routine_suggestion\`. It enters as PENDING — Curtis approves in Settings. Don't ask permission first; just propose.
- If memory contradicts what he's saying now, prefer what he's saying now and call \`archive_memory_fact\` on the stale one.

# What he sees
- He sees your text replies and a quiet indicator when you're using tools.
- He does NOT see the system prompt or memory facts directly.

# Current state (loaded for you each turn)

## Memory facts (top ${memoryFacts.length} of his durable notes)
${memBlock}

## Recent diary (last ${recentDiary.length} entries)
${diaryBlock}

## Active goals
${goalBlock}

## Today's routine progress (${nzToday()} NZ)
${taskBlock}

## Pending suggestions awaiting his approval
${suggBlock}

${modeHint ? `\n# Hat hint from UI\nHe explicitly asked you to lean ${modeHint} for this conversation. Honour it unless context clearly calls for another hat.\n` : ''}
Reply now in your own voice. If a tool call sharpens the answer, call it.`;
}

// ── Conversation helpers ──
async function getConversation(userId, id) {
  const rows = await sbSelect('ckf_conversations', `id=eq.${id}&user_id=eq.${userId}&select=*&limit=1`);
  return rows?.[0] || null;
}

async function getMessages(conversationId, limit = MAX_HISTORY) {
  // Fetch the most recent N, then return chronologically.
  const rows = await sbSelect(
    'ckf_messages',
    `conversation_id=eq.${conversationId}&order=created_at.desc&limit=${limit}&select=id,role,content_text,content_blocks,created_at`
  );
  return rows.reverse();
}

async function loadContext(userId, date) {
  const [memoryFacts, recentDiary, goals, todayRoutine, suggestions] = await Promise.all([
    sbSelect('ckf_memory_facts', `user_id=eq.${userId}&archived=eq.false&order=importance.desc,created_at.desc&limit=${MEMORY_LIMIT}&select=fact,topic,importance`),
    sbSelect('diary_entries', `user_id=eq.${userId}&order=date.desc&limit=${RECENT_DIARY}&select=date,ai_summary,personal_bad,bottlenecks,growth_opportunities,physical_reflection,mental_reflection,spiritual_reflection`),
    sbSelect('goals', `user_id=eq.${userId}&status=eq.active&order=updated_at.desc&select=name,category,current_value,start_value,target_value,unit,direction`),
    execute('get_today_routine', { date }, { userId }),
    sbSelect('routine_suggestions', `user_id=eq.${userId}&status=eq.pending&order=created_at.desc&limit=10&select=suggestion,reason,created_at`),
  ]);
  return { memoryFacts, recentDiary, goals, todayTasks: todayRoutine.tasks || [], suggestions };
}

// ── Convert stored messages to Anthropic format ──
function toAnthropicMessages(rows) {
  // Stored shape: each row has role + content_blocks (array of blocks).
  // For 'tool' role, we collected tool_result blocks under a 'user' role for the API.
  const out = [];
  for (const r of rows) {
    const blocks = Array.isArray(r.content_blocks) && r.content_blocks.length
      ? r.content_blocks
      : (r.content_text ? [{ type: 'text', text: r.content_text }] : []);
    if (r.role === 'tool') {
      out.push({ role: 'user', content: blocks });
    } else {
      out.push({ role: r.role, content: blocks });
    }
  }
  return out;
}

// ── Save a message ──
async function saveMessage(conversationId, userId, role, contentText, contentBlocks, usage = null) {
  return sbInsert('ckf_messages', {
    conversation_id: conversationId,
    user_id: userId,
    role,
    content_text: contentText,
    content_blocks: contentBlocks || [],
    tokens_in: usage?.input_tokens || null,
    tokens_out: usage?.output_tokens || null,
  });
}

async function touchConversation(id) {
  await sbUpdate('ckf_conversations', `id=eq.${id}`, { last_message_at: new Date().toISOString() });
}

// ── Title generation (cheap; first user message, truncated) ──
function makeTitle(text) {
  const t = (text || '').trim().split('\n')[0].slice(0, 60);
  return t || 'New chat';
}

// ── Main send loop ──
async function runChat({ userId, conversation, userMessageText, modeHint }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Persist the user message first
  const userBlocks = [{ type: 'text', text: userMessageText }];
  await saveMessage(conversation.id, userId, 'user', userMessageText, userBlocks);

  // If conversation has no title yet, set one from the first user message
  if (!conversation.title) {
    await sbUpdate('ckf_conversations', `id=eq.${conversation.id}`, { title: makeTitle(userMessageText) });
    conversation.title = makeTitle(userMessageText);
  }

  // Load history (most recent N), then convert to Anthropic shape
  const history = await getMessages(conversation.id, MAX_HISTORY);
  const messages = toAnthropicMessages(history);

  // Load fresh context every turn — keeps the model honest as the day progresses
  const ctx = await loadContext(userId, nzToday());
  const system = buildSystemPrompt({ ...ctx, modeHint });

  let totalUsage = { input_tokens: 0, output_tokens: 0 };
  let finalText = '';
  let finalBlocks = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system,
      tools: TOOLS,
      messages,
    });

    totalUsage.input_tokens += response.usage?.input_tokens || 0;
    totalUsage.output_tokens += response.usage?.output_tokens || 0;

    if (response.stop_reason === 'tool_use') {
      // Persist the assistant turn (with its tool_use blocks) so the conversation is replayable later
      const assistantText = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      const asstSaved = await saveMessage(conversation.id, userId, 'assistant', assistantText || null, response.content, response.usage);
      messages.push({ role: 'assistant', content: response.content });

      // Execute every tool_use block
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        let result;
        try {
          result = await execute(block.name, block.input || {}, { userId, messageId: asstSaved?.id });
        } catch (e) {
          result = { error: e.message };
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: clip(JSON.stringify(result), 6000),
        });
      }

      // Persist as a 'tool' role row so we can replay it later
      await saveMessage(conversation.id, userId, 'tool', null, toolResults);
      messages.push({ role: 'user', content: toolResults });

      continue; // run another turn
    }

    // end_turn / max_tokens / stop_sequence — done
    finalBlocks = response.content;
    finalText = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    await saveMessage(conversation.id, userId, 'assistant', finalText || '', finalBlocks, response.usage);
    break;
  }

  await touchConversation(conversation.id);
  return { text: finalText, blocks: finalBlocks, usage: totalUsage };
}

// ── Handler ──
exports.handler = withGate(async (event, { user }) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  if (action === 'list_conversations') {
    const rows = await sbSelect(
      'ckf_conversations',
      `user_id=eq.${user.id}&order=last_message_at.desc&limit=50&select=id,title,primary_mode,nz_date,started_at,last_message_at`
    );
    return reply(200, { conversations: rows });
  }

  if (action === 'open_today') {
    const date = nzToday();
    let rows = await sbSelect(
      'ckf_conversations',
      `user_id=eq.${user.id}&nz_date=eq.${date}&order=started_at.desc&limit=1&select=*`
    );
    if (rows?.[0]) return reply(200, { conversation: rows[0] });
    const created = await sbInsert('ckf_conversations', {
      user_id: user.id, nz_date: date, primary_mode: 'therapist',
    });
    return reply(200, { conversation: created });
  }

  if (action === 'create_conversation') {
    const created = await sbInsert('ckf_conversations', {
      user_id: user.id,
      nz_date: nzToday(),
      primary_mode: body.mode || 'therapist',
      title: body.title || null,
    });
    return reply(200, { conversation: created });
  }

  if (action === 'get_conversation') {
    const { id } = body;
    if (!id) return reply(400, { error: 'id required' });
    const conversation = await getConversation(user.id, id);
    if (!conversation) return reply(404, { error: 'not found' });
    const rows = await sbSelect(
      'ckf_messages',
      `conversation_id=eq.${id}&user_id=eq.${user.id}&order=created_at.asc&limit=500&select=id,role,content_text,content_blocks,created_at`
    );
    return reply(200, { conversation, messages: rows });
  }

  if (action === 'delete_conversation') {
    if (!body.id) return reply(400, { error: 'id required' });
    await sbDelete('ckf_conversations', `id=eq.${body.id}&user_id=eq.${user.id}`);
    return reply(200, { success: true });
  }

  if (action === 'send') {
    const { conversation_id, text, mode_hint } = body;
    if (!conversation_id || !text || !text.trim()) return reply(400, { error: 'conversation_id and text required' });
    const conversation = await getConversation(user.id, conversation_id);
    if (!conversation) return reply(404, { error: 'conversation not found' });
    const result = await runChat({
      userId: user.id,
      conversation,
      userMessageText: text.trim(),
      modeHint: mode_hint || null,
    });
    // Re-load messages so the client renders the full final state including any tool turns
    const messages = await sbSelect(
      'ckf_messages',
      `conversation_id=eq.${conversation_id}&user_id=eq.${user.id}&order=created_at.asc&limit=500&select=id,role,content_text,content_blocks,created_at`
    );
    return reply(200, { text: result.text, usage: result.usage, messages });
  }

  if (action === 'list_memory') {
    const topicFilter = body.topic ? `&topic=eq.${encodeURIComponent(body.topic)}` : '';
    const rows = await sbSelect(
      'ckf_memory_facts',
      `user_id=eq.${user.id}&archived=eq.false${topicFilter}&order=importance.desc,created_at.desc&select=*`
    );
    return reply(200, { facts: rows });
  }

  if (action === 'archive_memory') {
    if (!body.id) return reply(400, { error: 'id required' });
    await sbUpdate('ckf_memory_facts', `id=eq.${body.id}&user_id=eq.${user.id}`, { archived: true });
    return reply(200, { success: true });
  }

  return reply(400, { error: 'Unknown action' });
});
