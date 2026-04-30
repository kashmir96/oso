import { AuthProvider, useAuth } from '@ckf-lib/auth.jsx';
import Chat from './Chat.jsx';

export default function App() {
  return (
    <AuthProvider>
      <Gate>
        <Chat />
      </Gate>
    </AuthProvider>
  );
}

function Gate({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="ag-loading">Loading…</div>;
  if (!user) {
    if (typeof window !== 'undefined') window.location.replace('/ckf/login');
    return null;
  }
  return children;
}
