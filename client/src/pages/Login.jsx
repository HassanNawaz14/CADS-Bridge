import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { authAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';

const Login = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/dashboard';

  const [form, setForm] = useState({ envCode: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await authAPI.login(form);
      login(res.data.user, res.data.accessToken);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.response?.data?.message
        || (err.request ? 'Unable to reach the backend server. Please ensure it is running.' : 'Login failed. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Left panel */}
      <div style={{
        width: 420,
        flexShrink: 0,
        background: 'var(--ink)',
        color: 'var(--paper)',
        padding: '3rem',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: '1.25rem', letterSpacing: '-0.02em', marginBottom: '3rem' }}>
            <span style={{ color: 'var(--ca)' }}>CA</span>
            <span style={{ opacity: 0.6 }}>DS</span>
            <span style={{ color: 'var(--ds)' }}>-Bridge</span>
          </div>
          <h1 style={{ fontFamily: 'Syne', fontSize: '2.2rem', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.2, marginBottom: '1rem' }}>
            Where Finance<br />Meets Intelligence
          </h1>
          <p style={{ color: 'rgba(245,243,238,0.5)', fontSize: '0.9rem', lineHeight: 1.7 }}>
            The unified collaboration platform bridging Chartered Accountants and Data Scientists in enterprise environments.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {[
            { icon: '🔒', text: 'Role-based isolated environments' },
            { icon: '📊', text: 'KPI Command Centre & audit trails' },
            { icon: '🤝', text: 'Cross-functional project workspaces' },
          ].map((item) => (
            <div key={item.text} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.85rem', color: 'rgba(245,243,238,0.5)' }}>
              <span>{item.icon}</span>
              <span>{item.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div style={{ width: '100%', maxWidth: 420 }}>
          <div style={{ marginBottom: '2.5rem' }}>
            <h2 style={{ fontFamily: 'Syne', fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '0.4rem' }}>
              Sign in
            </h2>
            <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
              Enter your environment code and credentials to continue.
            </p>
          </div>

          {error && <div className="alert alert-error" style={{ marginBottom: '1.25rem' }}>⚠️ {error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Environment Code</label>
              <input
                className="form-input"
                placeholder="CADS-XXXXXXXXXXXX"
                value={form.envCode}
                onChange={(e) => setForm({ ...form, envCode: e.target.value.toUpperCase() })}
                required
                autoComplete="off"
                style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input
                className="form-input"
                type="email"
                placeholder="you@firm.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                className="form-input"
                type="password"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '0.8rem', marginTop: '0.5rem' }} disabled={loading}>
              {loading ? <><span className="spinner" /> Signing in...</> : 'Sign In →'}
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.85rem', color: 'var(--muted)' }}>
            New employee?{' '}
            <Link to="/register" style={{ color: 'var(--ca)', fontWeight: 600 }}>
              Request access
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
