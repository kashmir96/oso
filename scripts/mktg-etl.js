#!/usr/bin/env node
/**
 * mktg-etl.js — one-time CSV ETL into the canonical creative-agent tables.
 *
 * Reads CSVs from the marketing-playbook folder (next to this repo), parses
 * them, and inserts into the new mktg_creatives / mktg_reviews / etc tables.
 * Idempotent via source_row_hash — re-runs are safe and skip existing rows.
 *
 * Run from repo root:
 *
 *   node scripts/mktg-etl.js <csv> [...flags]
 *
 * CSV slugs:
 *   adsmanager       — ads with Meta performance (high-signal corpus)
 *   other-ads        — UTF-16 ads export with copy only (no perf)
 *   ads-export-2     — UTF-16 mega-export (10K rows; campaign tree)
 *   scripts          — video script library
 *   reviews          — Trustpilot reviews
 *   pain-points      — pain point reference table
 *   social-proof     — quotable proofs (press, reviews, endorsements, awards)
 *   primary-text     — historical primary-text bank
 *   script-types     — playbook structure_template patterns
 *   all              — runs every CSV in dependency order
 *
 * Flags:
 *   --playbook-dir=PATH        Override CSV folder (default: ../marketing-playbook/Marketing\ Agent)
 *   --retail-era-from=YYYY-MM-DD
 *   --retail-era-to=YYYY-MM-DD Mark creatives whose campaign date falls in this
 *                              range as generalizable=false (per the spec, the
 *                              retail era used different unit economics; its
 *                              patterns won't transfer).
 *   --limit=N                  Cap rows processed per CSV (debugging).
 *   --dry-run                  Parse + report counts but write nothing.
 *
 * Env required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 *
 * Embeddings + verbatim phrase extraction are NOT done here. The columns
 * exist; backfill jobs (separate, in Block 2.1+) populate them. ETL stays
 * cheap and resumable — no API calls required to land the data.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parse } = require('csv-parse/sync');

const REPO_ROOT = path.resolve(__dirname, '..');
process.chdir(REPO_ROOT);

// Auto-load .env.local then .env from the repo root (whichever exists).
// Never overrides values already set in process.env -- so an inline
// `SUPABASE_URL=... node scripts/mktg-etl.js ...` invocation still wins.
// Tiny inline parser; no dotenv dep so the script stays standalone.
function loadEnvFile(filename) {
  const fp = path.join(REPO_ROOT, filename);
  if (!fs.existsSync(fp)) return;
  const text = fs.readFileSync(fp, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // Strip surrounding single or double quotes.
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnvFile('.env.local');
loadEnvFile('.env');

const { sbSelect, sbInsert } = require(path.join(REPO_ROOT, 'netlify/functions/_lib/ckf-sb.js'));

// ─── CLI parsing ────────────────────────────────────────────────────────────
function parseFlags(argv) {
  const out = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      out[k] = v === undefined ? true : v;
    } else {
      out._.push(a);
    }
  }
  return out;
}

const flags = parseFlags(process.argv.slice(2));
const target = flags._[0];
if (!target) {
  console.error('Usage: node scripts/mktg-etl.js <csv> [...flags]\nSee header for CSV slugs.');
  process.exit(1);
}

// Try a few likely locations for the playbook folder. The repo lives under
// "Websites - Claude/oso" and the playbook under "Websites - Claude/marketing-playbook",
// so we walk up parents looking for a sibling marketing-playbook folder. If
// the repo is checked out as a worktree (e.g. .claude/worktrees/foo) we may
// need to walk up several levels.
function resolvePlaybookDir() {
  if (flags['playbook-dir']) return flags['playbook-dir'];
  let dir = REPO_ROOT;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'marketing-playbook', 'Marketing Agent');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(REPO_ROOT, '..', 'marketing-playbook', 'Marketing Agent'); // fallback for error message
}
const PLAYBOOK_DIR = resolvePlaybookDir();
const RETAIL_FROM = flags['retail-era-from'] ? new Date(flags['retail-era-from']) : null;
const RETAIL_TO   = flags['retail-era-to']   ? new Date(flags['retail-era-to'])   : null;
const LIMIT       = flags.limit ? parseInt(flags.limit, 10) : null;
const DRY_RUN     = !!flags['dry-run'];

if (RETAIL_FROM && RETAIL_TO && RETAIL_FROM > RETAIL_TO) {
  console.error('--retail-era-from must be ≤ --retail-era-to');
  process.exit(1);
}

// CSV reader + per-slug transformers live in _lib/mktg-etl-core.js so the
// CLI and the netlify function (mktg-etl-run.js) share identical logic.
const { FILENAMES, TARGET_TABLES, ORDER, SLUGS, TRANSFORMERS, parseCsvBuffer } =
  require(path.join(REPO_ROOT, 'netlify/functions/_lib/mktg-etl-core.js'));

function readCsv(absPath) {
  return parseCsvBuffer(fs.readFileSync(absPath));
}

// ─── Idempotent insert ──────────────────────────────────────────────────────
// PostgREST sbInsert doesn't expose ON CONFLICT cleanly, but our schema
// uses a UNIQUE constraint on source_row_hash. So:
// - check if hash exists; if yes, skip
// - else insert
// Cheap enough for one-time ETL. Not optimal for large tables, but fine.
const seenHashes = new Map(); // table -> Set<hash>
async function loadSeenHashes(table) {
  if (DRY_RUN) return new Set();
  if (seenHashes.has(table)) return seenHashes.get(table);
  const set = new Set();
  let offset = 0;
  while (true) {
    const rows = await sbSelect(table, `select=source_row_hash&source_row_hash=not.is.null&limit=1000&offset=${offset}`);
    for (const r of rows) if (r.source_row_hash) set.add(r.source_row_hash);
    if (rows.length < 1000) break;
    offset += 1000;
  }
  seenHashes.set(table, set);
  return set;
}

async function insertRows(table, rows) {
  if (DRY_RUN) {
    return { inserted: rows.length, skipped: 0, dry_run: true };
  }
  const seen = await loadSeenHashes(table);
  let inserted = 0;
  let skipped = 0;
  // Batch in chunks of 100 — PostgREST handles arrays as bulk.
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
      // PostgREST returns "23505" on dup-key — surface as skip not failure.
      if (String(e.message || e).includes('23505') || String(e.message || e).includes('duplicate key')) {
        skipped += chunk.length;
      } else {
        console.error(`[insertRows ${table}]`, e.message || e);
        throw e;
      }
    }
  }
  return { inserted, skipped };
}

// ─── Generic per-slug runner (uses shared transforms) ──────────────────────
async function runSlug(slug) {
  const fn = path.join(PLAYBOOK_DIR, FILENAMES[slug]);
  const rows = readCsv(fn);
  const transformed = TRANSFORMERS[slug](rows, {
    retailFrom: RETAIL_FROM,
    retailTo:   RETAIL_TO,
    limit:      LIMIT,
  });
  const table = TARGET_TABLES[slug];
  console.log(`${FILENAMES[slug]}: ${rows.length} rows -> ${transformed.length} transformed`);
  const res = await insertRows(table, transformed);
  console.log(`  -> ${table}: +${res.inserted} inserted, ${res.skipped} skipped`);
}

(async () => {
  if (!DRY_RUN && (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY)) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars (use --dry-run to parse without writing).');
    process.exit(1);
  }
  if (!fs.existsSync(PLAYBOOK_DIR)) {
    console.error(`Playbook folder not found: ${PLAYBOOK_DIR}`);
    console.error('Pass --playbook-dir=PATH to override.');
    process.exit(1);
  }
  console.log(`Playbook dir: ${PLAYBOOK_DIR}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'WRITE'}`);
  if (RETAIL_FROM) console.log(`Retail era: ${RETAIL_FROM.toISOString().slice(0,10)} to ${RETAIL_TO.toISOString().slice(0,10)} -> generalizable=false`);

  const slugs = target === 'all' ? ORDER : [target];
  for (const slug of slugs) {
    if (!TRANSFORMERS[slug]) { console.error(`Unknown CSV slug: ${slug}`); process.exit(1); }
    console.log(`\n--- ${slug} ---`);
    try { await runSlug(slug); }
    catch (e) { console.error(`  FAILED: ${e.message || e}`); process.exit(1); }
  }
  console.log('\nETL complete.');
})();
