import React, { useEffect, useMemo, useState, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { useAuth } from '../context/AuthContext';
import { kpiAPI, conflictsAPI } from '../services/api';
import { Link } from 'react-router-dom';

const KPIPage = () => {
  const { user, isAdmin } = useAuth();
  const [tab, setTab] = useState('dashboard');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [teamView, setTeamView] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [conflictAlerts, setConflictAlerts] = useState([]);
  const [layoutEdit, setLayoutEdit] = useState(false);
  const [newKpi, setNewKpi] = useState({
    metricKey: '',
    metricValue: '',
    unit: '%',
    targetValue: '',
    domain: user?.team || 'CA',
    source: 'MANUAL',
    periodLabel: '',
  });
  const [insight, setInsight] = useState({ pairKey: '', note: '' });
  const [rec, setRec] = useState({ userId: '', recommendationText: '', advancementType: 'Promotion', evidence: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await kpiAPI.get({ teamView, projectId: projectId || undefined });
      setData(res.data);
      // Load conflicts
      try {
        const cParams = projectId ? { projectId } : {};
        const cRes = await conflictsAPI.list(cParams);
        setConflictAlerts(cRes.data?.conflicts?.filter(c => c.status !== 'RESOLVED') || []);
      } catch {}
    } finally {
      setLoading(false);
    }
  }, [teamView, projectId]);

  useEffect(() => { load(); }, [load]);

  const kpi = useMemo(() => data?.kpi || [], [data]);
  const projects = data?.projects || [];
  const performance = data?.performance || [];
  const recommendations = data?.recommendations || [];
  const layout = data?.layout || { widgets: [] };

  const paired = useMemo(() => {
    const ca = kpi.filter((x) => x.domain === 'CA');
    const ds = kpi.filter((x) => x.domain === 'DS');
    return ca.map((c) => {
      const d = ds.find((m) => m.period_label === c.period_label);
      if (!d) return null;
      const base = Number(c.metric_value) || 0;
      const delta = Number(d.metric_value) - base;
      const deltaPct = base === 0 ? 0 : (delta / base) * 100;
      return { c, d, delta, deltaPct };
    }).filter(Boolean);
  }, [kpi]);

  const saveLayout = async () => {
    await kpiAPI.saveLayout(layout);
    setLayoutEdit(false);
  };

  const addKpi = async () => {
    if (!newKpi.metricKey.trim()) {
      alert('Metric key is required.');
      return;
    }
    if (newKpi.metricValue === '' || Number.isNaN(Number(newKpi.metricValue))) {
      alert('Metric value must be a numeric value.');
      return;
    }
    if (!/^-?\d+(?:\.\d{1,4})?$/.test(String(newKpi.metricValue).trim())) {
      alert('Metric value must be numeric and allow up to 4 decimal places.');
      return;
    }
    if (!['CA', 'DS'].includes(newKpi.domain)) {
      alert('Please select a valid domain (CA or DS).');
      return;
    }

    try {
      const result = await kpiAPI.record({
        ...newKpi,
        projectId: projectId || null,
        metricValue: Number(newKpi.metricValue),
        targetValue: newKpi.targetValue ? Number(newKpi.targetValue) : null,
      });
      setNewKpi((p) => ({ ...p, metricKey: '', metricValue: '', targetValue: '' }));
      // Show conflict detection results
      if (result.data?.conflictsCreated > 0) {
        alert(`⚠️ ${result.data.conflictsCreated} CA-DS conflict(s) detected! Check the Conflicts tab in your project workspace.`);
      }
      load();
    } catch (err) {
      console.error('KPI save failed:', err);
      // Show pre-check violations if any
      if (err.response?.data?.precheck?.violations?.length > 0) {
        const violations = err.response.data.precheck.violations;
        alert(`🚫 Regulatory Pre-Check FAILED:\n${violations.map(v => `• ${v.fieldName}: ${v.description} (value: ${v.value}, threshold: ${v.threshold})`).join('\n')}`);
        return;
      }
      alert(
        err.response?.data?.message
        || err.response?.data?.errors?.[0]?.msg
        || err.message
        || 'Failed to save KPI entry.'
      );
    }
  };

  const addInsight = async () => {
    if (!projectId) {
      alert('Please select a project first.');
      return;
    }
    try {
      await kpiAPI.addInsight({
        ...insight,
        projectId,
        pairKey: insight.pairKey?.trim() || 'general_cross_domain_insight',
      });
      setInsight({ pairKey: '', note: '' });
      load();
    } catch (err) {
      const firstValidation = err.response?.data?.errors?.[0]?.msg;
      alert(firstValidation || err.response?.data?.message || 'Failed to save insight note.');
    }
  };

  const addRecommendation = async () => {
    try {
      await kpiAPI.addRecommendation({
        ...rec,
        evidence: rec.evidence.split(',').map((x) => x.trim()).filter(Boolean),
      });
      setRec({ userId: '', recommendationText: '', advancementType: 'Promotion', evidence: '' });
      load();
    } catch (err) {
      const firstValidation = err.response?.data?.errors?.[0]?.msg;
      alert(firstValidation || err.response?.data?.message || 'Failed to save recommendation.');
    }
  };

  const toggleWidget = (key) => {
    if (!layoutEdit) return;
    const next = layout.widgets.includes(key) ? layout.widgets.filter((w) => w !== key) : [...layout.widgets, key];
    setData((prev) => ({ ...prev, layout: { ...prev.layout, widgets: next } }));
  };

  if (loading) {
    return <DashboardLayout title="KPI Command Centre"><div style={{ padding: '4rem', textAlign: 'center' }}><span className="spinner spinner-dark" /></div></DashboardLayout>;
  }

  return (
    <DashboardLayout title="KPI Command Centre" subtitle="Role-aware cross-domain performance intelligence">
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        {['dashboard', 'cross-domain', 'performance'].map((t) => (
          <button key={t} className={`btn btn-sm ${tab === t ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(t)}>
            {t === 'dashboard' ? 'Dashboard Builder' : t === 'cross-domain' ? 'Cross-Domain Insights' : 'Team Performance'}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
        <select className="form-input" style={{ maxWidth: 280 }} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {isAdmin && (
          <button className={`btn btn-sm ${teamView ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTeamView((v) => !v)}>
            {teamView ? 'Team View: ON' : 'Team View: OFF'}
          </button>
        )}
      </div>

      {/* Conflict Alerts Banner */}
      {conflictAlerts.length > 0 && (
        <div style={{ background: 'linear-gradient(135deg, #fee2e2 0%, #fff1f2 100%)', border: '1.5px solid #fca5a5', borderRadius: 'var(--radius-lg)', padding: '1rem 1.5rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <strong style={{ color: 'var(--danger)' }}>⚠️ {conflictAlerts.length} Open CA-DS Conflict{conflictAlerts.length > 1 ? 's' : ''} Detected</strong>
          </div>
          {conflictAlerts.slice(0, 3).map((c, i) => (
            <Link key={c.id || i} to={`/projects/${c.project_id}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0.7rem', background: 'white', borderRadius: 'var(--radius-md)', marginBottom: '0.3rem', border: '1px solid #fecaca', fontSize: '0.8rem' }}>
              <span><strong>{c.field_name}</strong> {c.project_name && <span style={{ color: 'var(--muted)' }}>· {c.project_name}</span>}</span>
              <span style={{ padding: '0.1rem 0.4rem', borderRadius: '4px', background: 'var(--danger)', color: 'white', fontSize: '0.7rem' }}>Δ {Math.abs(Number(c.delta_percent)).toFixed(1)}%</span>
            </Link>
          ))}
          {conflictAlerts.length > 3 && <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.3rem' }}>+ {conflictAlerts.length - 3} more conflicts</div>}
        </div>
      )}

      {tab === 'dashboard' && (
        <>
          <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <strong>Widget Layout</strong>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-sm btn-ghost" onClick={() => setLayoutEdit((v) => !v)}>{layoutEdit ? 'Stop Editing' : 'Edit Layout'}</button>
                {layoutEdit && <button className="btn btn-sm btn-primary" onClick={saveLayout}>Save Layout</button>}
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {(user.team === 'CA'
                ? ['revenue_variance', 'cost_accuracy', 'budget_utilisation', 'compliance_score', 'model_accuracy', 'f1_score']
                : ['model_accuracy', 'f1_score', 'prediction_drift', 'pipeline_health', 'training_loss', 'budget_utilisation']
              ).map((w) => (
                <button
                  key={w}
                  className={`btn btn-sm ${layout.widgets.includes(w) ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => toggleWidget(w)}
                >
                  {layout.widgets.includes(w) ? '✓ ' : ''}{w}
                </button>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: '1rem' }}>
            <strong>Add KPI Entry</strong>
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.5fr 0.7fr 0.8fr 0.6fr 0.6fr', gap: '0.5rem', marginTop: '0.75rem' }}>
              <input className="form-input" placeholder="metric key (e.g. revenue)" value={newKpi.metricKey} onChange={(e) => setNewKpi((p) => ({ ...p, metricKey: e.target.value }))} />
              <input className="form-input" placeholder="value" type="number" value={newKpi.metricValue} onChange={(e) => setNewKpi((p) => ({ ...p, metricValue: e.target.value }))} />
              <input className="form-input" placeholder="unit" value={newKpi.unit} onChange={(e) => setNewKpi((p) => ({ ...p, unit: e.target.value }))} />
              <input className="form-input" placeholder="target" type="number" value={newKpi.targetValue} onChange={(e) => setNewKpi((p) => ({ ...p, targetValue: e.target.value }))} />
              <input className="form-input" placeholder="period (e.g. Q1-2026)" value={newKpi.periodLabel} onChange={(e) => setNewKpi((p) => ({ ...p, periodLabel: e.target.value }))} />
              <select className="form-input" value={newKpi.domain} onChange={(e) => setNewKpi((p) => ({ ...p, domain: e.target.value }))}><option value="CA">CA</option><option value="DS">DS</option></select>
              <button type="button" className="btn btn-ca" onClick={addKpi}>Add</button>
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '0.4rem' }}>💡 Use the same metric key for CA and DS entries to enable automatic conflict detection. Select a project above to link the KPI entry.</div>
          </div>

          <div className="card" style={{ padding: '1rem', marginTop: '1rem' }}>
            <strong>Recent KPI Entries</strong>
            <div style={{ marginTop: '0.75rem' }}>
              {kpi.length === 0 ? (
                <div style={{ color: 'var(--muted)' }}>No KPI entries found for this view yet.</div>
              ) : (
                kpi.slice(0, 20).map((row) => (
                  <div
                    key={row.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1.2fr 0.9fr 0.8fr 0.7fr 0.8fr',
                      gap: '0.6rem',
                      padding: '0.55rem 0',
                      borderBottom: '1px solid var(--border)',
                      fontSize: '0.82rem',
                    }}
                  >
                    <div>
                      <strong>{row.metric_key}</strong>
                      <div style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>
                        {row.full_name} ({row.team})
                      </div>
                    </div>
                    <div>{Number(row.metric_value).toFixed(2)} {row.unit || ''}</div>
                    <div>{row.domain}</div>
                    <div>{row.source}</div>
                    <div style={{ color: 'var(--muted)' }}>
                      {row.recorded_at ? new Date(row.recorded_at).toLocaleDateString() : '-'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {tab === 'cross-domain' && (
        <>
          {!projectId ? (
            <div className="alert alert-info">Select a project to open cross-domain KPI insights.</div>
          ) : (
            <>
              <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
                <strong>CA vs DS KPI Pairing</strong>
                <div style={{ marginTop: '0.75rem' }}>
                  {paired.length === 0 ? <div style={{ color: 'var(--muted)' }}>No paired KPI periods yet.</div> : paired.map((r, idx) => {
                    const level = Math.abs(r.deltaPct) <= 5 ? 'var(--success)' : Math.abs(r.deltaPct) <= 10 ? 'var(--warning)' : 'var(--danger)';
                    return (
                      <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '1rem', padding: '0.65rem 0', borderBottom: '1px solid var(--border)' }}>
                        <div>CA: {r.c.metric_key} = <strong>{Number(r.c.metric_value).toFixed(2)}</strong></div>
                        <div>DS: {r.d.metric_key} = <strong>{Number(r.d.metric_value).toFixed(2)}</strong></div>
                        <div style={{ color: level, fontWeight: 700 }}>{r.deltaPct.toFixed(1)}%</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="card" style={{ padding: '1rem' }}>
                <strong>Add Insight Note</strong>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: '0.5rem', marginTop: '0.75rem' }}>
                  <input className="form-input" placeholder="pair key (e.g., revenue_forecast_vs_actual)" value={insight.pairKey} onChange={(e) => setInsight((p) => ({ ...p, pairKey: e.target.value }))} />
                  <input className="form-input" placeholder="insight note" value={insight.note} onChange={(e) => setInsight((p) => ({ ...p, note: e.target.value }))} />
                  <button className="btn btn-primary" onClick={addInsight}>Save</button>
                </div>
                <div style={{ marginTop: '0.75rem' }}>
                  {(data.insights || []).map((n) => (
                    <div key={n.id} style={{ fontSize: '0.83rem', padding: '0.45rem 0', borderBottom: '1px solid var(--border)' }}>
                      <strong>{n.author_name}</strong> · {n.pair_key} · {n.note}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {tab === 'performance' && (
        <>
          <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
            <strong>{isAdmin && teamView ? 'Team Ranking' : 'My Performance'}</strong>
            <div style={{ marginTop: '0.75rem' }}>
              {performance.map((p) => (
                <div key={p.user_id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', padding: '0.55rem 0', borderBottom: '1px solid var(--border)' }}>
                  <div>{p.full_name} <span style={{ color: 'var(--muted)' }}>({p.team})</span></div>
                  <strong>{Number(p.performance_score || 0).toFixed(1)}</strong>
                </div>
              ))}
            </div>
          </div>

          {isAdmin && (
            <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
              <strong>Add Advancement Recommendation</strong>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr auto', gap: '0.5rem', marginTop: '0.75rem' }}>
                <select className="form-input" value={rec.userId} onChange={(e) => setRec((p) => ({ ...p, userId: e.target.value }))}>
                  <option value="">Select member</option>
                  {performance.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}
                </select>
                <input className="form-input" placeholder="recommendation text" value={rec.recommendationText} onChange={(e) => setRec((p) => ({ ...p, recommendationText: e.target.value }))} />
                <input className="form-input" placeholder="advancement type" value={rec.advancementType} onChange={(e) => setRec((p) => ({ ...p, advancementType: e.target.value }))} />
                <input className="form-input" placeholder="evidence keys comma-separated" value={rec.evidence} onChange={(e) => setRec((p) => ({ ...p, evidence: e.target.value }))} />
                <button className="btn btn-primary" onClick={addRecommendation}>Save</button>
              </div>
            </div>
          )}

          <div className="card" style={{ padding: '1rem' }}>
            <strong>Recommendation History</strong>
            <div style={{ marginTop: '0.75rem' }}>
              {recommendations.length === 0 ? (
                <div style={{ color: 'var(--muted)' }}>No recommendations yet.</div>
              ) : recommendations.map((r) => (
                <div key={r.id} style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                  <strong>{r.user_name}</strong> · {r.advancement_type} · <span style={{ color: 'var(--muted)' }}>by {r.recommended_by_name}</span>
                  <div style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>{r.recommendation_text}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </DashboardLayout>
  );
};

export default KPIPage;
