import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../../components/Header.jsx';
import { call } from '../../lib/api.js';
import MarketingNav from './MarketingNav.jsx';

const SLOT_COUNT = 7;

export default function Products() {
  const [products, setProducts] = useState(null);
  const [err, setErr] = useState('');
  const [showNew, setShowNew] = useState(false);

  async function load() {
    setErr('');
    try {
      const r = await call('mktg-products', { action: 'list' });
      setProducts(r.products);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function createProduct({ id, name }) {
    if (!id || !name) return;
    try {
      await call('mktg-products', { action: 'create', id, name });
      setShowNew(false);
      load();
    } catch (e) { setErr(e.message); }
  }

  return (
    <div className="app">
      <Header
        title="Products"
        right={<button className="primary" onClick={() => setShowNew(true)}>+ New product</button>}
        back
      />
      <MarketingNav />

      {err && <div className="error">{err}</div>}
      {showNew && <NewProductForm onCreate={createProduct} onCancel={() => setShowNew(false)} />}
      {!products && !err && <div className="loading">Loading…</div>}
      {products && products.length === 0 && (
        <div className="empty">No products yet. Hit "+ New product" to add one.</div>
      )}

      <div className="row-list">
        {products && products.map((p) => {
          const filled = countFilled(p.seed_images);
          return (
            <Link key={p.id} to={`/business/marketing/products/${encodeURIComponent(p.id)}`} className="row-item">
              <div className="name">
                {p.name}
                <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{p.id}</span>
              </div>
              <div className="meta">
                <span><strong>{filled}/{SLOT_COUNT}</strong> seed images</span>
                {p.status && p.status !== 'active' && <span className="dim">{p.status}</span>}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function NewProductForm({ onCreate, onCancel }) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  return (
    <div className="card" style={{ marginBottom: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input
        placeholder="ID (slug, e.g. tallow-balm)"
        value={id}
        onChange={(e) => setId(e.target.value.trim().toLowerCase().replace(/\s+/g, '-'))}
        style={{ padding: 8 }}
      />
      <input
        placeholder="Name (e.g. Tallow Balm)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{ padding: 8 }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="primary" onClick={() => onCreate({ id, name })} disabled={!id || !name}>Create</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function countFilled(seedImages) {
  if (!seedImages || typeof seedImages !== 'object') return 0;
  return Object.keys(seedImages).filter((k) => seedImages[k]?.path).length;
}
