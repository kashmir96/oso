/**
 * mktg-chat.js — conversational interface to the PrimalPantry marketing playbook.
 *
 * Mirrors ckf-chat structure (Haiku 4.5, prompt caching, tool-use loop) but
 * with marketing-domain tools and system prompt.
 *
 * Actions:
 *   list_conversations
 *   create_conversation { title?, kind? ('context'|'wizard'), active_campaign? }
 *   get_conversation    { id }
 *   delete_conversation { id }
 *   send                { conversation_id, text }
 *   list_memory         { topic? }
 *   archive_memory      { id }
 */
const Anthropic = require('@anthropic-ai/sdk');
const { sbSelect, sbInsert, sbUpdate, sbDelete } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');
const { TOOLS, execute, clip } = require('./_lib/mktg-tools.js');

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TURNS = 5;
const MAX_HISTORY = 30;
const MEMORY_LIMIT = 60;

// ── Cached persona block ──
const STABLE_SYSTEM = `You are the marketing brain for PrimalPantry — a private AI Curtis (founder + CMO) uses to think through Meta ads, copy, concepts, scripts and brand decisions.

# What you have access to (via tools)
- The full playbook: campaigns (tallow-balm, shampoo-bar, reviana), products, copy/visual/video archetypes, concepts (with status: workhorse/efficient/tested/new/gap/retired), 86 historical ads with Meta performance, 7 production scripts, hooks, offers, locked decisions, weekly batches.
- Long-term marketing memory facts you accumulate across conversations.
- Uploads Curtis has shared in this and prior conversations (links, pasted copy, screenshots-as-text).
- A wizard-tool surface (\`wizard_*\`) for driving end-to-end ad creation conversationally — see "Ad creation flow" below.

# Tone
- Peer-to-peer with a founder who built his own ad system and reads performance data daily. Specific, sharp, no fluff. No "great question", no cheerleader language, no emojis.
- 1–4 short sentences for back-and-forth. When you're recommending creative or making a call ABOUT performance, longer is fine — back it with what the data shows.
- Honest. If a concept has 3 results at $80 CPR, don't pretend it's working.

# Always before writing copy
1. \`list_locked_decisions\` — customer count is "100,000+ kiwis"; PrimalPantry pulled out of retail (past tense, no scarcity hook); Reviana not Reviora; Reviana frames as "tallow + cosmeceutical actives" NOT a separate anti-aging brand.
2. Whatever campaign-specific context you need (\`get_campaign\`, \`top_ads\` for that campaign, \`get_concept\`).

# Ad creation flow (when Curtis wants to make an ad)
Trigger: he says he wants to make an ad, OR an internal kickoff message tells you to start one. Walk him through these as a CONVERSATION — not a form. Ask one thing at a time. Don't list the steps to him.

1. **Objective** — "What's this ad for?" Once he answers, call \`wizard_set({ objective })\`.
2. **Campaign** — infer from the objective if obvious ("Reviana day cream" → reviana). Confirm or ask. \`wizard_set({ campaign_id })\`.
3. **Format / audience / landing URL** — ask what format (static/video/carousel/reel), the audience (cold/warm/lookalike/lapsed), and landing URL. Batch these into one or two questions, don't ask them one by one. Once you have the audience + campaign, also infer a \`trust_priority\` (\`high\` for cold + reactive-skin / first-touch eczema audiences; \`medium\` for warm or familiar; \`low\` for retargeting / existing customers) and pass it in the same \`wizard_set\` call. \`wizard_set({ format, audience_type, landing_url, trust_priority })\`. Don't ask him about trust priority — infer it silently and move on.
4. **Concept** — call \`wizard_recommend_concepts\`, then present 3 options to him in 1–2 sentences each. He picks. \`wizard_select_concept({ concept_id })\` (or \`new_name\` if he wants to invent one).
5. **Creative** — call \`wizard_generate_creative\`. Summarise the output in his words (don't dump the JSON). For video: tell him the timeline beats + what B-roll he needs. For static: tell him the visual brief + that you've got 3 image-gen prompts ready. Ask if he wants to regenerate or move on.
6. **Copy** — call \`wizard_generate_copy\`. Then BEFORE showing the variants to Curtis, call \`wizard_critique\`. Read the verdict and act:
   - \`ship\` → show both variants to him and ask which he prefers. Don't read the critique aloud.
   - \`repair\` → don't show him the original. Quietly call \`wizard_generate_copy({ feedback: <repair_instructions from the critique> })\` again, then re-critique. Cap at 2 repair loops — if the second still isn't ship, surface the second attempt to him with a one-line "I had to tighten this — let me know if it lands" rather than another loop.
   - \`replace\` → tell him plainly the angle isn't working ("This concept isn't landing — let me pull different ones") and go back to \`wizard_recommend_concepts\`.
   When you do show him the variants, present them as v1 / v2. He picks one OR asks for changes (pass the change as \`feedback\` to \`wizard_generate_copy\` and re-critique).
7. **Finalize** — once he approves the copy, call \`wizard_finalize({ primary_text_final, chosen_variant: 'v1'|'v2', user_edits_diff })\`. \`chosen_variant\` is which generated variant he based the final on (required). \`user_edits_diff\` is a SHORT plain-English summary of what he changed from that variant — e.g. "cut the second paragraph", "swapped the EANZ line in", "tightened opener" — empty string if shipped as-is. The chat UI renders the ready-to-paste card automatically; just tell him "Done. Ready to paste into Meta."

If he opens the chat fresh and the kickoff hint says he just wants to start an ad, your FIRST message should be a single specific question — usually "What's this ad for?" — vary the wording. Don't announce the steps. Don't ask "ready to start?".

# Tool discipline
- Don't dump full lists at the user. Use tools to ground yourself, then answer in your own words with specifics.
- 2–3 read calls per turn is fine; 6+ makes him wait. Memory + recent uploads are already in your dynamic context — use them directly.
- \`save_upload\` whenever the user pastes copy, a link, or a description of a screenshot. Always include a one-line caption summarising why this matters. Tag to an entity if you can identify which ad/concept/script it relates to.
- \`remember\` for durable patterns ("VS3 founder-direct openers convert 30% better on Reviana", "kiwi-coded language lifts CTR on tallow-balm"). NOT one-off ad numbers — those live in the database.
- \`tag_upload_to_entity\` when context arrives later about a previously-shared upload.
- Wizard tools each return a \`draft\` object — you don't need to relay it; the chat UI renders the wizard state automatically.

# What he sees
He sees your text replies. He doesn't see this prompt or the dynamic context block.`;

// ── Dynamic context ──
async function loadContext(userId) {
  const [memoryFacts, recentUploads] = await Promise.all([
    sbSelect(
      'mktg_memory_facts',
      `user_id=eq.${userId}&archived=eq.false&order=importance.desc,created_at.desc&limit=${MEMORY_LIMIT}&select=fact,topic,importance`
    ),
    sbSelect(
      'mktg_uploads',
      `user_id=eq.${userId}&order=created_at.desc&limit=15&select=id,kind,caption,text_body,url,target_table,target_id,created_at`
    ),
  ]);
  return {
    memoryFacts,
    recentUploads,
    nzTimeStr: new Intl.DateTimeFormat('en-NZ', {
      timeZone: 'Pacific/Auckland',
      weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date()),
  };
}

function buildDynamic({ memoryFacts, recentUploads, nzTimeStr, conversation }) {
  const memBlock = memoryFacts.length
    ? memoryFacts.map((m) => `• [${m.importance}] ${m.topic ? `(${m.topic}) ` : ''}${m.fact}`).join('\n')
    : '(no marketing memory yet — call remember() when you learn something durable)';

  const uplBlock = recentUploads.length
    ? recentUploads.map((u) => {
        const where = u.target_table ? ` → ${u.target_table.replace('mktg_','')}#${u.target_id}` : '';
        if (u.kind === 'link') return `• [link${where}] ${u.url}${u.caption ? ` — ${u.caption}` : ''}`;
        if (u.kind === 'text') return `• [text${where}] ${u.caption || (u.text_body || '').slice(0, 80)}`;
        return `• [${u.kind}${where}] ${u.caption || ''}`;
      }).join('\n')
    : '(no uploads yet)';

  return `# Dynamic state (current)

## Active conversation
${conversation?.title ? `Title: ${conversation.title}` : '(untitled)'}
Kind: ${conversation?.kind || 'context'}
${conversation?.active_campaign ? `Active campaign: ${conversation.active_campaign}` : 'No active campaign focus.'}

## Marketing memory (top ${memoryFacts.length})
${memBlock}

## Recent uploads (last ${recentUploads.length})
${uplBlock}

## NZ time
${nzTimeStr}`;
}

function systemBlocks(dynamicText) {
  return [
    { type: 'text', text: STABLE_SYSTEM, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dynamicText },
  ];
}

// ── Conversation helpers ──
async function getConversation(userId, id) {
  const rows = await sbSelect('mktg_conversations', `id=eq.${id}&user_id=eq.${userId}&select=*&limit=1`);
  return rows?.[0] || null;
}

async function getMessagesAll(conversationId, userId) {
  return sbSelect(
    'mktg_messages',
    `conversation_id=eq.${conversationId}&user_id=eq.${userId}&order=created_at.asc&limit=500&select=id,role,content_text,content_blocks,created_at`
  );
}

async function getMessagesForModel(conversationId) {
  const rows = await sbSelect(
    'mktg_messages',
    `conversation_id=eq.${conversationId}&order=created_at.desc&limit=${MAX_HISTORY}&select=role,content_text,content_blocks`
  );
  return rows.reverse();
}

function toAnthropicMessages(rows) {
  const out = [];
  for (const r of rows) {
    const blocks = Array.isArray(r.content_blocks) && r.content_blocks.length
      ? r.content_blocks
      : (r.content_text ? [{ type: 'text', text: r.content_text }] : []);
    if (r.role === 'tool') out.push({ role: 'user', content: blocks });
    else                   out.push({ role: r.role, content: blocks });
  }
  return out;
}

// Expand any `image_ref` blocks into Claude vision blocks (`image` with
// base64 source) by fetching the file from Supabase Storage at request time.
// We don't store base64 in the DB — keeps the message JSONB lean and means
// rotated/deleted images don't leak old bytes into the model.
const STORAGE_BUCKET = 'mktg-uploads';

async function fetchStorageBase64(storagePath) {
  const url = `${process.env.SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${storagePath}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`Fetch ${storagePath}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('base64');
}

async function expandImageRefs(messages) {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    const expanded = [];
    for (const block of msg.content) {
      if (block?.type === 'image_ref' && block.storage_path) {
        try {
          const data = await fetchStorageBase64(block.storage_path);
          expanded.push({
            type: 'image',
            source: { type: 'base64', media_type: block.mime_type || 'image/png', data },
          });
        } catch (e) {
          expanded.push({ type: 'text', text: `[image unavailable: ${block.upload_id || block.storage_path}]` });
        }
      } else {
        expanded.push(block);
      }
    }
    msg.content = expanded;
  }
  return messages;
}

async function saveMessage(conversationId, userId, role, text, blocks, usage = null) {
  return sbInsert('mktg_messages', {
    conversation_id: conversationId,
    user_id:         userId,
    role,
    content_text:    text,
    content_blocks:  blocks || [],
    tokens_in:       usage?.input_tokens || null,
    tokens_out:      usage?.output_tokens || null,
  });
}

async function touchConversation(id, patch = {}) {
  await sbUpdate('mktg_conversations', `id=eq.${id}`, { last_message_at: new Date().toISOString(), ...patch });
}

function makeTitle(text) {
  const t = (text || '').trim().split('\n')[0].slice(0, 60);
  return t || 'New chat';
}

async function runChat({ userId, conversation, userMessageText, attachments = [] }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // attachments is an array of { upload_id, storage_path, mime_type } describing
  // images already stored in mktg_uploads. They get persisted as `image_ref`
  // blocks so we never bloat the DB with base64.
  const imageRefs = (attachments || []).map((a) => ({
    type: 'image_ref',
    upload_id: a.upload_id,
    storage_path: a.storage_path,
    mime_type: a.mime_type,
  }));
  const userBlocks = [
    ...imageRefs,
    ...(userMessageText ? [{ type: 'text', text: userMessageText }] : []),
  ];
  if (userBlocks.length === 0) throw new Error('Empty message');
  await saveMessage(conversation.id, userId, 'user', userMessageText || null, userBlocks);

  if (!conversation.title) {
    const title = makeTitle(userMessageText || (imageRefs.length > 0 ? `Image: ${imageRefs.length} attached` : ''));
    await sbUpdate('mktg_conversations', `id=eq.${conversation.id}`, { title });
    conversation.title = title;
  }

  const history = await getMessagesForModel(conversation.id);
  const messages = await expandImageRefs(toAnthropicMessages(history));

  const ctx = await loadContext(userId);
  const system = systemBlocks(buildDynamic({ ...ctx, conversation }));

  let totalUsage = { input_tokens: 0, output_tokens: 0 };
  let finalText = '';
  let finalBlocks = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system,
      tools: TOOLS,
      messages,
    });
    totalUsage.input_tokens  += response.usage?.input_tokens || 0;
    totalUsage.output_tokens += response.usage?.output_tokens || 0;

    if (response.stop_reason === 'tool_use') {
      const txt = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      const asstSaved = await saveMessage(conversation.id, userId, 'assistant', txt || null, response.content, response.usage);
      messages.push({ role: 'assistant', content: response.content });

      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        let result;
        try {
          result = await execute(block.name, block.input || {}, {
            userId,
            conversationId: conversation.id,
            messageId: asstSaved?.id,
          });
        } catch (e) {
          result = { error: e.message };
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: clip(JSON.stringify(result), 6000),
        });
      }

      await saveMessage(conversation.id, userId, 'tool', null, toolResults);
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    finalBlocks = response.content;
    finalText = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    await saveMessage(conversation.id, userId, 'assistant', finalText || '', finalBlocks, response.usage);
    break;
  }

  await touchConversation(conversation.id);
  return { text: finalText, blocks: finalBlocks, usage: totalUsage };
}

// AI greets first when the chat is opened from the "Marketing mode" FAB. The
// kickoff hint is a synthetic user-role message that is NOT persisted to the
// DB, so the visible history starts with the AI's reply.
async function runAutoOpen({ userId, conversation, modeHint }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const ctx = await loadContext(userId);
  const system = systemBlocks(buildDynamic({ ...ctx, conversation }));

  const kickoff = modeHint === 'create_ad'
    ? `[INTERNAL — do NOT echo this. Curtis just clicked "Marketing mode" on the business page. He wants to make an ad. Open with ONE specific question to start the ad-creation flow — usually "What's this ad for?" but vary the wording. Don't announce the 7 steps. Keep it under 20 words.]`
    : `[INTERNAL — Curtis just opened a fresh marketing chat. NZ time: ${ctx.nzTimeStr}. Ask one specific opening question. Keep it under 20 words.]`;

  const messages = [{ role: 'user', content: [{ type: 'text', text: kickoff }] }];

  let totalUsage = { input_tokens: 0, output_tokens: 0 };
  let finalText = '';
  let finalBlocks = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system,
      tools: TOOLS,
      messages,
    });
    totalUsage.input_tokens  += response.usage?.input_tokens || 0;
    totalUsage.output_tokens += response.usage?.output_tokens || 0;

    if (response.stop_reason === 'tool_use') {
      // Don't persist the synthetic kickoff or any tool turns it triggers —
      // we only persist the final assistant opener.
      messages.push({ role: 'assistant', content: response.content });
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        let result;
        try {
          result = await execute(block.name, block.input || {}, {
            userId,
            conversationId: conversation.id,
          });
        } catch (e) { result = { error: e.message }; }
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: clip(JSON.stringify(result), 6000) });
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    finalBlocks = response.content;
    finalText = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    await saveMessage(conversation.id, userId, 'assistant', finalText || '', finalBlocks, response.usage);
    break;
  }

  await touchConversation(conversation.id);
  return { text: finalText, blocks: finalBlocks, usage: totalUsage };
}

exports.handler = withGate(async (event, { user }) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  try {
    if (action === 'list_conversations') {
      const rows = await sbSelect(
        'mktg_conversations',
        `user_id=eq.${user.id}&order=last_message_at.desc&limit=50&select=id,title,kind,active_campaign,started_at,last_message_at`
      );
      return reply(200, { conversations: rows });
    }

    if (action === 'create_conversation') {
      const created = await sbInsert('mktg_conversations', {
        user_id:         user.id,
        kind:            body.kind || 'context',
        title:           body.title || null,
        active_campaign: body.active_campaign || null,
      });
      return reply(200, { conversation: created });
    }

    if (action === 'auto_open') {
      const { conversation_id, mode_hint } = body;
      if (!conversation_id) return reply(400, { error: 'conversation_id required' });
      const conversation = await getConversation(user.id, conversation_id);
      if (!conversation) return reply(404, { error: 'conversation not found' });
      // Idempotent: if the chat already has messages, skip and just return them
      const existing = await sbSelect(
        'mktg_messages',
        `conversation_id=eq.${conversation_id}&user_id=eq.${user.id}&limit=1&select=id`
      );
      if (existing?.length > 0) {
        const messages = await getMessagesAll(conversation_id, user.id);
        return reply(200, { skipped: true, messages });
      }
      const result = await runAutoOpen({ userId: user.id, conversation, modeHint: mode_hint || null });
      const messages = await getMessagesAll(conversation_id, user.id);
      return reply(200, { text: result.text, usage: result.usage, messages });
    }

    if (action === 'get_conversation') {
      if (!body.id) return reply(400, { error: 'id required' });
      const conversation = await getConversation(user.id, body.id);
      if (!conversation) return reply(404, { error: 'not found' });
      const messages = await getMessagesAll(body.id, user.id);
      return reply(200, { conversation, messages });
    }

    if (action === 'delete_conversation') {
      if (!body.id) return reply(400, { error: 'id required' });
      await sbDelete('mktg_conversations', `id=eq.${body.id}&user_id=eq.${user.id}`);
      return reply(200, { success: true });
    }

    if (action === 'send') {
      const { conversation_id, text, attachments } = body;
      if (!conversation_id) return reply(400, { error: 'conversation_id required' });
      const trimmed = (text || '').trim();
      const atts = Array.isArray(attachments) ? attachments : [];
      if (!trimmed && atts.length === 0) return reply(400, { error: 'text or attachments required' });
      const conversation = await getConversation(user.id, conversation_id);
      if (!conversation) return reply(404, { error: 'conversation not found' });
      const result = await runChat({
        userId: user.id,
        conversation,
        userMessageText: trimmed,
        attachments: atts,
      });
      const messages = await getMessagesAll(conversation_id, user.id);
      return reply(200, { text: result.text, usage: result.usage, messages });
    }

    if (action === 'list_memory') {
      const topicFilter = body.topic ? `&topic=eq.${encodeURIComponent(body.topic)}` : '';
      const rows = await sbSelect(
        'mktg_memory_facts',
        `user_id=eq.${user.id}&archived=eq.false${topicFilter}&order=importance.desc,created_at.desc&select=*`
      );
      return reply(200, { facts: rows });
    }

    if (action === 'archive_memory') {
      if (!body.id) return reply(400, { error: 'id required' });
      await sbUpdate('mktg_memory_facts', `id=eq.${body.id}&user_id=eq.${user.id}`, { archived: true });
      return reply(200, { success: true });
    }

    return reply(400, { error: 'Unknown action' });
  } catch (e) {
    console.error('[mktg-chat]', e);
    return reply(500, { error: e.message || 'Server error' });
  }
});
