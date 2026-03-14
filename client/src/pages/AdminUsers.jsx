import React, { useEffect, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { adminAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';

const TAB = { PENDING: 'pending', ACTIVE: 'active', ALL: 'all' };

const AdminUsers = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState(TAB.PENDING);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [createModal, setCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ fullName: '', email: '', password: '', team: 'CA', designation: '' });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      let res;
      if (tab === TAB.PENDING) {
        res = await adminAPI.getPendingUsers();
        setUsers(res.data.users || []);
      } else {
        res = await adminAPI.getUsers({ status: tab === TAB.ACTIVE ? 'active' : undefined, search: search || undefined });
        setUsers(res.data.users || []);
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [tab, search]);

  const flash = (msg) => { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(''), 3500); };

  const handleApprove = async (id, name) => {
    setActionLoading(id);
    try {
      await adminAPI.approveUser(id);
      flash(`${name}'s account has been activated.`);
      load();
    } catch (e) { alert(e.response?.data?.message || 'Failed.'); }
    setActionLoading(null);
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    setActionLoading(rejectModal.id);
    try {
      await adminAPI.rejectUser(rejectModal.id, rejectReason);
      flash(`${rejectModal.name}'s request rejected.`);
      setRejectModal(null); setRejectReason('');
      load();
    } catch (e) { alert(e.response?.data?.message || 'Failed.'); }
    setActionLoading(null);
  };

  const handleDeactivate = async (id, name) => {
    if (!window.confirm(`Deactivate ${name}? They will immediately lose access.`)) return;
    setActionLoading(id);
    try {
      await adminAPI.deactivateUser(id);
      flash(`${name} deactivated.`);
      load();
    } catch (e) { alert(e.response?.data?.message || 'Failed.'); }
    setActionLoading(null);
  };

  const handleCreate = async () => {
    setCreateError('');
    if (!createForm.fullName || !createForm.email || !createForm.password || !createForm.designation) {
      setCreateError('All fields are required.'); return;
    }
    setCreateLoading(true);
    try {
      await adminAPI.createAdmin(createForm);
      flash('Admin account created successfully.');
      setCreateModal(false);
      setCreateForm({ fullName: '', email: '', password: '', team: 'CA', designation: '' });
      load();
    } catch (e) { setCreateError(e.response?.data?.message || 'Failed to create admin.'); }
    setCreateLoading(false);
  };

  const STATUS_BADGE = {
    active:      { label: 'Active',      cls: 'badge-success' },
    pending:     { label: 'Pending',     cls: 'badge-warning' },
    rejected:    { label: 'Rejected',    cls: 'badge-danger'  },
    deactivated: { label: 'Deactivated', cls: 'badge-muted'   },
  };

  return (
    <DashboardLayout title="Manage Users" subtitle="Approve requests, manage team access">
      {successMsg && (
        <div className="alert alert-success" style={{ marginBottom: '1.25rem' }}>✓ {successMsg}</div>
      )}

      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {[TAB.PENDING, TAB.ACTIVE, TAB.ALL].map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`btn btn-sm ${tab === t ? 'btn-primary' : 'btn-ghost'}`}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          {tab !== TAB.PENDING && (
            <input
              className="form-input"
              style={{ width: 220 }}
              placeholder="Search name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
          <button className="btn btn-ca" onClick={() => setCreateModal(true)}>
            + Create Admin
          </button>
        </div>
      </div>

      {/* Users table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem' }}>
          <span className="spinner spinner-dark" style={{ width: 32, height: 32 }} />
        </div>
      ) : users.length === 0 ? (
        <div className="empty-state" style={{ padding: '5rem' }}>
          <div className="empty-icon">👤</div>
          <p>{tab === TAB.PENDING ? 'No pending requests.' : 'No users found.'}</p>
        </div>
      ) : (
        <div className="card">
          {/* Table header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr 1.5fr 160px',
            padding: '0.7rem 1.25rem',
            borderBottom: '1px solid var(--border)',
            fontSize: '0.72rem', fontWeight: 700, color: 'var(--muted)',
            textTransform: 'uppercase', letterSpacing: '0.07em',
          }}>
            <span>Name</span>
            <span>Email</span>
            <span>Team</span>
            <span>Role</span>
            <span>Status / Date</span>
            <span>Actions</span>
          </div>
          {users.map((u) => {
            const sb = STATUS_BADGE[u.status] || STATUS_BADGE.active;
            const isLoading = actionLoading === u.id;
            return (
              <div key={u.id} style={{
                display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr 1.5fr 160px',
                padding: '0.85rem 1.25rem',
                borderBottom: '1px solid var(--border)',
                alignItems: 'center',
                transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#fafaf8'}
              onMouseLeave={(e) => e.currentTarget.style.background = ''}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <div className={`avatar avatar-sm avatar-${u.team?.toLowerCase()}`}>{u.avatar_initials || u.team?.[0]}</div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.86rem' }}>{u.full_name}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>{u.designation}</div>
                  </div>
                </div>
                <div style={{ fontSize: '0.83rem', color: 'var(--muted)' }}>{u.email}</div>
                <span className={`badge badge-${u.team === 'CA' ? 'ca' : 'ds'}`}>{u.team}</span>
                <span style={{ fontSize: '0.8rem', color: 'var(--muted)', textTransform: 'capitalize' }}>
                  {u.role === 'platform_admin' ? 'Super Admin' : u.role}
                </span>
                <div>
                  <span className={`badge ${sb.cls}`}>{sb.label}</span>
                  <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
                    {new Date(u.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  {u.status === 'pending' && (
                    <>
                      <button
                        className="btn btn-sm"
                        style={{ background: 'rgba(34,197,94,0.1)', color: 'var(--success)', border: '1px solid rgba(34,197,94,0.25)' }}
                        onClick={() => handleApprove(u.id, u.full_name)}
                        disabled={isLoading}
                      >
                        {isLoading ? '...' : '✓'}
                      </button>
                      <button
                        className="btn btn-sm"
                        style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.2)' }}
                        onClick={() => setRejectModal({ id: u.id, name: u.full_name })}
                        disabled={isLoading}
                      >
                        ✗
                      </button>
                    </>
                  )}
                  {u.status === 'active' && u.id !== user.id && u.role !== 'platform_admin' && (
                    <button
                      className="btn btn-sm btn-ghost"
                      style={{ color: 'var(--danger)' }}
                      onClick={() => handleDeactivate(u.id, u.full_name)}
                      disabled={isLoading}
                    >
                      {isLoading ? '...' : 'Deactivate'}
                    </button>
                  )}
                  {u.status === 'deactivated' && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Inactive</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reject modal */}
      {rejectModal && (
        <div className="modal-overlay" onClick={() => setRejectModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Reject Access Request</h2>
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
              <strong>{rejectModal.name}</strong> will be notified with this reason.
            </p>
            <div className="form-group">
              <label className="form-label">Rejection Reason *</label>
              <textarea className="form-input" rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="e.g. Position no longer available. Please contact HR." style={{ resize: 'vertical' }} />
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => { setRejectModal(null); setRejectReason(''); }}>Cancel</button>
              <button className="btn btn-danger" onClick={handleReject} disabled={!rejectReason.trim() || actionLoading}>
                {actionLoading ? '...' : 'Reject Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Admin modal */}
      {createModal && (
        <div className="modal-overlay" onClick={() => setCreateModal(false)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Create Admin Account</h2>
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
              This account will have full admin access for their team.
            </p>
            {createError && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>⚠️ {createError}</div>}

            {/* Team toggle */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.25rem' }}>
              {['CA', 'DS'].map((t) => (
                <div
                  key={t}
                  onClick={() => setCreateForm((p) => ({ ...p, team: t }))}
                  style={{
                    padding: '0.85rem',
                    border: `2px solid ${createForm.team === t ? (t === 'CA' ? 'var(--ca)' : 'var(--ds)') : 'var(--border)'}`,
                    borderRadius: 'var(--radius-sm)',
                    background: createForm.team === t ? (t === 'CA' ? 'var(--ca-light)' : 'var(--ds-light)') : 'white',
                    cursor: 'pointer', textAlign: 'center',
                    fontWeight: 700, fontSize: '0.88rem',
                    color: createForm.team === t ? (t === 'CA' ? 'var(--ca)' : 'var(--ds)') : 'var(--muted)',
                    transition: 'all 0.15s',
                  }}
                >
                  {t === 'CA' ? '📒 CA Admin' : '🔬 DS Admin'}
                </div>
              ))}
            </div>

            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input className="form-input" placeholder="Ahmad Raza" value={createForm.fullName} onChange={(e) => setCreateForm((p) => ({ ...p, fullName: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Designation</label>
              <input className="form-input" placeholder="e.g. Chief Accountant" value={createForm.designation} onChange={(e) => setCreateForm((p) => ({ ...p, designation: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Work Email</label>
              <input type="email" className="form-input" placeholder="admin@firm.com" value={createForm.email} onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Temporary Password</label>
              <input type="password" className="form-input" placeholder="Min. 8 chars, uppercase + number" value={createForm.password} onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))} />
            </div>

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => { setCreateModal(false); setCreateError(''); }}>Cancel</button>
              <button className="btn btn-ca" onClick={handleCreate} disabled={createLoading}>
                {createLoading ? <><span className="spinner" />Creating...</> : 'Create Admin Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default AdminUsers;
