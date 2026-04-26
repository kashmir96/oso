/**
 * ckf-swipefile.js — gated CRUD for the Swipefile knowledge base.
 *
 * Actions:
 *   list         — { archived?: bool, category?: string, limit?: number }
 *   get          — { id }
 *   create_note  — { title, source_text, why_it_matters, tags, importance, category }
 *   create_link  — { url, title?, why_it_matters?, tags, importance, category }
 *                  fetches + extracts text server-side
 *   create_image — { image_base64, mime_type, title?, why_it_matters, tags, ... }
 *                  uploads to Storage + describes via Claude vision
 *   create_pdf   — { pdf_base64, title?, why_it_matters, tags, ... }
 *                  uploads + Claude document summary
 *   update       — { id, ...patch }
 *   archive      — { id }
 *   delete       — { id }
 *   search       — { q, limit? }   simple ILIKE across title/source_text/tags
 */
const crypto = require('crypto');
const { sbSelect, sbInsert, sbUpdate, sbDelete } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');
const { uploadObject, deleteObject } = require('./_lib/ckf-storage.js');
const { extractFromUrl, describeImage, summarisePdf } = require('./_lib/ckf-swipefile-process.js');

const BUCKET = 'ckf-swipefile';

function rand(bytes = 8) { return crypto.randomBytes(bytes).toString('hex'); }

async function uploadFile({ userId, base64, mimeType, ext }) {
  const buf = Buffer.from(base64, 'base64');
  if (buf.length === 0) throw new Error('Empty file');
  const path = `${userId}/${rand()}-${Date.now()}.${ext}`;
  const out = await uploadObject({ bucket: BUCKET, path, buffer: buf, contentType: mimeType || 'application/octet-stream' });
  return out;
}

exports.handler = withGate(async (event, { user }) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  if (action === 'list') {
    const { archived, category } = body;
    const limit = Math.min(Number(body.limit) || 100, 500);
    let filter = `user_id=eq.${user.id}`;
    if (archived !== undefined) filter += `&archived=eq.${archived ? 'true' : 'false'}`;
    if (category) filter += `&category=eq.${encodeURIComponent(category)}`;
    const rows = await sbSelect(
      'ckf_swipefile_items',
      `${filter}&order=importance.desc,created_at.desc&limit=${limit}&select=*`
    );
    return reply(200, { items: rows });
  }

  if (action === 'get') {
    if (!body.id) return reply(400, { error: 'id required' });
    const row = (await sbSelect('ckf_swipefile_items', `id=eq.${body.id}&user_id=eq.${user.id}&select=*&limit=1`))?.[0];
    if (!row) return reply(404, { error: 'not found' });
    return reply(200, { item: row });
  }

  if (action === 'create_note') {
    const { title, source_text, why_it_matters, tags, importance, category, author } = body;
    const row = await sbInsert('ckf_swipefile_items', {
      user_id: user.id, kind: 'note',
      title: title || null, source_text: source_text || null,
      why_it_matters: why_it_matters || null,
      tags: tags || [], importance: importance ?? 3,
      category: category || 'personal', author: author || null,
    });
    return reply(200, { item: row });
  }

  if (action === 'create_link') {
    const { url, title, why_it_matters, tags, importance, category, author } = body;
    if (!url) return reply(400, { error: 'url required' });
    let extracted;
    try { extracted = await extractFromUrl(url); } catch (e) { extracted = { title: null, description: null, text: null }; }
    const row = await sbInsert('ckf_swipefile_items', {
      user_id: user.id, kind: 'link',
      title: title || extracted.title || url,
      source_url: url,
      source_text: extracted.text || extracted.description || null,
      why_it_matters: why_it_matters || null,
      tags: tags || [], importance: importance ?? 3,
      category: category || 'personal', author: author || null,
    });
    return reply(200, { item: row, extraction_failed: !extracted.text });
  }

  if (action === 'create_image') {
    const { image_base64, mime_type, title, why_it_matters, tags, importance, category, author } = body;
    if (!image_base64) return reply(400, { error: 'image_base64 required' });
    const ext = (mime_type || '').includes('png') ? 'png' : 'jpg';
    const { path, public_url } = await uploadFile({ userId: user.id, base64: image_base64, mimeType: mime_type, ext });
    let summary = '';
    try { summary = await describeImage({ imageBase64: image_base64, mimeType: mime_type, hint: title }); } catch (e) { console.error('[swipefile] image describe failed:', e.message); }
    const row = await sbInsert('ckf_swipefile_items', {
      user_id: user.id, kind: 'image',
      title: title || null,
      storage_path: path, storage_url: public_url,
      source_text: summary || null,
      why_it_matters: why_it_matters || null,
      tags: tags || [], importance: importance ?? 3,
      category: category || 'personal', author: author || null,
    });
    return reply(200, { item: row });
  }

  if (action === 'create_pdf') {
    const { pdf_base64, title, why_it_matters, tags, importance, category, author } = body;
    if (!pdf_base64) return reply(400, { error: 'pdf_base64 required' });
    const { path, public_url } = await uploadFile({ userId: user.id, base64: pdf_base64, mimeType: 'application/pdf', ext: 'pdf' });
    let summary = '';
    try { summary = await summarisePdf({ pdfBase64: pdf_base64, mimeType: 'application/pdf', hint: title }); } catch (e) { console.error('[swipefile] pdf summary failed:', e.message); }
    const row = await sbInsert('ckf_swipefile_items', {
      user_id: user.id, kind: 'document',
      title: title || null,
      storage_path: path, storage_url: public_url,
      source_text: summary || null,
      why_it_matters: why_it_matters || null,
      tags: tags || [], importance: importance ?? 3,
      category: category || 'personal', author: author || null,
    });
    return reply(200, { item: row });
  }

  if (action === 'update') {
    const { id, ...patch } = body;
    if (!id) return reply(400, { error: 'id required' });
    delete patch.action;
    const allowed = ['title','source_text','source_url','why_it_matters','tags','importance','category','author','archived'];
    const clean = {};
    for (const k of allowed) if (patch[k] !== undefined) clean[k] = patch[k];
    const rows = await sbUpdate('ckf_swipefile_items', `id=eq.${id}&user_id=eq.${user.id}`, clean);
    return reply(200, { item: rows?.[0] });
  }

  if (action === 'archive') {
    if (!body.id) return reply(400, { error: 'id required' });
    const rows = await sbUpdate('ckf_swipefile_items', `id=eq.${body.id}&user_id=eq.${user.id}`, { archived: true });
    return reply(200, { item: rows?.[0] });
  }

  if (action === 'delete') {
    if (!body.id) return reply(400, { error: 'id required' });
    const row = (await sbSelect('ckf_swipefile_items', `id=eq.${body.id}&user_id=eq.${user.id}&select=storage_path&limit=1`))?.[0];
    if (row?.storage_path) {
      try { await deleteObject({ bucket: BUCKET, path: row.storage_path }); } catch {}
    }
    await sbDelete('ckf_swipefile_items', `id=eq.${body.id}&user_id=eq.${user.id}`);
    return reply(200, { success: true });
  }

  if (action === 'search') {
    const q = (body.q || '').trim();
    const limit = Math.min(Number(body.limit) || 12, 50);
    if (!q) return reply(200, { items: [] });
    const safe = encodeURIComponent(`*${q.replace(/[%*]/g, '')}*`);
    // PostgREST ilike-any over multiple cols
    const rows = await sbSelect(
      'ckf_swipefile_items',
      `user_id=eq.${user.id}&archived=eq.false&or=(title.ilike.${safe},source_text.ilike.${safe},why_it_matters.ilike.${safe})&order=importance.desc,created_at.desc&limit=${limit}&select=id,kind,title,source_url,source_text,why_it_matters,category,tags,importance,author,created_at`
    );
    // Trim source_text on the way out so the response stays small.
    return reply(200, {
      items: (rows || []).map((r) => ({ ...r, source_text: r.source_text ? r.source_text.slice(0, 600) : null })),
    });
  }

  return reply(400, { error: 'Unknown action' });
});
