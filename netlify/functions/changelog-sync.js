/**
 * changelog-sync.js
 *
 * Scheduled function – runs every 15 minutes.
 * Polls Netlify API for recent PrimalPantry deploys, fetches commit
 * file lists from GitHub, detects funnel-related changes, and stores
 * 30-day baseline funnel metrics in Supabase.
 *
 * Env vars required:
 *   NETLIFY_API_TOKEN, NETLIFY_SITE_ID_PRIMALPANTRY
 *   GITHUB_TOKEN  (personal access token with repo read)
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const FUNNEL_PATTERNS = [
  'index.html', 'checkout', 'cart', 'nav', 'header', 'footer',
  'layouts/', 'product', 'collection', 'pricing', 'buy', 'order',
  'templates/', 'sections/', 'snippets/', 'theme',
];

function sbFetch(path, opts = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  return fetch(`${url}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...opts.headers,
    },
  });
}

function isFunnelFile(filepath) {
  const lower = filepath.toLowerCase();
  return FUNNEL_PATTERNS.some(p => lower.includes(p));
}

async function getFilesChanged(sha) {
  const token = process.env.GITHUB_TOKEN;
  if (!token || !sha) return [];
  try {
    const res = await fetch(`https://api.github.com/repos/kashmir96/primalpantry/commits/${sha}`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'oso-changelog-sync',
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.files || []).map(f => f.filename);
  } catch (e) {
    console.error('[changelog-sync] GitHub API error:', e.message);
    return [];
  }
}

async function getFunnelBaseline(deployedAt) {
  // Get 30-day funnel metrics ending at deploy time
  const to = new Date(deployedAt);
  const from = new Date(to);
  from.setDate(from.getDate() - 30);
  const fromStr = from.toISOString();
  const toStr = to.toISOString();

  try {
    const res = await sbFetch('/rest/v1/rpc/analytics_funnel_stages', {
      method: 'POST',
      body: JSON.stringify({
        p_site: 'PrimalPantry.co.nz',
        p_from: fromStr,
        p_to: toStr,
      }),
    });
    const data = await res.json();
    if (!data || res.status !== 200) return { visitors: 0, atc: 0, conv: 0, rev: 0 };
    return {
      visitors: data.visitors || 0,
      atc: data.atc || 0,
      conv: data.purchased || data.checkout || 0,
      rev: 0, // revenue not in funnel_stages, will be enriched later from orders
    };
  } catch (e) {
    console.error('[changelog-sync] Baseline fetch error:', e.message);
    return { visitors: 0, atc: 0, conv: 0, rev: 0 };
  }
}

exports.handler = async () => {
  const NETLIFY_TOKEN = process.env.NETLIFY_API_TOKEN;
  const SITE_ID = process.env.NETLIFY_SITE_ID_PRIMALPANTRY;

  if (!NETLIFY_TOKEN || !SITE_ID) {
    console.log('[changelog-sync] Missing NETLIFY_API_TOKEN or SITE_ID');
    return { statusCode: 200, body: 'skipped' };
  }

  try {
    // Fetch last 10 deploys from Netlify
    const netlifyRes = await fetch(
      `https://api.netlify.com/api/v1/sites/${SITE_ID}/deploys?per_page=10`,
      { headers: { 'Authorization': `Bearer ${NETLIFY_TOKEN}` } }
    );
    if (!netlifyRes.ok) {
      console.error('[changelog-sync] Netlify API error:', netlifyRes.status);
      return { statusCode: 200, body: 'netlify error' };
    }
    const deploys = await netlifyRes.json();

    // Get existing deploy IDs to avoid duplicates
    const deployIds = deploys.map(d => d.id).filter(Boolean);
    if (deployIds.length === 0) return { statusCode: 200, body: 'no deploys' };

    const existingRes = await sbFetch(
      `/rest/v1/site_changelogs?deploy_id=in.(${deployIds.join(',')})&select=deploy_id`
    );
    const existingRows = await existingRes.json();
    const existingIds = new Set((existingRows || []).map(r => r.deploy_id));

    let inserted = 0;
    for (const d of deploys) {
      if (!d.id || existingIds.has(d.id)) continue;
      if (d.state !== 'ready') continue; // Only track successful deploys

      const sha = d.commit_ref || '';
      const files = await getFilesChanged(sha);
      const funnelFiles = files.filter(isFunnelFile);
      const isFunnel = funnelFiles.length > 0;

      // Determine affected funnel pages
      const funnelPages = [];
      if (isFunnel) {
        if (files.some(f => f.toLowerCase().includes('index.html'))) funnelPages.push('/');
        if (files.some(f => f.toLowerCase().includes('checkout'))) funnelPages.push('/checkout');
        if (files.some(f => /nav|header|footer|layout/i.test(f))) funnelPages.push('*'); // all pages
        if (files.some(f => /product|collection/i.test(f))) funnelPages.push('/products');
        if (files.some(f => /cart/i.test(f))) funnelPages.push('/cart');
      }

      // Get baseline metrics for funnel-related changes
      let baseline = { visitors: 0, atc: 0, conv: 0, rev: 0 };
      if (isFunnel) {
        baseline = await getFunnelBaseline(d.created_at);
      }

      const row = {
        deploy_id: d.id,
        site_key: 'primalpantry',
        commit_message: d.title || '',
        commit_sha: sha,
        files_changed: files,
        deployed_at: d.created_at,
        is_funnel_related: isFunnel,
        funnel_pages: funnelPages,
        baseline_visitors: baseline.visitors,
        baseline_atc: baseline.atc,
        baseline_conv: baseline.conv,
        baseline_rev: baseline.rev,
      };

      const insertRes = await sbFetch('/rest/v1/site_changelogs', {
        method: 'POST',
        body: JSON.stringify(row),
        headers: { 'Prefer': 'return=minimal' },
      });
      if (insertRes.ok) inserted++;
      else console.error('[changelog-sync] Insert failed:', await insertRes.text());
    }

    console.log(`[changelog-sync] Processed ${deploys.length} deploys, inserted ${inserted}`);
    return { statusCode: 200, body: `inserted ${inserted}` };
  } catch (err) {
    console.error('[changelog-sync] Error:', err.message);
    return { statusCode: 200, body: 'error' };
  }
};
