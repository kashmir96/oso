/**
 * agent-chat.js — minimal ad-script agent.
 *
 * Actions:
 *   open                                              -> { conversation, messages, stats }
 *   new                                               -> { conversation }
 *   send     { conversation_id, text }                -> { messages }
 *   approve  { conversation_id, message_id, script }  -> { messages, stats }
 *
 * Learning loop:
 *   - On approve, save to agent_approved_scripts.
 *   - Then ask Claude (one cheap call) to extract 1–3 short lessons from
 *     this winning script + the brief. Save them to agent_learnings.
 *   - On every send, inject up to 8 active learnings + the 3 most recent
 *     approved scripts as system-prompt context.
 */
const Anthropic = require('@anthropic-ai/sdk');
const { sbSelect, sbInsert, sbUpdate } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 800;
const HISTORY_TURNS = 30;
const MAX_LEARNINGS_IN_PROMPT = 8;
const RECENT_APPROVED_IN_PROMPT = 3;

// ── System prompt ────────────────────────────────────────────────────────────
// Hard guardrails baked in. The agent only writes ad scripts. Approved-script
// snippets and lessons learned are appended as live context.
const BASE_SYSTEM = `You are Curtis's ad-script assistant. ONE job: help him write short
direct-response ad scripts (typically 15–60 seconds, occasionally up to 90).

Rules:
1. Stay in scope. If Curtis asks for anything that isn't an ad script
   (image briefs, code, life advice, broader strategy), politely redirect.
2. Voice: peer-to-peer, kiwi-coded, no hype, no buzzwords, no emojis.
3. Be tight. Question what's missing (product, audience, angle, length,
   platform) BEFORE drafting if you genuinely can't proceed. Otherwise
   make sensible assumptions and draft.
4. When you're ready to deliver a script, output it inside a fenced block
   labelled \`script\` exactly like this:

   \`\`\`script
   [HOOK] ...
   [LINE 1] ...
   [LINE 2] ...
   [CTA] ...
   \`\`\`

   The fenced block is the ONLY way the user can approve and save a
   script, so always emit one when you have a real candidate.
5. After the fenced block, you may add ONE short follow-up line offering
   a tweak path (e.g. "Want a tighter CTA?"). Don't pile on options.
6. If Curtis tweaks an earlier draft, emit a fresh fenced \`script\` block
   with the updated copy — don't just describe the change.

You'll be given two extra context blocks every turn:
  - LEARNINGS: things that have worked in past approved scripts.
  - RECENT APPROVED: the most recent scripts Curtis approved.
Use them to bias toward what he's already endorsed. Don't quote them
verbatim unless it's clearly the right move.`;

// ── Helpers ─────────────────────────────────────────────────────────────────
async function getOrCreateConversation(userId) {
  const rows = await sbSelect(
    'agent_conversations',
    `user_id=eq.${userId}&order=last_message_at.desc.nullslast&limit=1&select=*`
  );
  if (rows && rows[0]) return rows[0];
  return sbInsert('agent_conversations', { user_id: userId, title: 'Ad scripts' });
}

async function getMessages(conversationId, userId) {
  return sbSelect(
    'agent_messages',
    `conversation_id=eq.${conversationId}&user_id=eq.${userId}&order=created_at.asc&limit=500&select=id,role,content,created_at`
  );
}

async function saveMessage(conversationId, userId, role, content, usage = null) {
  return sbInsert('agent_messages', {
    conversation_id: conversationId,
    user_id: userId,
    role,
    content,
    tokens_in: usage?.input_tokens || null,
    tokens_out: usage?.output_tokens || null,
  });
}

async function touchConversation(id) {
  await sbUpdate('agent_conversations', `id=eq.${id}`, { last_message_at: new Date().toISOString() });
}

async function getStats(userId) {
  const [approvedRows, learningRows] = await Promise.all([
    sbSelect('agent_approved_scripts', `user_id=eq.${userId}&select=id`),
    sbSelect('agent_learnings', `user_id=eq.${userId}&archived=eq.false&select=id`),
  ]);
  return {
    approved: approvedRows?.length || 0,
    learnings: learningRows?.length || 0,
  };
}

// Decorate stored messages so the UI knows which ones were approved without
// needing a second roundtrip.
async function decorateMessages(messages, userId) {
  if (!messages?.length) return messages || [];
  const ids = messages.filter((m) => m.role === 'assistant').map((m) => m.id);
  if (!ids.length) return messages;
  const approved = await sbSelect(
    'agent_approved_scripts',
    `user_id=eq.${userId}&source_message_id=in.(${ids.join(',')})&select=source_message_id`
  );
  const set = new Set((approved || []).map((r) => r.source_message_id));
  return messages.map((m) => set.has(m.id) ? { ...m, approved: true } : m);
}

async function buildContextBlocks(userId) {
  const [learnings, approved] = await Promise.all([
    sbSelect(
      'agent_learnings',
      `user_id=eq.${userId}&archived=eq.false&order=created_at.desc&limit=${MAX_LEARNINGS_IN_PROMPT}&select=lesson`
    ),
    sbSelect(
      'agent_approved_scripts',
      `user_id=eq.${userId}&order=approved_at.desc&limit=${RECENT_APPROVED_IN_PROMPT}&select=brief,script,approved_at`
    ),
  ]);

  let block = '';
  if (learnings?.length) {
    block += '\n\nLEARNINGS (what Curtis tends to approve):\n';
    block += learnings.map((l, i) => `${i + 1}. ${l.lesson}`).join('\n');
  }
  if (approved?.length) {
    block += '\n\nRECENT APPROVED SCRIPTS:\n';
    block += approved.map((a, i) => {
      const brief = a.brief ? `Brief: ${a.brief}\n` : '';
      return `--- #${i + 1} ---\n${brief}${a.script}`;
    }).join('\n\n');
  }
  return block;
}

function toAnthropicMessages(rows) {
  return rows
    .slice(-HISTORY_TURNS)
    .map((r) => ({ role: r.role, content: [{ type: 'text', text: r.content }] }));
}

function extractScriptBlock(text) {
  if (!text) return null;
  const m = text.match(/```script\s*\n([\s\S]*?)```/i);
  return m ? m[1].trim() : null;
}

// ── Send ────────────────────────────────────────────────────────────────────
async function runSend({ userId, conversation, userText }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  await saveMessage(conversation.id, userId, 'user', userText);
  const history = await getMessages(conversation.id, userId);
  const ctx = await buildContextBlocks(userId);

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [{ type: 'text', text: BASE_SYSTEM + ctx, cache_control: { type: 'ephemeral' } }],
    messages: toAnthropicMessages(history),
  });

  const text = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim() || '…';

  await saveMessage(conversation.id, userId, 'assistant', text, resp.usage);
  await touchConversation(conversation.id);
}

// ── Approve ─────────────────────────────────────────────────────────────────
// Save the script + extract a learning. The extraction is best-effort — if
// it fails we still keep the approval; the loop just doesn't learn that turn.
async function runApprove({ userId, conversationId, messageId, scriptText }) {
  // Find the most recent prior user message in this conversation -- that's
  // the brief that produced the winning draft.
  const prior = await sbSelect(
    'agent_messages',
    `conversation_id=eq.${conversationId}&user_id=eq.${userId}&role=eq.user&order=created_at.desc&limit=1&select=content`
  );
  const brief = prior?.[0]?.content || null;

  const saved = await sbInsert('agent_approved_scripts', {
    user_id: userId,
    conversation_id: conversationId,
    source_message_id: messageId,
    brief,
    script: scriptText,
  });

  // Best-effort learning extraction. One call, no retries.
  try {
    if (process.env.ANTHROPIC_API_KEY) {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const lessons = await extractLessons(client, brief, scriptText);
      for (const lesson of lessons) {
        await sbInsert('agent_learnings', {
          user_id: userId,
          source_script_id: saved?.id,
          lesson,
        });
      }
    }
  } catch (e) {
    console.error('[agent-chat] learning extraction failed:', e.message);
  }
}

async function extractLessons(client, brief, script) {
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 250,
    system: [{
      type: 'text',
      text:
`You analyse a single ad script that the writer just approved. Distil 1–3 SHORT
lessons (each <= 18 words) about what worked here that would translate to
future scripts. Focus on hook structure, voice, length, CTA style, sentence
rhythm, specificity -- whatever made this one land. Output ONLY the lessons,
one per line, no numbering, no preamble. If nothing distinctive stands out,
output a single line: SKIP`,
    }],
    messages: [{
      role: 'user',
      content: [{
        type: 'text',
        text: `Brief: ${brief || '(none captured)'}\n\nApproved script:\n${script}`,
      }],
    }],
  });
  const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return text
    .split('\n')
    .map((s) => s.trim().replace(/^[-*•\d.\s]+/, ''))
    .filter((s) => s && s.toUpperCase() !== 'SKIP')
    .slice(0, 3);
}

// ── Handler ─────────────────────────────────────────────────────────────────
exports.handler = withGate(async (event, { user }) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }

  try {
    if (body.action === 'open') {
      const conv = await getOrCreateConversation(user.id);
      const messages = await decorateMessages(await getMessages(conv.id, user.id), user.id);
      const stats = await getStats(user.id);
      return reply(200, { conversation: conv, messages, stats });
    }

    if (body.action === 'new') {
      const conv = await sbInsert('agent_conversations', { user_id: user.id, title: 'Ad scripts' });
      return reply(200, { conversation: conv });
    }

    if (body.action === 'send') {
      const { conversation_id, text } = body;
      if (!conversation_id || !text) return reply(400, { error: 'conversation_id + text required' });
      const conv = (await sbSelect('agent_conversations', `id=eq.${conversation_id}&user_id=eq.${user.id}&select=*&limit=1`))?.[0];
      if (!conv) return reply(404, { error: 'conversation not found' });
      await runSend({ userId: user.id, conversation: conv, userText: text });
      const messages = await decorateMessages(await getMessages(conversation_id, user.id), user.id);
      return reply(200, { messages });
    }

    if (body.action === 'approve') {
      const { conversation_id, message_id, script } = body;
      if (!conversation_id || !message_id || !script) {
        return reply(400, { error: 'conversation_id + message_id + script required' });
      }
      // Sanity: verify the script text actually appears in the source assistant
      // message. Stops a malicious client approving arbitrary text.
      const src = (await sbSelect(
        'agent_messages',
        `id=eq.${message_id}&conversation_id=eq.${conversation_id}&user_id=eq.${user.id}&role=eq.assistant&select=*&limit=1`
      ))?.[0];
      if (!src) return reply(404, { error: 'source message not found' });
      const inSrc = extractScriptBlock(src.content);
      if (!inSrc || inSrc.replace(/\s+/g, '') !== script.replace(/\s+/g, '')) {
        return reply(400, { error: 'script does not match source message' });
      }
      await runApprove({ userId: user.id, conversationId: conversation_id, messageId: message_id, scriptText: inSrc });
      const messages = await decorateMessages(await getMessages(conversation_id, user.id), user.id);
      const stats = await getStats(user.id);
      return reply(200, { messages, stats });
    }

    return reply(400, { error: `unknown action: ${body.action}` });
  } catch (e) {
    console.error('[agent-chat]', e);
    return reply(500, { error: e.message || 'Server error' });
  }
});
