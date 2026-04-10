import React, { useEffect, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { kpiAPI } from '../services/api';

const METRIC_LABELS = {
  report_accuracy:          'Report Accuracy',
  task_completion_rate:     'Task Completion',
  audit_findings_resolved:  'Audit Resolved',
  model_accuracy:           'Model Accuracy',
  pipeline_uptime:          'Pipeline Uptime',
  prediction_delivery_rate: 'Delivery Rate',
};

const MemberCard = ({ name, initials, team, metrics, thresholds }) => {
  const isFlagged = metrics.some((m) => {
    const t = thresholds.find((th) => th.metric_key === m.metric_key && th.team === team);
    return t && Number(m.metric_value) < Number(t.min_value);
  });

  return (
    <div className="card" style={{ marginBottom: '0.75rem' }}>
      <div style={{
        padding: '0.85rem 1.1rem',
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        borderBottom: metrics.length ? '1px solid var(--border)' : 'none',
      }}>
        <div className={`avatar avatar-md avatar-${team.toLowerCase()}`}>{initials}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{name}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>{team} Team</div>
        </div>
        {isFlagged && (
          <span className="badge badge-danger" title="One or more metrics below threshold">
            ⚠️ Flagged
          </span>
        )}
      </div>
      {metrics.length > 0 ? (
        <div style={{ padding: '0.6rem 1.1rem' }}>
          {metrics.map((m) => {
            const t = thresholds.find((th) => th.metric_key === m.metric_key && th.team === team);
            const val = Number(m.metric_value);
            const below = t && val < Number(t.min_value);
            const pct = Math.min(100, val);
            return (
              <div key={m.metric_key} style={{ marginBottom: '0.6rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                  <span style={{ color: 'var(--muted)' }}>{METRIC_LABELS[m.metric_key] || m.metric_key}</span>
                  <span style={{ fontWeight: 700, color: below ? 'var(--danger)' : 'var(--success)' }}>{val.toFixed(1)}%</span>
                </div>
                <div style={{ height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 3,
                    width: `${pct}%`,
                    background: below ? 'var(--danger)' : team === 'CA' ? 'var(--ca)' : 'var(--ds)',
                    transition: 'width 0.4s ease',
                  }} />
                </div>
                {t && <div style={{ fontSize: '0.67rem', color: 'var(--muted)', marginTop: '0.15rem' }}>Threshold: {Number(t.min_value).toFixed(0)}%</div>}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ padding: '0.75rem 1.1rem', fontSize: '0.8rem', color: 'var(--muted)' }}>No data available</div>
      )}
    </div>
  );
};

const KPIPage = () => {

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    kpiAPI.get().then((r) => { setData(r.data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return (
    <DashboardLayout title="KPI Command Centre">
      <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
        <span className="spinner spinner-dark" style={{ width: 32, height: 32 }} />
      </div>
    </DashboardLayout>
  );

  if (!data) return (
    <DashboardLayout title="KPI Command Centre">
      <div className="alert alert-error">KPI data could not be loaded. Please try again later.</div>
    </DashboardLayout>
  );

  // Group by user
  const byUser = {};
  (data.kpi || []).forEach((k) => {
    if (!byUser[k.user_id]) byUser[k.user_id] = { name: k.full_name, initials: k.avatar_initials, team: k.team, metrics: [] };
    byUser[k.user_id].metrics.push(k);
  });

  const caUsers = Object.values(byUser).filter((u) => u.team === 'CA');
  const dsUsers = Object.values(byUser).filter((u) => u.team === 'DS');
  const thresholds = data.thresholds || [];
  const collab = data.collaboration || {};

  return (
    <DashboardLayout title="KPI Command Centre" subtitle="Team performance metrics">
      {/* Cross-domain stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.75rem' }}>
        {[
          { label: 'Active Projects',    value: collab.active_projects    || 0, icon: '🚀', color: 'var(--ca)' },
          { label: 'Completed Projects', value: collab.completed_projects || 0, icon: '✅', color: 'var(--success)' },
          { label: 'Total Projects',     value: collab.total_projects     || 0, icon: '📊', color: 'var(--muted)' },
        ].map((s) => (
          <div key={s.label} className="card" style={{ padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '1.75rem' }}>{s.icon}</span>
            <div>
              <div style={{ fontFamily: 'Syne', fontSize: '1.75rem', fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '0.25rem' }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Side-by-side CA / DS */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        {/* CA Panel */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--ca)' }} />
            <h3 style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: '1rem' }}>CA Team</h3>
            <span className="badge badge-ca">{caUsers.length} members</span>
          </div>
          {caUsers.length === 0 ? (
            <div className="empty-state"><div className="empty-icon">📭</div><p>No CA KPI data yet</p></div>
          ) : caUsers.map((u) => (
            <MemberCard key={u.name} {...u} thresholds={thresholds} />
          ))}
        </div>

        {/* DS Panel */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--ds)' }} />
            <h3 style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: '1rem' }}>DS Team</h3>
            <span className="badge badge-ds">{dsUsers.length} members</span>
          </div>
          {dsUsers.length === 0 ? (
            <div className="empty-state"><div className="empty-icon">📭</div><p>No DS KPI data yet</p></div>
          ) : dsUsers.map((u) => (
            <MemberCard key={u.name} {...u} thresholds={thresholds} />
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default KPIPage;
