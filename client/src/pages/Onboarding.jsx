import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { onboardingAPI } from '../services/api';

/* ─────────────────────────────────────────────────────────────
   CADS-Bridge Onboarding Wizard — 4 Steps:
   1. Firm Details      → firm name, industry
   2. Admin Accounts    → CA Admin + DS Admin credentials
   3. Invite Members    → optional initial team members
   4. Launch            → success screen with env code
───────────────────────────────────────────────────────────── */

const INDUSTRIES = [
  'Banking & Finance', 'Insurance', 'Manufacturing',
  'Retail & E-Commerce', 'Consulting', 'Healthcare',
  'Technology', 'Real Estate', 'Energy & Utilities', 'Other',
];

const STEPS = [
  { num: 1, label: 'Firm Details',   icon: '🏢' },
  { num: 2, label: 'Admin Accounts', icon: '👑' },
  { num: 3, label: 'Invite Team',    icon: '👥' },
  { num: 4, label: 'Launch',         icon: '🚀' },
];

/* ── reusable field component ── */
const Field = ({ label, error, children, hint }) => (
  <div className="form-group" style={{ marginBottom: '1.1rem' }}>
    <label className="form-label">{label}</label>
    {children}
    {hint  && !error && <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '0.3rem' }}>{hint}</div>}
    {error && <div className="form-error">{error}</div>}
  </div>
);

/* ── password strength indicator ── */
const PasswordStrength = ({ password }) => {
  if (!password) return null;
  const checks = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ];
  const score = checks.filter(Boolean).length;
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  const colors = ['', 'var(--danger)', 'var(--warning)', 'var(--ca)', 'var(--success)'];
  return (
    <div style={{ marginTop: '0.4rem' }}>
      <div style={{ display: 'flex', gap: '3px', marginBottom: '0.25rem' }}>
        {[1,2,3,4].map((i) => (
          <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= score ? colors[score] : 'var(--border)', transition: 'background 0.2s' }} />
        ))}
      </div>
      <span style={{ fontSize: '0.68rem', color: colors[score], fontWeight: 600 }}>{labels[score]}</span>
    </div>
  );
};

/* ── Admin form block (used for both CA and DS) ── */
const AdminBlock = ({ team, form, onChange, errors }) => {
  const [showPass, setShowPass] = useState(false);
  const isCA = team === 'CA';
  const color = isCA ? 'var(--ca)' : 'var(--ds)';
  const prefix = isCA ? 'ca' : 'ds';

  return (
    <div style={{
      border: `2px solid ${color}30`,
      borderTop: `4px solid ${color}`,
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
    }}>
      {/* Card header */}
      <div style={{ padding: '1.1rem 1.4rem', background: `${color}08`, borderBottom: `1px solid ${color}20`, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{ width: 38, height: 38, borderRadius: '50%', background: color, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Syne', fontWeight: 800, fontSize: '0.85rem' }}>
          {team}
        </div>
        <div>
          <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: '0.95rem' }}>
            {isCA ? 'CA Administrator' : 'DS Administrator'}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
            {isCA ? 'Chartered Accountant Lead' : 'Data Science Lead'}
          </div>
        </div>
        <span style={{ marginLeft: 'auto', background: `${color}15`, color, padding: '0.2rem 0.65rem', borderRadius: '1rem', fontSize: '0.7rem', fontWeight: 700 }}>
          Team Admin
        </span>
      </div>

      {/* Fields */}
      <div style={{ padding: '1.25rem 1.4rem' }}>
        <Field label="Full Name *" error={errors[`${prefix}Name`]}>
          <input className={`form-input ${errors[`${prefix}Name`] ? 'error' : ''}`}
            placeholder={isCA ? 'e.g. Ahmad Raza' : 'e.g. Sara Khan'}
            value={form[`${prefix}Name`]} onChange={(e) => onChange(`${prefix}Name`, e.target.value)} />
        </Field>

        <Field label="Designation / Job Title *" error={errors[`${prefix}Designation`]}>
          <input className={`form-input ${errors[`${prefix}Designation`] ? 'error' : ''}`}
            placeholder={isCA ? 'e.g. Chief Accountant' : 'e.g. Lead Data Scientist'}
            value={form[`${prefix}Designation`]} onChange={(e) => onChange(`${prefix}Designation`, e.target.value)} />
        </Field>

        <Field label="Work Email *" error={errors[`${prefix}Email`]}>
          <input type="email" className={`form-input ${errors[`${prefix}Email`] ? 'error' : ''}`}
            placeholder={isCA ? 'ca.admin@firm.com' : 'ds.admin@firm.com'}
            value={form[`${prefix}Email`]} onChange={(e) => onChange(`${prefix}Email`, e.target.value)} />
        </Field>

        <div className="form-row" style={{ alignItems: 'flex-start' }}>
          <Field label="Password *" error={errors[`${prefix}Password`]}>
            <div style={{ position: 'relative' }}>
              <input type={showPass ? 'text' : 'password'}
                className={`form-input ${errors[`${prefix}Password`] ? 'error' : ''}`}
                style={{ paddingRight: '3rem' }}
                placeholder="Min. 8 chars"
                value={form[`${prefix}Password`]} onChange={(e) => onChange(`${prefix}Password`, e.target.value)} />
              <button type="button" onClick={() => setShowPass((p) => !p)}
                style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--muted)' }}>
                {showPass ? 'Hide' : 'Show'}
              </button>
            </div>
            <PasswordStrength password={form[`${prefix}Password`]} />
          </Field>
          <Field label="Confirm *" error={errors[`${prefix}Confirm`]}>
            <input type="password" className={`form-input ${errors[`${prefix}Confirm`] ? 'error' : ''}`}
              placeholder="Re-enter password"
              value={form[`${prefix}Confirm`]} onChange={(e) => onChange(`${prefix}Confirm`, e.target.value)} />
          </Field>
        </div>

        {/* Permissions list */}
        <div style={{ marginTop: '0.75rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Permissions</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {[
              `Manage ${team} team members & access levels`,
              `Configure ${team}-side workspace settings`,
              isCA ? 'Review & approve financial artifacts' : 'Review & approve model artifacts',
              `Access ${team} admin dashboard`,
            ].map((p) => (
              <div key={p} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', color: 'var(--muted)' }}>
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: `${color}15`, color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', flexShrink: 0 }}>✓</div>
                {p}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════ */
const Onboarding = () => {
  const navigate = useNavigate();
  const [step, setStep]       = useState(1);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState('');

  // Provisioned result (set after step 2 API call)
  const [result, setResult] = useState(null); // { envCode, firmName, admins }

  // Step 1 fields
  const [firm, setFirm] = useState({ name: '', industry: '' });

  // Step 2 fields
  const [admins, setAdmins] = useState({
    caName: '', caDesignation: '', caEmail: '', caPassword: '', caConfirm: '',
    dsName: '', dsDesignation: '', dsEmail: '', dsPassword: '', dsConfirm: '',
  });

  // Step 3 fields — dynamic member rows
  const [members, setMembers] = useState([
    { fullName: '', email: '', team: 'CA', designation: '' },
    { fullName: '', email: '', team: 'DS', designation: '' },
  ]);
  const [inviteResult, setInviteResult] = useState(null);

  // Validation errors
  const [errors, setErrors] = useState({});

  const updateAdmin = (field, val) => setAdmins((p) => ({ ...p, [field]: val }));

  /* ── validators ── */
  const validateStep1 = () => {
    const e = {};
    if (!firm.name.trim())     e.firmName = 'Firm name is required.';
    if (!firm.industry.trim()) e.industry = 'Please select an industry.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateStep2 = () => {
    const e = {};
    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const passRx  = /^(?=.*[A-Z])(?=.*[0-9]).{8,}$/;

    ['ca', 'ds'].forEach((p) => {
      if (!admins[`${p}Name`].trim())        e[`${p}Name`]        = 'Name is required.';
      if (!admins[`${p}Designation`].trim()) e[`${p}Designation`] = 'Designation is required.';
      if (!emailRx.test(admins[`${p}Email`]))e[`${p}Email`]       = 'Valid email is required.';
      if (!passRx.test(admins[`${p}Password`])) e[`${p}Password`] = 'Min 8 chars, 1 uppercase, 1 number.';
      if (admins[`${p}Password`] !== admins[`${p}Confirm`]) e[`${p}Confirm`] = 'Passwords do not match.';
    });

    if (admins.caEmail && admins.dsEmail && admins.caEmail === admins.dsEmail) {
      e.dsEmail = 'CA and DS Admin emails must be different.';
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  /* ── step navigation ── */
  const goNext = async () => {
    setApiError('');

    if (step === 1) {
      if (!validateStep1()) return;
      setStep(2);
      return;
    }

    if (step === 2) {
      if (!validateStep2()) return;
      setLoading(true);
      try {
        const res = await onboardingAPI.provision({
          firmName: firm.name,
          industry: firm.industry,
          caAdmin: { fullName: admins.caName, designation: admins.caDesignation, email: admins.caEmail, password: admins.caPassword },
          dsAdmin: { fullName: admins.dsName, designation: admins.dsDesignation, email: admins.dsEmail, password: admins.dsPassword },
        });
        setResult(res.data);
        setStep(3);
      } catch (e) {
        setApiError(e.response?.data?.message || 'Provisioning failed. Please try again.');
      }
      setLoading(false);
      return;
    }

    if (step === 3) {
      // Members step is optional — filter out empty rows
      const validMembers = members.filter((m) => m.fullName.trim() && m.email.trim() && m.designation.trim());
      if (validMembers.length > 0) {
        setLoading(true);
        try {
          const res = await onboardingAPI.inviteMembers({ envCode: result.environment.envCode, members: validMembers });
          setInviteResult(res.data);
        } catch (e) {
          // Non-fatal — continue to step 4 anyway
        }
        setLoading(false);
      }
      setStep(4);
      return;
    }
  };

  const addMemberRow = () => setMembers((p) => [...p, { fullName: '', email: '', team: 'CA', designation: '' }]);
  const removeMemberRow = (i) => setMembers((p) => p.filter((_, idx) => idx !== i));
  const updateMember = (i, field, val) => setMembers((p) => p.map((m, idx) => idx === i ? { ...m, [field]: val } : m));

  /* ── Layout wrapper ── */
  const Layout = ({ children }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', minHeight: '100vh' }}>
      {/* Left sidebar */}
      <aside style={{ background: 'var(--ink)', color: 'var(--paper)', padding: '3rem', display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh' }}>
        {/* Logo */}
        <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: '1.2rem', letterSpacing: '-0.02em', marginBottom: '3rem' }}>
          <span style={{ color: 'var(--ca)' }}>CA</span>DS<span style={{ color: 'var(--ds)' }}>-Bridge</span>
        </div>

        {/* Steps */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flex: 1 }}>
          {STEPS.map((s, i) => {
            const isDone   = step > s.num;
            const isActive = step === s.num;
            return (
              <div key={s.num} style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start', padding: '1.1rem 0', position: 'relative' }}>
                {/* Connector line */}
                {i < STEPS.length - 1 && (
                  <div style={{ position: 'absolute', left: 17, top: 48, width: 2, height: 'calc(100% - 16px)', background: isDone ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.08)' }} />
                )}
                {/* Circle */}
                <div style={{
                  width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'Syne', fontSize: '0.8rem', fontWeight: 700,
                  position: 'relative', zIndex: 1,
                  background: isDone ? 'var(--success)' : isActive ? 'white' : 'var(--ink)',
                  border: `2px solid ${isDone ? 'var(--success)' : isActive ? 'white' : 'rgba(255,255,255,0.15)'}`,
                  color: isDone ? 'white' : isActive ? 'var(--ink)' : 'rgba(255,255,255,0.35)',
                }}>
                  {isDone ? '✓' : s.num}
                </div>
                {/* Text */}
                <div style={{ paddingTop: '0.2rem' }}>
                  <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: '0.9rem', color: isActive ? 'white' : isDone ? 'rgba(245,243,238,0.6)' : 'rgba(245,243,238,0.3)' }}>
                    {s.label}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: isActive ? 'rgba(245,243,238,0.5)' : 'rgba(245,243,238,0.2)', marginTop: '0.1rem' }}>
                    {s.num === 1 && 'Register your organisation'}
                    {s.num === 2 && 'CA Lead + DS Lead admin accounts'}
                    {s.num === 3 && 'Optionally add initial team members'}
                    {s.num === 4 && 'Your environment is live'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom note */}
        <div style={{ padding: '1.1rem', background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,255,255,0.08)', marginTop: 'auto' }}>
          <p style={{ fontSize: '0.78rem', color: 'rgba(245,243,238,0.4)', lineHeight: 1.6 }}>
            💡 Both admins have equal authority within their own team. Neither can access the other's admin panel.
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ padding: '4rem 5rem', overflowY: 'auto' }}>
        {children}
      </main>
    </div>
  );

  /* ══════════════════════════════════════════
     STEP 1 — Firm Details
  ══════════════════════════════════════════ */
  if (step === 1) return (
    <Layout>
      <div style={{ maxWidth: 560 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: 'var(--ca-light)', border: '1px solid rgba(26,107,255,0.2)', color: 'var(--ca)', padding: '0.3rem 0.9rem', borderRadius: '2rem', fontSize: '0.75rem', fontWeight: 700, marginBottom: '1.25rem' }}>
          Step 1 of 4 · Firm Details
        </div>
        <h1 style={{ fontFamily: 'Syne', fontSize: '2.25rem', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: '0.75rem' }}>
          Book your<br />environment
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.95rem', lineHeight: 1.65, marginBottom: '2.5rem', maxWidth: 440 }}>
          Every firm gets a completely isolated CADS-Bridge environment with a unique access code. Your data never mixes with another firm's.
        </p>

        {apiError && <div className="alert alert-error" style={{ marginBottom: '1.5rem' }}>⚠️ {apiError}</div>}

        <Field label="Firm / Organisation Name *" error={errors.firmName}
          hint="This will appear across your team's dashboards.">
          <input className={`form-input ${errors.firmName ? 'error' : ''}`}
            style={{ fontSize: '1rem' }}
            placeholder="e.g. Nexus Capital Ltd."
            value={firm.name} onChange={(e) => setFirm((p) => ({ ...p, name: e.target.value }))} />
        </Field>

        <Field label="Industry Sector *" error={errors.industry}>
          <select className={`form-input ${errors.industry ? 'error' : ''}`}
            value={firm.industry} onChange={(e) => setFirm((p) => ({ ...p, industry: e.target.value }))}>
            <option value="">Select your industry...</option>
            {INDUSTRIES.map((ind) => <option key={ind}>{ind}</option>)}
          </select>
        </Field>

        <div className="alert alert-info" style={{ marginBottom: '2rem' }}>
          ℹ️ A unique 12-character environment code will be generated for your firm. Share it with employees to let them request access.
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link to="/" style={{ color: 'var(--muted)', fontSize: '0.88rem', fontWeight: 500 }}>← Back to home</Link>
          <button className="btn btn-primary" onClick={goNext} style={{ padding: '0.8rem 2rem' }}>
            Continue to Admin Setup →
          </button>
        </div>
      </div>
    </Layout>
  );

  /* ══════════════════════════════════════════
     STEP 2 — Admin Accounts
  ══════════════════════════════════════════ */
  if (step === 2) return (
    <Layout>
      <div style={{ maxWidth: 760 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: 'var(--ca-light)', border: '1px solid rgba(26,107,255,0.2)', color: 'var(--ca)', padding: '0.3rem 0.9rem', borderRadius: '2rem', fontSize: '0.75rem', fontWeight: 700, marginBottom: '1.25rem' }}>
          Step 2 of 4 · Admin Accounts
        </div>
        <h1 style={{ fontFamily: 'Syne', fontSize: '2.25rem', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: '0.75rem' }}>
          Create your admin<br />accounts
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.95rem', lineHeight: 1.65, marginBottom: '2.5rem', maxWidth: 520 }}>
          Set up one lead administrator per team. These accounts will have full control over their team's access, permissions, and workspace.
        </p>

        {apiError && <div className="alert alert-error" style={{ marginBottom: '1.5rem' }}>⚠️ {apiError}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
          <AdminBlock team="CA" form={admins} onChange={updateAdmin} errors={errors} />
          <AdminBlock team="DS" form={admins} onChange={updateAdmin} errors={errors} />
        </div>

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={() => { setStep(1); setApiError(''); }}>← Back</button>
          <button className="btn btn-primary" onClick={goNext} disabled={loading} style={{ padding: '0.8rem 2rem' }}>
            {loading ? <><span className="spinner" /> Provisioning...</> : 'Provision Environment →'}
          </button>
        </div>
      </div>
    </Layout>
  );

  /* ══════════════════════════════════════════
     STEP 3 — Invite Team Members (optional)
  ══════════════════════════════════════════ */
  if (step === 3) return (
    <Layout>
      <div style={{ maxWidth: 680 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: 'var(--ds-light)', border: '1px solid rgba(255,107,53,0.2)', color: 'var(--ds)', padding: '0.3rem 0.9rem', borderRadius: '2rem', fontSize: '0.75rem', fontWeight: 700, marginBottom: '1.25rem' }}>
          Step 3 of 4 · Invite Team — Optional
        </div>
        <h1 style={{ fontFamily: 'Syne', fontSize: '2.25rem', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: '0.75rem' }}>
          Add your initial<br />team members
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.95rem', lineHeight: 1.65, marginBottom: '0.75rem', maxWidth: 520 }}>
          Optionally add members now — or skip and share the environment code later so employees register themselves.
        </p>

        {/* Env code preview */}
        {result && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1.1rem', background: 'white', border: '1.5px solid var(--border)', borderRadius: 'var(--radius-md)', marginBottom: '2rem' }}>
            <span style={{ fontSize: '1.1rem' }}>🔑</span>
            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Your Environment Code</div>
              <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '1.05rem', letterSpacing: '0.08em', color: 'var(--ca)' }}>{result.environment.envCode}</div>
            </div>
            <button
              style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--ca)', fontWeight: 600 }}
              onClick={() => navigator.clipboard?.writeText(result.environment.envCode)}
            >
              Copy
            </button>
          </div>
        )}

        {apiError && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>⚠️ {apiError}</div>}

        {/* Member rows */}
        <div style={{ marginBottom: '1rem' }}>
          {members.map((m, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px 1fr auto', gap: '0.6rem', marginBottom: '0.6rem', alignItems: 'flex-start' }}>
              <input className="form-input" placeholder="Full name" value={m.fullName} onChange={(e) => updateMember(i, 'fullName', e.target.value)} />
              <input type="email" className="form-input" placeholder="Email address" value={m.email} onChange={(e) => updateMember(i, 'email', e.target.value)} />
              <select className="form-input" value={m.team} onChange={(e) => updateMember(i, 'team', e.target.value)}>
                <option value="CA">CA</option>
                <option value="DS">DS</option>
              </select>
              <input className="form-input" placeholder="Designation" value={m.designation} onChange={(e) => updateMember(i, 'designation', e.target.value)} />
              {members.length > 1 ? (
                <button onClick={() => removeMemberRow(i)} style={{ color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: '0.5rem', lineHeight: 1 }}>×</button>
              ) : <div style={{ width: 32 }} />}
            </div>
          ))}
        </div>

        <button className="btn btn-ghost btn-sm" onClick={addMemberRow} style={{ marginBottom: '2rem' }}>
          + Add another member
        </button>

        <div className="alert alert-info" style={{ marginBottom: '2rem' }}>
          ℹ️ Added members will have <strong>pending</strong> status. Admins must approve each request before they can log in. Temporary password: <code style={{ fontFamily: 'monospace', fontWeight: 700 }}>TempPass@123</code> — members should change it on first login.
        </div>

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={() => setStep(4)}>Skip for now</button>
          <button className="btn btn-primary" onClick={goNext} disabled={loading} style={{ padding: '0.8rem 2rem' }}>
            {loading ? <><span className="spinner" /> Adding members...</> : 'Continue →'}
          </button>
        </div>
      </div>
    </Layout>
  );

  /* ══════════════════════════════════════════
     STEP 4 — Launch / Success
  ══════════════════════════════════════════ */
  if (step === 4) return (
    <Layout>
      <div style={{ maxWidth: 580, textAlign: 'center', margin: '0 auto', paddingTop: '2rem' }}>
        <div style={{ fontSize: '4rem', marginBottom: '1.5rem' }}>🚀</div>
        <h1 style={{ fontFamily: 'Syne', fontSize: '2.25rem', fontWeight: 800, letterSpacing: '-0.03em', marginBottom: '0.75rem' }}>
          Your environment is live!
        </h1>
        <p style={{ color: 'var(--muted)', lineHeight: 1.7, fontSize: '0.95rem', marginBottom: '2.5rem' }}>
          <strong>{result?.environment?.firmName}</strong> is now provisioned on CADS-Bridge. Both admin accounts are active and ready to use.
        </p>

        {/* Env code big display */}
        <div style={{ background: 'var(--ink)', borderRadius: 'var(--radius-lg)', padding: '2rem', marginBottom: '2rem', color: 'var(--paper)' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(245,243,238,0.4)', marginBottom: '0.5rem' }}>
            Your Unique Environment Code
          </div>
          <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '1.75rem', letterSpacing: '0.12em', color: 'var(--ca)', marginBottom: '0.5rem' }}>
            {result?.environment?.envCode}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'rgba(245,243,238,0.4)', marginBottom: '1.25rem' }}>
            Share this code with your employees so they can request access.
          </div>
          <button
            className="btn btn-ghost btn-sm"
            style={{ color: 'rgba(245,243,238,0.6)', borderColor: 'rgba(255,255,255,0.15)' }}
            onClick={() => { navigator.clipboard?.writeText(result?.environment?.envCode); }}
          >
            📋 Copy Code
          </button>
        </div>

        {/* Admin credentials summary */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem', textAlign: 'left' }}>
          {[
            { label: 'CA Admin', data: result?.admins?.ca, color: 'var(--ca)' },
            { label: 'DS Admin', data: result?.admins?.ds, color: 'var(--ds)' },
          ].map((a) => (
            <div key={a.label} className="card" style={{ padding: '1.1rem 1.25rem', borderTop: `3px solid ${a.color}` }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.4rem' }}>{a.label}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>{a.data?.fullName}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--ca)', marginTop: '0.2rem', wordBreak: 'break-all' }}>{a.data?.email}</div>
            </div>
          ))}
        </div>

        {inviteResult && (
          <div className="alert alert-success" style={{ marginBottom: '1.5rem', textAlign: 'left' }}>
            ✓ {inviteResult.created?.length || 0} team member(s) added with pending status.
            {inviteResult.errors?.length > 0 && ` ${inviteResult.errors.length} failed.`}
          </div>
        )}

        <div className="alert alert-warning" style={{ marginBottom: '2rem', textAlign: 'left' }}>
          🔐 Save your environment code and admin credentials now. The code is required to log in and register new members.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <Link to="/login" className="btn btn-primary" style={{ justifyContent: 'center', padding: '0.9rem' }}>
            Go to Login → Sign in as CA Admin
          </Link>
          <Link to="/" className="btn btn-ghost" style={{ justifyContent: 'center' }}>
            ← Back to Home
          </Link>
        </div>
      </div>
    </Layout>
  );

  return null;
};

export default Onboarding;
