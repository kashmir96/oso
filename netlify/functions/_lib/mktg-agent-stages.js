/**
 * mktg-agent-stages.js — Zod schemas per agent stage.
 *
 * One schema per stage from primalpantry_agent_production_prompt.md "Pipeline".
 * Used to validate the model's JSON output. On validation failure the agent
 * service retries once with the validation error fed back; second failure
 * surfaces raw output to the operator.
 *
 * Hard Requirement #5: schema violations are bugs, not warnings.
 *
 * The schemas are deliberately strict on required fields and discriminator
 * values, but tolerant on enum-string-vs-arbitrary-string for fields where
 * the spec uses example values not exhaustive enums (e.g. dimension on
 * feedback diffs — the spec lists 8 example dimensions but says they're
 * categorical hints, not closed enums).
 */
const { z } = require('zod');

// Common shapes
const Citation = z.string().min(1); // creative_id (UUID) or pattern_id (UUID) — we don't enforce UUID shape, the agent could cite either form

// ─── stage="strategy" ──────────────────────────────────────────────────────
const StrategySchema = z.object({
  primary_angle:           z.string().min(1),
  audience_message_fit:    z.string().min(1),
  alternatives_considered: z.array(z.object({
    angle:       z.string().min(1),
    why_rejected: z.string().min(1),
  })),
  citations:               z.array(Citation),
  exemplar_strength:       z.enum(['strong','moderate','weak']),
  flags:                   z.array(z.string()),
}).strict();

// ─── stage="variants_ad" ───────────────────────────────────────────────────
const AdVariant = z.object({
  variant_id:           z.string().min(1),
  axis_explored:        z.string().min(1),
  composition_pattern:  z.string().min(1),
  visual_style:         z.object({
    palette:           z.array(z.string()),
    lighting:          z.string(),
    subject_treatment: z.string(),
  }),
  headline:             z.string().min(1),
  body:                 z.string().nullable(),
  cta:                  z.string().min(1),
  image_prompt:         z.string().min(1)
                        .refine((s) => !/['"`]\s*\w/.test(s), {
                          message: 'image_prompt appears to contain text-to-render — Hard Rule #1: never render text inside generated images',
                        }),
  reference_image_ids:  z.array(z.string()),
}).strict();

const VariantsAdSchema = z.object({
  variants: z.array(AdVariant).min(4, 'spec requires 4-6 variants').max(6, 'spec requires 4-6 variants'),
}).strict();

// ─── stage="outline" (video_script) ────────────────────────────────────────
const OutlineSchema = z.object({
  structure_template: z.string().min(1),
  beats:              z.array(z.object({
    timestamp: z.string(),
    beat:      z.string().min(1),
    broll:     z.string().nullable(),
  })).min(1),
  estimated_runtime:  z.string(),
}).strict();

// ─── stage="hooks" (video_script) ──────────────────────────────────────────
const HookVariant = z.object({
  variant_id:             z.string().min(1),
  archetype:              z.string().min(1),
  opening_lines_verbatim: z.string().min(1),
  first_visual:           z.string().min(1),
  rationale:              z.string().min(1),
  citations:              z.array(Citation),
}).strict();

const HooksSchema = z.object({
  hook_variants: z.array(HookVariant).min(4, 'spec requires 4-6 hooks').max(6, 'spec requires 4-6 hooks'),
}).strict();

// ─── stage="draft" (video_script) ──────────────────────────────────────────
const DraftSchema = z.object({
  full_script: z.string().min(1),
  section_breakdown: z.array(z.object({
    timestamp:   z.string(),
    spoken_line: z.string().min(1),
    broll:       z.string().nullable(),
    pacing_note: z.string().nullable(),
  })).min(1),
}).strict();

// ─── stage="critique" ──────────────────────────────────────────────────────
const Score1To5 = z.number().int().min(1).max(5);

const CritiqueSchema = z.object({
  scores: z.object({
    brief_fit:                       Score1To5,
    pattern_adherence:               Score1To5,
    hook_strength:                   Score1To5,
    brand_fit:                       Score1To5,
    anti_pattern_check:              z.enum(['pass','fail']),
    retention_drop_signature_check:  z.enum(['pass','fail','n/a']),
  }).strict(),
  rationale:           z.string().min(1),
  verdict:             z.enum(['ship','repair','replace']),
  repair_instructions: z.string().nullable(),
}).strict()
  // Spec verdict rule: replace if brief_fit<=2 OR hook_strength<=2 OR anti_pattern_check=fail.
  .refine((c) => {
    const triggers = c.scores.brief_fit <= 2 || c.scores.hook_strength <= 2 || c.scores.anti_pattern_check === 'fail';
    if (triggers && c.verdict !== 'replace') return false;
    return true;
  }, {
    message: 'verdict must be "replace" when brief_fit<=2, hook_strength<=2, or anti_pattern_check=fail',
  });

// ─── stage="feedback" ──────────────────────────────────────────────────────
const FeedbackDiff = z.object({
  // Spec lists 8 example dimensions but treats them as categorical hints,
  // not a closed enum — if the model proposes a sensible new dimension we
  // don't want to reject the whole call. So validate as string + soft
  // recommend the canonical set in the prompt.
  dimension:           z.string().min(1),
  chosen_trait:        z.string().min(1),
  rejected_trait:      z.string().min(1),
  rejected_variant_ids: z.array(z.string()),
  hypothesis:          z.string().min(1),
}).strict();

const EditAnalysis = z.object({
  category: z.enum(['rhythm','register','factual','structural','voice','cut-for-pacing']),
  before:   z.string(),
  after:    z.string(),
  lesson:   z.string().min(1),
}).strict();

const FeedbackSchema = z.object({
  diffs:                                 z.array(FeedbackDiff),
  edit_analysis:                         z.array(EditAnalysis),
  top_hypotheses:                        z.array(z.string()),
  candidate_reasons_for_user_confirmation: z.array(z.string()),
  user_note_reconciliation:              z.union([
                                            z.null(),
                                            z.object({
                                              relation:    z.enum(['confirms','contradicts','extends']),
                                              explanation: z.string().min(1),
                                            }).strict(),
                                          ]),
  generalizable:                         z.boolean(),
  generalization_caveat:                 z.string().nullable(),
  pattern_tags:                          z.array(z.string()),
  confidence:                            z.enum(['high','medium','low']),
}).strict();

// ─── stage="playbook_extract" ──────────────────────────────────────────────
const PatternProposal = z.object({
  pattern_type: z.enum([
    'hook_archetype','composition','structure_template','palette_cluster',
    'pacing_pattern','retention_drop_signature','anti_pattern',
  ]),
  name:        z.string().min(1),
  description: z.string().min(1),
  definition:  z.record(z.string(), z.unknown()),
  evidence_creative_ids: z.array(z.string()).min(3, 'spec generalisation gate: >=3 supporting performed records'),
  audience_segments: z.array(z.string()).default([]),
}).strict();

const PlaybookExtractSchema = z.object({
  proposed_patterns:      z.array(PatternProposal),
  patterns_to_deprecate:  z.array(z.object({
    pattern_id: z.string().min(1),
    reason:     z.string().min(1),
  }).strict()),
  proposed_anti_patterns: z.array(PatternProposal),
  notes_for_operator:     z.string(),
}).strict();

// ─── Registry ──────────────────────────────────────────────────────────────
const SCHEMAS = {
  strategy:         StrategySchema,
  variants_ad:      VariantsAdSchema,
  outline:          OutlineSchema,
  hooks:            HooksSchema,
  draft:            DraftSchema,
  critique:         CritiqueSchema,
  feedback:         FeedbackSchema,
  playbook_extract: PlaybookExtractSchema,
};

const STAGE_NAMES = Object.keys(SCHEMAS);

/**
 * Validate a parsed JSON output for a stage.
 * @returns {{ ok: true, data: object } | { ok: false, error: string }}
 */
function validateStageOutput(stage, parsed) {
  const schema = SCHEMAS[stage];
  if (!schema) return { ok: false, error: `unknown stage: ${stage}` };
  const r = schema.safeParse(parsed);
  if (r.success) return { ok: true, data: r.data };
  // Compact zod errors into a single-line summary for the retry prompt.
  const issues = r.error.issues.slice(0, 6).map((i) => {
    const path = i.path.join('.') || '<root>';
    return `${path}: ${i.message}`;
  }).join(' | ');
  return { ok: false, error: issues };
}

module.exports = {
  SCHEMAS,
  STAGE_NAMES,
  validateStageOutput,
  // Re-export individual schemas for tests / programmatic introspection
  StrategySchema, VariantsAdSchema, OutlineSchema, HooksSchema, DraftSchema,
  CritiqueSchema, FeedbackSchema, PlaybookExtractSchema,
};
