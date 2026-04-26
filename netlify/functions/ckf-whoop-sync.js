/**
 * ckf-whoop-sync.js — scheduled daily.
 *
 * Pulls yesterday's recovery, sleep, and cycle metrics from Whoop and upserts
 * a row into whoop_metrics keyed by (user_id, date). Refreshes the access
 * token if needed.
 *
 * Schedule: 0 19 * * * UTC = 07:00 / 08:00 NZ (early morning), so yesterday's
 * data is fresh by the time Curtis wakes up.
 *
 * Env: WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
const { sbSelect, sbInsert, sbUpdate } = require('./_lib/ckf-sb.js');
const { getValidIntegration } = require('./_lib/ckf-oauth.js');
const { ALLOWED_EMAIL } = require('./_lib/ckf-guard.js');

function nzYesterday() {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' });
  const today = fmt.format(new Date());
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function whoopGet(token, path, params = {}) {
  const url = new URL(`https://api.prod.whoop.com${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Whoop ${path} ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

exports.handler = async () => {
  try {
    // Find Curtis's user id
    const users = await sbSelect('ckf_users', `email=eq.${encodeURIComponent(ALLOWED_EMAIL)}&select=id&limit=1`);
    if (!users?.[0]) return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'user not bootstrapped' }) };
    const userId = users[0].id;

    const integration = await getValidIntegration(userId, 'whoop');
    if (!integration) return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'whoop not connected' }) };

    const date = nzYesterday();
    const start = `${date}T00:00:00.000Z`;
    const end = new Date(new Date(start).getTime() + 86400e3).toISOString();

    // Whoop v2 API endpoints. We pull cycles (which carry strain), recovery,
    // and sleep. Each is paginated; we just take the first page sorted by start.
    const [cycles, recoveries, sleeps] = await Promise.all([
      whoopGet(integration.access_token, '/developer/v1/cycle', { start, end, limit: 5 }).catch((e) => ({ records: [], error: e.message })),
      whoopGet(integration.access_token, '/developer/v1/recovery', { start, end, limit: 5 }).catch((e) => ({ records: [], error: e.message })),
      whoopGet(integration.access_token, '/developer/v1/activity/sleep', { start, end, limit: 5 }).catch((e) => ({ records: [], error: e.message })),
    ]);

    // Pick the most recent record from each
    const cycle = (cycles.records || [])[0];
    const recovery = (recoveries.records || [])[0];
    const sleep = (sleeps.records || [])[0];

    const metrics = {
      user_id: userId,
      date,
      recovery_score: recovery?.score?.recovery_score ?? null,
      hrv_rmssd_ms: recovery?.score?.hrv_rmssd_milli ?? null,
      resting_heart_rate: recovery?.score?.resting_heart_rate ?? null,
      strain: cycle?.score?.strain ?? null,
      sleep_performance: sleep?.score?.sleep_performance_percentage ?? null,
      sleep_hours: sleep?.score?.stage_summary?.total_in_bed_time_milli
        ? Number(sleep.score.stage_summary.total_in_bed_time_milli) / 3600000
        : null,
      sleep_efficiency: sleep?.score?.sleep_efficiency_percentage ?? null,
      raw: { cycle, recovery, sleep },
    };

    const existing = await sbSelect('whoop_metrics', `user_id=eq.${userId}&date=eq.${date}&select=id&limit=1`);
    if (existing?.[0]) {
      await sbUpdate('whoop_metrics', `id=eq.${existing[0].id}`, metrics);
    } else {
      await sbInsert('whoop_metrics', metrics);
    }

    // ── Push values into goals that are linked to Whoop fields ──
    const linkedGoals = await sbSelect(
      'goals',
      `user_id=eq.${userId}&status=eq.active&data_source=eq.whoop&select=id,name,data_source_field,current_value`
    );
    const updates = [];
    for (const g of linkedGoals || []) {
      const field = g.data_source_field;
      if (!field || metrics[field] == null) continue;
      const value = Number(metrics[field]);
      await sbUpdate('goals', `id=eq.${g.id}&user_id=eq.${userId}`, { current_value: value });
      await sbInsert('goal_logs', { goal_id: g.id, user_id: userId, value, note: `whoop ${field}` });
      updates.push({ goal: g.name, field, value });
    }

    return { statusCode: 200, body: JSON.stringify({ synced: true, date, metrics, goal_updates: updates }) };
  } catch (e) {
    console.error('[ckf-whoop-sync]', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
