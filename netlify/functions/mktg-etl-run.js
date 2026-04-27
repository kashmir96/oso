/**
 * mktg-etl-run.js — runs the CSV ETL on Netlify, reading CSVs from
 * Supabase Storage so we don't need the operator's laptop.
 *
 * Workflow:
 *   1. Operator drops CSVs into the private mktg-etl-csvs bucket via
 *      the Supabase dashboard (drag-and-drop, no code).
 *   2. Hits POST /mktg-etl-run from the Health page UI.
 *
 * One CSV per call so we stay under the 26s extended netlify timeout.
 * The UI loops through slugs serially.
 *
 * Body:
 *   { action: 'list' }                  -> { available: [{slug, present}] }
 *   { action: 'run', csv: 'slug',
 *     retail_era_from?, retail_era_to?,
 *     limit? }                          -> { slug, table, inserted, skipped, errors }
 *
 * Auth: gated by withGate (any signed-in operator can trigger it -- the
 * service-role write happens server-side so no DB credentials cross the
 * wire).
 */
const { sbSelect, sbInsert } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');
const { FILENAMES, TARGET_TABLES, ORDER, TRANSFORMERS, parseCsvBuffer } = require('./_lib/mktg-etl-core.js');

const BUCKET = 'mktg-etl-csvs';

async function listBucket() {
  // PostgREST style request to storage list endpoint.
  const url = `${process.env.SUPABASE_URL}/storage/v1/object/list/${BUCKET}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ limit: 100, offset: 0, sortBy: { column: 'name', order: 'asc' } }),
  });
  if (!res.ok) throw new Error(`Storage list failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return await res.json();
}

async function downloadFromBucket(filename) {
  const url = `${process.env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(filename)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`Storage download failed for ${filename}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

// Idempotent insert -- pulls existing source_row_hash set, skips dups.
// For the first run the in-memory set starts empty; on re-runs we hash-check.
async function loadSeenHashes(table) {
  const set = new Set();
  let offset = 0;
  while (true) {
    const rows = await sbSelect(
      table,
      `select=source_row_hash&source_row_hash=not.is.null&limit=1000&offset=${offset}`
    );
    for (const r of rows) if (r.source_row_hash) set.add(r.source_row_hash);
    if (rows.length < 1000) break;
    offset += 1000;
  }
  return set;
}

async function insertRows(table, rows) {
  const seen = await loadSeenHashes(table);
  let inserted = 0;
  let skipped = 0;
  const fresh = rows.filter((r) => {
    if (r.source_row_hash && seen.has(r.source_row_hash)) { skipped++; return false; }
    return true;
  });
  for (let i = 0; i < fresh.length; i += 100) {
    const chunk = fresh.slice(i, i + 100);
    try {
      await sbInsert(table, chunk);
      inserted += chunk.length;
      for (const r of chunk) if (r.source_row_hash) seen.add(r.source_row_hash);
    } catch (e) {
      const msg = String(e.message || e);
      if (msg.includes('23505') || msg.includes('duplicate key')) {
        skipped += chunk.length;
      } else {
        throw e;
      }
    }
  }
  return { inserted, skipped };
}

exports.handler = withGate(async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return reply(500, { error: 'SUPABASE_URL / SUPABASE_SERVICE_KEY missing' });
  }

  try {
    if (action === 'list') {
      // Diagnostic-friendly: surface the specific missing piece (migration
      // not run, bucket missing, etc.) so the UI can render a helpful
      // message rather than a generic 500.
      let listing = [];
      let bucketReady = true;
      let setupHint = null;
      try {
        listing = await listBucket();
      } catch (e) {
        bucketReady = false;
        const msg = String(e?.message || e);
        if (msg.includes('Bucket not found') || msg.includes('"statusCode":"404"') || msg.includes('400')) {
          setupHint = 'Bucket "mktg-etl-csvs" does not exist yet. Run supabase-creative-agent-v4.sql in the Supabase SQL editor.';
        } else if (msg.includes('Invalid JWT') || msg.includes('JWS') || msg.includes('401')) {
          setupHint = 'Supabase service key is invalid -- check SUPABASE_SERVICE_KEY in Netlify env vars.';
        } else {
          setupHint = `Bucket access failed: ${msg.slice(0, 300)}`;
        }
      }
      // Also confirm migrations 1-3 are applied so the UI can warn before
      // the operator clicks Run.
      let schemaReady = true;
      let schemaHint = null;
      try {
        const versions = await sbSelect('mktg_schema_versions', 'select=schema_version&order=schema_version.asc');
        const haveCore = versions.some((v) => v.schema_version === '1.0.0');
        if (!haveCore) {
          schemaReady = false;
          schemaHint = 'Schema migration 1.0.0 not applied. Run supabase-creative-agent.sql first.';
        }
      } catch (e) {
        schemaReady = false;
        schemaHint = `mktg_schema_versions table missing -- run supabase-creative-agent.sql first. (${String(e?.message || e).slice(0,200)})`;
      }
      const presentNames = new Set((listing || []).map((o) => o.name));
      const available = ORDER.map((slug) => ({
        slug,
        filename: FILENAMES[slug],
        present:  presentNames.has(FILENAMES[slug]),
        target_table: TARGET_TABLES[slug],
      }));
      return reply(200, {
        available, bucket: BUCKET,
        bucket_ready: bucketReady,
        schema_ready: schemaReady,
        setup_hint: setupHint,
        schema_hint: schemaHint,
      });
    }

    if (action === 'run') {
      const slug = body.csv;
      if (!slug || !TRANSFORMERS[slug]) return reply(400, { error: `unknown csv slug: ${slug}` });
      const filename = FILENAMES[slug];
      const table    = TARGET_TABLES[slug];

      let buf;
      try { buf = await downloadFromBucket(filename); }
      catch (e) {
        return reply(404, {
          error: `${filename} not found in ${BUCKET} bucket. Upload it via Supabase dashboard -> Storage -> ${BUCKET}.`,
          detail: e.message,
        });
      }

      const rows = parseCsvBuffer(buf);

      const opts = {
        retailFrom: body.retail_era_from ? new Date(body.retail_era_from) : null,
        retailTo:   body.retail_era_to   ? new Date(body.retail_era_to)   : null,
        limit:      body.limit ? parseInt(body.limit, 10) : null,
      };
      const transformed = TRANSFORMERS[slug](rows, opts);

      const t0 = Date.now();
      const { inserted, skipped } = await insertRows(table, transformed);
      return reply(200, {
        slug, table,
        rows_in_csv: rows.length,
        rows_transformed: transformed.length,
        inserted, skipped,
        latency_ms: Date.now() - t0,
      });
    }

    return reply(400, { error: 'Unknown action -- use "list" or "run"' });
  } catch (e) {
    console.error('[mktg-etl-run]', e);
    return reply(500, { error: e.message || 'ETL failed' });
  }
});
