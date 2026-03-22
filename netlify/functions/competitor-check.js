/**
 * competitor-check.js
 *
 * Netlify scheduled function – runs once daily at ~3:17am NZT.
 * For each active competitor:
 *   1. Fetches homepage HTML + sitemap.xml
 *   2. Extracts: title, meta description, h1/hero text, prices, product count, content hash
 *   3. Compares against previous snapshot
 *   4. If changes detected → inserts into competitor_changes
 *   5. Saves new snapshot
 *
 * No external dependencies – uses native fetch + regex parsing.
 */

const crypto = require('crypto');

function sbFetch(path, opts = {}) {
  const headers = {
    'apikey': process.env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (opts.prefer) headers['Prefer'] = opts.prefer;
  return fetch(`${process.env.SUPABASE_URL}${path}`, {
    headers,
    method: opts.method || 'GET',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

// ── HTML extraction helpers ──

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim().replace(/\s+/g, ' ') : '';
}

function extractMetaDescription(html) {
  const m = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["'][^>]*\/?>/i)
           || html.match(/<meta[^>]*content=["']([\s\S]*?)["'][^>]*name=["']description["'][^>]*\/?>/i);
  return m ? m[1].trim().replace(/\s+/g, ' ') : '';
}

function extractHeroText(html) {
  // First h1, or first h2 if no h1
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return stripTags(h1[1]).trim().replace(/\s+/g, ' ').slice(0, 500);
  const h2 = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  if (h2) return stripTags(h2[1]).trim().replace(/\s+/g, ' ').slice(0, 500);
  return '';
}

function extractPrices(html) {
  // Match prices like $29.99, NZ$45.00, $120 etc. with nearby context
  const prices = [];
  // Get price elements with surrounding context
  const pricePattern = /(?:<[^>]*class="[^"]*price[^"]*"[^>]*>[\s\S]*?<\/[^>]+>)/gi;
  const priceBlocks = html.match(pricePattern) || [];
  for (const block of priceBlocks.slice(0, 30)) {
    const text = stripTags(block).trim().replace(/\s+/g, ' ');
    if (text) prices.push(text);
  }
  // Also grab standalone price patterns
  const standalone = html.match(/(?:NZ)?\$\d+(?:\.\d{2})?/g) || [];
  const unique = [...new Set(standalone)];
  return JSON.stringify({ labeled: prices.slice(0, 20), raw: unique.slice(0, 30) });
}

function extractProductCount(html, sitemapPages) {
  // Count from sitemap product URLs if available
  if (sitemapPages && sitemapPages.length > 0) {
    const productPages = sitemapPages.filter(p =>
      /\/products\/|\/product\/|\/collections\/.*\/products/i.test(p)
    );
    if (productPages.length > 0) return productPages.length;
  }
  // Fallback: count product-card-like elements
  const cards = html.match(/<[^>]*class="[^"]*product[-_]?card[^"]*"[^>]*>/gi) || [];
  if (cards.length > 0) return cards.length;
  // Another fallback: product grid items
  const items = html.match(/<[^>]*class="[^"]*product[-_]?item[^"]*"[^>]*>/gi) || [];
  return items.length || 0;
}

function extractVisibleText(html) {
  // Remove script, style, nav, footer, header
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '');
  text = stripTags(text).replace(/\s+/g, ' ').trim();
  return text.slice(0, 10000); // Cap at 10k chars
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ');
}

function contentHash(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

// ── Sitemap parsing ──

async function fetchSitemap(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/sitemap.xml`, {
      headers: { 'User-Agent': 'PrimalPantryBot/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const urls = [];
    const matches = xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi);
    for (const m of matches) urls.push(m[1].trim());
    return urls;
  } catch {
    return [];
  }
}

// ── Diffing ──

function diffSnapshots(prev, curr, competitorName) {
  const changes = [];

  if (prev.title !== curr.title && curr.title) {
    changes.push({
      change_type: 'title',
      summary: `Title changed: "${prev.title || '(empty)'}" → "${curr.title}"`,
      old_value: prev.title || '',
      new_value: curr.title,
    });
  }

  if (prev.meta_description !== curr.meta_description && curr.meta_description) {
    changes.push({
      change_type: 'meta',
      summary: `Meta description updated`,
      old_value: prev.meta_description || '',
      new_value: curr.meta_description,
    });
  }

  if (prev.hero_text !== curr.hero_text && curr.hero_text) {
    changes.push({
      change_type: 'hero',
      summary: `Hero text changed: "${(prev.hero_text || '').slice(0, 80)}" → "${curr.hero_text.slice(0, 80)}"`,
      old_value: prev.hero_text || '',
      new_value: curr.hero_text,
    });
  }

  if (prev.product_count !== curr.product_count && curr.product_count > 0) {
    const diff = curr.product_count - (prev.product_count || 0);
    const direction = diff > 0 ? `+${diff} new` : `${diff} removed`;
    changes.push({
      change_type: 'products',
      summary: `Product count: ${prev.product_count || 0} → ${curr.product_count} (${direction})`,
      old_value: String(prev.product_count || 0),
      new_value: String(curr.product_count),
    });
  }

  // Price changes
  if (prev.price_snippets !== curr.price_snippets && curr.price_snippets) {
    try {
      const oldP = JSON.parse(prev.price_snippets || '{"raw":[]}');
      const newP = JSON.parse(curr.price_snippets);
      const oldRaw = new Set(oldP.raw || []);
      const newRaw = new Set(newP.raw || []);
      const added = [...newRaw].filter(p => !oldRaw.has(p));
      const removed = [...oldRaw].filter(p => !newRaw.has(p));
      if (added.length > 0 || removed.length > 0) {
        const parts = [];
        if (added.length) parts.push(`New prices: ${added.slice(0, 5).join(', ')}`);
        if (removed.length) parts.push(`Removed: ${removed.slice(0, 5).join(', ')}`);
        changes.push({
          change_type: 'pricing',
          summary: parts.join('. '),
          old_value: (oldP.raw || []).join(', '),
          new_value: (newP.raw || []).join(', '),
        });
      }
    } catch { /* skip if JSON parse fails */ }
  }

  // New pages from sitemap
  if (prev.sitemap_pages && curr.sitemap_pages) {
    const oldPages = new Set(prev.sitemap_pages);
    const newPages = curr.sitemap_pages.filter(p => !oldPages.has(p));
    if (newPages.length > 0) {
      changes.push({
        change_type: 'new_pages',
        summary: `${newPages.length} new page(s): ${newPages.slice(0, 3).map(u => u.split('/').pop()).join(', ')}${newPages.length > 3 ? '...' : ''}`,
        old_value: String(prev.sitemap_pages.length),
        new_value: newPages.slice(0, 10).join('\n'),
      });
    }
  }

  // General content change (only if no other specific changes caught it)
  if (changes.length === 0 && prev.content_hash !== curr.content_hash && prev.content_hash) {
    changes.push({
      change_type: 'content',
      summary: 'Page content changed (no specific field identified)',
      old_value: prev.content_hash,
      new_value: curr.content_hash,
    });
  }

  return changes;
}

// ── Auth helper for manual triggers ──

async function verifyToken(token) {
  if (!token) return false;
  const res = await sbFetch(`/rest/v1/staff?session_token=eq.${encodeURIComponent(token)}&select=id`);
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

// ── Main handler ──

exports.handler = async (event) => {
  // Support manual trigger via HTTP with token auth
  const params = event.queryStringParameters || {};
  if (params.token) {
    const valid = await verifyToken(params.token);
    if (!valid) {
      return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
  }

  console.log('Competitor check starting...');

  // Get all active competitors
  const compRes = await sbFetch('/rest/v1/competitors?active=eq.true&select=id,name,url');
  const competitors = await compRes.json();

  if (!Array.isArray(competitors) || competitors.length === 0) {
    console.log('No active competitors to check.');
    return { statusCode: 200, body: 'No competitors' };
  }

  let totalChanges = 0;

  for (const comp of competitors) {
    try {
      console.log(`Checking ${comp.name}: ${comp.url}`);

      // Fetch homepage
      const pageRes = await fetch(comp.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; PrimalPantryBot/1.0)',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(15000),
        redirect: 'follow',
      });

      if (!pageRes.ok) {
        console.log(`  Failed to fetch ${comp.url}: ${pageRes.status}`);
        continue;
      }

      const html = await pageRes.text();
      const sitemapPages = await fetchSitemap(comp.url);

      // Build current snapshot
      const visibleText = extractVisibleText(html);
      const current = {
        title: extractTitle(html),
        meta_description: extractMetaDescription(html),
        hero_text: extractHeroText(html),
        price_snippets: extractPrices(html),
        product_count: extractProductCount(html, sitemapPages),
        sitemap_pages: sitemapPages,
        content_hash: contentHash(visibleText),
        raw_text: visibleText.slice(0, 5000),
      };

      // Get previous snapshot
      const prevRes = await sbFetch(
        `/rest/v1/competitor_snapshots?competitor_id=eq.${comp.id}&order=checked_at.desc&limit=1`
      );
      const prevSnaps = await prevRes.json();
      const prev = prevSnaps[0] || {};

      // Compare
      if (prev.id) {
        const changes = diffSnapshots(prev, current, comp.name);
        if (changes.length > 0) {
          console.log(`  ${changes.length} change(s) detected for ${comp.name}`);
          totalChanges += changes.length;

          // Insert change records
          for (const change of changes) {
            await sbFetch('/rest/v1/competitor_changes', {
              method: 'POST',
              body: {
                competitor_id: comp.id,
                change_type: change.change_type,
                summary: change.summary,
                old_value: change.old_value,
                new_value: change.new_value,
              },
            });
          }
        } else {
          console.log(`  No changes for ${comp.name}`);
        }
      } else {
        console.log(`  First snapshot for ${comp.name}`);
      }

      // Save new snapshot
      await sbFetch('/rest/v1/competitor_snapshots', {
        method: 'POST',
        body: {
          competitor_id: comp.id,
          title: current.title,
          meta_description: current.meta_description,
          hero_text: current.hero_text,
          price_snippets: current.price_snippets,
          product_count: current.product_count,
          sitemap_pages: current.sitemap_pages,
          content_hash: current.content_hash,
          raw_text: current.raw_text,
        },
      });

    } catch (err) {
      console.error(`  Error checking ${comp.name}:`, err.message);
    }
  }

  console.log(`Competitor check complete. ${totalChanges} total changes across ${competitors.length} competitors.`);
  return { statusCode: 200, body: `Checked ${competitors.length} competitors, ${totalChanges} changes` };
};
