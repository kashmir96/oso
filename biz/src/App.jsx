import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from '@ckf-lib/auth.jsx';
import Sidebar from './components/Sidebar.jsx';
import AgentChat from './components/AgentChat.jsx';
import { AGENTS, findAgent, GROUPS, agentsInGroup } from './agents/_registry.js';

export default function App() {
  return (
    <AuthProvider>
      <Gate>
        <div className="biz-app">
          <Sidebar />
          <main className="biz-main">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/:slug" element={<AgentRoute />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </Gate>
    </AuthProvider>
  );
}

function Gate({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="biz-loading">Loading…</div>;
  if (!user) {
    // Bounce to /ckf login (we share auth + token).
    if (typeof window !== 'undefined') window.location.replace('/ckf/login');
    return null;
  }
  return children;
}

function Home() {
  return (
    <div className="biz-home">
      <h1>Pick an agent</h1>
      {GROUPS.map((g) => (
        <div key={g.id} className="biz-home-group">
          <h2>{g.label}</h2>
          <div className="biz-home-grid">
            {agentsInGroup(g.id).map((a) => (
              <a key={a.slug} href={`/biz/${a.slug}`} className="biz-home-card">
                <div className="biz-home-card-icon">{a.icon}</div>
                <div className="biz-home-card-name">{a.name}</div>
                <div className="biz-home-card-blurb">{a.blurb}</div>
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentRoute() {
  const { slug } = useParams();
  const agent = findAgent(slug);
  if (!agent) return <Navigate to="/" replace />;
  // Specialised pages can ship later — most agents use the shared chat shell.
  // The kanban is the only one with a non-chat surface in v1; route it
  // through a different component below when built.
  if (agent.slug === 'kanban') return <KanbanPlaceholder />;
  return <AgentChat agent={agent} />;
}

function KanbanPlaceholder() {
  return (
    <div className="biz-empty" style={{ padding: 24 }}>
      <h2>Production Kanban</h2>
      <p>Coming soon — your assistant's board for shipping creatives. Until
      then, see <a href="/ckf/business/marketing/assistant">/ckf/business/marketing/assistant</a>.</p>
    </div>
  );
}
