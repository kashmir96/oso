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
      // Daily totals per campaign (broken down by day)
      url = `https://graph.facebook.com/v21.0/act_${accountId}/insights?level=campaign&time_range=${encodeURIComponent(timeRange)}&time_increment=1&fields=campaign_name,campaign_id,spend,actions,action_values&access_token=${accessToken}&limit=500`;
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
        const { conversions, conversions_value } = parseActions(d.actions, d.action_values);
        return {
          date: d.date_start,
          campaign_name: d.campaign_name || '',
          name: d.campaign_name || '',
          spend: Number(d.spend || 0),
          conversions,
          conversions_value,
        };
      });
      return reply(200, { daily: dailyData });
    }

    // Ad-level creative performance (with thumbnails)
    if (qs.ads === '1') {
      // Fetch active ads with their creative thumbnails and insights
      const trInline = `{"since":"${from}","until":"${to}"}`;
      const adUrl = `https://graph.facebook.com/v21.0/act_${accountId}/ads?fields=name,status,creative{thumbnail_url,image_url,object_story_spec,title,body},insights.time_range(${trInline}){impressions,clicks,spend,actions,action_values,ctr,cpc}&filtering=${encodeURIComponent('[{"field":"effective_status","operator":"IN","value":["ACTIVE"]}]')}&limit=100&access_token=${accessToken}`;
      console.log('[FB Ads] Fetching:', adUrl.replace(accessToken, '***'));
      let adData = [];
      let nextAdUrl = adUrl;
      while (nextAdUrl) {
        const adRes = await fetch(nextAdUrl);
        const adJson = await adRes.json();
        console.log('[FB Ads] Response:', JSON.stringify({ dataCount: adJson.data?.length, error: adJson.error, hasMore: !!adJson.paging?.next }).slice(0, 500));
        if (adJson.error) {
          console.error('Facebook Ads API error:', adJson.error);
          return reply(200, { ads: [], error: adJson.error.message });
        }
        if (adJson.data) adData = adData.concat(adJson.data);
        nextAdUrl = adJson.paging?.next || null;
      }
      console.log(`[FB Ads] Total ads fetched: ${adData.length}`);

      const ads = adData.map(ad => {
        const insights = ad.insights?.data?.[0] || {};
        const { conversions, conversions_value } = parseActions(insights.actions, insights.action_values);
        const spend = Number(insights.spend || 0);
        // Extract ad copy from object_story_spec
        const spec = ad.creative?.object_story_spec || {};
        const linkData = spec.link_data || spec.video_data || {};
        const adBody = ad.creative?.body || linkData.message || linkData.description || '';
        const adTitle = ad.creative?.title || linkData.name || linkData.title || '';
        const adLink = linkData.link || '';
        return {
          name: ad.name || '',
          status: ad.status || '',
          thumbnail_url: ad.creative?.thumbnail_url || '',
          image_url: ad.creative?.image_url || '',
          ad_body: adBody,
          ad_title: adTitle,
          ad_link: adLink,
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

    // ── Sync FB ad names → UTM mappings ──
    if (qs.sync === 'utm') {
      const SUPABASE_URL = process.env.SUPABASE_URL;
      const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
      const sbHeaders = {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'resolution=merge-duplicates,return=representation',
      };

      const mappings = [];

      // Load existing mappings to skip already-mapped IDs
      const existingRes = await fetch(`${SUPABASE_URL}/rest/v1/utm_mappings?select=utm_field,utm_value&platform=eq.facebook`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
      });
      const existingRows = await existingRes.json();
      const existingKeys = new Set((existingRows || []).map(r => r.utm_field + '::' + r.utm_value));

      // 1. Campaigns (campaign_id → campaign_name) → utm_campaign
      const campUrl = `https://graph.facebook.com/v21.0/act_${accountId}/campaigns?fields=id,name&limit=500&access_token=${accessToken}`;
      let campNext = campUrl;
      while (campNext) {
        const r = await fetch(campNext);
        const j = await r.json();
        if (j.error) { console.error('[FB sync] campaigns error:', j.error); break; }
        (j.data || []).forEach(c => {
          if (c.id && c.name && !existingKeys.has('utm_campaign::' + c.id)) {
            mappings.push({ utm_field: 'utm_campaign', utm_value: c.id, friendly_name: c.name, platform: 'facebook' });
          }
        });
        campNext = j.paging?.next || null;
      }

      // 2. Adsets (adset_id → adset_name) → utm_adgroup
      const adsetUrl = `https://graph.facebook.com/v21.0/act_${accountId}/adsets?fields=id,name&limit=500&access_token=${accessToken}`;
      let adsetNext = adsetUrl;
      while (adsetNext) {
        const r = await fetch(adsetNext);
        const j = await r.json();
        if (j.error) { console.error('[FB sync] adsets error:', j.error); break; }
        (j.data || []).forEach(a => {
          if (a.id && a.name && !existingKeys.has('utm_adgroup::' + a.id)) {
            mappings.push({ utm_field: 'utm_adgroup', utm_value: a.id, friendly_name: a.name, platform: 'facebook' });
          }
        });
        adsetNext = j.paging?.next || null;
      }

      // 3. Ads (ad_id → ad_name) → utm_content
      const adsUrl = `https://graph.facebook.com/v21.0/act_${accountId}/ads?fields=id,name&limit=500&access_token=${accessToken}`;
      let adsNext = adsUrl;
      while (adsNext) {
        const r = await fetch(adsNext);
        const j = await r.json();
        if (j.error) { console.error('[FB sync] ads error:', j.error); break; }
        (j.data || []).forEach(a => {
          if (a.id && a.name && !existingKeys.has('utm_content::' + a.id)) {
            mappings.push({ utm_field: 'utm_content', utm_value: a.id, friendly_name: a.name, platform: 'facebook' });
          }
        });
        adsNext = j.paging?.next || null;
      }

      // Bulk upsert to utm_mappings
      if (mappings.length > 0) {
        // Chunk into batches of 200
        for (let i = 0; i < mappings.length; i += 200) {
          const chunk = mappings.slice(i, i + 200);
          await fetch(`${SUPABASE_URL}/rest/v1/utm_mappings`, {
            method: 'POST',
            headers: sbHeaders,
            body: JSON.stringify(chunk),
          });
        }
      }

      return reply(200, { synced: mappings.length, campaigns: mappings.filter(m => m.utm_field === 'utm_campaign').length, adsets: mappings.filter(m => m.utm_field === 'utm_adgroup').length, ads: mappings.filter(m => m.utm_field === 'utm_content').length });
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
