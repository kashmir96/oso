import { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth, AuthProvider } from './lib/auth.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import BottomNav from './components/BottomNav.jsx';
import ReminderModal from './components/ReminderModal.jsx';

// Heavy / less-frequently-touched pages are code-split. Login + Dashboard
// stay in the main bundle so opening the app paints immediately.
const Goals = lazy(() => import('./pages/Goals.jsx'));
const GoalDetail = lazy(() => import('./pages/GoalDetail.jsx'));
const Today = lazy(() => import('./pages/Today.jsx'));
const Chat = lazy(() => import('./pages/Chat.jsx'));
const Memory = lazy(() => import('./pages/Memory.jsx'));
const Weekly = lazy(() => import('./pages/Weekly.jsx'));
const NinetyDayGoals = lazy(() => import('./pages/NinetyDayGoals.jsx'));
const Business = lazy(() => import('./pages/Business.jsx'));
const BusinessTasks = lazy(() => import('./pages/BusinessTasks.jsx'));
const ProjectDetail = lazy(() => import('./pages/ProjectDetail.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Errands = lazy(() => import('./pages/Errands.jsx'));
const Meals = lazy(() => import('./pages/Meals.jsx'));
const Swipefile = lazy(() => import('./pages/Swipefile.jsx'));
const SearchPage = lazy(() => import('./pages/Search.jsx'));

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
      <ReminderModal />
    </>
  );
}

// Empty fallback — pages render instantly because most chunks are pre-warmed
// in the idle prefetch below. A blank flash is less jarring than "Loading…".
const Fallback = () => null;

function Shell() {
  // Once the app has paint, idle-prefetch every route bundle + warm common
  // API calls so tab switches feel instant. The cache layer in lib/api.js
  // means second visits to a page paint immediately from cached data.
  useEffect(() => {
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 250));
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date());
    const h1 = idle(() => {
      import('./pages/Today.jsx').catch(() => {});
      import('./pages/Errands.jsx').catch(() => {});
      import('./pages/Settings.jsx').catch(() => {});
      import('./pages/Business.jsx').catch(() => {});
      import('./pages/Goals.jsx').catch(() => {});
      import('./pages/Meals.jsx').catch(() => {});
      import('./lib/api.js').then(({ callCached }) => {
        callCached('ckf-tasks', { action: 'today', date: today }).catch(() => {});
        callCached('ckf-errands', { action: 'list', status: 'open' }).catch(() => {});
        callCached('ckf-goals', { action: 'list' }).catch(() => {});
        callCached('ckf-business', { action: 'list' }).catch(() => {});
      });
    });
    const h2 = idle(() => {
      import('./pages/GoalDetail.jsx').catch(() => {});
      import('./pages/NinetyDayGoals.jsx').catch(() => {});
      import('./pages/Weekly.jsx').catch(() => {});
      import('./pages/Memory.jsx').catch(() => {});
      import('./pages/BusinessTasks.jsx').catch(() => {});
      import('./pages/Swipefile.jsx').catch(() => {});
      import('./lib/api.js').then(({ callCached }) => {
        callCached('ckf-meals', { action: 'list', limit: 30 }).catch(() => {});
        callCached('ckf-swipefile', { action: 'list', archived: false }).catch(() => {});
      });
    });
    return () => {
      if (window.cancelIdleCallback) {
        if (typeof h1 === 'number') window.cancelIdleCallback(h1);
        if (typeof h2 === 'number') window.cancelIdleCallback(h2);
      }
    };
  }, []);

  return (
    <Suspense fallback={<Fallback />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Gated><Dashboard /></Gated>} />
        <Route path="/goals" element={<Gated><Goals /></Gated>} />
        <Route path="/goals/:id" element={<Gated><GoalDetail /></Gated>} />
        <Route path="/today" element={<Gated><Today /></Gated>} />
        <Route path="/chat" element={<Gated hideNav><Chat /></Gated>} />
        <Route path="/chat/memory" element={<Gated><Memory /></Gated>} />
        <Route path="/chat/:id" element={<Gated hideNav><Chat /></Gated>} />
        <Route path="/diary" element={<Navigate to="/chat" replace />} />
        <Route path="/diary/today" element={<Navigate to="/chat" replace />} />
        <Route path="/diary/:date" element={<Navigate to="/chat" replace />} />
        <Route path="/weekly" element={<Gated><Weekly /></Gated>} />
        <Route path="/ninety-day-goals" element={<Gated><NinetyDayGoals /></Gated>} />
        <Route path="/business" element={<Gated><Business /></Gated>} />
        <Route path="/business/tasks" element={<Gated><BusinessTasks /></Gated>} />
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
        <Route path="/errands" element={<Gated><Errands /></Gated>} />
        <Route path="/meals" element={<Gated><Meals /></Gated>} />
        <Route path="/swipefile" element={<Gated><Swipefile /></Gated>} />
        <Route path="/search" element={<Gated><SearchPage /></Gated>} />
        <Route path="/settings" element={<Gated><Settings /></Gated>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
