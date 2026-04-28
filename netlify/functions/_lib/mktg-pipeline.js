/**
 * mktg-pipeline.js — server-side dispatcher for the conversational creative
 * pipeline. The business chat (ckf-chat) calls these via the
 * `creative_pipeline` tool to walk Curtis through brief intake, stage runs,
 * critique-with-auto-repair, approval, voiceover, and assistant-queue submit.
 *
 * Each action returns a small structured object the AI summarises back into
 * conversational text — never raw JSON to the user.
 *
 * Architecture: this file owns the dispatch + business logic. The ACTUAL
 * agent calls go through _lib/mktg-agent.js runStage(); the lifecycle
 * transitions go through _lib/mktg-lifecycle.js; the persistence layer is
 * sbInsert/sbUpdate. No model logic here.
 */
const { sbSelect, sbInsert, sbUpdate } = require('./ckf-sb.js');
const { runStage } = require('./mktg-agent.js');
const lifecycle = require('./mktg-lifecycle.js');

// Extract a uniform script body from a creative's components blob. Same
// rule as Creative.jsx: video uses script.full_script, ads use body.
function scriptOf(creative) {
  const c = creative?.components;
  if (!c) return null;
  if (c.script?.full_script) return c.script.full_script;
  if (c.body) return c.body;
  return null;
}

// ─── Brief intake → fresh mktg_creatives row ────────────────────────────────
async function intakeBrief({ userId, brief, creative_type }) {
  if (!brief?.objective)         return { error: 'brief.objective required' };
  if (!brief?.audience)          return { error: 'brief.audience required' };
  if (!creative_type)            return { error: 'creative_type required (ad | video_script)' };
  if (!['ad','video_script'].includes(creative_type)) {
    return { error: 'creative_type must be ad or video_script' };
  }

  // Seed with empty components so the drafted-row CHECK constraint passes.
  // Stage runs progressively populate components.
  const row = {
    user_id:       userId,
    creative_type,
    brief: {
      objective:        brief.objective,
      audience:         brief.audience,
      kpi_target:       brief.kpi_target || { metric: 'purchase', target_value: null },
      platform:         brief.platform   || 'meta',
      format:           brief.format     || (creative_type === 'video_script' ? 'video' : 'static'),
      length_or_duration: brief.length_or_duration || null,
      constraints:      Array.isArray(brief.constraints) ? brief.constraints : [],
    },
    components:      {},  // populated as stages run
    exemplars_used:  [],
    pattern_tags:    [],
    status:          'drafted',
  };
  const inserted = await sbInsert('mktg_creatives', row);
  const c = Array.isArray(inserted) ? inserted[0] : inserted;
  return { ok: true, creative_id: c.creative_id, creative: c };
}

// ─── Generic stage runner with persistence ──────────────────────────────────
async function loadCreative(creative_id) {
  const rows = await sbSelect('mktg_creatives', `creative_id=eq.${encodeURIComponent(creative_id)}&select=*&limit=1`);
  return rows?.[0] || null;
}

async function patchCreative(creative_id, patch) {
  const updated = await sbUpdate(
    'mktg_creatives',
    `creative_id=eq.${encodeURIComponent(creative_id)}`,
    { ...patch, updated_at: new Date().toISOString() }
  );
  return Array.isArray(updated) ? updated[0] : updated;
}

// Run any stage and return a chat-friendly summary plus the parsed payload.
// The `extra` blob carries the prior-stage outputs the agent needs.
async function runPipelineStage({ user_id, creative_id, stage, extra = {} }) {
  const c = await loadCreative(creative_id);
  if (!c) return { error: 'creative not found' };

  // Pull prior stage outputs from components automatically so the AI doesn't
  // have to thread them through tool calls.
  const auto = {
    strategy:   c.components?.strategy   || null,
    outline:    c.components?.script?.outline_beats ? { beats: c.components.script.outline_beats, structure_template: c.components.composition_pattern } : null,
    hook:       c.components?.script?.hook || null,
    to_critique: stage === 'critique' ? (
      c.creative_type === 'video_script'
        ? { full_script: c.components?.script?.full_script, hook: c.components?.script?.hook }
        : { headline: c.components?.headline, body: c.components?.body, cta: c.components?.cta }
    ) : null,
  };
  const mergedExtra = { ...auto, ...extra };

  const result = await runStage({
    user_id, creative_id, stage,
    brief: c.brief,
    opts: { extra: mergedExtra },
  });
  return result;
}

// ─── Each pipeline action mutates the creative + returns a short summary ────
async function runStrategy({ user_id, creative_id }) {
  const r = await runPipelineStage({ user_id, creative_id, stage: 'strategy' });
  if (!r.ok) return { error: r.validation_error || r.error };
  // Persist on the creative so downstream stages can read it without
  // round-tripping through the chat.
  await patchCreative(creative_id, {
    components: { ...(await loadCreative(creative_id)).components, strategy: r.parsed },
  });
  return {
    ok: true,
    angle: r.parsed.primary_angle,
    audience_fit: r.parsed.audience_message_fit,
    alternatives_n: r.parsed.alternatives_considered?.length || 0,
    exemplar_strength: r.parsed.exemplar_strength,
    flags: r.parsed.flags || [],
    citations_n: r.parsed.citations?.length || 0,
    cost_usd: r.cost_usd, latency_ms: r.latency_ms,
  };
}

async function runVariants({ user_id, creative_id }) {
  const r = await runPipelineStage({ user_id, creative_id, stage: 'variants_ad' });
  if (!r.ok) return { error: r.validation_error || r.error };
  // Persist the variants array so the AI can ask Curtis to pick by index.
  const cur = await loadCreative(creative_id);
  await patchCreative(creative_id, {
    components: { ...cur.components, variants: r.parsed.variants },
  });
  return {
    ok: true,
    variants: (r.parsed.variants || []).map((v, i) => ({
      idx: i + 1,
      headline: v.headline,
      body_preview: (v.body || '').slice(0, 140),
      axis: v.axis_explored,
      cta: v.cta,
    })),
    cost_usd: r.cost_usd, latency_ms: r.latency_ms,
  };
}

async function pickVariant({ creative_id, idx }) {
  const c = await loadCreative(creative_id);
  if (!c) return { error: 'creative not found' };
  const variants = c.components?.variants || [];
  const v = variants[idx - 1];
  if (!v) return { error: `variant ${idx} not found (${variants.length} available)` };
  await patchCreative(creative_id, {
    components: {
      ...c.components,
      headline:        v.headline,
      body:            v.body,
      cta:             v.cta,
      composition_pattern: v.composition_pattern,
      palette:         v.visual_style?.palette || [],
      image_ref:       v.image_prompt,
      // clear the variants cache once one is picked
      variants:        undefined,
    },
  });
  return { ok: true, picked: { headline: v.headline, cta: v.cta } };
}

async function runOutline({ user_id, creative_id }) {
  const r = await runPipelineStage({ user_id, creative_id, stage: 'outline' });
  if (!r.ok) return { error: r.validation_error || r.error };
  const cur = await loadCreative(creative_id);
  await patchCreative(creative_id, {
    components: {
      ...cur.components,
      composition_pattern: r.parsed.structure_template,
      script: {
        ...(cur.components?.script || {}),
        outline_beats: r.parsed.beats,
      },
    },
  });
  return {
    ok: true,
    structure: r.parsed.structure_template,
    runtime: r.parsed.estimated_runtime,
    beats: r.parsed.beats.map((b) => `[${b.timestamp}] ${b.beat}`),
    cost_usd: r.cost_usd, latency_ms: r.latency_ms,
  };
}

async function runHooks({ user_id, creative_id }) {
  const r = await runPipelineStage({ user_id, creative_id, stage: 'hooks' });
  if (!r.ok) return { error: r.validation_error || r.error };
  const cur = await loadCreative(creative_id);
  await patchCreative(creative_id, {
    components: { ...cur.components, hooks_offered: r.parsed.hook_variants },
  });
  return {
    ok: true,
    hooks: (r.parsed.hook_variants || []).map((h, i) => ({
      idx: i + 1,
      opening: h.opening_lines_verbatim,
      archetype: h.archetype,
      visual: h.first_visual,
      rationale: h.rationale,
    })),
    cost_usd: r.cost_usd, latency_ms: r.latency_ms,
  };
}

async function pickHook({ creative_id, idx }) {
  const c = await loadCreative(creative_id);
  if (!c) return { error: 'creative not found' };
  const hooks = c.components?.hooks_offered || [];
  const h = hooks[idx - 1];
  if (!h) return { error: `hook ${idx} not found (${hooks.length} available)` };
  await patchCreative(creative_id, {
    components: {
      ...c.components,
      script: {
        ...(c.components?.script || {}),
        hook: h.opening_lines_verbatim,
        hook_type: h.archetype,
      },
      hooks_offered: undefined,
    },
  });
  return { ok: true, picked: { hook: h.opening_lines_verbatim, type: h.archetype } };
}

async function runDraft({ user_id, creative_id }) {
  const r = await runPipelineStage({ user_id, creative_id, stage: 'draft' });
  if (!r.ok) return { error: r.validation_error || r.error };
  const cur = await loadCreative(creative_id);
  await patchCreative(creative_id, {
    components: {
      ...cur.components,
      script: {
        ...(cur.components?.script || {}),
        full_script: r.parsed.full_script,
        section_breakdown: r.parsed.section_breakdown,
      },
    },
  });
  return {
    ok: true,
    full_script: r.parsed.full_script,
    word_count: (r.parsed.full_script || '').split(/\s+/).length,
    cost_usd: r.cost_usd, latency_ms: r.latency_ms,
  };
}

// Critique with auto-repair: if verdict=repair, regenerate the draft (or
// for ads: the body/headline) using repair_instructions as feedback, then
// re-critique. Cap at 2 repair loops; if the second still isn't 'ship',
// surface to the operator anyway.
async function runCritiqueWithRepair({ user_id, creative_id, max_repairs = 2 }) {
  let repairs = 0;
  let lastVerdict = null;
  while (repairs <= max_repairs) {
    const r = await runPipelineStage({ user_id, creative_id, stage: 'critique' });
    if (!r.ok) return { error: r.validation_error || r.error };
    const v = r.parsed.verdict;
    lastVerdict = r.parsed;
    if (v === 'ship' || v === 'replace') {
      return {
        ok: true, verdict: v, scores: r.parsed.scores, rationale: r.parsed.rationale,
        repairs_used: repairs, cost_usd: r.cost_usd, latency_ms: r.latency_ms,
      };
    }
    if (v === 'repair' && repairs < max_repairs) {
      // Re-run the relevant generation stage with repair instructions.
      const cur = await loadCreative(creative_id);
      const stage = cur.creative_type === 'video_script' ? 'draft' : 'variants_ad';
      const repairResult = await runPipelineStage({
        user_id, creative_id, stage,
        extra: { repair_instructions: r.parsed.repair_instructions || '' },
      });
      if (!repairResult.ok) {
        return { ok: true, verdict: 'repair', scores: r.parsed.scores, rationale: r.parsed.rationale, repairs_used: repairs, repair_failed: true };
      }
      // Persist the repaired output for ads + video paths
      const after = await loadCreative(creative_id);
      if (cur.creative_type === 'video_script') {
        await patchCreative(creative_id, {
          components: {
            ...after.components,
            script: { ...(after.components?.script || {}), full_script: repairResult.parsed.full_script, section_breakdown: repairResult.parsed.section_breakdown },
          },
        });
      } else {
        // Ads: repair returns a fresh variants list. Auto-pick variant 1 to keep flow moving.
        const v1 = (repairResult.parsed.variants || [])[0];
        if (v1) {
          await patchCreative(creative_id, {
            components: {
              ...after.components,
              headline: v1.headline, body: v1.body, cta: v1.cta,
              composition_pattern: v1.composition_pattern,
              palette: v1.visual_style?.palette || [],
              image_ref: v1.image_prompt,
            },
          });
        }
      }
      repairs++;
      continue;
    }
    // verdict was 'repair' but we hit the cap
    return {
      ok: true, verdict: 'repair', scores: r.parsed.scores, rationale: r.parsed.rationale,
      repairs_used: repairs, max_repairs_hit: true,
    };
  }
  return { ok: true, verdict: lastVerdict?.verdict || 'unknown', repairs_used: repairs };
}

// ─── Lifecycle actions (transition through state machine) ──────────────────
async function approveCreative({ creative_id, approval_reason, feedback_analysis }) {
  const c = await loadCreative(creative_id);
  if (!c) return { error: 'creative not found' };
  const extras = {};
  if (approval_reason) extras.approval_reason = approval_reason;
  if (feedback_analysis) extras.feedback_analysis = feedback_analysis;
  // Need at least one of the two for the user_approved invariant.
  if (!extras.approval_reason && !extras.feedback_analysis) {
    extras.approval_reason = 'approved by Curtis in chat';
  }
  let patch;
  try { ({ patch } = lifecycle.transition(c, 'user_approved', extras)); }
  catch (e) { return { error: e.message }; }
  const updated = await patchCreative(creative_id, patch);
  return { ok: true, creative_id, status: updated.status };
}

async function submitToAssistant({ creative_id }) {
  const c = await loadCreative(creative_id);
  if (!c) return { error: 'creative not found' };
  if (c.status !== 'user_approved') {
    return { error: `cannot submit from status ${c.status} -- approve first` };
  }
  let patch;
  try { ({ patch } = lifecycle.transition(c, 'submitted', {})); }
  catch (e) { return { error: e.message }; }
  await patchCreative(creative_id, patch);
  return {
    ok: true, creative_id, status: 'submitted',
    has_voiceover: !!c.voiceover_storage_path,
    has_script: !!scriptOf(c),
    detail_url: `/business/marketing/creative/${creative_id}`,
  };
}

// Generate voiceover by calling the same render+upload helpers mktg-vo's
// HTTP handler uses. Skipping the gate is safe -- ckf-chat already
// authenticated the user before invoking this tool.
async function generateVoiceover({ user, creative_id }) {
  const mktgVo = require('../mktg-vo.js');
  const c = await loadCreative(creative_id);
  if (!c) return { error: 'creative not found' };
  if (c.user_id && c.user_id !== user.id) return { error: 'creative belongs to another user' };
  const script = mktgVo.scriptFromCreative(c);
  if (!script) return { error: 'no script body to voice -- approve a draft first' };
  let result;
  try {
    result = await mktgVo.renderAndUpload({
      userId: user.id, ownerId: c.creative_id,
      scriptText: script, voiceIdOverride: null,
    });
  } catch (e) { return { error: `render failed: ${e.message || e}` }; }
  if (c.voiceover_storage_path) await mktgVo.deleteFromStorage(c.voiceover_storage_path);
  await patchCreative(creative_id, {
    voiceover_storage_path: result.storagePath,
    voiceover_voice_id:     result.voice,
    voiceover_label:        c.voiceover_label || c.brief?.objective || 'Voiceover',
    voiceover_generated_at: new Date().toISOString(),
  });
  return {
    ok: true,
    public_url: mktgVo.publicUrlFor(result.storagePath),
    voice_id: result.voice,
    bytes: result.bytes,
  };
}

// ─── FAST PATH: record script -> wrap with timeline+broll -> voice -> submit ─
// Curtis types "record script" in business chat; the chat UI shows an inline
// widget. Buttons on that widget call these functions directly (the AI is not
// in the loop until submit-to-assistant time, where it does the script
// wrapping via the wrap_script stage).

// Step 1: create a fresh creative with the script body. No agent call yet.
async function recordScriptInit({ user_id, script_text, creative_type = 'video_script', objective_hint }) {
  if (!script_text || !script_text.trim()) return { error: 'script_text required' };
  const t = script_text.trim();
  // Stash the script in the right components slot. Brief is sparse on this
  // path; we record the objective as "(script-first record)" so it doesn't
  // break downstream code that expects brief.objective.
  const components = creative_type === 'video_script'
    ? { script: { full_script: t, hook: null, outline_beats: [] } }
    : { body: t };
  const row = {
    user_id,
    creative_type,
    brief: {
      objective:        objective_hint || '(script-first record)',
      audience:         '(script-first — audience inferred by editor)',
      kpi_target:       { metric: 'purchase', target_value: null },
      platform:         'meta',
      format:           creative_type === 'video_script' ? 'video' : 'static',
      length_or_duration: null,
      constraints:      [],
    },
    components,
    exemplars_used: [],
    pattern_tags:   [],
    status:         'drafted',
  };
  const inserted = await sbInsert('mktg_creatives', row);
  const c = Array.isArray(inserted) ? inserted[0] : inserted;
  return { ok: true, creative_id: c.creative_id };
}

// Step 2 (run on Send to Assistant): wrap the script with timeline + B-roll
// via the wrap_script stage, then transition through user_approved ->
// submitted. AI is in the loop ONLY for the wrap.
async function recordScriptWrapAndSubmit({ user_id, creative_id }) {
  const c = await loadCreative(creative_id);
  if (!c) return { error: 'creative not found' };
  const script = scriptOf(c);
  if (!script) return { error: 'no script body to wrap' };

  // Run the wrap_script stage. extra.script carries the verbatim text.
  const r = await runStage({
    user_id, creative_id, stage: 'wrap_script',
    brief: c.brief,
    opts: { extra: { script } },
  });
  if (!r.ok) return { error: r.validation_error || r.error };

  // Persist the wrapped output onto components.script. preserved_script must
  // equal the input -- if the model rewrote it, prefer the original.
  const wrapped = r.parsed;
  const safeScript = (wrapped.preserved_script === script) ? wrapped.preserved_script : script;
  await patchCreative(creative_id, {
    components: {
      ...c.components,
      script: {
        ...(c.components?.script || {}),
        full_script:        safeScript,
        hook:               wrapped.hook,
        hook_type:          wrapped.hook_type,
        outline_beats:      wrapped.timeline.map((t) => ({ timestamp: t.timestamp, beat: t.spoken_line, broll: t.broll || null })),
        section_breakdown:  wrapped.timeline.map((t) => ({ timestamp: t.timestamp, spoken_line: t.spoken_line, broll: t.broll || null })),
        broll_shots:        wrapped.broll_shots,
        cta_placement:      wrapped.cta_placement,
        notes_for_editor:   wrapped.notes_for_editor,
        estimated_runtime:  wrapped.estimated_runtime,
      },
      composition_pattern: 'script-first',
    },
  });

  // Lifecycle: drafted -> user_approved -> submitted, in one go. The
  // approval reason captures the path so the corpus knows this was a
  // fast-track, not a full-pipeline approval.
  const after = await loadCreative(creative_id);
  let patch;
  try {
    ({ patch } = lifecycle.transition(after, 'user_approved', {
      approval_reason: 'fast-track: script recorded directly + wrapped',
    }));
  } catch (e) { return { error: `approve failed: ${e.message}` }; }
  await patchCreative(creative_id, patch);
  const approved = await loadCreative(creative_id);
  try {
    ({ patch } = lifecycle.transition(approved, 'submitted', {}));
  } catch (e) { return { error: `submit failed: ${e.message}` }; }
  await patchCreative(creative_id, patch);

  return {
    ok: true,
    creative_id,
    status: 'submitted',
    detail_url: `/business/marketing/creative/${creative_id}`,
    timeline_n: wrapped.timeline.length,
    broll_n:    wrapped.broll_shots.length,
    cost_usd:   r.cost_usd,
  };
}

module.exports = {
  intakeBrief,
  runStrategy,
  runVariants,
  pickVariant,
  runOutline,
  runHooks,
  pickHook,
  runDraft,
  runCritiqueWithRepair,
  approveCreative,
  submitToAssistant,
  generateVoiceover,
  loadCreative,
  // fast path
  recordScriptInit,
  recordScriptWrapAndSubmit,
};
