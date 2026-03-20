/**
 * deploy-status.js
 *
 * Returns the most recent Netlify deploy status for one or more sites.
 * GET ?token=X
 *
 * Returns status for all configured sites (oso, primalpantry, reviana).
 *
 * Env vars required:
 *   NETLIFY_API_TOKEN
 *   NETLIFY_SITE_ID_OSO
 *   NETLIFY_SITE_ID_PRIMALPANTRY
 *   NETLIFY_SITE_ID_REVIANA
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function reply(statusCode, data) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(data) };
}

async function getStaffByToken(token) {
  if (!token) return null;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/staff?session_token=eq.${encodeURIComponent(token)}&select=id`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });
  const rows = await res.json();
  return rows && rows.length > 0 ? rows[0] : null;
}

async function fetchDeploy(siteId, netlifyToken) {
  try {
    const res = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys?per_page=1`, {
      headers: { 'Authorization': `Bearer ${netlifyToken}` },
    });
    if (!res.ok) return { state: 'unknown', error: `API ${res.status}` };
    const deploys = await res.json();
    if (!deploys || deploys.length === 0) return { state: 'unknown', error: 'No deploys' };
    const d = deploys[0];
    return {
      state: d.state,
      created_at: d.created_at,
      published_at: d.published_at,
      deploy_time: d.deploy_time,
      title: d.title || '',
      error_message: d.error_message || '',
    };
  } catch (err) {
    return { state: 'unknown', error: err.message };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, '');
  if (event.httpMethod !== 'GET') return reply(405, { error: 'GET only' });

  const { token } = event.queryStringParameters || {};
  const staff = await getStaffByToken(token);
  if (!staff) return reply(401, { error: 'Unauthorized' });

  const NETLIFY_TOKEN = process.env.NETLIFY_API_TOKEN;
  if (!NETLIFY_TOKEN) {
    return reply(200, { error: 'NETLIFY_API_TOKEN not configured' });
  }

  const sites = {
    oso: process.env.NETLIFY_SITE_ID_OSO,
    primalpantry: process.env.NETLIFY_SITE_ID_PRIMALPANTRY,
    reviana: process.env.NETLIFY_SITE_ID_REVIANA,
  };

  const results = {};
  const fetches = Object.entries(sites).map(async ([name, siteId]) => {
    if (!siteId) {
      results[name] = { state: 'unknown', error: 'Site ID not configured' };
    } else {
      results[name] = await fetchDeploy(siteId, NETLIFY_TOKEN);
    }
  });

  await Promise.all(fetches);

  return reply(200, results);
};
