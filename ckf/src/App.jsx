import { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
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
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Errands = lazy(() => import('./pages/Errands.jsx'));
const Meals = lazy(() => import('./pages/Meals.jsx'));

function Gated({ children, hideNav }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <>
      {children}
      {!hideNav && <BottomNav />}
      <ReminderModal />
    </>
  );
}

const Fallback = () => <div className="loading">Loading…</div>;

function Shell() {
  // Once the app has paint, idle-prefetch the other route bundles + warm up
  // common API calls so tab switches feel instant.
  useEffect(() => {
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 250));
    const handle = idle(() => {
      // Code chunks
      import('./pages/Today.jsx').catch(() => {});
      import('./pages/Errands.jsx').catch(() => {});
      import('./pages/Settings.jsx').catch(() => {});
      import('./pages/Business.jsx').catch(() => {});
      import('./pages/Goals.jsx').catch(() => {});
      // Routine / errand data — warms the API + Netlify function instances
      import('./lib/api.js').then(({ call }) => {
        call('ckf-tasks', { action: 'today', date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date()) }).catch(() => {});
        call('ckf-errands', { action: 'list', status: 'open' }).catch(() => {});
      });
    });
    return () => {
      if (window.cancelIdleCallback && typeof handle === 'number') window.cancelIdleCallback(handle);
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
        <Route path="/errands" element={<Gated><Errands /></Gated>} />
        <Route path="/meals" element={<Gated><Meals /></Gated>} />
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
