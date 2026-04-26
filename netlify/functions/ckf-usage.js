/**
 * ckf-usage.js — read-only API usage aggregates.
 *
 * Actions:
 *   summary        — { today, this_month, last_30d } per provider + total $
 *   recent         — last N call rows
 */
const { sbSelect } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');

function nzToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date()); }

function startOfDayUtc(dateStr) {
  // Treat NZ midnight as the day boundary. Convert to UTC by subtracting NZ offset roughly.
  // Simpler: use NZ-formatted date string + 00:00:00 in NZ tz; cron rows are timestamptz in UTC,
  // so we filter using ISO. Approx is good enough for spend display.
  return new Date(dateStr + 'T00:00:00.000Z').toISOString();
}

exports.handler = withGate(async (event, { user }) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  if (action === 'summary') {
    const today = nzToday();
    const monthStart = today.slice(0, 8) + '01';
    const thirty = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);

    // Pull last 30d rows once and aggregate client-side. Cheap for one user.
    const rows = await sbSelect(
      'ckf_api_usage',
      `occurred_at=gte.${encodeURIComponent(startOfDayUtc(thirty))}&order=occurred_at.desc&limit=2000&select=provider,action,model,input_tokens,output_tokens,cache_read_tokens,cache_creation_tokens,audio_seconds,chars,cost_usd,occurred_at`
    );

    const buckets = {
      today: { total: 0, by_provider: {} },
      this_month: { total: 0, by_provider: {} },
      last_30d: { total: 0, by_provider: {} },
    };
    function add(b, r) {
      b.total += Number(r.cost_usd || 0);
      const k = r.provider || 'unknown';
      if (!b.by_provider[k]) b.by_provider[k] = { cost: 0, calls: 0, input_tokens: 0, output_tokens: 0, audio_seconds: 0, chars: 0 };
      const p = b.by_provider[k];
      p.cost += Number(r.cost_usd || 0);
      p.calls += 1;
      p.input_tokens += Number(r.input_tokens || 0);
      p.output_tokens += Number(r.output_tokens || 0);
      p.audio_seconds += Number(r.audio_seconds || 0);
      p.chars += Number(r.chars || 0);
    }
    const todayUtcStart = startOfDayUtc(today);
    const monthUtcStart = startOfDayUtc(monthStart);
    for (const r of (rows || [])) {
      add(buckets.last_30d, r);
      if (r.occurred_at >= monthUtcStart) add(buckets.this_month, r);
      if (r.occurred_at >= todayUtcStart) add(buckets.today, r);
    }
    // Round costs nicely
    function roundB(b) {
      b.total = Number(b.total.toFixed(4));
      for (const k of Object.keys(b.by_provider)) {
        b.by_provider[k].cost = Number(b.by_provider[k].cost.toFixed(4));
      }
    }
    roundB(buckets.today); roundB(buckets.this_month); roundB(buckets.last_30d);
    return reply(200, { ...buckets });
  }

  if (action === 'recent') {
    const limit = Math.min(Number(body.limit) || 30, 200);
    const rows = await sbSelect(
      'ckf_api_usage',
      `order=occurred_at.desc&limit=${limit}&select=provider,action,model,input_tokens,output_tokens,audio_seconds,chars,cost_usd,occurred_at`
    );
    return reply(200, { rows: rows || [] });
  }

  return reply(400, { error: 'Unknown action' });
});
