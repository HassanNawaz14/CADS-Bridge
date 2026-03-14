import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI, projectsAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';

const FEATURES = [
  { key: 'annotations',   label: '📝 Annotations',    desc: 'Collaborative document annotations' },
  { key: 'knowledge_hub', label: '📚 Knowledge Hub',   desc: 'Shared reference library' },
  { key: 'reporting',     label: '📊 Reporting',       desc: 'Stakeholder reports' },
  { key: 'messaging',     label: '💬 Messaging',       desc: 'Project chat (always included)', locked: true },
  { key: 'file_sharing',  label: '📁 File Sharing',    desc: 'Upload/download artifacts', locked: true },
  { key: 'task_board',    label: '✅ Task Board',      desc: 'Task management (always included)', locked: true },
];

const steps = ['Details', 'Team', 'Timeline', 'Features'];

const NewProjectModal = ({ onClose }) => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [envUsers, setEnvUsers] = useState([]);

  // Form state (persisted across steps)
  const [form, setForm] = useState({
    name: '', description: '', objectives: '',
    members: [],
    startDate: '', endDate: '',
    milestones: [{ title: '', dueDate: '' }],
    features: ['messaging', 'file_sharing', 'task_board'],
  });

  useEffect(() => {
    adminAPI.getUsers({ status: 'active' })
      .then((r) => setEnvUsers(r.data.users || []))
      .catch(() => {});
  }, []);

  const update = (field, val) => setForm((p) => ({ ...p, [field]: val }));

  const validateStep = () => {
    if (step === 0) {
      if (!form.name.trim()) return 'Project name is required.';
      if (!form.description.trim()) return 'Description is required.';
      if (!form.objectives.trim()) return 'Objectives are required.';
    }
    if (step === 1) {
      if (form.members.length < 1) return 'Select at least one additional team member.';
      const teams = new Set(envUsers.filter((u) => form.members.includes(u.id)).map((u) => u.team));
      if (!teams.has('CA') || !teams.has('DS')) return 'Project must include at least one CA and one DS member.';
    }
    if (step === 2) {
      if (!form.startDate || !form.endDate) return 'Start and end dates are required.';
      if (new Date(form.endDate) <= new Date(form.startDate)) return 'End date must be after start date.';
      if (form.milestones.some((m) => !m.title || !m.dueDate)) return 'All milestones need a title and date.';
    }
    return '';
  };

  const nextStep = () => {
    const err = validateStep();
    if (err) { setError(err); return; }
    setError('');
    setStep((s) => s + 1);
  };

  const submit = async () => {
    const err = validateStep();
    if (err) { setError(err); return; }
    setLoading(true);
    setError('');
    try {
      await projectsAPI.create({
        ...form,
        members: [...new Set([...form.members, user.id])],
      });
      setSuccess(true);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to submit project.');
    } finally {
      setLoading(false);
    }
  };

  const toggleMember = (id) => {
    update('members', form.members.includes(id)
      ? form.members.filter((m) => m !== id)
      : [...form.members, id]
    );
  };

  const toggleFeature = (key) => {
    const locked = FEATURES.find((f) => f.key === key)?.locked;
    if (locked) return;
    update('features', form.features.includes(key)
      ? form.features.filter((f) => f !== key)
      : [...form.features, key]
    );
  };

  const addMilestone = () => update('milestones', [...form.milestones, { title: '', dueDate: '' }]);
  const updateMilestone = (i, field, val) => {
    const ms = [...form.milestones];
    ms[i][field] = val;
    update('milestones', ms);
  };
  const removeMilestone = (i) => {
    if (form.milestones.length === 1) return;
    update('milestones', form.milestones.filter((_, idx) => idx !== i));
  };

  if (success) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🚀</div>
          <h2 className="syne" style={{ fontSize: '1.4rem', marginBottom: '0.5rem' }}>Project Submitted!</h2>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: 1.6 }}>
            Your project proposal has been sent to the admin for approval.<br />
            You'll be notified once it's reviewed.
          </p>
          <div className="modal-footer" style={{ justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={() => { onClose(); navigate('/projects'); }}>
              View My Projects
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--ca)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.3rem' }}>
              Step {step + 1} of 4 · {steps[step]}
            </div>
            <h2 className="modal-title">Start a New Project</h2>
          </div>
          <button onClick={onClose} style={{ fontSize: '1.3rem', color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1.75rem' }}>
          {steps.map((s, i) => (
            <div key={s} style={{
              flex: 1, height: 4, borderRadius: 2,
              background: i <= step ? 'var(--ca)' : 'var(--border)',
              transition: 'background 0.3s'
            }} />
          ))}
        </div>

        {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>⚠️ {error}</div>}

        {/* ── Step 0: Details ── */}
        {step === 0 && (
          <div>
            <div className="form-group">
              <label className="form-label">Project Name *</label>
              <input className="form-input" value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="e.g. Revenue Forecast Model Q2 2025" />
            </div>
            <div className="form-group">
              <label className="form-label">Description *</label>
              <textarea className="form-input" rows={3} value={form.description} onChange={(e) => update('description', e.target.value)} placeholder="What is this project about?" style={{ resize: 'vertical' }} />
            </div>
            <div className="form-group">
              <label className="form-label">Objectives *</label>
              <textarea className="form-input" rows={3} value={form.objectives} onChange={(e) => update('objectives', e.target.value)} placeholder="What are the key goals and deliverables?" style={{ resize: 'vertical' }} />
            </div>
          </div>
        )}

        {/* ── Step 1: Team ── */}
        {step === 1 && (
          <div>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1rem' }}>
              Select CA and DS members. You are automatically included as the initiator.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', maxHeight: 300, overflowY: 'auto' }}>
              {envUsers.filter((u) => u.id !== user.id).map((u) => (
                <label key={u.id} style={{
                  display: 'flex', alignItems: 'center', gap: '0.65rem',
                  padding: '0.65rem 0.85rem',
                  border: `1.5px solid ${form.members.includes(u.id) ? (u.team === 'CA' ? 'var(--ca)' : 'var(--ds)') : 'var(--border)'}`,
                  borderRadius: 'var(--radius-sm)',
                  background: form.members.includes(u.id) ? (u.team === 'CA' ? 'var(--ca-light)' : 'var(--ds-light)') : 'white',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}>
                  <input type="checkbox" checked={form.members.includes(u.id)} onChange={() => toggleMember(u.id)} style={{ display: 'none' }} />
                  <div className={`avatar avatar-sm avatar-${u.team.toLowerCase()}`}>{u.avatar_initials || u.avatarInitials || u.team[0]}</div>
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{u.full_name || u.fullName}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>{u.team} · {u.designation}</div>
                  </div>
                </label>
              ))}
            </div>
            {form.members.length > 0 && (
              <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.75rem' }}>
                {form.members.length} member{form.members.length > 1 ? 's' : ''} selected (+ you)
              </p>
            )}
          </div>
        )}

        {/* ── Step 2: Timeline ── */}
        {step === 2 && (
          <div>
            <div className="form-row" style={{ marginBottom: '1.25rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Start Date *</label>
                <input type="date" className="form-input" value={form.startDate} onChange={(e) => update('startDate', e.target.value)} min={new Date().toISOString().split('T')[0]} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">End Date *</label>
                <input type="date" className="form-input" value={form.endDate} onChange={(e) => update('endDate', e.target.value)} min={form.startDate} />
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                <label className="form-label" style={{ marginBottom: 0 }}>Milestones *</label>
                <button onClick={addMilestone} className="btn btn-ghost btn-sm">+ Add</button>
              </div>
              {form.milestones.map((m, i) => (
                <div key={i} className="form-row" style={{ marginBottom: '0.5rem', alignItems: 'center' }}>
                  <input className="form-input" placeholder={`Milestone ${i + 1} title`} value={m.title} onChange={(e) => updateMilestone(i, 'title', e.target.value)} />
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <input type="date" className="form-input" value={m.dueDate} onChange={(e) => updateMilestone(i, 'dueDate', e.target.value)} />
                    {form.milestones.length > 1 && (
                      <button onClick={() => removeMilestone(i)} style={{ color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', flexShrink: 0 }}>×</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Step 3: Features ── */}
        {step === 3 && (
          <div>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1rem' }}>
              Select the tools to enable in the shared workspace.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
              {FEATURES.map((f) => (
                <div
                  key={f.key}
                  onClick={() => toggleFeature(f.key)}
                  style={{
                    padding: '0.8rem 1rem',
                    border: `1.5px solid ${form.features.includes(f.key) ? 'var(--ca)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius-sm)',
                    background: form.features.includes(f.key) ? 'var(--ca-light)' : 'white',
                    cursor: f.locked ? 'default' : 'pointer',
                    opacity: f.locked ? 0.65 : 1,
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{f.label}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '0.2rem' }}>{f.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer buttons */}
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={step === 0 ? onClose : () => { setError(''); setStep((s) => s - 1); }}>
            {step === 0 ? 'Cancel' : '← Back'}
          </button>
          {step < 3 ? (
            <button className="btn btn-ca" onClick={nextStep}>Continue →</button>
          ) : (
            <button className="btn btn-ca" onClick={submit} disabled={loading}>
              {loading ? <><span className="spinner" />Submitting...</> : 'Submit for Approval 🚀'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default NewProjectModal;
