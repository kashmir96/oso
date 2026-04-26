// Best-effort text extraction for Swipefile attachments.
// - URLs: fetch + crude HTML→text strip.
// - Images: Claude vision describes the contents.
// - PDFs: Claude documents extract a summary.

const Anthropic = require('@anthropic-ai/sdk');
const { logAnthropicUsage } = require('./ckf-usage.js');

const VISION_MODEL = 'claude-sonnet-4-20250514';

function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ── URL → text ──
async function extractFromUrl(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (CKF Swipefile)', Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Fetch ${url} failed: ${res.status}`);
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('text/html') && !ct.includes('text/plain')) {
    throw new Error(`Unsupported content-type for swipefile URL: ${ct}`);
  }
  let html = await res.text();
  // Pull title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : null;
  // Pull og description
  const descMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  const description = descMatch ? descMatch[1] : null;
  // Strip everything noisy. Naive but good enough.
  html = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  html = html.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  html = html.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  html = html.replace(/<header[\s\S]*?<\/header>/gi, ' ');
  html = html.replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
  html = html.replace(/<nav[\s\S]*?<\/nav>/gi, ' ');
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  // Cap at 30k chars; longer pieces still searchable but storage stays sane.
  return { title, description, text: text.slice(0, 30000) };
}

// ── Image → vision summary ──
async function describeImage({ imageBase64, mimeType, hint }) {
  const userText = `Describe this image succinctly so it can be referenced as a knowledge-base entry.
${hint ? `Context: ${hint}\n` : ''}Respond as plain prose, 2–6 sentences. If there's text in the image, transcribe the key parts.`;
  const res = await client().messages.create({
    model: VISION_MODEL,
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: imageBase64 } },
        { type: 'text', text: userText },
      ],
    }],
  });
  logAnthropicUsage({ action: 'swipefile_image', model: VISION_MODEL, usage: res.usage });
  return res.content?.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim() || '';
}

// ── PDF → summary + key points ──
async function summarisePdf({ pdfBase64, mimeType, hint }) {
  const userText = `Summarise this PDF so it can be referenced later as a knowledge-base entry.
${hint ? `Context: ${hint}\n` : ''}Return:
- 2–4 sentence summary
- 5–10 key points or quotes (bullet list)
Keep the whole reply under 1500 words.`;
  const res = await client().messages.create({
    model: VISION_MODEL,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: mimeType || 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: userText },
      ],
    }],
  });
  logAnthropicUsage({ action: 'swipefile_pdf', model: VISION_MODEL, usage: res.usage });
  return res.content?.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim() || '';
}

module.exports = { extractFromUrl, describeImage, summarisePdf };
