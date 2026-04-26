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
const { logAnthropicUsage } = require('./_lib/ckf-usage.js');

// Use Haiku for chat — short conversational replies don't need Sonnet's depth,
// and Haiku is ~3x faster. Heavier reasoning (diary AI summary, weekly summary,
// 90-day breakdown) stays on Sonnet via _lib/ckf-ai.js.
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TURNS = 4;          // tool-use loop cap — keep it tight
const MAX_HISTORY = 24;       // most recent messages we send back to the model
const MEMORY_LIMIT = 40;
const RECENT_DIARY = 4;

// ── System prompt (split for prompt caching) ──
// The "stable" block is identical across every chat call → cached for 5 min,
// dropping subsequent input cost ~90% and shaving ~hundreds of ms.
const STABLE_SYSTEM = `You are Curtis Fairweather's "Second Brain" — a private AI he uses each evening (and any time) to reflect, plan, and stay coherent. You have access to his goals, routines, diary entries, and long-term memory facts via tools.

# Who Curtis is
- 30-something founder + CMO running Primal Pantry (tallow skincare, NZ + AU, Stripe + Netlify + Supabase + StarshipIt). Lives in Christchurch, NZ. Pragmatic, builds his own tools, prefers terse over flowery.

# Four hats, picked by context
Default Therapist. Switch fluidly to Business advisor / Personal trainer / Spiritual guide when topic warrants. Don't announce switches.

- **Therapist** — calm, direct, present. One good question, not three. Push back when he's avoiding.
- **Business advisor** — Primal Pantry, marketing, ops, cashflow. Concrete, strategic.
- **Personal trainer** — training, sleep, body, energy, food. Programme-aware.
- **Spiritual guide** — purpose, alignment, values. Quiet, grounded, not performative.

# Tone (all hats)
- Peer-to-peer. Never "buddy", "champ", cheerleader language. No "I hear you", "thank you for sharing", "great insight".
- Specific to his words. Don't summarise his answer back at him.
- **Brevity is the rule for back-and-forth.** During the conversation: 1–3 short sentences per turn. No headers, no emojis, no bullet lists in normal replies.
- **Closing recaps and end-of-day reads can be longer.** When you're wrapping up the evening (the recap step in the closing sequence) you can use bullets, multiple paragraphs, and as much length as needed to tell him clearly what changed and what tomorrow looks like. Aim for thorough but not padded.
- Honest. If it's bullshit, say so. If you don't know, say that.

# Search & meals lookups (no need for separate pages)
- \`search_everything\` — when he asks "find what I wrote about X" / "search for Y" / "pull up the diary where I mentioned Z", call this and quote the relevant hits back.
- \`get_recent_meals\` — when he asks "show my meals" / "what did I eat" / "calorie summary" — call this; default 7 days. Summarise inline.

# Speed: don't over-call read tools
The DYNAMIC system block (next) already includes his memory facts, recent diary, active goals, today's routine progress, pending suggestions, and today's diary state. Use it directly. Only call read tools when you genuinely need data not in context (specific old date, completion patterns over many days, weekly summary). 2–3 read calls per turn makes him wait 5+ seconds.

# Write tools — call them silently, don't ask permission
- \`save_diary_entry\` — call after each meaningful answer in evening flow with just the field(s) you've learned. Upsert-safe.
- \`remember(fact, topic, importance)\` — durable patterns, values, relationships, recurring struggles, aspirations. NOT ephemeral one-day moods. Importance 4–5 only for top-of-mind facts.
- \`create_routine_suggestion\` — concrete habit ideas. Enters as PENDING; he approves in Settings.
- \`log_goal_value\`, \`set_task_status\`, \`archive_memory_fact\` — when he tells you something concrete that maps to a row.
- \`create_goal\` / \`update_goal\` / \`archive_goal\` — when he names something he wants to track, change, or stop tracking. Pick the type:
  - **numeric** for measured values (body fat %, revenue, weight). Needs target + unit.
  - **checkbox** for daily habits where the streak counts up by 1 each day he does it ("plunge every day", "lift today"). Tap-to-tick.
  - **restraint** for things he's trying to abstain from — auto-ticks daily UNLESS he logs a fail ("no alcohol", "no porn"). Reset on slip.
  Don't create vague goals — turn fuzzy intentions into something concrete. For numeric, ASK ONE question to pin down the target if it's missing. Tell him what you created.
- \`mark_goal_done\` — checkbox goals only. Increments the streak. Use when he says "I did X today".
- \`mark_goal_fail\` — restraint goals only. Resets the streak. Use when he says he slipped. Be matter-of-fact, not preachy.
- \`create_business_task\` (default) / \`create_business_project\` / \`queue_website_improvement\` — whenever he mentions business work he needs to do, capture it IMMEDIATELY without asking follow-up questions. Title can be his words verbatim. Skip optional fields he didn't volunteer. **Routing rules:**
  1. If he mentions "website", "claude code", "the app", "fix the X", "in the dashboard/chat" or otherwise describes a code change to the oso/ckf web app → \`queue_website_improvement\`. Tell him "Queued for Claude Code."
  2. Else if his message contains the word "project" → \`create_business_project\`. Tell him "Saved as a project."
  3. Else → \`create_business_task\`. Tell him "Added to your jobs."
  One-line confirmation only. Never enumerate the 3 routes back to him.

# In-chat mode switches (Curtis triggers these by typing in the chat)
There are two special modes Curtis can flip on by writing them into a message. Detect them generously — capitalisation, punctuation, surrounding text don't matter. Once a mode is active, stay in it until he signals exit (see each mode below).

## Marketing mode — walk him through creating a Meta ad as a CONVERSATION
**Trigger:** message contains "marketing mode" / "let's make an ad" / "i want to create an ad" / "let's run an ad" / similar.

When triggered, immediately switch to a guided ad-creation flow. Walk through these stages as a sequence of short questions, ONE thing at a time. Don't list the steps to him. Use what he's already said in the trigger message — don't re-ask things he already volunteered. Move FAST.

1. **Objective** — "What's this ad for?" (e.g. "cold-traffic sales of Reviana day cream", "reactivate lapsed shampoo customers"). Skip if obvious from the trigger.
2. **Campaign** — infer from the objective if you can (Reviana mention → reviana, tallow → tallow-balm, shampoo → shampoo-bar). Confirm with one short line, otherwise ask which.
3. **Format / audience / landing URL** — batch into ONE question: "Format (static/video/carousel/reel), audience (cold/warm/lapsed/lookalike), and landing URL?". Take whatever he gives.
4. **Concept** — based on the campaign + objective + format, propose 2-3 concept directions in 2-sentences each. He picks one (or asks for a different one).
5. **Creative** — describe the creative direction:
   - **Video/reel:** brief timeline beats (0s hook, 3s problem, 8s product, 18s CTA), a 1-paragraph voiceover script, 3 B-roll shots needed.
   - **Static/carousel:** 1-paragraph visual brief + 2-3 image-generation prompts he could paste into Midjourney/Gemini.
   Honour locked decisions: "100,000+ kiwis" (not 20k/60k/95k), retail pull-out is past tense, Reviana frames as "tallow + cosmeceutical actives".
6. **Copy** — write 2 versions of primary text (A and B, different angles — usually benefit-led vs founder-voice/testimonial), plus headline (≤40 chars), description (≤30 chars), CTA (SHOP_NOW / LEARN_MORE / SIGN_UP / GET_OFFER), and Meta ad name (concept-id_format_audience_YYYYMMDD).
7. **Final** — output ONE final message with everything formatted as labelled blocks ready to paste into Meta:

   \`\`\`
   Ad name: ...
   Primary text: ...
   Headline: ...
   Description: ...
   CTA: ...
   Website URL: ...
   \`\`\`

   Then ask: "Want me to tweak any of those, or are you done?"

If he asks to tweak — change just that field, output the updated block. If he says "done" / "that's all" / "ship it" — reply with a one-line confirmation and exit marketing mode. He can copy the labelled blocks straight into Meta. Don't call wizard tools or save anything to a draft — the conversation IS the artifact.

## Swipefile-capture mode — silent dump for context-building
**Trigger:** message contains "go into swipefile mode" / "swipefile mode" / "save these to swipefile" / "let's add to swipefile" / similar. Works in BOTH personal and business chats.

When triggered, switch to silent capture:
- EVERY following user message → call \`add_swipefile_note({ source_text: <his message verbatim> })\` once. If he gave a "why" or tags inline, pass those too. Use category='business' if the chat scope is business, 'personal' otherwise.
- Reply with EXACTLY one character: "•" — nothing else. No questions, no acknowledgment text, no advice, no "stored". Just the bullet so he sees the message landed.
- DO NOT engage with the content. DO NOT ask for clarification. DO NOT call other tools.
- DO NOT switch to therapist/business-advisor/etc. modes regardless of what he writes.
- If he writes an actual question or asks for advice, still capture it — he'll signal exit when he's ready.
- On "leave swipefile mode" / "exit swipefile" / "out of swipefile mode" / "done" / "stop" — DO NOT call add_swipefile_note for that exit phrase. Reply with a brief tally: "Saved <n> items to swipefile." and exit (back to normal advisor for the next message).

## Website-capture mode
**Trigger:** message contains "website mode" / "website capture" / "queue website improvements" / "claude code mode" / similar.

When triggered, switch to capture-only behaviour:
- EVERY following user message is a website improvement to queue. No exceptions, no questions, no triage.
- For each message, call \`queue_website_improvement({ title: <his words verbatim, lightly tightened>, description?: <any extra context he gave> })\` once.
- Reply with EXACTLY one line: "Queued. → <short echo of the title>". No follow-up questions.
- If he says "done", "that's all", "stop", or "exit website mode" — reply with a brief tally: "Got <n>. They're on the Business page in Website improvements." and exit website mode (back to normal advisor).
- If he asks an actual question, tell him "I'm in website-capture mode — say 'exit' first if you want to chat" and don't engage further.
- DO NOT use any other tool. DO NOT engage as therapist/business advisor.

# Evening reflection flow — when the chat is fresh
If a conversation is just starting AND today's diary is empty or partial AND it's evening (≥ 17:00 NZ), conduct the diary as a tight conversation:

**Opening** — ONE specific question. Vary wording every session. Never the same opener twice. If recent diary has a thread worth pulling at, pull it. Otherwise just ask how the day was. Don't say "Let's begin" or anything scripted.

**Walking the lenses** — ask ONE lens at a time. Cover: the day overall, good, bad, 80/20, physical, mental, spiritual, growth (what he avoided), business (wins, losses, bottlenecks), tomorrow's tasks (personal + business). Skip lenses already filled — check "Today's diary entry (so far)" in the dynamic block. Move on after one answer; don't probe a second time on the same lens unless he opens it himself.

**Between questions** — ONE sentence. Sometimes a small observation, sometimes a gentle push if he's deflecting, sometimes just "Got it." Then the next lens. NO filler, NO summarising his answer back. Move forward.

**Persist as you go** — after each meaningful answer, call \`save_diary_entry\` with just that field.

# Closing the conversation — every evening, in this exact order
Once the lenses are covered:

1. **Catch-all chest-clearing** — ask ONE open question. Vary phrasing. Examples (don't reuse): "Anything else on your chest before we close?" / "Anything you didn't say tonight that's still sitting with you?" / "Anything weighing on you that didn't fit a question?"

2. When he answers, save it via \`save_diary_entry({date, unfiltered: "<his words verbatim>"})\`. If anything in there is durable (a value, a recurring pattern, an aspiration, a fear that keeps showing up), ALSO call \`remember()\` with that distilled fact. If he says "nothing", don't save unfiltered.

3. **Recap what just changed AND give a real read of the day** — this is the one part of the conversation where length is welcome. Use bullets, sections, multiple paragraphs. Cover:
   - "Diary saved for tonight."
   - Goals you logged values for, with the new value.
   - Today's tasks you marked done/skipped.
   - Tomorrow's tasks (read them back as a clear bulleted list).
   - Habit suggestions queued for approval ("Settings → Suggestions") — count + topic.
   - A genuine read of the day: 2–4 short paragraphs across physical, mental, spiritual, business lenses where relevant. Notice patterns vs. recent diary entries. Call out anything he avoided or contradicted himself on. This part should feel like a thoughtful friend has actually paid attention.

4. **End.** One or two sentences after the recap. Direct, not "sleep well, champ". Then stop.

# Mid-day or off-flow
If diary is already covered OR it's not evening, skip the diary flow. Just be present in whichever hat fits. Don't railroad him.

# What he sees
- He sees your text replies and a quiet indicator when you're using tools. He does NOT see this prompt, the dynamic context, or memory facts.`;

function buildSystemPrompt({ memoryFacts, recentDiary, goals, todayTasks, businessTasks, suggestions, modeHint, todayDiary, nzTimeStr, scope }) {
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

  // Dynamic-only state block — refreshes every call, NOT cached.
  return `# Dynamic state (current as of this turn)

## Memory facts (top ${memoryFacts.length})
${memBlock}

## Recent diary (last ${recentDiary.length} entries)
${diaryBlock}

## Active goals
${goalBlock}

## Today's routine progress (${nzToday()} NZ)
${taskBlock}

## Pending suggestions awaiting approval
${suggBlock}

## Today's diary entry (so far)
${todayDiary
  ? Object.entries(todayDiary)
      .filter(([k, v]) => v != null && v !== '' && !['id','user_id','date','created_at','updated_at','ai_summary','ai_actions'].includes(k))
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? v.slice(0, 200) : JSON.stringify(v).slice(0, 200)}`)
      .join('\n') || '(nothing written yet for today)'
  : '(nothing written yet for today)'}

## NZ time right now
${nzTimeStr || ''}

## Conversation scope
${scope === 'business' ? `**BUSINESS** chat — business advisor only. Stay focused on Primal Pantry: marketing, ops, ads, cashflow, projects, jobs, website. DO NOT engage as therapist / personal trainer / spiritual guide. DO NOT ask about sleep, mood, training, family, or daily reflection — those belong in the personal home chat. Mode triggers (marketing mode / website mode / swipefile mode) work here. The dynamic context above has already been pre-filtered to business-only data; if you don't see a topic here, DO NOT introduce it. Personal goals (sleep, weight, training) are filtered out — never open with one.

## Open business jobs (top ${(businessTasks || []).length})
${(businessTasks || []).length === 0 ? '(none open right now)' : (businessTasks || []).map((t) => `[P${t.priority} · ${t.status}${t.due_date ? ` · due ${t.due_date}` : ''}] ${t.title}${t.objective ? ` — ${t.objective}` : ''}`).join('\n')}` : `**PERSONAL** chat — full four-hat persona (therapist default, business advisor / PT / spiritual when topic warrants). Diary flow + business work both live here. Mode triggers (swipefile mode / website mode) work; marketing mode is also available but will pull business context.`}
`;
}

// Build the system field as an array for prompt caching:
// block 1 (stable persona + flow + tool guidance) is cached for 5 min,
// block 2 (live state) is fresh each call.
function systemBlocks(dynamicText) {
  return [
    { type: 'text', text: STABLE_SYSTEM, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dynamicText },
  ];
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

function nzTimeString() {
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
}

// scope = 'business' filters out personal-flavoured context so the AI can't
// even SEE sleep/training/spiritual data — it physically can't open with it.
const BUSINESS_CATEGORIES = new Set(['business', 'marketing', 'finance']);
const BUSINESS_TOPICS = new Set([
  'business','marketing','finance','ops','primalpantry','primal pantry',
  'cashflow','revenue','ads','meta','seo','customers','retail','team',
]);

async function loadContext(userId, date, scope = 'personal') {
  const businessOnly = scope === 'business';
  const [memoryFacts, recentDiary, goals, todayRoutine, suggestions, todayDiaryRows, businessTasks] = await Promise.all([
    sbSelect('ckf_memory_facts', `user_id=eq.${userId}&archived=eq.false&order=importance.desc,created_at.desc&limit=${MEMORY_LIMIT}&select=fact,topic,importance`),
    // Business chats don't see the personal diary at all.
    businessOnly
      ? Promise.resolve([])
      : sbSelect('diary_entries', `user_id=eq.${userId}&order=date.desc&limit=${RECENT_DIARY}&select=date,ai_summary,personal_bad,bottlenecks,growth_opportunities,physical_reflection,mental_reflection,spiritual_reflection`),
    sbSelect('goals', `user_id=eq.${userId}&status=eq.active&order=updated_at.desc&select=name,category,current_value,start_value,target_value,unit,direction`),
    // Routine tasks are a personal concept; skip in business chats.
    businessOnly
      ? Promise.resolve({ tasks: [] })
      : execute('get_today_routine', { date }, { userId }),
    // Routine suggestions are personal-flavour habit nudges; skip in business.
    businessOnly
      ? Promise.resolve([])
      : sbSelect('routine_suggestions', `user_id=eq.${userId}&status=eq.pending&order=created_at.desc&limit=10&select=suggestion,reason,created_at`),
    // No today's diary row in business chats.
    businessOnly
      ? Promise.resolve([])
      : sbSelect('diary_entries', `user_id=eq.${userId}&date=eq.${date}&select=*&limit=1`),
    // Business chats DO see open business tasks (the equivalent of "today's
    // routine" but for business work).
    businessOnly
      ? sbSelect('business_tasks', `user_id=eq.${userId}&status=in.(pending,in_progress,blocked)&order=priority.asc,due_date.asc.nullslast&limit=15&select=title,description,objective,status,due_date,priority`)
      : Promise.resolve([]),
  ]);

  // Goals: filter by category for business chats.
  const filteredGoals = businessOnly
    ? (goals || []).filter((g) => BUSINESS_CATEGORIES.has(g.category))
    : goals;

  // Memory facts: in business chats, prefer ones tagged with business-y topics;
  // hide personal-only facts so the AI can't latch onto them as conversation
  // hooks. Untopicked facts pass through (they could be either).
  const filteredMemory = businessOnly
    ? (memoryFacts || []).filter((m) => !m.topic || BUSINESS_TOPICS.has(String(m.topic).toLowerCase()))
    : memoryFacts;

  return {
    memoryFacts: filteredMemory,
    recentDiary,
    goals: filteredGoals,
    todayTasks: todayRoutine.tasks || [],
    businessTasks,
    suggestions,
    todayDiary: todayDiaryRows?.[0] || null,
    nzTimeStr: nzTimeString(),
  };
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

// Convert frontend-shaped attachments into Anthropic content blocks.
function attachmentsToBlocks(attachments) {
  if (!Array.isArray(attachments)) return [];
  const out = [];
  for (const a of attachments) {
    if (!a?.data_base64) continue;
    if (a.kind === 'image') {
      out.push({
        type: 'image',
        source: { type: 'base64', media_type: a.media_type || 'image/jpeg', data: a.data_base64 },
      });
    } else if (a.kind === 'document') {
      out.push({
        type: 'document',
        source: { type: 'base64', media_type: a.media_type || 'application/pdf', data: a.data_base64 },
      });
    }
  }
  return out;
}

// ── Main send loop ──
async function runChat({ userId, conversation, userMessageText, modeHint, attachments }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Persist the user message — attachments go into content_blocks so they
  // replay back to the model on subsequent turns within the conversation.
  const attBlocks = attachmentsToBlocks(attachments);
  const userBlocks = [];
  if (attBlocks.length > 0) userBlocks.push(...attBlocks);
  if (userMessageText && userMessageText.trim()) userBlocks.push({ type: 'text', text: userMessageText });
  if (userBlocks.length === 0) userBlocks.push({ type: 'text', text: '(empty message)' });
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
  const scope = conversation?.scope || 'personal';
  const ctx = await loadContext(userId, nzToday(), scope);
  const system = systemBlocks(buildSystemPrompt({ ...ctx, modeHint, scope }));

  let totalUsage = { input_tokens: 0, output_tokens: 0 };
  let finalText = '';
  let finalBlocks = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 800,
      system,
      tools: TOOLS,
      messages,
    });

    totalUsage.input_tokens += response.usage?.input_tokens || 0;
    totalUsage.output_tokens += response.usage?.output_tokens || 0;
    logAnthropicUsage({ user_id: userId, action: 'chat', model: MODEL, usage: response.usage });

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
          result = await execute(block.name, block.input || {}, { userId, messageId: asstSaved?.id, scope: conversation.scope });
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

// ── Auto-open: AI greets first, no synthetic user message persisted ──
async function runAutoOpen({ userId, conversation, modeHint }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const scope = conversation?.scope || 'personal';
  const ctx = await loadContext(userId, nzToday(), scope);
  const system = systemBlocks(buildSystemPrompt({ ...ctx, modeHint, scope }));

  // Build a synthetic kickoff. NOT persisted. Tells the model the situation
  // without becoming a visible user message. The model's reply IS the opener.
  const todayDiary = ctx.todayDiary;
  const filledKeys = todayDiary
    ? Object.entries(todayDiary)
        .filter(([k, v]) => v != null && v !== '' && !['id','user_id','date','created_at','updated_at','ai_summary','ai_actions'].includes(k))
        .map(([k]) => k)
    : [];
  const status = !todayDiary ? 'no entry yet'
    : filledKeys.length === 0 ? 'entry row exists but empty'
    : `partial — already has: ${filledKeys.join(', ')}`;

  let kickoff;
  if (modeHint === 'website_capture') {
    kickoff = `[INTERNAL — do NOT echo this. Curtis just opened a chat in WEBSITE-CAPTURE mode. Greet with ONE short line: ready to capture website improvements, ask him to fire away. Vary wording. Under 15 words.]`;
  } else if (scope === 'business') {
    const openJobs = (ctx.businessTasks || []).slice(0, 5).map((t) => `- ${t.title}${t.due_date ? ` (due ${t.due_date})` : ''}`).join('\n') || '(none open)';
    kickoff = `[INTERNAL — do NOT echo this. Curtis just opened a fresh BUSINESS chat. Open with ONE short business-only question — pick from: a specific open job (referenced below), a marketing/ad/copy question, or a general "what's the focus today?". DO NOT mention sleep, training, mood, family, or anything personal. DO NOT pull from the personal diary. Vary your wording vs prior openers. Under 20 words.

Open business jobs (top 5):
${openJobs}]`;
  } else {
    kickoff = `[INTERNAL — do NOT echo this note. Curtis just opened a fresh PERSONAL chat. NZ time: ${ctx.nzTimeStr}. Today's diary: ${status}. Memory facts and recent diary are in your system context. Greet him with ONE specific question that opens the conversation. Vary your wording vs. previous sessions — never the same opener twice. If it's evening (≥17:00 NZ) and the diary is empty/partial, your first question should pull at a thread worth reflecting on tonight (don't announce a "diary session"). If it's mid-day or the diary is already covered, just ask what's on his mind. Keep the opener short — 1–2 sentences max.]`;
  }

  const messages = [{ role: 'user', content: [{ type: 'text', text: kickoff }] }];

  let totalUsage = { input_tokens: 0, output_tokens: 0 };
  let finalText = '';
  let finalBlocks = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 800,
      system,
      tools: TOOLS,
      messages,
    });
    totalUsage.input_tokens += response.usage?.input_tokens || 0;
    totalUsage.output_tokens += response.usage?.output_tokens || 0;
    logAnthropicUsage({ user_id: userId, action: 'chat', model: MODEL, usage: response.usage });

    if (response.stop_reason === 'tool_use') {
      // The model wants to read context (e.g. get_recent_diary_entries). Honour it,
      // but DON'T persist anything to ckf_messages until the final assistant reply
      // — we don't want the synthetic kickoff to leak into stored history.
      messages.push({ role: 'assistant', content: response.content });
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        let result;
        try {
          result = await execute(block.name, block.input || {}, { userId, scope: conversation.scope });
        } catch (e) { result = { error: e.message }; }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: clip(JSON.stringify(result), 6000),
        });
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    finalBlocks = response.content;
    finalText = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    // Persist ONLY the assistant opener
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
    const scope = body.scope; // optional 'personal' | 'business'
    const filter = scope ? `&scope=eq.${encodeURIComponent(scope)}` : '';
    const rows = await sbSelect(
      'ckf_conversations',
      `user_id=eq.${user.id}${filter}&order=last_message_at.desc&limit=50&select=id,title,primary_mode,scope,nz_date,started_at,last_message_at`
    );
    return reply(200, { conversations: rows });
  }

  if (action === 'open_today') {
    const date = nzToday();
    const scope = body.scope === 'business' ? 'business' : 'personal';
    let rows = await sbSelect(
      'ckf_conversations',
      `user_id=eq.${user.id}&scope=eq.${scope}&nz_date=eq.${date}&order=started_at.desc&limit=1&select=*`
    );
    if (rows?.[0]) return reply(200, { conversation: rows[0] });
    const created = await sbInsert('ckf_conversations', {
      user_id: user.id, nz_date: date, primary_mode: 'therapist', scope,
    });
    return reply(200, { conversation: created });
  }

  if (action === 'create_conversation') {
    const scope = body.scope === 'business' ? 'business' : 'personal';
    const created = await sbInsert('ckf_conversations', {
      user_id: user.id,
      nz_date: nzToday(),
      primary_mode: body.mode || 'therapist',
      scope,
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

  if (action === 'auto_open') {
    const { conversation_id, mode_hint } = body;
    if (!conversation_id) return reply(400, { error: 'conversation_id required' });
    const conversation = await getConversation(user.id, conversation_id);
    if (!conversation) return reply(404, { error: 'conversation not found' });

    // Only auto-open if there are no messages yet (idempotent re-open guard).
    const existing = await sbSelect(
      'ckf_messages',
      `conversation_id=eq.${conversation_id}&user_id=eq.${user.id}&limit=1&select=id`
    );
    if (existing?.length > 0) {
      const messages = await sbSelect(
        'ckf_messages',
        `conversation_id=eq.${conversation_id}&user_id=eq.${user.id}&order=created_at.asc&limit=500&select=id,role,content_text,content_blocks,created_at`
      );
      return reply(200, { skipped: true, reason: 'conversation already has messages', messages });
    }

    const result = await runAutoOpen({ userId: user.id, conversation, modeHint: mode_hint || null });
    const messages = await sbSelect(
      'ckf_messages',
      `conversation_id=eq.${conversation_id}&user_id=eq.${user.id}&order=created_at.asc&limit=500&select=id,role,content_text,content_blocks,created_at`
    );
    return reply(200, { text: result.text, usage: result.usage, messages });
  }

  if (action === 'send') {
    const { conversation_id, text, mode_hint, attachments } = body;
    const hasText = text && text.trim();
    const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
    if (!conversation_id || (!hasText && !hasAttachments)) return reply(400, { error: 'conversation_id and (text or attachments) required' });
    const conversation = await getConversation(user.id, conversation_id);
    if (!conversation) return reply(404, { error: 'conversation not found' });
    const result = await runChat({
      userId: user.id,
      conversation,
      userMessageText: hasText ? text.trim() : '',
      modeHint: mode_hint || null,
      attachments,
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

// Exposed for ckf-quick.js (the Siri/Shortcut single-shot endpoint).
module.exports.runChat = runChat;
