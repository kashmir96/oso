// Supabase Storage upload helper. Uses the service role key so it can write
// to any bucket regardless of RLS. Returns a public URL into the bucket.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function ensureEnv() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
}

// Upload a Buffer to Storage. Returns { path, public_url }.
async function uploadObject({ bucket, path, buffer, contentType }) {
  ensureEnv();
  const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': contentType || 'application/octet-stream',
      'x-upsert': 'true',
      'cache-control': '3600',
    },
    body: buffer,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Storage upload ${res.status}: ${text.slice(0, 300)}`);
  }
  return {
    path,
    public_url: `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`,
  };
}

async function deleteObject({ bucket, path }) {
  ensureEnv();
  const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Storage delete ${res.status}: ${text.slice(0, 200)}`);
  }
}

module.exports = { uploadObject, deleteObject };
