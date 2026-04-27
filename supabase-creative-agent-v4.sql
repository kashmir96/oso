-- ===========================================================================
-- Creative-agent — ETL bucket (v1.0.3).
--
-- Block 6.1 addition: a private storage bucket where the operator drops the
-- raw CSVs (via Supabase dashboard drag-and-drop) so the netlify ETL
-- function can read them without going through the 6MB Netlify body limit.
--
-- Workflow:
--   1. Run this migration.
--   2. Open Supabase dashboard -> Storage -> mktg-etl-csvs -> upload your
--      9 CSVs (filenames as listed in scripts/mktg-etl.js) into the bucket.
--   3. Open the Health dashboard in the app -> click "Run ETL" per CSV.
--
-- Idempotent.
-- ===========================================================================

INSERT INTO mktg_schema_versions (schema_version, changelog)
VALUES ('1.0.3', 'Add private mktg-etl-csvs storage bucket for ETL on Netlify.')
ON CONFLICT (schema_version) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('mktg-etl-csvs', 'mktg-etl-csvs', false)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;
