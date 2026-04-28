import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../../components/Header.jsx';
import { call } from '../../lib/api.js';
import MarketingNav from './MarketingNav.jsx';

const ACCEPTED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const SLOTS = [
  { key: 'front',         label: 'Front photo' },
  { key: 'back',          label: 'Back photo' },
  { key: 'side1',         label: 'Side 1 photo' },
  { key: 'side2',         label: 'Side 2 photo' },
  { key: 'texture_pack',  label: 'Texture in package' },
  { key: 'texture_skin',  label: 'Texture on skin' },
  { key: 'label',         label: 'Full label scan' },
];

export default function ProductDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [product, setProduct] = useState(null);
  const [signedUrls, setSignedUrls] = useState({});
  const [err, setErr] = useState('');
  const [busySlot, setBusySlot] = useState(null);

  async function load() {
    setErr('');
    try {
      const r = await call('mktg-products', { action: 'get', id });
      setProduct(r.product);
      setSignedUrls(r.signed_urls || {});
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, [id]);

  async function uploadSlot(slot, file) {
    if (!ACCEPTED_IMAGE_MIME.includes(file.type)) {
      setErr(`Unsupported image type: ${file.type || 'unknown'}`);
      return;
    }
    setBusySlot(slot); setErr('');
    try {
      const data_base64 = await fileToBase64(file);
      const r = await call('mktg-products', {
        action: 'upload_seed',
        product_id: id,
        slot,
        data_base64,
        mime_type: file.type,
      });
      setProduct(r.product);
      if (r.signed_url) setSignedUrls((u) => ({ ...u, [slot]: r.signed_url }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusySlot(null);
    }
  }

  async function deleteSlot(slot) {
    if (!confirm(`Remove the ${slot} image?`)) return;
    setBusySlot(slot); setErr('');
    try {
      const r = await call('mktg-products', { action: 'delete_seed', product_id: id, slot });
      setProduct(r.product);
      setSignedUrls((u) => { const next = { ...u }; delete next[slot]; return next; });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusySlot(null);
    }
  }

  async function deleteProduct() {
    if (!confirm(`Delete product "${product?.name}"? This also deletes all seed images.`)) return;
    try {
      await call('mktg-products', { action: 'delete', id });
      nav('/business/marketing/products', { replace: true });
    } catch (e) { setErr(e.message); }
  }

  if (err && !product) return (
    <div className="app">
      <Header title="Product" back />
      <MarketingNav />
      <div className="error">{err}</div>
    </div>
  );

  if (!product) return (
    <div className="app">
      <Header title="Product" back />
      <MarketingNav />
      <div className="loading">Loading…</div>
    </div>
  );

  return (
    <div className="app">
      <Header
        title={product.name}
        right={<button className="danger" onClick={deleteProduct} style={{ fontSize: 12, padding: '6px 10px' }}>Delete</button>}
        back
      />
      <MarketingNav />

      {err && <div className="error">{err}</div>}

      <div className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
        ID: <code>{product.id}</code>
        {product.tagline && <> · {product.tagline}</>}
      </div>

      <div className="section-title"><span>Seed images</span></div>
      <p className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
        These photos feed every future generator (Gemini / OpenAI / Claude). Upload one image per slot.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 12,
        }}
      >
        {SLOTS.map((s) => (
          <SlotCard
            key={s.key}
            slot={s.key}
            label={s.label}
            info={product.seed_images?.[s.key]}
            previewUrl={signedUrls[s.key]}
            busy={busySlot === s.key}
            onUpload={(file) => uploadSlot(s.key, file)}
            onDelete={() => deleteSlot(s.key)}
          />
        ))}
      </div>
    </div>
  );
}

function SlotCard({ slot, label, info, previewUrl, busy, onUpload, onDelete }) {
  const inputId = `slot-input-${slot}`;
  const filled = !!info?.path;
  return (
    <div
      className="card"
      style={{
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        opacity: busy ? 0.6 : 1,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600 }}>{label}</div>
      <label
        htmlFor={inputId}
        style={{
          aspectRatio: '1 / 1',
          background: 'var(--surface, #f4f3f0)',
          border: '1px dashed var(--border, #d8d4cc)',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          cursor: busy ? 'wait' : 'pointer',
          fontSize: 12,
          color: 'var(--muted, #888)',
        }}
      >
        {filled && previewUrl ? (
          <img
            src={previewUrl}
            alt={label}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : filled ? (
          <span>uploaded · refresh to view</span>
        ) : busy ? (
          <span>Uploading…</span>
        ) : (
          <span>+ upload</span>
        )}
      </label>
      <input
        id={inputId}
        type="file"
        accept={ACCEPTED_IMAGE_MIME.join(',')}
        style={{ display: 'none' }}
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onUpload(file);
        }}
      />
      {filled && (
        <button
          onClick={onDelete}
          disabled={busy}
          style={{ fontSize: 11, padding: '4px 8px' }}
        >
          Remove
        </button>
      )}
    </div>
  );
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Read failed'));
    reader.readAsDataURL(file);
  });
}
