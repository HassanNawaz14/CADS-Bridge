import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { projectsAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

// Feature options available for projects
const OPTIONAL_FEATURES = [
  { key: 'annotations', label: '📝 Annotations', desc: 'Inline document annotations' },
  { key: 'knowledge_hub', label: '📚 Knowledge Hub', desc: 'Shared glossary & past projects' },
  { key: 'reporting', label: '📊 Reporting Engine', desc: 'Joint stakeholder reports' },
  { key: 'conflict_detection', label: '⚠️ Conflict Detection', desc: 'CA-DS discrepancy alerts' },
];

const CORE_FEATURES = [
  { key: 'messaging', label: '💬 Messaging', desc: 'Project chat' },
  { key: 'file_sharing', label: '📁 File Sharing', desc: 'Upload/download artifacts' },
  { key: 'task_board', label: '✅ Task Board', desc: 'Task management' },
];

const ALL_FEATURES = [...CORE_FEATURES, ...OPTIONAL_FEATURES];

const ProjectDomain = [
  { key: 'finance', label: '💰 Finance' },
  { key: 'data', label: '📊 Data & Analytics' },
  { key: 'hybrid', label: '🔗 Hybrid (Finance + Data)' },
];

const NewProjectModal = ({ onClose }) => {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Step state
  const [step, setStep] = useState(1); // Steps: 1=Details, 2=Team, 3=Timeline, 4=Features, 5=Review
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Data
  const [caUsers, setCaUsers] = useState([]); // CA team members available
  const [dsUsers, setDsUsers] = useState([]); // DS team members available
  const [loadingUsers, setLoadingUsers] = useState(true);

  // Form state (auto-save between steps)
  const [form, setForm] = useState({
    // Step 1: Details
    name: '',
    description: '',
    objectives: '',
    domain: 'hybrid',
    startDate: '',
    endDate: '',

    // Step 2: Team
    caMembers: [], // array of CA user IDs
    dsMembers: [], // array of DS user IDs

    // Step 3: Milestones
    milestones: [{ title: '', dueDate: '' }],

    // Step 4: Features
    features: ['messaging', 'file_sharing', 'task_board'], // always include core features

    // Metadata
    searchCA: '',
    searchDS: '',
  });

  // Load available users on mount
  useEffect(() => {
    const loadUsers = async () => {
      try {
        setLoadingUsers(true);
        // Fetch CA members from public endpoint
        const caRes = await api.get('/projects/team/users', { params: { status: 'active', team: 'CA' } });
        const caList = (caRes.data.users || [])
          .filter((u) => u.id !== user.id) // Exclude initiator
          .sort((a, b) => a.full_name.localeCompare(b.full_name));
        setCaUsers(caList);

        // Fetch DS members from public endpoint
        const dsRes = await api.get('/projects/team/users', { params: { status: 'active', team: 'DS' } });
        const dsList = (dsRes.data.users || [])
          .filter((u) => u.id !== user.id) // Exclude initiator
          .sort((a, b) => a.full_name.localeCompare(b.full_name));
        setDsUsers(dsList);
      } catch (err) {
        setError('Failed to load team members. Please try again.');
        console.error(err);
      } finally {
        setLoadingUsers(false);
      }
    };
    loadUsers();
  }, [user.id]);

  // Update form
  const updateForm = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  // Milestone helpers
  const addMilestone = () => {
    updateForm('milestones', [...form.milestones, { title: '', dueDate: '' }]);
  };

  const updateMilestone = (index, field, value) => {
    const newMilestones = [...form.milestones];
    newMilestones[index] = { ...newMilestones[index], [field]: value };
    updateForm('milestones', newMilestones);
  };

  const removeMilestone = (index) => {
    if (form.milestones.length > 1) {
      updateForm('milestones', form.milestones.filter((_, i) => i !== index));
    }
  };

  // Feature toggle
  const toggleFeature = (key) => {
    const locked = CORE_FEATURES.find((f) => f.key === key);
    if (locked) return; // Can't toggle core features
    const hasFeature = form.features.includes(key);
    updateForm(
      'features',
      hasFeature
        ? form.features.filter((f) => f !== key)
        : [...form.features, key]
    );
  };

  // Team member toggle
  const toggleCAMember = (userId) => {
    const hasMember = form.caMembers.includes(userId);
    updateForm(
      'caMembers',
      hasMember
        ? form.caMembers.filter((id) => id !== userId)
        : [...form.caMembers, userId]
    );
  };

  const toggleDSMember = (userId) => {
    const hasMember = form.dsMembers.includes(userId);
    updateForm(
      'dsMembers',
      hasMember
        ? form.dsMembers.filter((id) => id !== userId)
        : [...form.dsMembers, userId]
    );
  };

  // Validate step before proceeding
  const validateStep = () => {
    setError('');

    if (step === 1) {
      // Validate details
      if (!form.name.trim()) {
        setError('Project name is required.');
        return false;
      }
      if (form.name.trim().length < 3) {
        setError('Project name must be at least 3 characters.');
        return false;
      }
      if (!form.description.trim()) {
        setError('Description is required.');
        return false;
      }
      if (!form.objectives.trim()) {
        setError('Objectives are required.');
        return false;
      }
      if (!form.startDate) {
        setError('Start date is required.');
        return false;
      }
      if (!form.endDate) {
        setError('End date is required.');
        return false;
      }
      const start = new Date(form.startDate);
      const end = new Date(form.endDate);
      if (end <= start) {
        setError('End date must be after start date.');
        return false;
      }
      return true;
    }

    if (step === 2) {
      // Validate team selection
      if (form.caMembers.length === 0) {
        setError('Select at least one CA team member.');
        return false;
      }
      if (form.dsMembers.length === 0) {
        setError('Select at least one DS team member.');
        return false;
      }
      return true;
    }

    if (step === 3) {
      // Validate milestones
      const hasIncompleteMilestone = form.milestones.some((m) => !m.title.trim() || !m.dueDate);
      if (hasIncompleteMilestone) {
        setError('All milestones must have a title and due date.');
        return false;
      }
      // Validate milestone dates are within project timeline
      const start = new Date(form.startDate);
      const end = new Date(form.endDate);
      const invalidMilestone = form.milestones.find((m) => {
        const mDate = new Date(m.dueDate);
        return mDate < start || mDate > end;
      });
      if (invalidMilestone) {
        setError('All milestone dates must be between project start and end date.');
        return false;
      }
      return true;
    }

    if (step === 4) {
      // Features - always valid (at least core features are included)
      return true;
    }

    if (step === 5) {
      // Review - final check
      return true;
    }

    return true;
  };

  const handleNext = () => {
    if (!validateStep()) return;
    if (step < 5) {
      setStep(step + 1);
    }
  };

  const handlePrevious = () => {
    if (step > 1) {
      setStep(step - 1);
      setError('');
    }
  };

  const handleSubmit = async () => {
    if (!validateStep()) return;
    setSubmitting(true);
    setError('');

    try {
      const projectData = {
        name: form.name.trim(),
        description: form.description.trim(),
        objectives: form.objectives.trim(),
        startDate: form.startDate,
        endDate: form.endDate,
        milestones: form.milestones.map((m) => ({ title: m.title.trim(), dueDate: m.dueDate })),
        features: form.features,
        caMembers: form.caMembers,
        dsMembers: form.dsMembers,
      };

      await projectsAPI.create(projectData);
      setSuccess(true);
    } catch (err) {
      console.error('Project creation error:', err);
      setError(err.response?.data?.message || 'Failed to create project. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Success screen
  if (success) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🚀</div>
          <h2 className="syne" style={{ fontSize: '1.4rem', marginBottom: '0.75rem', fontWeight: 700 }}>
            Project Submitted!
          </h2>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '1.5rem' }}>
            We've sent <strong>{form.name}</strong> to your admin team for approval.
            <br />
            You'll receive a notification once it's reviewed.
          </p>
          <div className="modal-footer" style={{ justifyContent: 'center', gap: '0.75rem' }}>
            <button className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
            <button 
              className="btn btn-primary" 
              onClick={() => {
                onClose();
                navigate('/projects');
              }}
            >
              View My Projects →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 700, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--ca)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.3rem' }}>
              Step {step} of 5
            </div>
            <h2 className="modal-title" style={{ fontSize: '1.3rem', fontWeight: 700 }}>
              {step === 1 && '📋 Project Details'}
              {step === 2 && '👥 Select Team Members'}
              {step === 3 && '📅 Timeline & Milestones'}
              {step === 4 && '⚙️ Workspace Features'}
              {step === 5 && '✅ Review & Submit'}
            </h2>
          </div>
          <button 
            onClick={onClose} 
            style={{ fontSize: '1.4rem', color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {/* Progress bar */}
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1.75rem' }}>
          {[1, 2, 3, 4, 5].map((s) => (
            <div 
              key={s} 
              style={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                background: s <= step ? 'var(--ca)' : 'var(--border)',
                transition: 'background 0.3s',
              }}
            />
          ))}
        </div>

        {/* Error message */}
        {error && (
          <div style={{
            padding: '0.75rem 1rem',
            background: 'var(--danger-light)',
            border: '1.5px solid var(--danger)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--danger)',
            fontSize: '0.85rem',
            marginBottom: '1rem',
          }}>
            ⚠️ {error}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* STEP 1: DETAILS */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {step === 1 && (
          <div>
            <div className="form-group">
              <label className="form-label">Project Name *</label>
              <input
                className="form-input"
                type="text"
                value={form.name}
                onChange={(e) => updateForm('name', e.target.value)}
                placeholder="e.g., Revenue Forecast Model Q2 2025"
                maxLength={200}
              />
              <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.3rem' }}>
                {form.name.length}/200 characters
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Domain *</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {ProjectDomain.map((d) => (
                  <button
                    key={d.key}
                    onClick={() => updateForm('domain', d.key)}
                    style={{
                      flex: 1,
                      padding: '0.75rem',
                      border: `1.5px solid ${form.domain === d.key ? 'var(--ca)' : 'var(--border)'}`,
                      background: form.domain === d.key ? 'var(--ca-light)' : 'white',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.82rem',
                      fontWeight: form.domain === d.key ? 600 : 500,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Description *</label>
              <textarea
                className="form-input"
                value={form.description}
                onChange={(e) => updateForm('description', e.target.value)}
                placeholder="What is this project about? What context should team members know?"
                rows={3}
                style={{ resize: 'vertical' }}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Objectives *</label>
              <textarea
                className="form-input"
                value={form.objectives}
                onChange={(e) => updateForm('objectives', e.target.value)}
                placeholder="What are the key goals and expected outputs?"
                rows={3}
                style={{ resize: 'vertical' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Start Date *</label>
                <input
                  className="form-input"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => updateForm('startDate', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">End Date *</label>
                <input
                  className="form-input"
                  type="date"
                  value={form.endDate}
                  onChange={(e) => updateForm('endDate', e.target.value)}
                  min={form.startDate}
                />
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* STEP 2: TEAM SELECTION */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {step === 2 && (
          <div>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1.25rem' }}>
              Select at least one CA member and one DS member. You ({user.fullName}) are auto-included as the initiator.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              {/* CA Team Panel */}
              <div>
                <h4 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--ca)' }}>
                  Chartered Accountants (CA)
                </h4>
                <input
                  className="form-input"
                  type="text"
                  placeholder="Search CA members..."
                  value={form.searchCA}
                  onChange={(e) => updateForm('searchCA', e.target.value)}
                  style={{ marginBottom: '0.75rem' }}
                />
                <div style={{
                  border: '1.5px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  maxHeight: 280,
                  overflowY: 'auto',
                  padding: '0.5rem',
                }}>
                  {loadingUsers ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>
                      Loading...
                    </div>
                  ) : caUsers.filter((u) => 
                    u.full_name.toLowerCase().includes(form.searchCA.toLowerCase())
                  ).length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
                      No CA members available
                    </div>
                  ) : (
                    caUsers
                      .filter((u) => u.full_name.toLowerCase().includes(form.searchCA.toLowerCase()))
                      .map((u) => (
                        <label
                          key={u.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            padding: '0.65rem',
                            borderRadius: '0.4rem',
                            cursor: 'pointer',
                            background: form.caMembers.includes(u.id) ? 'var(--ca-light)' : 'transparent',
                            transition: 'background 0.15s',
                            userSelect: 'none',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={form.caMembers.includes(u.id)}
                            onChange={() => toggleCAMember(u.id)}
                            style={{ cursor: 'pointer' }}
                          />
                          <div className="avatar avatar-sm avatar-ca">{u.avatar_initials || 'CA'}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '0.82rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {u.full_name}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                              {u.designation}
                            </div>
                          </div>
                        </label>
                      ))
                  )}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.5rem' }}>
                  Selected: {form.caMembers.length} member{form.caMembers.length !== 1 ? 's' : ''}
                </div>
              </div>

              {/* DS Team Panel */}
              <div>
                <h4 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--ds)' }}>
                  Data Scientists (DS)
                </h4>
                <input
                  className="form-input"
                  type="text"
                  placeholder="Search DS members..."
                  value={form.searchDS}
                  onChange={(e) => updateForm('searchDS', e.target.value)}
                  style={{ marginBottom: '0.75rem' }}
                />
                <div style={{
                  border: '1.5px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  maxHeight: 280,
                  overflowY: 'auto',
                  padding: '0.5rem',
                }}>
                  {loadingUsers ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>
                      Loading...
                    </div>
                  ) : dsUsers.filter((u) => 
                    u.full_name.toLowerCase().includes(form.searchDS.toLowerCase())
                  ).length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
                      No DS members available
                    </div>
                  ) : (
                    dsUsers
                      .filter((u) => u.full_name.toLowerCase().includes(form.searchDS.toLowerCase()))
                      .map((u) => (
                        <label
                          key={u.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            padding: '0.65rem',
                            borderRadius: '0.4rem',
                            cursor: 'pointer',
                            background: form.dsMembers.includes(u.id) ? 'var(--ds-light)' : 'transparent',
                            transition: 'background 0.15s',
                            userSelect: 'none',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={form.dsMembers.includes(u.id)}
                            onChange={() => toggleDSMember(u.id)}
                            style={{ cursor: 'pointer' }}
                          />
                          <div className="avatar avatar-sm avatar-ds">{u.avatar_initials || 'DS'}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '0.82rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {u.full_name}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                              {u.designation}
                            </div>
                          </div>
                        </label>
                      ))
                  )}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.5rem' }}>
                  Selected: {form.dsMembers.length} member{form.dsMembers.length !== 1 ? 's' : ''}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* STEP 3: TIMELINE & MILESTONES */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {step === 3 && (
          <div>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1rem' }}>
              Define project phases and milestone dates. All dates must fall within the project timeline.
            </p>

            <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'var(--paper)', borderRadius: 'var(--radius-md)', fontSize: '0.8rem', color: 'var(--muted)' }}>
              <strong>Project Timeline:</strong> {new Date(form.startDate).toLocaleDateString()} — {new Date(form.endDate).toLocaleDateString()}
            </div>

            <div>
              {form.milestones.map((milestone, idx) => (
                <div key={idx} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto auto', gap: '0.5rem', alignItems: 'end', marginBottom: '0.75rem' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600, width: 30, textAlign: 'center' }}>
                    {idx + 1}
                  </div>
                  <input
                    className="form-input"
                    type="text"
                    value={milestone.title}
                    onChange={(e) => updateMilestone(idx, 'title', e.target.value)}
                    placeholder={`Phase ${idx + 1} name (e.g., Data Collection)`}
                  />
                  <input
                    className="form-input"
                    type="date"
                    value={milestone.dueDate}
                    onChange={(e) => updateMilestone(idx, 'dueDate', e.target.value)}
                    min={form.startDate}
                    max={form.endDate}
                    style={{ width: 150 }}
                  />
                  {form.milestones.length > 1 && (
                    <button
                      onClick={() => removeMilestone(idx)}
                      style={{
                        padding: '0.5rem 0.75rem',
                        background: 'var(--danger-light)',
                        border: '1.5px solid var(--danger)',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--danger)',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        transition: 'all 0.15s',
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button
              onClick={addMilestone}
              style={{
                padding: '0.65rem 1rem',
                background: 'var(--ca-light)',
                border: '1.5px dashed var(--ca)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--ca)',
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontWeight: 600,
                marginTop: '0.5rem',
                transition: 'all 0.15s',
              }}
            >
              + Add Milestone
            </button>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* STEP 4: FEATURES */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {step === 4 && (
          <div>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1.25rem' }}>
              Core workspace features are always included. Select additional optional features for this project.
            </p>

            {/* Core Features - Always Included */}
            <div style={{ marginBottom: '1.5rem' }}>
              <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>
                ✓ Always Included
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.75rem' }}>
                {CORE_FEATURES.map((feat) => (
                  <div
                    key={feat.key}
                    style={{
                      padding: '0.85rem',
                      border: '1.5px solid var(--border)',
                      borderRadius: 'var(--radius-md)',
                      background: 'white',
                      opacity: 0.7,
                    }}
                  >
                    <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>✓ {feat.label}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.3rem' }}>
                      {feat.desc}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Optional Features */}
            <div>
              <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>
                Optional Features
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.75rem' }}>
                {OPTIONAL_FEATURES.map((feat) => {
                  const isSelected = form.features.includes(feat.key);
                  return (
                    <button
                      key={feat.key}
                      onClick={() => toggleFeature(feat.key)}
                      style={{
                        padding: '0.85rem',
                        border: `1.5px solid ${isSelected ? 'var(--ca)' : 'var(--border)'}`,
                        borderRadius: 'var(--radius-md)',
                        background: isSelected ? 'var(--ca-light)' : 'white',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: isSelected ? 'var(--ca)' : 'inherit' }}>
                        {isSelected ? '✓ ' : ''}{feat.label}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.3rem' }}>
                        {feat.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* STEP 5: REVIEW & SUBMIT */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {step === 5 && (
          <div>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1.25rem' }}>
              Review your project details before submitting for admin approval.
            </p>

            {/* Project Details */}
            <div style={{ marginBottom: '1.25rem', padding: '1rem', background: 'var(--paper)', borderRadius: 'var(--radius-md)' }}>
              <h4 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.65rem' }}>Project Overview</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '0.5rem 1rem', fontSize: '0.85rem' }}>
                <strong>Name:</strong>
                <div>{form.name}</div>
                <strong>Domain:</strong>
                <div>{ProjectDomain.find((d) => d.key === form.domain)?.label}</div>
                <strong>Timeline:</strong>
                <div>
                  {new Date(form.startDate).toLocaleDateString()} —{' '}
                  {new Date(form.endDate).toLocaleDateString()}
                </div>
                <strong>Description:</strong>
                <div style={{ whiteSpace: 'pre-wrap' }}>{form.description}</div>
                <strong>Objectives:</strong>
                <div style={{ whiteSpace: 'pre-wrap' }}>{form.objectives}</div>
              </div>
            </div>

            {/* Team */}
            <div style={{ marginBottom: '1.25rem', padding: '1rem', background: 'var(--paper)', borderRadius: 'var(--radius-md)' }}>
              <h4 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.65rem' }}>Team Members</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--ca)', marginBottom: '0.5rem' }}>CA: {form.caMembers.length + 1}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                    <div>{user.fullName} (You)</div>
                    {form.caMembers.map((id) => {
                      const u = caUsers.find((u) => u.id === id);
                      return u ? <div key={id}>{u.full_name}</div> : null;
                    })}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--ds)', marginBottom: '0.5rem' }}>DS: {form.dsMembers.length}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                    {form.dsMembers.map((id) => {
                      const u = dsUsers.find((u) => u.id === id);
                      return u ? <div key={id}>{u.full_name}</div> : null;
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Milestones */}
            <div style={{ marginBottom: '1.25rem', padding: '1rem', background: 'var(--paper)', borderRadius: 'var(--radius-md)' }}>
              <h4 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.65rem' }}>Milestones ({form.milestones.length})</h4>
              <div style={{ fontSize: '0.85rem' }}>
                {form.milestones.map((m, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.4rem', marginBottom: '0.4rem', borderBottom: '1px solid var(--border)' }}>
                    <div>{m.title}</div>
                    <div style={{ color: 'var(--muted)' }}>{new Date(m.dueDate).toLocaleDateString()}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Features */}
            <div style={{ padding: '1rem', background: 'var(--paper)', borderRadius: 'var(--radius-md)' }}>
              <h4 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.65rem' }}>Enabled Features</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', fontSize: '0.8rem' }}>
                {form.features.map((feat) => {
                  const feature = ALL_FEATURES.find((f) => f.key === feat);
                  return feature ? (
                    <span
                      key={feat}
                      style={{
                        padding: '0.3rem 0.65rem',
                        background: 'var(--ca-light)',
                        color: 'var(--ca)',
                        borderRadius: '99px',
                        fontWeight: 500,
                      }}
                    >
                      {feature.label}
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          </div>
        )}

        {/* Footer with navigation buttons */}
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '2rem', justifyContent: 'flex-end' }}>
          {step > 1 && (
            <button className="btn btn-ghost" onClick={handlePrevious}>
              ← Back
            </button>
          )}
          {step < 5 ? (
            <button 
              className="btn btn-primary" 
              onClick={handleNext}
              disabled={submitting}
            >
              Next →
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={submitting}
              style={{ opacity: submitting ? 0.6 : 1, cursor: submitting ? 'not-allowed' : 'pointer' }}
            >
              {submitting ? 'Submitting...' : 'Submit Project'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default NewProjectModal;
