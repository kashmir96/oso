-- ===========================================================================
-- Creative-agent — proposal queue + audit memos (v1.0.2).
--
-- Block 6 additions:
--   • mktg_pending_proposals — every job that wants to add/deprecate a
--     pattern, pain point, or surface a stat/freshness signal writes a row
--     here at status='pending'. Operator approves/rejects in dashboard.
--     Approval applies the proposal to the live tables (e.g. flips a
--     playbook_pattern.active=true).
--   • mktg_audit_memos — outputs from the periodic audits (self_audit,
--     taste_vs_performance) the operator reads on the dashboard.
--   • mktg_job_runs — log + last-success tracking so threshold-based jobs
--     can compute "since last success" deltas.
--
-- Idempotent.
-- ===========================================================================

INSERT INTO mktg_schema_versions (schema_version, changelog)
VALUES ('1.0.2', 'Add mktg_pending_proposals, mktg_audit_memos, mktg_job_runs (lifecycle jobs / proposal queue).')
ON CONFLICT (schema_version) DO NOTHING;

CREATE TABLE IF NOT EXISTS mktg_pending_proposals (
  proposal_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job           TEXT NOT NULL,                 -- 'playbook_extract', 'anti_pattern_detect', etc.
  type          TEXT NOT NULL CHECK (type IN (
                  'pattern','anti_pattern','pattern_deprecate',
                  'pain_point','pain_point_deprecate',
                  'retention_drop_signature',
                  'stat_check','self_audit_action','taste_audit_action')),
  payload       JSONB NOT NULL,                -- the proposal body (varies by type)
  rationale     TEXT,                          -- agent's "notes_for_operator" or computed reason
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','superseded')),
  reviewed_at   TIMESTAMPTZ,
  reviewed_by   TEXT,
  applied_at    TIMESTAMPTZ,                   -- set when approval mutated the live tables
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mktg_proposals_status  ON mktg_pending_proposals(status);
CREATE INDEX IF NOT EXISTS idx_mktg_proposals_job     ON mktg_pending_proposals(job);
CREATE INDEX IF NOT EXISTS idx_mktg_proposals_created ON mktg_pending_proposals(created_at DESC);

-- Audit memos -- the one-page outputs from §7.3 self-audit + the
-- §6.3 taste-vs-performance audit. Read-only history.
CREATE TABLE IF NOT EXISTS mktg_audit_memos (
  memo_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL CHECK (kind IN (
                'self_audit','taste_vs_performance','stat_freshness',
                'playbook_extract','anti_pattern_detect','retention_drop_detect',
                'pain_point_extract')),
  content_md  TEXT NOT NULL,                   -- one-page memo / summary
  signals     JSONB,                           -- structured fields for dashboard widgets
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mktg_audit_kind    ON mktg_audit_memos(kind);
CREATE INDEX IF NOT EXISTS idx_mktg_audit_created ON mktg_audit_memos(created_at DESC);

-- Job runs -- compact ledger so threshold gates can ask "how many new
-- performed records / reviews / etc. since last success?" without
-- carrying state in the function.
CREATE TABLE IF NOT EXISTS mktg_job_runs (
  run_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job          TEXT NOT NULL,
  outcome      TEXT NOT NULL CHECK (outcome IN ('skipped_threshold','ok','error')),
  reason       TEXT,                            -- short note: why skipped / what produced
  proposals_n  INTEGER NOT NULL DEFAULT 0,      -- how many rows landed in mktg_pending_proposals
  memo_id      UUID REFERENCES mktg_audit_memos(memo_id) ON DELETE SET NULL,
  ran_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_mktg_job_runs_job_ran ON mktg_job_runs(job, ran_at DESC);
