/**
 * adspend-hourly-sync.js
 *
 * Scheduled function — runs every hour via Netlify scheduled functions.
 * Polls FB + Google for today's cumulative spend, calculates the hourly
 * delta, and stores it in adspend_hourly table.
 *
 * Also cleans up rows older than 14 days.
 *
 * Schedule: @hourly (configured in netlify.toml)
 */

const HEADERS = {
  'Content-Type': 'application/json',
};

function sbFetch(path, opts = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  return fetch(`${url}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: opts.prefer || 'return=minimal',
      ...opts.headers,
    },
  });
}

async function getGoogleTokens() {
  const res = await sbFetch('/rest/v1/google_tokens?id=eq.1&select=access_token,refresh_token,expires_at,ads_customer_id');
  const rows = await res.json();
  if (!rows || rows.length === 0 || !rows[0].access_token) return null;
  const row = rows[0];

  if (new Date(row.expires_at) < new Date(Date.now() + 60000)) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!row.refresh_token || !clientId || !clientSecret) return null;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: row.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) return null;

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
    await sbFetch('/rest/v1/google_tokens?id=eq.1', {
      method: 'PATCH',
      body: JSON.stringify({ access_token: tokenData.access_token, expires_at: expiresAt, updated_at: new Date().toISOString() }),
    });
    row.access_token = tokenData.access_token;
  }
  return row;
}

async function getFacebookSpendToday() {
  const accountId = process.env.FB_AD_ACCOUNT_ID;
  const accessToken = process.env.FB_ACCESS_TOKEN;
  if (!accountId || !accessToken) return null;

  try {
    const url = `https://graph.facebook.com/v21.0/act_${accountId}/insights?fields=spend&date_preset=today&access_token=${accessToken}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.error) return null;
    return json.data && json.data.length > 0 ? Number(json.data[0].spend || 0) : 0;
  } catch {
    return null;
  }
}

async function getGoogleSpendToday() {
  const gTokens = await getGoogleTokens();
  if (!gTokens || !gTokens.ads_customer_id) return null;

  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!devToken) return null;

  try {
    const today = new Date().toISOString().slice(0, 10);
    const query = `SELECT metrics.cost_micros FROM campaign WHERE segments.date = '${today}' AND campaign.status = 'ENABLED'`;

    const res = await fetch(
      `https://googleads.googleapis.com/v23/customers/${gTokens.ads_customer_id}/googleAds:searchStream`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${gTokens.access_token}`,
          'developer-token': devToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      }
    );

    const data = await res.json();
    if (!res.ok) return null;

    let totalMicros = 0;
    const batches = Array.isArray(data) ? data : [data];
    for (const batch of batches) {
      for (const row of (batch.results || [])) {
        totalMicros += Number(row.metrics?.costMicros || 0);
      }
    }
    return totalMicros / 1000000;
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  // Get NZ time
  const now = new Date();
  const nzStr = now.toLocaleString('en-US', { timeZone: 'Pacific/Auckland' });
  const nz = new Date(nzStr);
  const year = nz.getFullYear();
  const month = String(nz.getMonth() + 1).padStart(2, '0');
  const day = String(nz.getDate()).padStart(2, '0');
  const todayDate = `${year}-${month}-${day}`;
  const currentHour = nz.getHours();

  console.log(`[adspend-hourly] Running for ${todayDate} hour ${currentHour}`);

  // Fetch today's cumulative spend from both platforms
  const [fbSpend, gSpend] = await Promise.all([
    getFacebookSpendToday(),
    getGoogleSpendToday(),
  ]);

  console.log(`[adspend-hourly] FB: $${fbSpend}, Google: $${gSpend}`);

  // For each source, get the previous hour's cumulative, calculate delta
  // Handle FB/Google midnight reset: when cumulative drops, the new value IS the delta
  for (const [source, cumSpend] of [['facebook', fbSpend], ['google', gSpend]]) {
    if (cumSpend === null) continue;

    // Get most recent previous row (could be today or yesterday — handles day boundary)
    const prevRes = await sbFetch(
      `/rest/v1/adspend_hourly?source=eq.${source}&order=date.desc,hour.desc&limit=1&not.and=(date.eq.${todayDate},hour.eq.${currentHour})`,
      { headers: { Accept: 'application/json' } }
    );
    const prevRows = await prevRes.json();
    const prevCum = prevRows.length > 0 ? Number(prevRows[0].cumulative_spend || 0) : 0;

    // If cumulative dropped (ad platform reset at their midnight), the new cumulative IS the hourly spend
    // Otherwise normal delta calculation
    const hourlyDelta = cumSpend < prevCum ? cumSpend : (cumSpend - prevCum);

    // Upsert this hour
    await sbFetch('/rest/v1/adspend_hourly', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        date: todayDate,
        hour: currentHour,
        source,
        cumulative_spend: cumSpend,
        hourly_spend: hourlyDelta,
      }),
    });

    console.log(`[adspend-hourly] Stored ${source}: cumulative=$${cumSpend}, hourly=$${hourlyDelta}, prevCum=$${prevCum}${cumSpend < prevCum ? ' (RESET DETECTED)' : ''}`);
  }

  // Cleanup: delete rows older than 14 days
  const cutoff = new Date(nz);
  cutoff.setDate(cutoff.getDate() - 14);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  await sbFetch(`/rest/v1/adspend_hourly?date=lt.${cutoffDate}`, { method: 'DELETE' });

  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, date: todayDate, hour: currentHour, fb: fbSpend, google: gSpend }) };
};
