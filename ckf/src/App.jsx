import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth, AuthProvider } from './lib/auth.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Goals from './pages/Goals.jsx';
import GoalDetail from './pages/GoalDetail.jsx';
import Today from './pages/Today.jsx';
import Chat from './pages/Chat.jsx';
import Memory from './pages/Memory.jsx';
import Weekly from './pages/Weekly.jsx';
import NinetyDayGoals from './pages/NinetyDayGoals.jsx';
import Business from './pages/Business.jsx';
import ProjectDetail from './pages/ProjectDetail.jsx';
import Settings from './pages/Settings.jsx';
import BottomNav from './components/BottomNav.jsx';

// Lazy chunk — the marketing playbook (campaigns, ads, concepts, scripts, etc.)
// only loads when you actually open /business/marketing/*. Keeps the diary fast.
const Marketing = lazy(() => import('./pages/marketing/Marketing.jsx'));

// Routes that should render full-screen (no BottomNav). Anything matching these
// patterns hides the nav even when wrapped without an explicit hideNav prop —
// useful for nested routes inside lazy modules that can't pass props in.
const FULLSCREEN_PATTERNS = [
  /^\/business\/marketing\/chat(\/|$)/,
];

function Gated({ children, hideNav }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="loading">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  const fullscreen = hideNav || FULLSCREEN_PATTERNS.some((re) => re.test(location.pathname));
  return (
    <>
      {children}
      {!fullscreen && <BottomNav />}
    </>
  );
}

function Shell() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Gated><Dashboard /></Gated>} />
      <Route path="/goals" element={<Gated><Goals /></Gated>} />
      <Route path="/goals/:id" element={<Gated><GoalDetail /></Gated>} />
      <Route path="/today" element={<Gated><Today /></Gated>} />
      {/* Chat — full-screen, no bottom nav so the composer sits flush */}
      <Route path="/chat" element={<Gated hideNav><Chat /></Gated>} />
      <Route path="/chat/memory" element={<Gated><Memory /></Gated>} />
      <Route path="/chat/:id" element={<Gated hideNav><Chat /></Gated>} />
      {/* Backwards-compatible alias for the original SMS body and old links */}
      <Route path="/diary" element={<Navigate to="/chat" replace />} />
      <Route path="/diary/today" element={<Navigate to="/chat" replace />} />
      <Route path="/diary/:date" element={<Navigate to="/chat" replace />} />
      <Route path="/weekly" element={<Gated><Weekly /></Gated>} />
      <Route path="/ninety-day-goals" element={<Gated><NinetyDayGoals /></Gated>} />
      <Route path="/business" element={<Gated><Business /></Gated>} />
      <Route path="/business/projects/:id" element={<Gated><ProjectDetail /></Gated>} />
      <Route
        path="/business/marketing/*"
        element={
          <Gated>
            <Suspense fallback={<div className="app"><div className="loading">Loading marketing…</div></div>}>
              <Marketing />
            </Suspense>
          </Gated>
        }
      />
      <Route path="/settings" element={<Gated><Settings /></Gated>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
