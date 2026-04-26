import { Routes, Route, Navigate } from 'react-router-dom';
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
import BusinessTasks from './pages/BusinessTasks.jsx';
import Errands from './pages/Errands.jsx';
import ReminderModal from './components/ReminderModal.jsx';
import Settings from './pages/Settings.jsx';
import BottomNav from './components/BottomNav.jsx';

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

function Shell() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* Home — goals widgets + embedded chat. Bottom nav visible. */}
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
      <Route path="/business/tasks" element={<Gated><BusinessTasks /></Gated>} />
      <Route path="/errands" element={<Gated><Errands /></Gated>} />
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
