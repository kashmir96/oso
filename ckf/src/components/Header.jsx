import { useNavigate } from 'react-router-dom';

export default function Header({ title, back, right }) {
  const nav = useNavigate();
  return (
    <header className="app-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {back && (
          <button onClick={() => nav(-1)} style={{ padding: '6px 10px', fontSize: 13 }}>←</button>
        )}
        <h1 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h1>
      </div>
      <div>{right}</div>
    </header>
  );
}
