import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('cfairweather1996@gmail.com');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      await login(email.trim(), password);
      nav('/', { replace: true });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <h1>CKF</h1>
        <div className="sub">Second Brain — private</div>
        <div className="field">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            minLength={8}
          />
        </div>
        {err && <div className="error">{err}</div>}
        <button type="submit" className="primary" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Signing in…' : 'Enter'}
        </button>
        <div className="sub" style={{ marginTop: 14, fontSize: 11 }}>
          First sign-in seeds your account. Min 8 characters.
        </div>
      </form>
    </div>
  );
}
