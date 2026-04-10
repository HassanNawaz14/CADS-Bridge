import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import { projectsAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';

const STATUS_BADGE = {
  active:    { label: 'Active',    cls: 'badge-success' },
  pending:   { label: 'Pending',   cls: 'badge-warning' },
  rejected:  { label: 'Rejected',  cls: 'badge-danger' },
  completed: { label: 'Completed', cls: 'badge-muted' },
  archived:  { label: 'Archived',  cls: 'badge-muted' },
};

const ProjectsPage = () => {
  const { isAdmin } = useAuth();
  const [projects, setProjects] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [rejecting, setRejecting] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const params = filter !== 'all' ? { status: filter } : {};
      const res = await projectsAPI.list(params);
      setProjects(res.data.projects || []);
    } catch {}
    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [filter]);

  const handleApprove = async (id) => {
    try {
      await projectsAPI.approve(id);
      load();
    } catch (e) {
      alert(e.response?.data?.message || 'Failed to approve.');
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    try {
      await projectsAPI.reject(rejecting, rejectReason);
      setRejecting(null);
      setRejectReason('');
      load();
    } catch (e) {
      alert(e.response?.data?.message || 'Failed to reject.');
    }
  };

  const filters = ['all', 'active', 'pending', 'completed'];

  return (
    <DashboardLayout title="My Projects" subtitle="Cross-functional project workspaces">
      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem' }}>
          <span className="spinner spinner-dark" style={{ width: 32, height: 32 }} />
        </div>
      ) : projects.length === 0 ? (
        <div className="empty-state" style={{ padding: '5rem' }}>
          <div className="empty-icon">🚀</div>
          <p>No projects found. Start a new project from the sidebar.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1rem' }}>
          {projects.map((p) => {
            const sb = STATUS_BADGE[p.status] || STATUS_BADGE.active;
            return (
              <div key={p.id} className="card" style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '1.25rem 1.4rem', flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <span className={`badge ${sb.cls}`}>{sb.label}</span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                      {new Date(p.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <h3 style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: '1rem', marginBottom: '0.4rem' }}>{p.name}</h3>
                  <p style={{ fontSize: '0.82rem', color: 'var(--muted)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {p.description}
                  </p>
                  <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--muted)' }}>
                    by <strong>{p.initiated_by_name}</strong> ({p.initiated_by_team})
                    {p.start_date && ` · ${new Date(p.start_date).toLocaleDateString()} – ${new Date(p.end_date).toLocaleDateString()}`}
                  </div>
                </div>

                <div style={{ padding: '0.85rem 1.4rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '0.5rem' }}>
                  {p.status === 'active' && (
                    <Link to={`/projects/${p.id}`} className="btn btn-ca btn-sm" style={{ flex: 1, justifyContent: 'center' }}>
                      Open Workspace →
                    </Link>
                  )}
                  {p.status === 'pending' && isAdmin && (
                    <>
                      <button className="btn btn-sm btn-ghost" style={{ flex: 1, justifyContent: 'center', color: 'var(--success)', borderColor: 'var(--success)' }} onClick={() => handleApprove(p.id)}>
                        ✓ Approve
                      </button>
                      <button className="btn btn-sm btn-ghost" style={{ flex: 1, justifyContent: 'center', color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => setRejecting(p.id)}>
                        ✗ Reject
                      </button>
                    </>
                  )}
                  {p.status === 'pending' && !isAdmin && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>⏳ Awaiting admin approval</span>
                  )}
                  {(p.status === 'rejected' || p.status === 'completed') && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                      {p.status === 'rejected' ? '✗ Rejected' : '✓ Completed'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reject modal */}
      {rejecting && (
        <div className="modal-overlay" onClick={() => setRejecting(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Reject Project</h2>
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
              Please provide a reason for rejection. The project initiator will be notified.
            </p>
            <div className="form-group">
              <label className="form-label">Rejection Reason *</label>
              <textarea className="form-input" rows={4} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="e.g. Insufficient scope definition. Please resubmit with more detailed objectives." style={{ resize: 'vertical' }} />
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setRejecting(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleReject} disabled={!rejectReason.trim()}>Reject Project</button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default ProjectsPage;
