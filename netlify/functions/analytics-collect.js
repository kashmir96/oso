/**
 * analytics-collect.js
 *
 * Public endpoint that receives pageview/event/duration data from the tracking script.
 * Cookie-free: hashes IP + UA + site + daily-rotating salt for anonymous visitor identity.
 *
 * Env vars required: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const crypto = require('crypto');

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function reply(statusCode, data) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(data) };
}

async function sbFetch(url, opts = {}) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  return fetch(`${SUPABASE_URL}${url}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      ...opts.headers,
    },
  });
}

// ── UA Parsing ──
function parseBrowser(ua) {
  if (!ua) return 'Unknown';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR\//i.test(ua) || /Opera/i.test(ua)) return 'Opera';
  if (/SamsungBrowser/i.test(ua)) return 'Samsung';
  if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) return 'Chrome';
  if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) return 'Safari';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  return 'Other';
}

function parseOS(ua) {
  if (!ua) return 'Unknown';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  if (/CrOS/i.test(ua)) return 'ChromeOS';
  return 'Other';
}

function deviceType(screenWidth) {
  if (!screenWidth || screenWidth <= 0) return 'Desktop';
  if (screenWidth <= 768) return 'Phone';
  if (screenWidth <= 1024) return 'Tablet';
  return 'Desktop';
}

function extractDomain(ref) {
  if (!ref) return '';
  try { return new URL(ref).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// ── Daily Salt ──
async function getDailySalt() {
  const today = new Date().toISOString().slice(0, 10);
  const res = await sbFetch('/rest/v1/analytics_salt?id=eq.1&select=*');
  const rows = await res.json();

  if (rows && rows.length > 0 && rows[0].date_str === today) {
    return rows[0].salt;
  }

  // Rotate salt
  const newSalt = crypto.randomBytes(32).toString('hex');
  await sbFetch('/rest/v1/analytics_salt?id=eq.1', {
    method: 'PATCH',
    body: JSON.stringify({ salt: newSalt, date_str: today }),
  });
  return newSalt;
}

// ── Unique check ──
async function isUniqueToday(visitorHash, siteId) {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const res = await sbFetch(
    `/rest/v1/analytics_pageviews?visitor_hash=eq.${encodeURIComponent(visitorHash)}&site_id=eq.${encodeURIComponent(siteId)}&created_at=gte.${todayStart.toISOString()}&select=id&limit=1`
  );
  const rows = await res.json();
  return !rows || rows.length === 0;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, '');
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body); } catch { return reply(400, { error: 'Bad JSON' }); }

  const { t: type, s: siteId, p: pathname } = body;
  if (!type || !siteId || !pathname) return reply(400, { error: 'Missing fields' });

  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'] || '0.0.0.0';
  const ua = event.headers['user-agent'] || '';

  // Country from Netlify geo header
  let country = '';
  try {
    const geo = event.headers['x-nf-geo'];
    if (geo) {
      const parsed = JSON.parse(geo);
      country = (parsed.country && parsed.country.code) || '';
    }
  } catch {}

  // ── PAGEVIEW ──
  if (type === 'pv') {
    const salt = await getDailySalt();
    const visitorHash = crypto.createHash('sha256').update(ip + ua + siteId + salt).digest('hex');
    const unique = await isUniqueToday(visitorHash, siteId);

    const row = {
      visitor_hash: visitorHash,
      site_id: siteId,
      pathname: pathname,
      referrer: body.r || '',
      referrer_domain: extractDomain(body.r),
      utm_campaign: body.uc || '',
      utm_source: body.us || '',
      utm_medium: body.um || '',
      utm_content: body.ux || '',
      utm_term: body.ut || '',
      browser: parseBrowser(ua),
      os: parseOS(ua),
      device_type: deviceType(body.sw),
      country: country,
      screen_width: body.sw || 0,
      duration: 0,
      is_unique: unique,
      entry_page: unique, // first page = entry page
      persistent_id: body.vid || '',
      ft_source: body.ft_src || '',
      ft_campaign: body.ft_cam || '',
      ft_medium: body.ft_med || '',
      lt_source: body.lt_src || '',
      lt_campaign: body.lt_cam || '',
      lt_medium: body.lt_med || '',
      gclid: body.gclid || '',
      fbclid: body.fbclid || '',
    };

    await sbFetch('/rest/v1/analytics_pageviews', {
      method: 'POST',
      body: JSON.stringify(row),
    });

    return reply(200, { ok: true });
  }

  // ── DURATION UPDATE ──
  if (type === 'du') {
    const dur = parseInt(body.d, 10);
    if (!dur || dur <= 0 || dur > 7200) return reply(200, { ok: true }); // ignore invalid

    const salt = await getDailySalt();
    const visitorHash = crypto.createHash('sha256').update(ip + ua + siteId + salt).digest('hex');

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    // Find the most recent pageview for this visitor+path today
    const findRes = await sbFetch(
      `/rest/v1/analytics_pageviews?visitor_hash=eq.${encodeURIComponent(visitorHash)}&site_id=eq.${encodeURIComponent(siteId)}&pathname=eq.${encodeURIComponent(pathname)}&created_at=gte.${todayStart.toISOString()}&select=id&order=created_at.desc&limit=1`
    );
    const rows = await findRes.json();
    if (rows && rows.length > 0) {
      await sbFetch(`/rest/v1/analytics_pageviews?id=eq.${rows[0].id}`, {
        method: 'PATCH',
        body: JSON.stringify({ duration: dur }),
      });
    }

    return reply(200, { ok: true });
  }

  // ── EVENT ──
  if (type === 'ev') {
    const eventName = body.n;
    if (!eventName) return reply(400, { error: 'Missing event name' });

    const salt = await getDailySalt();
    const visitorHash = crypto.createHash('sha256').update(ip + ua + siteId + salt).digest('hex');

    await sbFetch('/rest/v1/analytics_events', {
      method: 'POST',
      body: JSON.stringify({
        visitor_hash: visitorHash,
        site_id: siteId,
        event_name: eventName,
        pathname: pathname,
      }),
    });

    return reply(200, { ok: true });
  }

  return reply(400, { error: 'Unknown type' });
};
