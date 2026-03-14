import React, { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { adminAPI } from '../services/api';

const ACTION_ICONS = {
  user_login:             '🔑',
  user_logout:            '🚪',
  user_registered:        '📝',
  user_approved:          '✅',
  user_rejected:          '❌',
  user_deactivated:       '🔒',
  admin_created:          '👑',
  project_created:        '🚀',
  project_approved:       '✅',
  project_rejected:       '❌',
  message_sent:           '💬',
  file_upload:            '📁',
  task_created:           '📋',
  task_status_updated:    '🔄',
  kpi_recorded:           '📊',
  kpi_threshold_updated:  '⚙️',
};

const AuditLogs = () => {
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ actionType: '', dateFrom: '', dateTo: '', search: '' });
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 50 };
      if (filters.actionType) params.actionType = filters.actionType;
      if (filters.dateFrom)   params.dateFrom   = filters.dateFrom;
      if (filters.dateTo)     params.dateTo     = filters.dateTo;

      const res = await adminAPI.getAuditLogs(params);
      setLogs(res.data.logs || []);
      setPagination(res.data.pagination || {});
    } catch {}
    setLoading(false);
  }, [page, filters]);

  useEffect(() => { load(); }, [load]);

  const updateFilter = (k, v) => { setFilters((p) => ({ ...p, [k]: v })); setPage(1); };

  const ACTION_TYPES = [
    'user_login','user_logout','user_registered','user_approved','user_rejected',
    'user_deactivated','admin_created','project_created','project_approved',
    'project_rejected','message_sent','file_upload','task_created','task_status_updated',
    'kpi_recorded','kpi_threshold_updated',
  ];

  const formatAction = (action) =>
    action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <DashboardLayout title="Audit Logs" subtitle="Complete tamper-proof action history">
      {/* Filters */}
      <div className="card" style={{ padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '0.75rem', alignItems: 'flex-end' }}>
          <div>
            <label className="form-label">Action Type</label>
            <select className="form-input" value={filters.actionType} onChange={(e) => updateFilter('actionType', e.target.value)}>
              <option value="">All actions</option>
              {ACTION_TYPES.map((a) => <option key={a} value={a}>{formatAction(a)}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">From Date</label>
            <input type="date" className="form-input" value={filters.dateFrom} onChange={(e) => updateFilter('dateFrom', e.target.value)} />
          </div>
          <div>
            <label className="form-label">To Date</label>
            <input type="date" className="form-input" value={filters.dateTo} onChange={(e) => updateFilter('dateTo', e.target.value)} />
          </div>
          <button className="btn btn-ghost" onClick={() => { setFilters({ actionType: '', dateFrom: '', dateTo: '', search: '' }); setPage(1); }}>
            Clear
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', fontSize: '0.82rem', color: 'var(--muted)' }}>
        <span>📊 Total records: <strong style={{ color: 'var(--ink)' }}>{pagination.total?.toLocaleString() || 0}</strong></span>
        <span>·</span>
        <span>Page {pagination.page} of {pagination.pages}</span>
        <span style={{ marginLeft: 'auto', fontSize: '0.72rem', fontStyle: 'italic' }}>
          Audit logs are read-only and tamper-proof.
        </span>
      </div>

      {/* Log table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem' }}>
          <span className="spinner spinner-dark" style={{ width: 32, height: 32 }} />
        </div>
      ) : logs.length === 0 ? (
        <div className="empty-state" style={{ padding: '5rem' }}>
          <div className="empty-icon">📋</div>
          <p>No records found for the selected criteria.</p>
        </div>
      ) : (
        <div className="card">
          {/* Table header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '40px 1.5fr 2fr 1.5fr 1.2fr',
            padding: '0.65rem 1.25rem',
            borderBottom: '1px solid var(--border)',
            fontSize: '0.7rem', fontWeight: 700,
            color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em',
          }}>
            <span></span>
            <span>Action</span>
            <span>Actor</span>
            <span>Target</span>
            <span>Timestamp</span>
          </div>

          {logs.map((log) => {
            const icon = ACTION_ICONS[log.action_type] || '📌';
            const isExpanded = expandedId === log.id;
            let meta = null;
            try { if (log.metadata) meta = JSON.parse(log.metadata); } catch {}

            return (
              <div key={log.id}>
                <div
                  style={{
                    display: 'grid', gridTemplateColumns: '40px 1.5fr 2fr 1.5fr 1.2fr',
                    padding: '0.75rem 1.25rem',
                    borderBottom: '1px solid var(--border)',
                    alignItems: 'center',
                    cursor: meta ? 'pointer' : 'default',
                    transition: 'background 0.1s',
                  }}
                  onClick={() => meta && setExpandedId(isExpanded ? null : log.id)}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#fafaf8'}
                  onMouseLeave={(e) => e.currentTarget.style.background = ''}
                >
                  <span style={{ fontSize: '1rem' }}>{icon}</span>

                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.83rem' }}>{formatAction(log.action_type)}</div>
                    {log.ip_address && (
                      <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginTop: '0.1rem', fontFamily: 'monospace' }}>
                        {log.ip_address}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {log.actor_name ? (
                      <>
                        <div className={`avatar avatar-sm avatar-${log.actor_team?.toLowerCase() || 'ca'}`}>
                          {log.avatar_initials || log.actor_team?.[0] || '?'}
                        </div>
                        <div>
                          <div style={{ fontSize: '0.83rem', fontWeight: 500 }}>{log.actor_name}</div>
                          <span className={`badge badge-${log.actor_team === 'CA' ? 'ca' : 'ds'}`} style={{ fontSize: '0.62rem' }}>{log.actor_team}</span>
                        </div>
                      </>
                    ) : (
                      <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>System</span>
                    )}
                  </div>

                  <div>
                    {log.target_name ? (
                      <>
                        <div style={{ fontSize: '0.82rem', fontWeight: 500 }}>{log.target_name}</div>
                        {log.target_type && (
                          <div style={{ fontSize: '0.68rem', color: 'var(--muted)', textTransform: 'capitalize' }}>{log.target_type}</div>
                        )}
                      </>
                    ) : <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>—</span>}
                  </div>

                  <div>
                    <div style={{ fontSize: '0.8rem' }}>{new Date(log.created_at).toLocaleDateString()}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                      {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </div>
                  </div>
                </div>

                {/* Expanded metadata */}
                {isExpanded && meta && (
                  <div style={{ padding: '0.75rem 1.25rem 0.75rem 72px', background: '#fafaf8', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--muted)', whiteSpace: 'pre-wrap' }}>
                      {JSON.stringify(meta, null, 2)}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1.5rem' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
            ← Prev
          </button>
          <span style={{ display: 'flex', alignItems: 'center', fontSize: '0.85rem', color: 'var(--muted)', padding: '0 0.5rem' }}>
            Page {page} of {pagination.pages}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))} disabled={page === pagination.pages}>
            Next →
          </button>
        </div>
      )}
    </DashboardLayout>
  );
};

export default AuditLogs;
