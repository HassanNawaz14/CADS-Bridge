import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authAPI } from '../services/api';

const Register = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(0); // 0=env, 1=team, 2=profile, 3=done
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [env, setEnv] = useState(null);

  const [form, setForm] = useState({
    envCode: '', team: '', fullName: '', designation: '', email: '', password: '', confirm: ''
  });

  const update = (f, v) => setForm((p) => ({ ...p, [f]: v }));

  const checkEnv = async () => {
    if (!form.envCode.trim()) { setError('Environment code is required.'); return; }
    setLoading(true); setError('');
    try {
      const res = await authAPI.checkEnv(form.envCode);
      setEnv(res.data.environment);
      setStep(1);
    } catch (e) {
      setError(e.response?.data?.message || 'Invalid environment code.');
    } finally { setLoading(false); }
  };

  const submit = async () => {
    if (!form.fullName.trim() || !form.email.trim() || !form.password || !form.designation.trim()) {
      setError('All fields are required.'); return;
    }
    if (form.password !== form.confirm) { setError('Passwords do not match.'); return; }
    if (form.password.length < 8) { setError('Password must be at least 8 characters.'); return; }

    setLoading(true); setError('');
    try {
      await authAPI.register({ ...form });
      setStep(3);
    } catch (e) {
      setError(e.response?.data?.message || 'Registration failed.');
    } finally { setLoading(false); }
  };

  const logoSection = (
    <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: '1.2rem', letterSpacing: '-0.02em', marginBottom: '2.5rem' }}>
      <span style={{ color: 'var(--ca)' }}>CA</span>DS<span style={{ color: 'var(--ds)' }}>-Bridge</span>
    </div>
  );

  if (step === 3) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', background: 'var(--paper)' }}>
      <div style={{ maxWidth: 440, textAlign: 'center' }}>
        {logoSection}
        <div style={{ fontSize: '3.5rem', marginBottom: '1.25rem' }}>🎉</div>
        <h2 style={{ fontFamily: 'Syne', fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.6rem' }}>Request Submitted!</h2>
        <p style={{ color: 'var(--muted)', lineHeight: 1.7, fontSize: '0.9rem', marginBottom: '2rem' }}>
          Your access request for <strong>{env?.firm_name}</strong> has been sent to the administrator.
          You'll receive an in-app notification once it's reviewed.
        </p>
        <Link to="/login" className="btn btn-primary" style={{ display: 'inline-flex' }}>
          Back to Sign In
        </Link>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', background: 'var(--paper)' }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        {logoSection}

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '2rem' }}>
          {['Environment', 'Team', 'Profile'].map((s, i) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flex: 1 }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                background: i < step ? 'var(--success)' : i === step ? 'var(--ca)' : 'var(--border)',
                color: i <= step ? 'white' : 'var(--muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.72rem', fontWeight: 700,
              }}>
                {i < step ? '✓' : i + 1}
              </div>
              <span style={{ fontSize: '0.78rem', fontWeight: i === step ? 600 : 400, color: i === step ? 'var(--ink)' : 'var(--muted)' }}>{s}</span>
              {i < 2 && <div style={{ flex: 1, height: 2, background: i < step ? 'var(--success)' : 'var(--border)', borderRadius: 1 }} />}
            </div>
          ))}
        </div>

        <div className="card" style={{ borderRadius: 'var(--radius-lg)' }}>
          <div className="card-body" style={{ padding: '2rem' }}>
            {error && <div className="alert alert-error" style={{ marginBottom: '1.25rem' }}>⚠️ {error}</div>}

            {/* Step 0 - Environment Code */}
            {step === 0 && (
              <>
                <h2 style={{ fontFamily: 'Syne', fontSize: '1.3rem', fontWeight: 800, marginBottom: '0.4rem' }}>Enter Environment Code</h2>
                <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                  Your employer provides this code to join their CADS-Bridge environment.
                </p>
                <div className="form-group">
                  <label className="form-label">Environment Code</label>
                  <input className="form-input" placeholder="CADS-XXXXXXXXXXXX"
                    value={form.envCode}
                    onChange={(e) => update('envCode', e.target.value.toUpperCase())}
                    style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}
                    onKeyDown={(e) => e.key === 'Enter' && checkEnv()}
                  />
                </div>
                <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={checkEnv} disabled={loading}>
                  {loading ? <><span className="spinner" />Verifying...</> : 'Verify Code →'}
                </button>
              </>
            )}

            {/* Step 1 - Team Selection */}
            {step === 1 && env && (
              <>
                <h2 style={{ fontFamily: 'Syne', fontSize: '1.3rem', fontWeight: 800, marginBottom: '0.3rem' }}>Select Your Team</h2>
                <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                  Joining: <strong>{env.firm_name}</strong>
                </p>
                <p style={{ color: 'var(--muted)', fontSize: '0.8rem', marginBottom: '1.5rem' }}>
                  Your team determines your dashboard, permissions, and role.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                  {['CA', 'DS'].map((t) => (
                    <div
                      key={t}
                      onClick={() => update('team', t)}
                      style={{
                        padding: '1.5rem 1rem',
                        border: `2px solid ${form.team === t ? (t === 'CA' ? 'var(--ca)' : 'var(--ds)') : 'var(--border)'}`,
                        borderRadius: 'var(--radius-md)',
                        background: form.team === t ? (t === 'CA' ? 'var(--ca-light)' : 'var(--ds-light)') : 'white',
                        cursor: 'pointer',
                        textAlign: 'center',
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{t === 'CA' ? '📒' : '🔬'}</div>
                      <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: '0.95rem', color: t === 'CA' ? 'var(--ca)' : 'var(--ds)' }}>
                        {t === 'CA' ? 'Chartered Accountant' : 'Data Scientist'}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '0.3rem' }}>
                        {t === 'CA' ? 'Financial analytics & compliance' : 'Models & prediction pipelines'}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button className="btn btn-ghost" onClick={() => setStep(0)} style={{ flex: 1, justifyContent: 'center' }}>← Back</button>
                  <button
                    className={`btn btn-${form.team === 'DS' ? 'ds' : 'ca'}`}
                    disabled={!form.team}
                    onClick={() => setStep(2)}
                    style={{ flex: 2, justifyContent: 'center' }}
                  >
                    Continue →
                  </button>
                </div>
              </>
            )}

            {/* Step 2 - Profile */}
            {step === 2 && (
              <>
                <h2 style={{ fontFamily: 'Syne', fontSize: '1.3rem', fontWeight: 800, marginBottom: '0.25rem' }}>Your Profile</h2>
                <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                  Fill in your details to submit the access request.
                </p>
                <div className="form-group">
                  <label className="form-label">Full Name</label>
                  <input className="form-input" placeholder="Ahmad Raza" value={form.fullName} onChange={(e) => update('fullName', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Designation / Job Title</label>
                  <input className="form-input" placeholder="e.g. Senior Accountant" value={form.designation} onChange={(e) => update('designation', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Work Email</label>
                  <input type="email" className="form-input" placeholder="you@firm.com" value={form.email} onChange={(e) => update('email', e.target.value)} />
                </div>
                <div className="form-row">
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Password</label>
                    <input type="password" className="form-input" placeholder="••••••••" value={form.password} onChange={(e) => update('password', e.target.value)} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Confirm</label>
                    <input type="password" className="form-input" placeholder="••••••••" value={form.confirm} onChange={(e) => update('confirm', e.target.value)} />
                  </div>
                </div>
                <p style={{ fontSize: '0.73rem', color: 'var(--muted)', margin: '0.5rem 0 1.25rem' }}>
                  Minimum 8 characters, must include an uppercase letter and a number.
                </p>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button className="btn btn-ghost" onClick={() => setStep(1)} style={{ flex: 1, justifyContent: 'center' }}>← Back</button>
                  <button className={`btn btn-${form.team === 'DS' ? 'ds' : 'ca'}`} onClick={submit} disabled={loading} style={{ flex: 2, justifyContent: 'center' }}>
                    {loading ? <><span className="spinner" />Submitting...</> : 'Submit Request 🚀'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <p style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '0.85rem', color: 'var(--muted)' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--ca)', fontWeight: 600 }}>Sign in</Link>
        </p>
      </div>
    </div>
  );
};

export default Register;
