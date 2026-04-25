import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth, AuthProvider } from './lib/auth.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Goals from './pages/Goals.jsx';
import GoalDetail from './pages/GoalDetail.jsx';
import Today from './pages/Today.jsx';
import Diary from './pages/Diary.jsx';
import Weekly from './pages/Weekly.jsx';
import NinetyDayGoals from './pages/NinetyDayGoals.jsx';
import Business from './pages/Business.jsx';
import Settings from './pages/Settings.jsx';
import BottomNav from './components/BottomNav.jsx';

function Gated({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <>
      {children}
      <BottomNav />
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
      <Route path="/diary/:date" element={<Gated><Diary /></Gated>} />
      <Route path="/weekly" element={<Gated><Weekly /></Gated>} />
      <Route path="/ninety-day-goals" element={<Gated><NinetyDayGoals /></Gated>} />
      <Route path="/business" element={<Gated><Business /></Gated>} />
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
