// Image / file upload helpers — keep things small enough for inline transport.
//
// Anthropic accepts image and document content blocks inline as base64 within
// a single user message. We resize images to max 1280px before encoding and
// gate file size at 4MB to bound payload + database row weight.

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_DIM = 1280;
const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_DOC_MIMES = ['application/pdf'];

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const idx = r.result.indexOf(',');
      resolve(idx >= 0 ? r.result.slice(idx + 1) : r.result);
    };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function resizeImage(file) {
  // Skip resizing tiny images.
  if (file.size < 250 * 1024) return file;
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = URL.createObjectURL(file);
  });
  const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.width, img.height));
  if (scale === 1) { URL.revokeObjectURL(img.src); return file; }
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(img.src);
  // Always re-encode to JPEG for predictable size.
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
}

// Returns { kind: 'image' | 'document', media_type, data_base64, filename, preview_url }
// Throws on unsupported / oversized files.
export async function processFile(file) {
  if (!file) throw new Error('No file');

  if (ALLOWED_IMAGE_MIMES.includes(file.type) || file.type.startsWith('image/')) {
    const sized = await resizeImage(file);
    if (sized.size > MAX_BYTES) throw new Error(`Image too large (${(sized.size / 1024 / 1024).toFixed(1)} MB).`);
    const data_base64 = await blobToBase64(sized);
    return {
      kind: 'image',
      media_type: sized.type || 'image/jpeg',
      data_base64,
      filename: sized.name,
      preview_url: URL.createObjectURL(sized),
    };
  }

  if (ALLOWED_DOC_MIMES.includes(file.type)) {
    if (file.size > MAX_BYTES) throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB).`);
    const data_base64 = await blobToBase64(file);
    return {
      kind: 'document',
      media_type: file.type,
      data_base64,
      filename: file.name,
      preview_url: null,
    };
  }

  // Anything else — refuse politely. Video/audio uploads belong in their own
  // pipeline (transcribe via Whisper) which is a future round.
  throw new Error(`Unsupported file type: ${file.type || 'unknown'}. Images and PDFs only for now.`);
}

export function revokePreview(att) {
  if (att?.preview_url) {
    try { URL.revokeObjectURL(att.preview_url); } catch {}
  }
}
