import React, { useEffect, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { adminAPI } from '../services/api';

const METRIC_INFO = {
  report_accuracy:           { label: 'Report Accuracy',          team: 'CA', unit: '%', desc: 'Percentage of financial reports with zero errors' },
  task_completion_rate:      { label: 'Task Completion Rate',     team: 'CA', unit: '%', desc: 'Ratio of completed tasks to total assigned' },
  audit_findings_resolved:   { label: 'Audit Findings Resolved',  team: 'CA', unit: '%', desc: 'Percentage of audit findings addressed within SLA' },
  model_accuracy:            { label: 'Model Accuracy',           team: 'DS', unit: '%', desc: 'Average prediction accuracy across deployed models' },
  pipeline_uptime:           { label: 'Pipeline Uptime',          team: 'DS', unit: '%', desc: 'Percentage of time data pipelines are operational' },
  prediction_delivery_rate:  { label: 'Prediction Delivery Rate', team: 'DS', unit: '%', desc: 'On-time delivery rate of model predictions' },
};

const KpiSettings = () => {

  const [editValues, setEditValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [successMsg, setSuccessMsg] = useState('');

  const load = async () => {
    try {
      const res = await adminAPI.getKpiThresholds();
      const th = res.data.thresholds || [];

      const vals = {};
      th.forEach((t) => { vals[`${t.metric_key}_${t.team}`] = t.min_value; });
      setEditValues(vals);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSave = async (metricKey, team) => {
    const key = `${metricKey}_${team}`;
    const val = editValues[key];
    if (val === undefined || val === '') return;
    setSaving(key);
    try {
      await adminAPI.updateKpiThreshold(metricKey, { minValue: val, team });
      setSuccessMsg(`${METRIC_INFO[metricKey]?.label || metricKey} threshold updated.`);
      setTimeout(() => setSuccessMsg(''), 3000);
      load();
    } catch (e) {
      alert(e.response?.data?.message || 'Failed to update.');
    }
    setSaving(null);
  };

  const caMetrics = Object.entries(METRIC_INFO).filter(([, v]) => v.team === 'CA');
  const dsMetrics = Object.entries(METRIC_INFO).filter(([, v]) => v.team === 'DS');

  const renderMetricRow = ([key, info]) => {
    const editKey = `${key}_${info.team}`;
    const isSaving = saving === editKey;
    return (
      <div key={key} style={{
        padding: '1rem 1.25rem',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: '1rem',
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{info.label}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.15rem' }}>{info.desc}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ position: 'relative' }}>
            <input
              type="number"
              min="0"
              max="100"
              step="0.5"
              className="form-input"
              style={{ width: 90, paddingRight: '1.8rem', textAlign: 'center' }}
              value={editValues[editKey] ?? ''}
              onChange={(e) => setEditValues((p) => ({ ...p, [editKey]: e.target.value }))}
            />
            <span style={{ position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.75rem', color: 'var(--muted)' }}>%</span>
          </div>
          <button
            className={`btn btn-sm btn-${info.team === 'CA' ? 'ca' : 'ds'}`}
            onClick={() => handleSave(key, info.team)}
            disabled={isSaving}
          >
            {isSaving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Save'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <DashboardLayout title="KPI Thresholds" subtitle="Configure performance benchmarks per team">
      {successMsg && <div className="alert alert-success" style={{ marginBottom: '1.25rem' }}>✓ {successMsg}</div>}

      <div className="alert alert-info" style={{ marginBottom: '1.5rem' }}>
        ℹ️ Members with any metric below its threshold will be automatically flagged on the KPI dashboard. Changes take effect immediately without code changes.
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem' }}>
          <span className="spinner spinner-dark" style={{ width: 32, height: 32 }} />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
          {/* CA Thresholds */}
          <div className="card">
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--ca)' }} />
                <h3>CA Team Thresholds</h3>
              </div>
              <span className="badge badge-ca">Chartered Accountants</span>
            </div>
            {caMetrics.map(renderMetricRow)}
          </div>

          {/* DS Thresholds */}
          <div className="card">
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--ds)' }} />
                <h3>DS Team Thresholds</h3>
              </div>
              <span className="badge badge-ds">Data Scientists</span>
            </div>
            {dsMetrics.map(renderMetricRow)}
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default KpiSettings;
