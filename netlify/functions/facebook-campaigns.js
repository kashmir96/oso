/**
 * facebook-campaigns.js
 *
 * Returns per-campaign performance data from Facebook Marketing API.
 *
 * GET ?token=X&from=YYYY-MM-DD&to=YYYY-MM-DD
 *     Optional: &daily=1 for per-day breakdown (total spend + revenue by day)
 *
 * Returns: { campaigns: [{ name, id, impressions, clicks, spend, conversions, conversions_value }] }
 *          or with daily=1: { daily: [{ date, spend, conversions_value }] }
 *
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   FB_AD_ACCOUNT_ID, FB_ACCESS_TOKEN
 */

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function reply(code, data) {
  return { statusCode: code, headers: HEADERS, body: JSON.stringify(data) };
}

async function getStaffByToken(token) {
  if (!token) return null;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/staff?session_token=eq.${encodeURIComponent(token)}&select=id`, {
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });
  const rows = await res.json();
  return rows && rows.length > 0 ? rows[0] : null;
}

function parseActions(actions, actionValues) {
  let conversions = 0;
  let conversions_value = 0;

  if (actions) {
    for (const a of actions) {
      if (a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase') {
        conversions += Number(a.value || 0);
      }
    }
  }
  if (actionValues) {
    for (const a of actionValues) {
      if (a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase') {
        conversions_value += Number(a.value || 0);
      }
    }
  }

  return { conversions, conversions_value };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, '');
  if (event.httpMethod !== 'GET') return reply(405, { error: 'GET only' });

  const qs = event.queryStringParameters || {};
  const { token, from, to, daily, geo } = qs;

  const staff = await getStaffByToken(token);
  if (!staff) return reply(401, { error: 'Unauthorized' });

  const accountId = process.env.FB_AD_ACCOUNT_ID;
  const accessToken = process.env.FB_ACCESS_TOKEN;

  if (!accountId || !accessToken) {
    return reply(200, { campaigns: [], error: 'Facebook credentials not configured' });
  }

  if (!from || !to) return reply(400, { error: 'Missing from/to date params' });

  try {
    const timeRange = JSON.stringify({ since: from, until: to });

    let url;
    if (geo === 'region') {
      // Region-level breakdown (spend, impressions, clicks, conversions by region)
      url = `https://graph.facebook.com/v21.0/act_${accountId}/insights?time_range=${encodeURIComponent(timeRange)}&breakdowns=region&fields=region,spend,impressions,clicks,actions,action_values&access_token=${accessToken}&limit=500`;
    } else if (daily) {
      // Daily totals (account level, broken down by day)
      url = `https://graph.facebook.com/v21.0/act_${accountId}/insights?time_range=${encodeURIComponent(timeRange)}&time_increment=1&fields=spend,actions,action_values&access_token=${accessToken}&limit=100`;
    } else {
      // Campaign level
      url = `https://graph.facebook.com/v21.0/act_${accountId}/insights?level=campaign&time_range=${encodeURIComponent(timeRange)}&fields=campaign_name,campaign_id,impressions,clicks,spend,actions,action_values&access_token=${accessToken}&limit=100`;
    }

    // Fetch all pages
    let allData = [];
    let nextUrl = url;

    while (nextUrl) {
      const res = await fetch(nextUrl);
      const json = await res.json();

      if (json.error) {
        console.error('Facebook API error:', json.error);
        return reply(200, { campaigns: [], error: json.error.message });
      }

      if (json.data) allData = allData.concat(json.data);
      nextUrl = json.paging?.next || null;
    }

    if (geo === 'region') {
      const regions = allData.map(d => {
        const { conversions, conversions_value } = parseActions(d.actions, d.action_values);
        return {
          region: d.region || '',
          spend: Number(d.spend || 0),
          impressions: Number(d.impressions || 0),
          clicks: Number(d.clicks || 0),
          conversions,
          conversions_value,
        };
      });
      // Aggregate by region (in case of duplicates)
      const regionMap = {};
      regions.forEach(r => {
        if (!r.region) return;
        if (!regionMap[r.region]) regionMap[r.region] = { region: r.region, spend: 0, impressions: 0, clicks: 0, conversions: 0, conversions_value: 0 };
        regionMap[r.region].spend += r.spend;
        regionMap[r.region].impressions += r.impressions;
        regionMap[r.region].clicks += r.clicks;
        regionMap[r.region].conversions += r.conversions;
        regionMap[r.region].conversions_value += r.conversions_value;
      });
      const sorted = Object.values(regionMap).sort((a, b) => b.spend - a.spend);
      return reply(200, { regions: sorted });
    }

    if (daily) {
      const dailyData = allData.map(d => {
        const { conversions_value } = parseActions(d.actions, d.action_values);
        return {
          date: d.date_start,
          spend: Number(d.spend || 0),
          conversions_value,
        };
      });
      return reply(200, { daily: dailyData });
    }

    // Ad-level creative performance (with thumbnails)
    if (qs.ads === '1') {
      // Fetch ad-level insights with creative thumbnail
      // For /ads endpoint, insights.time_range uses inline JSON without outer encoding
      // Step 1: Get active campaign IDs
      const campUrl = `https://graph.facebook.com/v21.0/act_${accountId}/campaigns?fields=id&filtering=[{"field":"effective_status","operator":"IN","value":["ACTIVE"]}]&limit=500&access_token=${accessToken}`;
      const campRes = await fetch(campUrl);
      const campJson = await campRes.json();
      const activeCampIds = (campJson.data || []).map(c => c.id);

      if (activeCampIds.length === 0) {
        return reply(200, { ads: [], error: 'No active campaigns' });
      }

      // Step 2: Fetch active ads within those campaigns
      const trInline = `{"since":"${from}","until":"${to}"}`;
      const campFilter = JSON.stringify([
        {"field":"campaign.id","operator":"IN","value":activeCampIds},
        {"field":"ad.effective_status","operator":"IN","value":["ACTIVE"]}
      ]);
      const adUrl = `https://graph.facebook.com/v21.0/act_${accountId}/ads?fields=name,status,creative{thumbnail_url},insights.time_range(${trInline}){impressions,clicks,spend,actions,action_values,ctr,cpc}&filtering=${encodeURIComponent(campFilter)}&limit=100&access_token=${accessToken}`;
      let adData = [];
      let nextAdUrl = adUrl;
      while (nextAdUrl) {
        const adRes = await fetch(nextAdUrl);
        const adJson = await adRes.json();
        if (adJson.error) {
          console.error('Facebook Ads API error:', adJson.error);
          return reply(200, { ads: [], error: adJson.error.message });
        }
        if (adJson.data) adData = adData.concat(adJson.data);
        nextAdUrl = adJson.paging?.next || null;
      }

      const ads = adData.map(ad => {
        const insights = ad.insights?.data?.[0] || {};
        const { conversions, conversions_value } = parseActions(insights.actions, insights.action_values);
        const spend = Number(insights.spend || 0);
        return {
          name: ad.name || '',
          status: ad.status || '',
          thumbnail_url: ad.creative?.thumbnail_url || '',
          impressions: Number(insights.impressions || 0),
          clicks: Number(insights.clicks || 0),
          spend,
          ctr: Number(insights.ctr || 0),
          cpc: Number(insights.cpc || 0),
          conversions,
          conversions_value,
          roas: spend > 0 ? (conversions_value / spend).toFixed(1) : '0',
          cpa: conversions > 0 ? (spend / conversions).toFixed(2) : null,
        };
      }).filter(a => a.spend > 0).sort((a, b) => b.spend - a.spend);

      return reply(200, { ads });
    }

    const campaigns = allData.map(d => {
      const { conversions, conversions_value } = parseActions(d.actions, d.action_values);
      return {
        name: d.campaign_name || '',
        id: d.campaign_id || '',
        impressions: Number(d.impressions || 0),
        clicks: Number(d.clicks || 0),
        spend: Number(d.spend || 0),
        conversions,
        conversions_value,
      };
    });

    // Sort by spend descending
    campaigns.sort((a, b) => b.spend - a.spend);

    return reply(200, { campaigns });
  } catch (err) {
    console.error('Facebook campaigns fetch error:', err.message);
    return reply(200, { campaigns: [], ads: [], error: err.message });
  }
};
