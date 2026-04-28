/**
 * biz-chat.js — chat dispatcher for oso/biz competency agents.
 *
 * One function, many agents. Each request carries an `agent` slug that
 * selects the system prompt + tool subset (from _lib/biz-agents/_index.js).
 * Conversations are stored in ckf_conversations / ckf_messages with
 * scope = `biz_<slug>` so each agent gets its own thread per user.
 *
 * Actions:
 *   list_conversations  { agent }                      -> { conversations }
 *   create_conversation { agent, title? }              -> { conversation }
 *   get_conversation    { id }                         -> { conversation, messages }
 *   delete_conversation { id }                         -> { success }
 *   send                { conversation_id, agent, text }
 *                                                      -> { messages, text, usage }
 *   edit_message        { id, new_text, truncate_after? }
 *                                                      -> { success }
 *   continue_after_edit { conversation_id, agent }     -> { messages, text, usage }
 *   clear_context       { conversation_id }            -> { horizon_id }
 *
 * Backends Anthropic Haiku 4.5 by default; specific agents can override
 * via their registry entry.
 */
const Anthropic = require('@anthropic-ai/sdk');
const { sbSelect, sbInsert, sbUpdate, sbDelete } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');
const { TOOLS: ALL_TOOLS, execute, clip } = require('./_lib/ckf-tools.js');
const { logUsage: logAnthropicUsage } = require('./_lib/ckf-usage.js');
const { getAgent, listAgents } = require('./_lib/biz-agents/_index.js');

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TURNS = 6;
const MAX_HISTORY = 50;

// ─── Conversation helpers ───────────────────────────────────────────────────
function scopeForAgent(slug) { return `biz_${slug}`; }

async function getConversation(userId, id) {
  const rows = await sbSelect('ckf_conversations', `id=eq.${id}&user_id=eq.${userId}&select=*&limit=1`);
  return rows?.[0] || null;
}

async function getMessages(conversationId, userId) {
  return sbSelect(
    'ckf_messages',
    `conversation_id=eq.${conversationId}&user_id=eq.${userId}&order=created_at.asc&limit=500&select=id,role,content_text,content_blocks,created_at`
  );
}

// ─── Build the message list to send to Anthropic ────────────────────────────
// Honours the most recent context_horizon marker -- everything BEFORE the
// horizon is hidden from the model. UI still shows the divider.
function applyHorizonCut(rows) {
  let lastHorizonAt = null;
  for (const r of rows) {
    const blocks = Array.isArray(r.content_blocks) ? r.content_blocks : [];
    if (blocks.some((b) => b?.type === 'context_horizon')) lastHorizonAt = r.created_at;
  }
  if (!lastHorizonAt) return rows;
  return rows.filter((r) => r.created_at > lastHorizonAt && !rowIsHorizon(r));
}

function rowIsHorizon(r) {
  return Array.isArray(r?.content_blocks) && r.content_blocks.some((b) => b?.type === 'context_horizon');
}

// Filter out custom UI block types Anthropic would reject. Drop messages that
// end up empty.
const ANTHROPIC_BLOCK_TYPES = new Set(['text','image','tool_use','tool_result','image_ref','document']);
function sanitiseBlocksForAnthropic(blocks) {
  const out = [];
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    if (ANTHROPIC_BLOCK_TYPES.has(b.type)) { out.push(b); continue; }
    if (b.type === 'pipeline_card') { out.push({ type: 'text', text: `[ui:pipeline_card stage="${b.stage}"]` }); continue; }
    if (b.type === 'context_horizon') continue;
  }
  return out;
}

function toAnthropicMessages(rows) {
  const sliced = applyHorizonCut(rows).slice(-MAX_HISTORY);
  const out = [];
  for (const r of sliced) {
    const raw = Array.isArray(r.content_blocks) && r.content_blocks.length
      ? r.content_blocks
      : (r.content_text ? [{ type: 'text', text: r.content_text }] : []);
    const blocks = sanitiseBlocksForAnthropic(raw);
    if (blocks.length === 0) continue;
    if (r.role === 'tool') out.push({ role: 'user', content: blocks });
    else                   out.push({ role: r.role, content: blocks });
  }
  return out;
}

async function saveMessage(conversationId, userId, role, text, blocks, usage = null) {
  return sbInsert('ckf_messages', {
    conversation_id: conversationId,
    user_id: userId,
    role,
    content_text: text,
    content_blocks: blocks || [],
    tokens_in: usage?.input_tokens || null,
    tokens_out: usage?.output_tokens || null,
  });
}

async function touchConversation(id) {
  await sbUpdate('ckf_conversations', `id=eq.${id}`, { last_message_at: new Date().toISOString() });
}

// ─── Tool subsetting per agent ──────────────────────────────────────────────
function toolsForAgent(agent) {
  const allowed = new Set(agent.tools || []);
  return ALL_TOOLS.filter((t) => allowed.has(t.name));
}

// ─── Run the chat tool-loop for one send ────────────────────────────────────
async function runChat({ userId, conversation, agent, userText }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  await saveMessage(conversation.id, userId, 'user', userText, [{ type: 'text', text: userText }]);

  const history = await getMessages(conversation.id, userId);
  const messages = toAnthropicMessages(history);

  const tools  = toolsForAgent(agent);
  const system = [
    { type: 'text', text: agent.system_prompt, cache_control: { type: 'ephemeral' } },
  ];

  let totalUsage = { input_tokens: 0, output_tokens: 0 };
  let finalText = '';
  let finalBlocks = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await client.messages.create({
      model: agent.model || DEFAULT_MODEL,
      max_tokens: agent.max_tokens || 800,
      system, tools, messages,
    });
    totalUsage.input_tokens  += resp.usage?.input_tokens  || 0;
    totalUsage.output_tokens += resp.usage?.output_tokens || 0;
    logAnthropicUsage({ user_id: userId, action: `biz:${agent.slug}`, model: resp.model, usage: resp.usage });

    if (resp.stop_reason === 'tool_use') {
      const txt = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      const asstSaved = await saveMessage(conversation.id, userId, 'assistant', txt || null, resp.content, resp.usage);
      messages.push({ role: 'assistant', content: resp.content });

      const toolResults = [];
      for (const block of resp.content) {
        if (block.type !== 'tool_use') continue;
        let result;
        try {
          result = await execute(block.name, block.input || {}, {
            userId, user: { id: userId },
            messageId: asstSaved?.id,
            conversationId: conversation.id,
            scope: conversation.scope,
            agent: agent.slug,
          });
        } catch (e) { result = { error: e.message }; }
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: clip(JSON.stringify(result), 6000) });
      }
      await saveMessage(conversation.id, userId, 'tool', null, toolResults);
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    finalBlocks = resp.content;
    finalText = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    await saveMessage(conversation.id, userId, 'assistant', finalText || '', finalBlocks, resp.usage);
    break;
  }

  // Safety net: hit MAX_TURNS without final text -> force one more no-tools call.
  if (!finalText) {
    try {
      const closer = await client.messages.create({
        model: agent.model || DEFAULT_MODEL, max_tokens: 400, system,
        messages: [...messages, { role: 'user', content: [{ type: 'text', text: '[Internal: hit tool-loop cap. Reply briefly with what you accomplished and what to do next. No more tool calls.]' }] }],
      });
      finalText = closer.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
        || 'I got tangled up. Try rephrasing or /reset.';
      await saveMessage(conversation.id, userId, 'assistant', finalText, closer.content, closer.usage);
    } catch (e) {
      finalText = 'I got tangled up. Try rephrasing or /reset.';
      await saveMessage(conversation.id, userId, 'assistant', finalText, [{ type: 'text', text: finalText }]);
    }
  }

  await touchConversation(conversation.id);
  return { text: finalText, usage: totalUsage };
}

// ─── Handler ────────────────────────────────────────────────────────────────
exports.handler = withGate(async (event, { user }) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  try {
    if (action === 'list_agents') {
      return reply(200, { agents: listAgents() });
    }

    if (action === 'list_conversations') {
      const agentSlug = body.agent;
      if (!agentSlug) return reply(400, { error: 'agent required' });
      const rows = await sbSelect(
        'ckf_conversations',
        `user_id=eq.${user.id}&scope=eq.${encodeURIComponent(scopeForAgent(agentSlug))}&order=last_message_at.desc.nullslast&limit=20&select=id,title,scope,nz_date,last_message_at,started_at`
      );
      return reply(200, { conversations: rows });
    }

    if (action === 'create_conversation') {
      const agentSlug = body.agent;
      if (!agentSlug) return reply(400, { error: 'agent required' });
      const agent = getAgent(agentSlug);
      if (!agent) return reply(404, { error: `unknown agent: ${agentSlug}` });
      const created = await sbInsert('ckf_conversations', {
        user_id: user.id,
        scope: scopeForAgent(agentSlug),
        title: body.title || null,
        nz_date: nzToday(),
      });
      const row = Array.isArray(created) ? created[0] : created;
      return reply(200, { conversation: row });
    }

    if (action === 'get_conversation') {
      if (!body.id) return reply(400, { error: 'id required' });
      const conv = await getConversation(user.id, body.id);
      if (!conv) return reply(404, { error: 'not found' });
      const messages = await getMessages(body.id, user.id);
      return reply(200, { conversation: conv, messages });
    }

    if (action === 'delete_conversation') {
      if (!body.id) return reply(400, { error: 'id required' });
      await sbDelete('ckf_conversations', `id=eq.${body.id}&user_id=eq.${user.id}`);
      return reply(200, { success: true });
    }

    if (action === 'send') {
      const { conversation_id, agent: agentSlug, text } = body;
      if (!conversation_id || !text || !agentSlug) return reply(400, { error: 'conversation_id + agent + text required' });
      const agent = getAgent(agentSlug);
      if (!agent) return reply(404, { error: `unknown agent: ${agentSlug}` });
      const conv = await getConversation(user.id, conversation_id);
      if (!conv) return reply(404, { error: 'conversation not found' });
      const result = await runChat({ userId: user.id, conversation: conv, agent, userText: text });
      const messages = await getMessages(conversation_id, user.id);
      return reply(200, { text: result.text, usage: result.usage, messages });
    }

    if (action === 'edit_message') {
      // Update an existing message's text. If truncate_after=true, ALSO
      // delete every message with a created_at strictly later than this one
      // (used when editing a user message + re-running from there).
      if (!body.id || typeof body.new_text !== 'string') return reply(400, { error: 'id + new_text required' });
      const rows = await sbSelect('ckf_messages', `id=eq.${body.id}&user_id=eq.${user.id}&select=*&limit=1`);
      const m = rows?.[0];
      if (!m) return reply(404, { error: 'message not found' });
      // Update content_text + replace any text block in content_blocks. Other
      // block types preserved.
      const newBlocks = Array.isArray(m.content_blocks) && m.content_blocks.length
        ? m.content_blocks.map((b) => b?.type === 'text' ? { ...b, text: body.new_text } : b)
        : [{ type: 'text', text: body.new_text }];
      // If there's no text block in there, prepend one.
      if (!newBlocks.some((b) => b?.type === 'text')) newBlocks.unshift({ type: 'text', text: body.new_text });
      await sbUpdate('ckf_messages', `id=eq.${body.id}`, { content_text: body.new_text, content_blocks: newBlocks });

      if (body.truncate_after) {
        await sbDelete('ckf_messages',
          `conversation_id=eq.${m.conversation_id}&user_id=eq.${user.id}&created_at=gt.${encodeURIComponent(m.created_at)}`
        );
      }
      return reply(200, { success: true });
    }

    if (action === 'continue_after_edit') {
      // After editing a user message and truncating, run the AI ONCE more so
      // the latest user message (the edited one) gets a reply. Doesn't save
      // a new user message -- that's already the edited one.
      const { conversation_id, agent: agentSlug } = body;
      if (!conversation_id || !agentSlug) return reply(400, { error: 'conversation_id + agent required' });
      const agent = getAgent(agentSlug);
      const conv = await getConversation(user.id, conversation_id);
      if (!conv) return reply(404, { error: 'conversation not found' });

      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const history = await getMessages(conversation_id, user.id);
      const messages = toAnthropicMessages(history);
      const tools = toolsForAgent(agent);
      const system = [{ type: 'text', text: agent.system_prompt, cache_control: { type: 'ephemeral' } }];

      const resp = await client.messages.create({
        model: agent.model || DEFAULT_MODEL,
        max_tokens: agent.max_tokens || 800,
        system, tools, messages,
      });
      const finalText = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      await saveMessage(conversation_id, user.id, 'assistant', finalText || '', resp.content, resp.usage);
      logAnthropicUsage({ user_id: user.id, action: `biz:${agent.slug}:continue`, model: resp.model, usage: resp.usage });
      await touchConversation(conversation_id);
      const out = await getMessages(conversation_id, user.id);
      return reply(200, { messages: out, text: finalText });
    }

    if (action === 'clear_context') {
      // Insert a context_horizon marker so the AI ignores history before now.
      // Visible in UI as a divider; persists across reloads.
      if (!body.conversation_id) return reply(400, { error: 'conversation_id required' });
      const conv = await getConversation(user.id, body.conversation_id);
      if (!conv) return reply(404, { error: 'conversation not found' });
      const inserted = await sbInsert('ckf_messages', {
        conversation_id: body.conversation_id,
        user_id: user.id,
        role: 'assistant',
        content_text: null,
        content_blocks: [{ type: 'context_horizon', cleared_at: new Date().toISOString() }],
      });
      const row = Array.isArray(inserted) ? inserted[0] : inserted;
      return reply(200, { horizon_id: row?.id });
    }

    return reply(400, { error: 'Unknown action' });
  } catch (e) {
    console.error('[biz-chat]', e);
    return reply(500, { error: e.message || 'Server error' });
  }
});

function nzToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date());
}
