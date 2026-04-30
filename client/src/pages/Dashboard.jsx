import React, { useEffect, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { useAuth } from '../context/AuthContext';
import { projectsAPI, tasksAPI, kpiAPI, conflictsAPI } from '../services/api';
import { Link } from 'react-router-dom';

const StatCard = ({ label, value, sub, color, icon }) => (
  <div className="card" style={{ padding: '1.4rem 1.5rem' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div>
        <div style={{ fontSize: '0.78rem', color: 'var(--muted)', fontWeight: 600, marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
        <div style={{ fontFamily: 'Syne', fontSize: '2rem', fontWeight: 800, color: color || 'var(--ink)', lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.4rem' }}>{sub}</div>}
      </div>
      <span style={{ fontSize: '1.5rem', opacity: 0.6 }}>{icon}</span>
    </div>
  </div>
);

const Dashboard = () => {
  const { user, isCA, accentColor } = useAuth();
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [kpi, setKpi] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [pRes, tRes, kRes] = await Promise.all([
          projectsAPI.list({ status: 'active' }),
          tasksAPI.list({ assignedTo: user.id }),
          kpiAPI.get(),
        ]);
        setProjects(pRes.data.projects || []);
        setTasks(tRes.data.tasks || []);
        setKpi(kRes.data);
        // Fetch all open conflicts in one call
        try {
          const cRes = await conflictsAPI.list({ status: 'OPEN' });
          setConflicts(cRes.data?.conflicts || []);
        } catch {}
      } catch {}
      setLoading(false);
    };
    load();
  }, [user.id]);

  const myTasks = tasks.filter((t) => t.status !== 'done');
  const overdueTasks = myTasks.filter((t) => t.due_date && new Date(t.due_date) < new Date());

  // My KPI metrics
  const myKpi = kpi?.kpi?.filter((k) => k.user_id === user.id) || [];
  const avgMetric = myKpi.length
    ? Math.round(myKpi.reduce((a, k) => a + Number(k.metric_value), 0) / myKpi.length)
    : null;

  const recentActivity = [
    ...projects.slice(0, 3).map((p) => ({ type: 'project', label: p.name, time: p.created_at, icon: '🚀' })),
    ...tasks.slice(0, 3).map((t) => ({ type: 'task', label: t.title, time: t.created_at, icon: t.status === 'done' ? '✅' : '📋' })),
  ].sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 6);

  return (
    <DashboardLayout title="Dashboard" subtitle={`${user.firmName} · ${isCA ? 'CA' : 'DS'} Team`}>
      {/* Welcome banner */}
      <div style={{
        background: `linear-gradient(135deg, ${accentColor}15 0%, ${accentColor}05 100%)`,
        border: `1.5px solid ${accentColor}25`,
        borderRadius: 'var(--radius-lg)',
        padding: '1.5rem 2rem',
        marginBottom: '1.5rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <h3 style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.25rem' }}>
            Welcome back, {user.fullName?.split(' ')[0]} 👋
          </h3>
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
            {user.designation} · {user.firmName}
          </p>
        </div>
        <div className={`badge badge-${isCA ? 'ca' : 'ds'}`} style={{ fontSize: '0.8rem', padding: '0.35rem 0.9rem' }}>
          {isCA ? '📒 CA' : '🔬 DS'} {user.role === 'admin' ? 'Admin' : 'Member'}
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        <StatCard label="Active Projects" value={projects.length} sub="shared workspaces" icon="🚀" color={accentColor} />
        <StatCard label="My Open Tasks" value={myTasks.length} sub={overdueTasks.length > 0 ? `${overdueTasks.length} overdue` : 'on track'} icon="📋" color={overdueTasks.length > 0 ? 'var(--danger)' : undefined} />
        <StatCard label="My Avg KPI" value={avgMetric !== null ? `${avgMetric}%` : '–'} sub="across all metrics" icon="📊" />
        <StatCard label="Open Conflicts" value={conflicts.length} sub={conflicts.length > 0 ? 'needs resolution' : 'all clear'} icon="⚔️" color={conflicts.length > 0 ? 'var(--danger)' : 'var(--success)'} />
        <StatCard label="Collab Score" value={`${kpi?.collaboration?.active_projects || 0}`} sub="active cross-team projects" icon="🤝" color="var(--success)" />
      </div>

      {/* Conflict Alerts */}
      {conflicts.length > 0 && (
        <div style={{
          background: 'linear-gradient(135deg, #1e1b4b 0%, #4c1d95 50%, #7c3aed 100%)',
          borderRadius: 'var(--radius-lg)',
          padding: '1.25rem 1.5rem',
          marginBottom: '1.5rem',
          boxShadow: '0 8px 32px rgba(124, 58, 237, 0.25)',
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', top: -30, right: -30, width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(239,68,68,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: '1.1rem' }}>⚠️</span>
              </div>
              <div>
                <h3 style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: '1.05rem', color: '#fff', margin: 0 }}>
                  {conflicts.length} Active CA-DS Conflict{conflicts.length > 1 ? 's' : ''} Detected
                </h3>
                <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.6)' }}>Requires immediate attention from both teams</div>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', position: 'relative' }}>
            {conflicts.slice(0, 4).map((c, i) => {
              const sevColor = c.severity === 'CRITICAL' ? '#ef4444' : c.severity === 'HIGH' ? '#f97316' : c.severity === 'MEDIUM' ? '#eab308' : '#3b82f6';
              return (
                <Link key={c.id || i} to={`/projects/${c.project_id}`} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '0.6rem 0.85rem', background: 'rgba(255,255,255,0.08)',
                  borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)',
                  fontSize: '0.82rem', color: '#fff', transition: 'all 0.2s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: sevColor, boxShadow: `0 0 8px ${sevColor}` }} />
                    <div>
                      <strong>{c.field_name}</strong>
                      {c.project_name && <span style={{ color: 'rgba(255,255,255,0.5)', marginLeft: '0.4rem', fontSize: '0.75rem' }}>· {c.project_name}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)' }}>DS: {Number(c.ds_value).toLocaleString()} → CA: {Number(c.ca_actual_value).toLocaleString()}</span>
                    <span style={{ padding: '0.2rem 0.55rem', borderRadius: '12px', background: sevColor, color: '#fff', fontSize: '0.68rem', fontWeight: 700 }}>
                      Δ {Math.abs(Number(c.delta_percent)).toFixed(1)}%
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
          {conflicts.length > 4 && <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.5)', marginTop: '0.5rem', textAlign: 'center' }}>+ {conflicts.length - 4} more conflicts</div>}
        </div>
      )}

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '1.25rem' }}>
        {/* Active projects */}
        <div className="card">
          <div className="card-header">
            <h3>Active Projects</h3>
            <Link to="/projects" style={{ fontSize: '0.78rem', color: 'var(--ca)', fontWeight: 600 }}>View all →</Link>
          </div>
          <div className="card-body" style={{ padding: '0.5rem 0' }}>
            {loading ? (
              <div style={{ padding: '2rem', textAlign: 'center' }}><span className="spinner spinner-dark" /></div>
            ) : projects.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🚀</div>
                <p>No active projects yet.<br />Click "Start New Project" to begin.</p>
              </div>
            ) : projects.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0.85rem 1.4rem',
                borderBottom: '1px solid var(--border)',
                transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--paper)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{p.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.1rem' }}>
                    by {p.initiated_by_name} · {p.initiated_by_team}
                  </div>
                </div>
                <span className="badge badge-success">Active</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Recent activity */}
        <div className="card">
          <div className="card-header">
            <h3>Recent Activity</h3>
          </div>
          <div className="card-body" style={{ padding: '0.5rem 0' }}>
            {recentActivity.length === 0 ? (
              <div className="empty-state" style={{ padding: '2rem' }}>
                <div className="empty-icon">📭</div>
                <p>No recent activity</p>
              </div>
            ) : recentActivity.map((a, i) => (
              <div key={i} style={{ padding: '0.75rem 1.2rem', borderBottom: '1px solid var(--border)', display: 'flex', gap: '0.65rem', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '1rem', marginTop: '0.1rem' }}>{a.icon}</span>
                <div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 500 }}>{a.label}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                    {new Date(a.time).toLocaleDateString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Dashboard;
