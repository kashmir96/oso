/**
 * mktg-ads.js — the Meta Ads creator wizard.
 *
 * Step-by-step builder that progressively fills an mktg_drafts row, calling
 * Claude (Sonnet for creative quality) at the generation steps. The wizard
 * holds state in DB so drafts can be resumed days later.
 *
 * Actions:
 *   list_drafts        -> { drafts: [...] }
 *   get_draft          { id } -> { draft }
 *   create_draft       { objective?, campaign_id?, format?, ... } -> { draft }
 *   update_draft       { id, ...patch } -> { draft }
 *   delete_draft       { id } -> { success }
 *   archive_draft      { id } -> { draft }
 *
 *   generate_concepts  { id } -> { recommended_concepts: [{id,name,why}] }
 *   generate_creative  { id } -> { creative: {...} }   (shape varies by format)
 *   generate_copy      { id } -> { primary_text_v1, primary_text_v2, headline, description, cta, naming }
 *   regenerate_step    { id, step: 'concept'|'creative'|'copy', feedback } -> regenerates with the feedback
 */
const Anthropic = require('@anthropic-ai/sdk');
const { sbSelect, sbInsert, sbUpdate, sbDelete } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');

// Sonnet 4.6 for creative — Haiku is great for chat, but ad copy is the one
// place quality matters more than latency. Cap output and cache the playbook.
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS_CONCEPTS = 1200;
const MAX_TOKENS_CREATIVE = 2000;
const MAX_TOKENS_COPY     = 1500;
const MAX_TOKENS_CRITIQUE = 1200;
const MAX_TOKENS_FEEDBACK = 800;

// Register-level anti-patterns. Inserted into every generator's system prompt
// after the locked-decisions reminder, before the JSON output shape. These
// expand "kiwi-coded, peer-to-peer, warm but plain-spoken" — they don't
// replace it. Keep this verbatim across generators so the model sees the same
// guardrail every call (and the prompt cache stays warm).
const REGISTER_ANTIPATTERNS = `Register anti-patterns — DO NOT:
- Don't use vague hyperbole: "this is the one", "say goodbye to ___", "transform your skin", "the secret to", "game-changer", "holy grail".
- Don't use luxury/pamper register: "indulge", "treat yourself", "pamper", "luxe", "ritual", "spa-like".
- Don't use clean-beauty/wellness register: "clean ingredients", "non-toxic", "wellness journey", "self-care moment", "actives", "regimens", "skincare routine".
- Don't frame the brand as a small struggling startup ("just a tiny family business trying to make it"). We're 23 people shipping ~50,000 units/year — past that.
- Don't frame the brand as a polished mega-brand either. DTC, direct, plainspoken.
- Don't open with "Hey guys", "What's up", "Welcome back" or generic creator openers.
- Don't hide what tallow is — it's rendered beef fat. Say so plainly when the moment calls for it.
- Don't make medical claims (cure, treat, heal, fix eczema). EANZ Gold Supporter relationship depends on this.
- Don't use scarcity around retail availability — pull-out is complete and past tense.`;

// Trust priority context block. Placed in the user message of generateCreative
// + generateCopy so the model knows when to lead with explicit trust levers
// (cold + reactive audience) vs. skip them (retargeting / existing customers).
function trustPriorityBlock(level) {
  const lvl = level || 'medium';
  return `Trust priority: ${lvl}
- high: lead with at least one specific trust lever (EANZ Gold Supporter, NZ-made in Christchurch, 100,000+ kiwis served, "patch test first", or founder voice). Don't lead with offer or discount.
- medium: include a trust lever casually if it fits — don't force it.
- low: existing customers / retargeting — skip the trust setup, lead with offer, new product, or new angle.`;
}

// ── Helpers ──
async function getDraft(userId, id) {
  const rows = await sbSelect('mktg_drafts', `id=eq.${encodeURIComponent(id)}&user_id=eq.${userId}&select=*&limit=1`);
  return rows?.[0] || null;
}

async function patchDraft(userId, id, patch) {
  const updated = await sbUpdate(
    'mktg_drafts',
    `id=eq.${encodeURIComponent(id)}&user_id=eq.${userId}`,
    { ...patch, updated_at: new Date().toISOString() }
  );
  return Array.isArray(updated) ? updated[0] : updated;
}

// Lightweight lookups — we hand the model just the parts of the playbook
// that matter to this draft to keep tokens tight.
async function loadDraftContext(draft) {
  const cid = draft.campaign_id;
  const enc = cid ? encodeURIComponent(cid) : null;
  const [campaign, concepts, lockedDecisions, hooks, offers, topAds, copyArchetypes] = await Promise.all([
    cid ? sbSelect('mktg_campaigns', `id=eq.${enc}&select=*&limit=1`) : Promise.resolve([]),
    cid ? sbSelect('mktg_concepts', `campaign_id=eq.${enc}&select=id,name,status,copy_archetype_id,visual_archetype_ids,video_opener_ids,performance,notes&order=status.asc&limit=40`)
        : Promise.resolve([]),
    sbSelect('mktg_locked_decisions', 'select=*'),
    cid ? sbSelect('mktg_hooks', `campaign_ids=cs.{${cid}}&select=*`) : sbSelect('mktg_hooks', 'select=*&limit=40'),
    cid ? sbSelect('mktg_offers', `applies_to_campaigns=cs.{${cid}}&select=*`) : sbSelect('mktg_offers', 'select=*&limit=20'),
    cid ? sbSelect('mktg_ads', `campaign_id=eq.${enc}&select=ad_name,format,title,body,call_to_action,performance&limit=80`) : Promise.resolve([]),
    cid ? sbSelect('mktg_copy_archetypes', `campaign_id=eq.${enc}&select=*&order=type_label.asc`) : Promise.resolve([]),
  ]);

  // Top performing ads in this campaign by spend (cheap reference voice)
  const sortedAds = topAds
    .filter((a) => a.performance?.spend_nzd)
    .sort((a, b) => (b.performance.spend_nzd || 0) - (a.performance.spend_nzd || 0))
    .slice(0, 8);

  return {
    campaign: campaign?.[0] || null,
    concepts,
    lockedDecisions,
    hooks,
    offers,
    topAds: sortedAds,
    copyArchetypes,
  };
}

function lockedDecisionsBlock(rows) {
  if (!rows.length) return '(none)';
  return rows.map((d) => `- ${d.key}: ${d.value}${d.notes ? ` (${d.notes})` : ''}`).join('\n');
}

function conceptListBlock(rows, withPerf = true) {
  if (!rows.length) return '(none)';
  return rows.map((c) => {
    const perf = withPerf && c.performance
      ? ` — spend $${Math.round(c.performance.spend_nzd || 0)}, ${c.performance.results || 0} sales` +
        (c.performance.cpr_nzd ? `, CPR $${c.performance.cpr_nzd.toFixed(2)}` : '')
      : '';
    return `- [${c.status}] ${c.id} — ${c.name}${perf}${c.notes ? ` :: ${c.notes}` : ''}`;
  }).join('\n');
}

function adsBlock(rows) {
  if (!rows.length) return '(none)';
  return rows.map((a) => {
    const p = a.performance || {};
    return `### ${a.ad_name} (${a.format || '?'} — spend $${Math.round(p.spend_nzd || 0)}, ${p.results || 0} sales)
Title: ${a.title || '—'}
Body: ${(a.body || '').slice(0, 600)}`;
  }).join('\n\n');
}

function clamp(s, n) {
  if (typeof s !== 'string') return s;
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// Strip markdown fencing from JSON output and parse.
function parseJSON(text) {
  if (!text) throw new Error('Empty model response');
  let s = text.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  }
  // Try to locate the first {...} or [...] if there's surrounding prose
  const firstBrace = Math.min(...['[', '{'].map((c) => {
    const i = s.indexOf(c);
    return i === -1 ? Infinity : i;
  }));
  if (firstBrace !== Infinity && firstBrace !== 0) s = s.slice(firstBrace);
  return JSON.parse(s);
}

// ── Generators ──

async function generateConcepts(draft) {
  const ctx = await loadDraftContext(draft);
  const c = client();

  const sys = [
    {
      type: 'text',
      text: `You recommend ad concepts for PrimalPantry — a NZ tallow-skincare brand. You will get an objective, a campaign and a format, plus the campaign's existing concept library and top-performing ads. Recommend 3 concepts that fit the objective. Prefer concepts with status 'workhorse' or 'efficient' when available; otherwise propose new concepts that build on patterns the top-performing ads exhibit.

Honour the locked brand decisions (especially: PrimalPantry pulled out of retail — past tense, no scarcity hook around availability; customer count is "100,000+ kiwis"; Reviana — not Reviora; Reviana frames as "tallow + cosmeceutical actives", NOT a separate anti-aging brand).

${REGISTER_ANTIPATTERNS}

Respond ONLY with JSON of the form: [{"id":"<existing-concept-id-or-null>","name":"<short concept name>","why":"<2-3 sentences why this fits the objective + format>"}]. If recommending a brand-new concept set id to null.`,
      cache_control: { type: 'ephemeral' },
    },
  ];

  const user = `# Objective
${draft.objective || '(not set)'}

# Campaign
${ctx.campaign ? `${ctx.campaign.id} — ${ctx.campaign.name}\nRole: ${ctx.campaign.role_in_funnel}\n${ctx.campaign.description}` : '(not set)'}

# Format
${draft.format || '(not set)'}

# Audience
${draft.audience_type || '(not specified — assume cold)'}

# Locked brand decisions
${lockedDecisionsBlock(ctx.lockedDecisions)}

# Existing concepts in this campaign
${conceptListBlock(ctx.concepts)}

# Top-spend ads in this campaign (reference voice)
${clamp(adsBlock(ctx.topAds.slice(0, 4)), 4000)}

Pick 3 concepts. Respond with JSON only.`;

  const resp = await c.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS_CONCEPTS,
    system: sys,
    messages: [{ role: 'user', content: user }],
  });
  const text = resp.content.find((b) => b.type === 'text')?.text || '';
  const concepts = parseJSON(text);
  if (!Array.isArray(concepts)) throw new Error('Expected array of concepts');
  return concepts.slice(0, 5);
}

async function generateCreative(draft) {
  const ctx = await loadDraftContext(draft);
  const concept = draft.selected_concept_id
    ? (await sbSelect('mktg_concepts', `id=eq.${encodeURIComponent(draft.selected_concept_id)}&select=*&limit=1`))[0]
    : null;
  const c = client();

  const isVideo = draft.format === 'video' || draft.format === 'reel';
  const formatNote = isVideo
    ? `Produce a SHORT video timeline (≤30s for static feed, ≤45s for reels). Output JSON: {"timeline": [{"ts_sec": 0, "shot": "<what's on screen>", "vo": "<voiceover for this beat or null>"}, ...], "vo_script": "<continuous voiceover text>", "b_roll_shots": ["<each B-roll the user needs to shoot or generate>"], "shot_list": ["<plain-language shot descriptions for the user to film/source>"]}`
    : `Produce visual direction for a static or carousel ad. Output JSON: {"visual_brief": "<one-paragraph creative direction>", "image_prompts": ["<prompt 1, suitable for an image generator>", "<prompt 2>", "<prompt 3>"], "shot_list": ["<plain-language shots if user is shooting it themselves>"]}`;

  const sys = [
    {
      type: 'text',
      text: `You produce creative direction for PrimalPantry Meta ads. Tone: NZ kiwi-coded, peer-to-peer, warm but plain-spoken.

Honour the locked brand decisions (especially: PrimalPantry pulled out of retail — past tense, no scarcity hook; customer count is "100,000+ kiwis"; Reviana not Reviora; Reviana frames as "tallow + cosmeceutical actives" NOT a separate anti-aging brand).

${REGISTER_ANTIPATTERNS}

Respond ONLY with JSON of the requested shape — no prose around it.`,
      cache_control: { type: 'ephemeral' },
    },
  ];

  const user = `# Objective
${draft.objective || '(not set)'}

# Campaign
${ctx.campaign ? `${ctx.campaign.id} — ${ctx.campaign.name} (${ctx.campaign.role_in_funnel})` : '(not set)'}

# Format
${draft.format || '(not set)'}

# Audience
${draft.audience_type || '(not specified — assume cold)'}

# Trust priority (gates explicit trust levers)
${trustPriorityBlock(draft.trust_priority)}

# Selected concept
${concept ? `${concept.id} — ${concept.name}\nStatus: ${concept.status}\nNotes: ${concept.notes || '—'}` : '(no existing concept selected — invent one that fits the objective)'}

# Locked brand decisions
${lockedDecisionsBlock(ctx.lockedDecisions)}

# Top-spend ads in this campaign (use as voice reference, NOT to copy)
${clamp(adsBlock(ctx.topAds.slice(0, 3)), 3500)}

# Format-specific instructions
${formatNote}

Output JSON only.`;

  const resp = await c.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS_CREATIVE,
    system: sys,
    messages: [{ role: 'user', content: user }],
  });
  const text = resp.content.find((b) => b.type === 'text')?.text || '';
  return parseJSON(text);
}

async function generateCopy(draft, opts = {}) {
  const ctx = await loadDraftContext(draft);
  const concept = draft.selected_concept_id
    ? (await sbSelect('mktg_concepts', `id=eq.${encodeURIComponent(draft.selected_concept_id)}&select=*&limit=1`))[0]
    : null;
  const c = client();

  const sys = [
    {
      type: 'text',
      text: `You write Meta ad copy for PrimalPantry. Tone: NZ kiwi-coded, peer-to-peer, warm but plain-spoken. Specific over generic.

Honour the locked brand decisions. Do NOT use scarcity around retail — pull-out is complete and past-tense. Customer count is "100,000+ kiwis" (don't say 20k/60k/85k/95k — those are stale).

${REGISTER_ANTIPATTERNS}

Output JSON ONLY:
{
  "primary_text_v1": "<full primary text version A — open with a sharp hook, ~80-160 words>",
  "primary_text_v2": "<version B — different angle (e.g. v1 is benefit-led, v2 is testimonial/founder voice)>",
  "headline": "<≤40 chars>",
  "description": "<≤30 chars (Meta link description)>",
  "cta": "SHOP_NOW | LEARN_MORE | SIGN_UP | GET_OFFER",
  "naming": "<concept-id_format_audience_YYYYMMDD — for Meta ad name>"
}`,
      cache_control: { type: 'ephemeral' },
    },
  ];

  const user = `# Objective
${draft.objective || '(not set)'}

# Campaign
${ctx.campaign ? `${ctx.campaign.id} — ${ctx.campaign.name}` : '(not set)'}

# Format / audience / landing
Format: ${draft.format || '?'}
Audience: ${draft.audience_type || 'cold (assume)'}
Landing URL: ${draft.landing_url || '(not provided — use {{landing}})'}

# Trust priority (gates explicit trust levers)
${trustPriorityBlock(draft.trust_priority)}

# Selected concept
${concept ? `${concept.id} — ${concept.name}` : '(brand-new — invent)'}

# Creative direction (already produced)
${draft.creative ? clamp(JSON.stringify(draft.creative), 2500) : '(no creative yet)'}

# Locked brand decisions
${lockedDecisionsBlock(ctx.lockedDecisions)}

# Reference: top ads in this campaign
${clamp(adsBlock(ctx.topAds.slice(0, 3)), 3500)}

${opts.feedback ? `\n# User feedback on previous version\n${opts.feedback}\n` : ''}

Output JSON only.`;

  const resp = await c.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS_COPY,
    system: sys,
    messages: [{ role: 'user', content: user }],
  });
  const text = resp.content.find((b) => b.type === 'text')?.text || '';
  return parseJSON(text);
}

// ── Graduation: live drafts → mktg_ads + memory fact ──
// When a draft flips to status='live', insert a corresponding mktg_ads row so
// loadDraftContext() can pull it as voice reference for future generations.
// Also drop a memory fact noting what shipped (high-importance — these are
// the strongest learning signals we get). Both are best-effort: failures log
// but don't break the live transition.
async function graduateLiveDraftToAds(userId, draft, beforeDraft) {
  const out = { graduated_ad_id: null, memory_fact_id: null, skipped: null };

  // Skip if there's no real concept (e.g. brand-new "__new:..." synthetic ids)
  // — mktg_ads.concept_id needs to point at a real concept row.
  let conceptId = draft.selected_concept_id || null;
  if (conceptId && conceptId.startsWith('__new:')) conceptId = null;

  // Skip if the draft has no shippable copy at all.
  const finalText = draft.primary_text_final || draft.primary_text_v1 || null;
  if (!finalText) {
    out.skipped = 'no primary text';
    return out;
  }

  // Idempotency: if this exact draft already graduated (we stamp ad_id back
  // onto the draft.notes JSON or via a naming convention), don't double up.
  // Cheapest check — same naming + same campaign + recently created.
  const adName = draft.naming || `draft-${draft.id.slice(0, 8)}`;
  try {
    const dupes = await sbSelect(
      'mktg_ads',
      `ad_name=eq.${encodeURIComponent(adName)}&select=ad_id&limit=1`
    );
    if (dupes?.length) {
      out.skipped = 'already graduated';
      out.graduated_ad_id = dupes[0].ad_id;
      return out;
    }
  } catch (_) { /* fall through and try insert */ }

  // Format must match the mktg_ads check constraint.
  const validFormats = new Set(['static','video','carousel','reel','unknown']);
  const format = validFormats.has(draft.format) ? draft.format : 'unknown';

  try {
    const inserted = await sbInsert('mktg_ads', {
      ad_id:               `gradd_${draft.id.slice(0, 8)}_${Date.now()}`,
      ad_name:             adName,
      campaign_id:         draft.campaign_id,
      concept_id:          conceptId,
      format,
      creative_type:       'graduated_from_draft',
      title:               draft.headline || null,
      body:                finalText,
      call_to_action:      draft.cta || null,
      call_to_action_link: draft.landing_url || null,
      // Performance starts empty — the regular Meta sync (or a future
      // ad-spend backfill) populates it. The ad still serves as voice
      // reference even with zero spend.
      performance:         {},
    });
    out.graduated_ad_id = inserted?.ad_id || null;
  } catch (e) {
    console.error('[graduateLiveDraftToAds] insert failed:', e?.message || e);
  }

  // Memory fact — short, high-importance, includes the durable signal of why
  // it shipped (audience + trust + which variant won + any feedback themes).
  try {
    const fb = draft.feedback_analysis || {};
    const themes = Array.isArray(fb.preference_signals) ? fb.preference_signals.slice(0, 2) : [];
    const themeNote = themes.length ? ` Wins: ${themes.join('; ')}.` : '';
    const variantNote = draft.chosen_variant ? ` (chose ${draft.chosen_variant})` : '';
    const fact = `Shipped: "${(adName).slice(0, 60)}" — ${draft.campaign_id || '?'} / ${draft.format || '?'} / ${draft.audience_type || 'audience ?'} / trust=${draft.trust_priority || 'medium'}${variantNote}.${themeNote}`;
    const factRow = await sbInsert('mktg_memory_facts', {
      user_id:    userId,
      fact:       fact.slice(0, 600),
      topic:      'shipped_ad',
      importance: 5,
      source_message_id: null,
    });
    out.memory_fact_id = factRow?.id || null;
  } catch (e) {
    console.error('[graduateLiveDraftToAds] memory insert failed:', e?.message || e);
  }

  return out;
}

// ── Critique & feedback ──
// generateCritique runs once both copy variants exist, before finalize, and
// returns { scores, rationale, verdict, repair_instructions }. The wizard
// uses verdict to gate finalize: ship → continue, repair → regenerate copy
// with the instructions, replace → start the concept step over.
async function generateCritique(draft) {
  const ctx = await loadDraftContext(draft);
  const c = client();

  const sys = [
    {
      type: 'text',
      text: `You critique a PrimalPantry ad draft before it ships. You see the full draft (creative + both copy variants + headline/cta) and grade it against brand voice, register, locked decisions, concept alignment, and hook strength. Be blunt and specific — Curtis wants you to catch register slips, locked-decision violations, weak hooks. You give exactly one verdict.

Honour the locked brand decisions and the register anti-patterns below.

${REGISTER_ANTIPATTERNS}

Output JSON ONLY:
{
  "scores": {
    "brand_voice": 0-10,
    "register": 0-10,
    "locked_decisions": 0-10,
    "concept_alignment": 0-10,
    "hook_strength": 0-10
  },
  "rationale": "<2-3 sentences: what's working, what's weak. Specific, not generic.>",
  "verdict": "ship" | "repair" | "replace",
  "repair_instructions": "<if verdict=repair: 1-3 specific changes to make to copy. If ship or replace: empty string.>"
}

Verdict rules:
- ship: scores mostly ≥7, no register or locked-decision violation. Ready as-is.
- repair: scores 5-7, one targeted rewrite of the copy will fix it. Provide repair_instructions.
- replace: any register-level violation, any locked-decision violation, OR scores mostly <5. The concept itself is wrong — start over.`,
      cache_control: { type: 'ephemeral' },
    },
  ];

  const user = `# Draft under review
Objective: ${draft.objective || '(not set)'}
Format: ${draft.format || '?'}
Audience: ${draft.audience_type || 'cold'}
Trust priority: ${draft.trust_priority || 'medium'}
Selected concept: ${draft.selected_concept_id || '(none)'}

# Creative direction
${draft.creative ? clamp(JSON.stringify(draft.creative), 2000) : '(none)'}

# Copy v1
${draft.primary_text_v1 || '(none)'}

# Copy v2
${draft.primary_text_v2 || '(none)'}

Headline: ${draft.headline || '(none)'}
Description: ${draft.description || '(none)'}
CTA: ${draft.cta || '(none)'}

# Locked brand decisions
${lockedDecisionsBlock(ctx.lockedDecisions)}

Critique. JSON only.`;

  const resp = await c.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS_CRITIQUE,
    system: sys,
    messages: [{ role: 'user', content: user }],
  });
  const text = resp.content.find((b) => b.type === 'text')?.text || '';
  return parseJSON(text);
}

// generateFeedback runs at finalize, given Curtis's pick (v1 vs v2) and any
// free-form summary of edits he made. Returns a structured analysis the
// wizard persists into mktg_drafts.feedback_analysis. High-confidence
// recurring patterns get bridged into mktg_memory_facts by the wizard
// executor — this function does NOT touch the DB.
async function generateFeedback(draft, choice) {
  const ctx = await loadDraftContext(draft);
  const c = client();

  const sys = [
    {
      type: 'text',
      text: `You analyse Curtis's pick between v1 and v2 of a PrimalPantry ad draft, plus any free-form notes he wrote about edits he made to the chosen one. You output a short, structured signal that helps the system learn his preferences over time. Specific, not generic. This is not a marketing report.

Output JSON ONLY:
{
  "preference_signals": ["<short bullet — what made the chosen variant win>", "..."],
  "rejected_signals": ["<what he passed on in the other variant>", "..."],
  "edit_themes": ["<category of edit he made: tone-down, more-specific, cut-jargon, swap-trust-lever, etc.>", "..."],
  "confidence": 0-10,
  "recurring_pattern_hint": "<2 sentences: a guess at a recurring preference worth remembering. Empty string if signal is too weak.>"
}

confidence guide:
- 9-10: very clear signal (one variant chosen with no edits, and the variants differed on one obvious axis like founder-voice vs benefit-list).
- 5-8: moderate (chosen with edits, or variants differed on multiple axes).
- 0-4: noisy — both variants similar, or no edits to interpret.`,
      cache_control: { type: 'ephemeral' },
    },
  ];

  const user = `# Draft context
Campaign: ${ctx.campaign?.name || draft.campaign_id || '?'}
Objective: ${draft.objective || '?'}
Audience: ${draft.audience_type || 'cold'}
Trust priority: ${draft.trust_priority || 'medium'}

# Variant v1 (${choice.chosen_variant === 'v1' ? 'CHOSEN' : 'rejected'})
${draft.primary_text_v1 || ''}

# Variant v2 (${choice.chosen_variant === 'v2' ? 'CHOSEN' : 'rejected'})
${draft.primary_text_v2 || ''}

# Final shipped text (after Curtis's edits)
${draft.primary_text_final || '(no edits — chosen variant shipped as-is)'}

# Curtis's free-form note on what he changed
${choice.user_edits_diff || '(none)'}

Analyse. JSON only.`;

  const resp = await c.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS_FEEDBACK,
    system: sys,
    messages: [{ role: 'user', content: user }],
  });
  const text = resp.content.find((b) => b.type === 'text')?.text || '';
  return parseJSON(text);
}

// ── Handler ──
// Expose internals so the marketing chat's wizard tools can drive the same
// generators without re-implementing them. Order matters — these must be
// declared after the function definitions above.
exports.generateConcepts = generateConcepts;
exports.generateCreative = generateCreative;
exports.generateCopy     = generateCopy;
exports.generateCritique = generateCritique;
exports.generateFeedback = generateFeedback;
exports.getDraft         = getDraft;
exports.patchDraft       = patchDraft;

// New creative-agent service (Block 4). Lazy-required to keep cold-start
// cheap when only the legacy draft actions are hit.
let _agentMod;
function agentMod() {
  if (!_agentMod) _agentMod = require('./_lib/mktg-agent.js');
  return _agentMod;
}
let _lifecycleMod;
function lifecycleMod() {
  if (!_lifecycleMod) _lifecycleMod = require('./_lib/mktg-lifecycle.js');
  return _lifecycleMod;
}

exports.handler = withGate(async (event, { user }) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  try {
    // ── New creative-agent stage actions (Block 4) ─────────────────────────
    // The old generate_concepts / generate_creative / generate_copy actions
    // below stay in place for the existing wizard UI until Block 5 cuts over.
    if (action === 'agent_run_stage') {
      const { stage, brief, creative_id, model, extra } = body;
      if (!stage || !brief) return reply(400, { error: 'stage and brief required' });
      const result = await agentMod().runStage({
        user_id: user.id,
        creative_id: creative_id || null,
        stage,
        brief,
        opts: { model, extra },
      });
      // Return 200 even on validation failure -- the UI surfaces raw output
      // + validation_error per spec. Hard 5xx is reserved for genuine errors.
      return reply(200, result);
    }

    if (action === 'creative_create') {
      // Block 4 thin wrapper: insert a fresh mktg_creatives row at status=drafted.
      // Block 5 UI calls this once the brief is filled in. The actual stage runs
      // happen via agent_run_stage with the returned creative_id passed for
      // telemetry attribution.
      const { creative_type, brief } = body;
      if (!['ad','video_script'].includes(creative_type)) return reply(400, { error: 'creative_type must be ad|video_script' });
      if (!brief || typeof brief !== 'object') return reply(400, { error: 'brief object required' });
      // Lifecycle invariant: drafted requires brief + components + exemplars_used.
      const insertRow = {
        creative_type,
        brief,
        components: {},        // Block 5 fills in as stages return
        exemplars_used: [],
        playbook_patterns_used: [],
        pattern_tags: [],
        status: 'drafted',
        generalizable: true,
        user_id: user.id,
      };
      const err = lifecycleMod().validateDraftedInsert(insertRow);
      if (err) return reply(400, { error: err });
      const inserted = await sbInsert('mktg_creatives', insertRow);
      const row = Array.isArray(inserted) ? inserted[0] : inserted;
      return reply(200, { creative: row });
    }

    if (action === 'creative_get') {
      if (!body.creative_id) return reply(400, { error: 'creative_id required' });
      const rows = await sbSelect('mktg_creatives', `creative_id=eq.${encodeURIComponent(body.creative_id)}&select=*&limit=1`);
      const row = rows?.[0];
      if (!row) return reply(404, { error: 'creative not found' });
      // Materialise the public VO URL so the UI doesn't need SUPABASE_URL.
      // Mirrors the same pattern get_draft uses for legacy drafts.
      const enriched = row.voiceover_storage_path ? {
        ...row,
        voiceover_url: `${process.env.SUPABASE_URL}/storage/v1/object/public/mktg-vo/${row.voiceover_storage_path}`,
      } : row;
      return reply(200, { creative: enriched });
    }

    if (action === 'creative_update_components') {
      // Block 5 patches the components blob as each stage approves.
      if (!body.creative_id) return reply(400, { error: 'creative_id required' });
      if (!body.patch || typeof body.patch !== 'object') return reply(400, { error: 'patch object required' });
      const rows = await sbSelect('mktg_creatives', `creative_id=eq.${encodeURIComponent(body.creative_id)}&select=*&limit=1`);
      const cur = rows?.[0];
      if (!cur) return reply(404, { error: 'creative not found' });
      const merged = { ...(cur.components || {}), ...body.patch };
      const updated = await sbUpdate(
        'mktg_creatives',
        `creative_id=eq.${encodeURIComponent(body.creative_id)}`,
        { components: merged, updated_at: new Date().toISOString() }
      );
      return reply(200, { creative: Array.isArray(updated) ? updated[0] : updated });
    }

    if (action === 'list_creatives') {
      // Used by the Assistant queue (production handoff) to show creatives
      // alongside legacy mktg_drafts. Same response shape so the UI can
      // render both kinds with one row component.
      const status = body.status; // optional filter (submitted / in_production / needs_approval / live etc.)
      const filter = status ? `status=eq.${encodeURIComponent(status)}&` : '';
      const rows = await sbSelect(
        'mktg_creatives',
        `${filter}order=updated_at.desc&limit=80&select=creative_id,status,creative_type,brief,components,submitted_at,approved_at,production_notes,production_asset_url,approval_notes,voiceover_storage_path,voiceover_label,voiceover_generated_at,updated_at,created_at`
      );
      // Stamp on the public VO URL + a uniform shape (objective / format / audience).
      const enriched = rows.map((r) => ({
        kind:        'creative',
        id:          r.creative_id,
        creative_id: r.creative_id,
        status:      r.status,
        creative_type: r.creative_type,
        objective:   r.brief?.objective || null,
        format:      r.brief?.format || null,
        audience_type: r.brief?.audience || null,
        components:  r.components,
        submitted_at: r.submitted_at,
        approved_at: r.approved_at,
        production_notes: r.production_notes,
        production_asset_url: r.production_asset_url,
        approval_notes: r.approval_notes,
        updated_at:  r.updated_at,
        created_at:  r.created_at,
        voiceover_storage_path: r.voiceover_storage_path,
        voiceover_label: r.voiceover_label,
        voiceover_generated_at: r.voiceover_generated_at,
        voiceover_url: r.voiceover_storage_path
          ? `${process.env.SUPABASE_URL}/storage/v1/object/public/mktg-vo/${r.voiceover_storage_path}`
          : null,
      }));
      return reply(200, { creatives: enriched });
    }

    if (action === 'creative_transition') {
      // Block 5 transitions a creative through the lifecycle: drafted ->
      // user_approved / user_rejected, user_approved -> shipped, shipped ->
      // performed. The state machine + invariants live in mktg-lifecycle.
      const { creative_id, to_status, extras = {} } = body;
      if (!creative_id || !to_status) return reply(400, { error: 'creative_id and to_status required' });
      const rows = await sbSelect('mktg_creatives', `creative_id=eq.${encodeURIComponent(creative_id)}&select=*&limit=1`);
      const cur = rows?.[0];
      if (!cur) return reply(404, { error: 'creative not found' });
      let patch;
      try { ({ patch } = lifecycleMod().transition(cur, to_status, extras)); }
      catch (e) { return reply(400, { error: e.message }); }
      const updated = await sbUpdate(
        'mktg_creatives',
        `creative_id=eq.${encodeURIComponent(creative_id)}`,
        patch
      );
      return reply(200, { creative: Array.isArray(updated) ? updated[0] : updated });
    }

    // ── Proposal queue (Block 6 jobs write here, Block 7 dashboard reads) ──
    if (action === 'proposals_list') {
      const status = body.status || 'pending';
      const filter = `status=eq.${encodeURIComponent(status)}` + (body.job ? `&job=eq.${encodeURIComponent(body.job)}` : '');
      const rows = await sbSelect('mktg_pending_proposals', `${filter}&order=created_at.desc&limit=200&select=*`);
      return reply(200, { proposals: rows });
    }
    if (action === 'proposal_approve') {
      if (!body.proposal_id) return reply(400, { error: 'proposal_id required' });
      const rows = await sbSelect('mktg_pending_proposals', `proposal_id=eq.${encodeURIComponent(body.proposal_id)}&select=*&limit=1`);
      const p = rows?.[0];
      if (!p) return reply(404, { error: 'proposal not found' });
      // Apply the proposal to the live tables based on type. Hard Req #7
      // generalisation gate: pattern proposals require >=3 evidence; the
      // Zod stage schema already enforces this at agent-output time, but
      // re-check here in case the proposal was hand-edited.
      const payload = p.payload || {};
      let applied_to = null;
      try {
        if (p.type === 'pattern' || p.type === 'anti_pattern') {
          if (!Array.isArray(payload.evidence_creative_ids) || payload.evidence_creative_ids.length < 3) {
            return reply(400, { error: 'pattern requires >=3 evidence_creative_ids (generalisation gate)' });
          }
          const inserted = await sbInsert('mktg_playbook_patterns', {
            pattern_type: payload.pattern_type || (p.type === 'anti_pattern' ? 'anti_pattern' : 'composition'),
            name:        payload.name,
            description: payload.description,
            definition:  payload.definition || {},
            evidence_creative_ids: payload.evidence_creative_ids,
            audience_segments: payload.audience_segments || [],
            performance_summary: { n_observations: payload.evidence_creative_ids.length },
            active:      true,
            approved_by: user.id,
            approved_at: new Date().toISOString(),
          });
          applied_to = Array.isArray(inserted) ? inserted[0]?.pattern_id : inserted?.pattern_id;
        } else if (p.type === 'pattern_deprecate') {
          if (!payload.pattern_id) return reply(400, { error: 'payload.pattern_id required' });
          await sbUpdate('mktg_playbook_patterns', `pattern_id=eq.${encodeURIComponent(payload.pattern_id)}`, {
            active: false, deprecation_reason: payload.reason || 'operator-approved deprecation', last_updated: new Date().toISOString(),
          });
          applied_to = payload.pattern_id;
        } else if (p.type === 'pain_point') {
          const inserted = await sbInsert('mktg_pain_points', {
            name:               payload.name || 'unnamed',
            description:        payload.description || '',
            example_phrasings:  payload.definition?.example_phrasings || [],
            audience_segment:   null, frequency: 0, products_relevant: [], active: true,
          });
          applied_to = Array.isArray(inserted) ? inserted[0]?.pain_point_id : inserted?.pain_point_id;
        } else if (p.type === 'pain_point_deprecate') {
          if (!payload.pattern_id) return reply(400, { error: 'payload.pattern_id required (pain_point_id)' });
          await sbUpdate('mktg_pain_points', `pain_point_id=eq.${encodeURIComponent(payload.pattern_id)}`, { active: false });
          applied_to = payload.pattern_id;
        }
        // stat_check / taste_audit_action / self_audit_action: approval just
        // marks the proposal handled -- no live-table mutation.
      } catch (e) {
        return reply(500, { error: `apply failed: ${e.message || e}` });
      }
      await sbUpdate('mktg_pending_proposals', `proposal_id=eq.${encodeURIComponent(body.proposal_id)}`, {
        status: 'approved', reviewed_at: new Date().toISOString(),
        reviewed_by: user.id, applied_at: new Date().toISOString(),
      });
      return reply(200, { approved: true, applied_to });
    }
    if (action === 'proposal_reject') {
      if (!body.proposal_id) return reply(400, { error: 'proposal_id required' });
      await sbUpdate('mktg_pending_proposals', `proposal_id=eq.${encodeURIComponent(body.proposal_id)}`, {
        status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: user.id,
      });
      return reply(200, { rejected: true });
    }

    // ── Audit memos + job-run history (dashboard reads these) ──────────────
    if (action === 'audit_memos_list') {
      const filter = body.kind ? `kind=eq.${encodeURIComponent(body.kind)}&` : '';
      const rows = await sbSelect('mktg_audit_memos', `${filter}order=created_at.desc&limit=20&select=*`);
      return reply(200, { memos: rows });
    }
    if (action === 'job_runs_list') {
      const filter = body.job ? `job=eq.${encodeURIComponent(body.job)}&` : '';
      const rows = await sbSelect('mktg_job_runs', `${filter}order=ran_at.desc&limit=50&select=*`);
      return reply(200, { runs: rows });
    }

    // ── Token / cost telemetry (dashboard reads) ───────────────────────────
    if (action === 'agent_calls_summary') {
      // Compact aggregation -- last 30 days by stage.
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const rows = await sbSelect(
        'mktg_agent_calls',
        `created_at=gte.${encodeURIComponent(since)}&select=stage,validation_status,latency_ms,input_tokens,output_tokens,cost_usd,model,created_at&limit=2000&order=created_at.desc`
      );
      return reply(200, { calls: rows, since });
    }

    // ── Legacy draft actions (kept for the existing wizard UI) ─────────────
    if (action === 'list_drafts') {
      const status = body.status; // optional filter
      const filter = status ? `&status=eq.${encodeURIComponent(status)}` : '';
      const rows = await sbSelect(
        'mktg_drafts',
        `user_id=eq.${user.id}${filter}&order=updated_at.desc&limit=80&select=id,status,current_step,objective,campaign_id,format,selected_concept_id,updated_at,created_at,voiceover_storage_path,voiceover_label,voiceover_generated_at,voiceover_voice_id,production_notes,production_asset_url,approval_notes,submitted_at`
      );
      // Stamp on the public VO URL so the client doesn't need SUPABASE_URL.
      const enriched = rows.map((r) => r.voiceover_storage_path ? {
        ...r,
        voiceover_url: `${process.env.SUPABASE_URL}/storage/v1/object/public/mktg-vo/${r.voiceover_storage_path}`,
      } : r);
      return reply(200, { drafts: enriched });
    }

    if (action === 'get_draft') {
      if (!body.id) return reply(400, { error: 'id required' });
      const draft = await getDraft(user.id, body.id);
      if (!draft) return reply(404, { error: 'not found' });
      const enriched = draft.voiceover_storage_path ? {
        ...draft,
        voiceover_url: `${process.env.SUPABASE_URL}/storage/v1/object/public/mktg-vo/${draft.voiceover_storage_path}`,
      } : draft;
      return reply(200, { draft: enriched });
    }

    if (action === 'create_draft') {
      const draft = await sbInsert('mktg_drafts', {
        user_id:       user.id,
        objective:     body.objective || null,
        campaign_id:   body.campaign_id || null,
        format:        body.format || null,
        audience_type: body.audience_type || null,
        landing_url:   body.landing_url || null,
        current_step:  body.current_step || 'objective',
      });
      return reply(200, { draft });
    }

    if (action === 'update_draft') {
      if (!body.id) return reply(400, { error: 'id required' });
      const allowed = [
        'objective','campaign_id','format','audience_type','landing_url',
        'selected_concept_id','recommended_concepts','creative',
        'primary_text_v1','primary_text_v2','primary_text_final',
        'headline','description','cta','naming','notes','current_step','status',
        'trust_priority',
        'feedback_analysis','chosen_variant','rejected_variant','user_edits_diff',
      ];
      const patch = {};
      for (const k of allowed) if (body[k] !== undefined) patch[k] = body[k];
      const draft = await patchDraft(user.id, body.id, patch);
      return reply(200, { draft });
    }

    if (action === 'delete_draft') {
      if (!body.id) return reply(400, { error: 'id required' });
      await sbDelete('mktg_drafts', `id=eq.${encodeURIComponent(body.id)}&user_id=eq.${user.id}`);
      return reply(200, { success: true });
    }

    if (action === 'archive_draft') {
      if (!body.id) return reply(400, { error: 'id required' });
      const draft = await patchDraft(user.id, body.id, { status: 'archived' });
      return reply(200, { draft });
    }

    // ── State-machine transitions ──
    // draft → submitted → in_production → needs_approval → approved → live
    //                                            ↓ (request_changes)
    //                                       in_production
    if (action === 'submit_draft') {
      if (!body.id) return reply(400, { error: 'id required' });
      const existing = await getDraft(user.id, body.id);
      if (!existing) return reply(404, { error: 'draft not found' });
      // Minimum bar: must have copy approved at least
      if (!existing.primary_text_final && !existing.primary_text_v1) {
        return reply(400, { error: 'draft has no primary text yet' });
      }
      const draft = await patchDraft(user.id, body.id, {
        status: 'submitted',
        current_step: 'final',
        submitted_at: new Date().toISOString(),
      });
      return reply(200, { draft });
    }

    if (action === 'claim_draft') {
      if (!body.id) return reply(400, { error: 'id required' });
      const draft = await patchDraft(user.id, body.id, { status: 'in_production' });
      return reply(200, { draft });
    }

    if (action === 'mark_needs_approval') {
      if (!body.id) return reply(400, { error: 'id required' });
      const patch = { status: 'needs_approval' };
      if (body.production_notes !== undefined)     patch.production_notes = body.production_notes;
      if (body.production_asset_url !== undefined) patch.production_asset_url = body.production_asset_url;
      const draft = await patchDraft(user.id, body.id, patch);
      return reply(200, { draft });
    }

    if (action === 'request_changes') {
      if (!body.id) return reply(400, { error: 'id required' });
      // Bounce back to in_production so the assistant sees it again with notes.
      const patch = { status: 'in_production' };
      if (body.approval_notes !== undefined) patch.approval_notes = body.approval_notes;
      const draft = await patchDraft(user.id, body.id, patch);
      return reply(200, { draft });
    }

    if (action === 'approve_draft') {
      if (!body.id) return reply(400, { error: 'id required' });
      const patch = {
        status: 'approved',
        approved_at: new Date().toISOString(),
      };
      if (body.approval_notes !== undefined) patch.approval_notes = body.approval_notes;
      const draft = await patchDraft(user.id, body.id, patch);
      return reply(200, { draft });
    }

    if (action === 'mark_live') {
      if (!body.id) return reply(400, { error: 'id required' });
      const before = await getDraft(user.id, body.id);
      if (!before) return reply(404, { error: 'draft not found' });
      const draft = await patchDraft(user.id, body.id, { status: 'live' });
      // Graduate into mktg_ads + drop a memory fact so future generations
      // cite this ad as voice reference. Best-effort — the live status flip
      // is the source of truth, the learning loop is downstream of it.
      const learning = await graduateLiveDraftToAds(user.id, draft, before);
      return reply(200, { draft, ...learning });
    }

    if (action === 'generate_concepts') {
      const draft = await getDraft(user.id, body.id);
      if (!draft) return reply(404, { error: 'draft not found' });
      if (!draft.objective || !draft.campaign_id || !draft.format) {
        return reply(400, { error: 'objective, campaign_id and format must be set first' });
      }
      const concepts = await generateConcepts(draft);
      const updated = await patchDraft(user.id, body.id, {
        recommended_concepts: concepts,
        current_step: draft.current_step === 'objective' || draft.current_step === 'campaign' || draft.current_step === 'format' ? 'concept' : draft.current_step,
      });
      return reply(200, { draft: updated, recommended_concepts: concepts });
    }

    if (action === 'generate_creative') {
      const draft = await getDraft(user.id, body.id);
      if (!draft) return reply(404, { error: 'draft not found' });
      if (!draft.format) return reply(400, { error: 'format required' });
      const creative = await generateCreative(draft);
      const updated = await patchDraft(user.id, body.id, {
        creative,
        current_step: 'creative',
      });
      return reply(200, { draft: updated, creative });
    }

    if (action === 'generate_copy') {
      const draft = await getDraft(user.id, body.id);
      if (!draft) return reply(404, { error: 'draft not found' });
      const out = await generateCopy(draft, { feedback: body.feedback });
      const updated = await patchDraft(user.id, body.id, {
        primary_text_v1: out.primary_text_v1 || null,
        primary_text_v2: out.primary_text_v2 || null,
        headline:        out.headline || null,
        description:     out.description || null,
        cta:             out.cta || null,
        naming:          out.naming || null,
        current_step:    'copy',
      });
      return reply(200, { draft: updated, ...out });
    }

    if (action === 'regenerate_step') {
      const draft = await getDraft(user.id, body.id);
      if (!draft) return reply(404, { error: 'draft not found' });
      if (body.step === 'concept') {
        const concepts = await generateConcepts(draft);
        const updated = await patchDraft(user.id, body.id, { recommended_concepts: concepts });
        return reply(200, { draft: updated, recommended_concepts: concepts });
      }
      if (body.step === 'creative') {
        const creative = await generateCreative(draft);
        const updated = await patchDraft(user.id, body.id, { creative });
        return reply(200, { draft: updated, creative });
      }
      if (body.step === 'copy') {
        const out = await generateCopy(draft, { feedback: body.feedback });
        const updated = await patchDraft(user.id, body.id, {
          primary_text_v1: out.primary_text_v1 || null,
          primary_text_v2: out.primary_text_v2 || null,
          headline:        out.headline || null,
          description:     out.description || null,
          cta:             out.cta || null,
          naming:          out.naming || null,
        });
        return reply(200, { draft: updated, ...out });
      }
      return reply(400, { error: 'step must be concept|creative|copy' });
    }

    return reply(400, { error: 'Unknown action' });
  } catch (e) {
    console.error('[mktg-ads]', e);
    return reply(500, { error: e.message || 'Server error' });
  }
});
