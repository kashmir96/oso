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
      text: `You recommend ad concepts for PrimalPantry — a NZ tallow-skincare brand. You will get an objective, a campaign and a format, plus the campaign's existing concept library and top-performing ads. Recommend 3 concepts that fit the objective. Prefer concepts with status 'workhorse' or 'efficient' when available; otherwise propose new concepts that build on patterns the top-performing ads exhibit. Respond ONLY with JSON of the form: [{"id":"<existing-concept-id-or-null>","name":"<short concept name>","why":"<2-3 sentences why this fits the objective + format>"}]. If recommending a brand-new concept set id to null.`,
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
      text: `You produce creative direction for PrimalPantry Meta ads. Tone: NZ kiwi-coded, peer-to-peer, warm but plain-spoken. Honour the locked brand decisions (especially: PrimalPantry pulled out of retail — past tense, no scarcity hook; customer count is "100,000+ kiwis"; Reviana not Reviora; Reviana frames as "tallow + cosmeceutical actives" NOT a separate anti-aging brand). Respond ONLY with JSON of the requested shape — no prose around it.`,
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
      text: `You write Meta ad copy for PrimalPantry. Tone: NZ kiwi-coded, peer-to-peer, warm but plain-spoken. Specific over generic. Honour the locked brand decisions. Do NOT use scarcity around retail — pull-out is complete and past-tense. Customer count is "100,000+ kiwis" (don't say 20k/60k/85k/95k — those are stale).

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

// ── Handler ──
// Expose internals so the marketing chat's wizard tools can drive the same
// generators without re-implementing them. Order matters — these must be
// declared after the function definitions above.
exports.generateConcepts = generateConcepts;
exports.generateCreative = generateCreative;
exports.generateCopy     = generateCopy;
exports.getDraft         = getDraft;
exports.patchDraft       = patchDraft;

exports.handler = withGate(async (event, { user }) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  try {
    if (action === 'list_drafts') {
      const status = body.status; // optional filter
      const filter = status ? `&status=eq.${encodeURIComponent(status)}` : '';
      const rows = await sbSelect(
        'mktg_drafts',
        `user_id=eq.${user.id}${filter}&order=updated_at.desc&limit=80&select=id,status,current_step,objective,campaign_id,format,selected_concept_id,updated_at,created_at`
      );
      return reply(200, { drafts: rows });
    }

    if (action === 'get_draft') {
      if (!body.id) return reply(400, { error: 'id required' });
      const draft = await getDraft(user.id, body.id);
      if (!draft) return reply(404, { error: 'not found' });
      return reply(200, { draft });
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
      const draft = await patchDraft(user.id, body.id, { status: 'live' });
      return reply(200, { draft });
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
