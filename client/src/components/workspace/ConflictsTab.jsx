import React, { useState, useEffect, useCallback } from 'react';
import { conflictsAPI } from '../../services/api';

const ConflictsTab = ({ projectId, user, onNotify }) => {
  const [conflicts, setConflicts] = useState([]);
  const [rules, setRules] = useState([]);
  const [settings, setSettings] = useState({ slaDays: 5 });
  const [trendReport, setTrendReport] = useState(null);
  const [view, setView] = useState('list'); // list, rules, trend
  const [selected, setSelected] = useState(null);
  const [rootCause, setRootCause] = useState({ category:'', note:'' });
  const [caResp, setCaResp] = useState({ type:'', note:'' });
  const [recon, setRecon] = useState('');
  const [newRule, setNewRule] = useState({ dsField:'', caField:'', acceptableVariancePercent:5, severity:'MEDIUM', isRegulatoryField:false, projectId:'' });
  const [detectData, setDetectData] = useState({ dsJson:'{}', caJson:'{}' });
  const isAdmin = ['admin','platform_admin','super_admin'].includes(user?.role);
  const isDS = user?.team === 'DS';
  const isCA = user?.team === 'CA';

  const load = useCallback(async () => {
    try {
      const [cRes, rRes] = await Promise.all([
        conflictsAPI.list({ projectId }),
        conflictsAPI.listRules({ projectId })
      ]);
      const newConflicts = cRes.data?.conflicts || [];
      setConflicts(newConflicts);
      setRules(rRes.data?.rules || []);

      // Refresh selected conflict with latest data (don't lose panel state)
      if (selected) {
        const freshSelected = newConflicts.find(c => c.id === selected.id);
        if (freshSelected) {
          setSelected(freshSelected);
        }
      }

      if (isAdmin) {
        try { const s = await conflictsAPI.getSettings(); setSettings(s.data?.settings || { slaDays:5 }); } catch {}
      }
    } catch { onNotify('error', 'Failed to load conflicts'); }
  }, [projectId, selected, isAdmin, onNotify]);

  useEffect(() => { load(); }, [load]);

  // Helper to update selected with server response
  const updateSelected = (conflict) => {
    if (conflict) {
      setSelected(conflict);
    }
  };

  const runDetection = async () => {
    try {
      const ds = JSON.parse(detectData.dsJson);
      const ca = JSON.parse(detectData.caJson);
      const r = await conflictsAPI.detect({ projectId, dsData: ds, caData: ca });
      onNotify('success', `Detection complete: ${r.data?.detected || 0} conflicts found`);
      load();
    } catch (e) { onNotify('error', 'Detection failed — check JSON format'); }
  };

  const submitRootCause = async () => {
    try {
      const r = await conflictsAPI.addRootCause(selected.id, { rootCauseCategory: rootCause.category, rootCauseNote: rootCause.note });
      onNotify('success', 'Root cause saved');
      // Update selected with server response instead of closing panel
      if (r.data?.conflict) {
        updateSelected(r.data.conflict);
      }
      setRootCause({ category:'', note:'' });
      load();
    } catch { onNotify('error', 'Failed — note must be ≥50 chars'); }
  };

  const submitCAResponse = async () => {
    try {
      const r = await conflictsAPI.addCAResponse(selected.id, { responseType: caResp.type, responseNote: caResp.note });
      onNotify('success', 'CA response saved');
      if (r.data?.conflict) {
        updateSelected(r.data.conflict);
      }
      setCaResp({ type:'', note:'' });
      load();
    } catch { onNotify('error', 'Failed to save response'); }
  };

  const submitReconciliation = async () => {
    try {
      const r = await conflictsAPI.setReconciliation(selected.id, { reconciliationDecision: recon });
      onNotify('success', 'Reconciliation saved');
      if (r.data?.conflict) {
        updateSelected(r.data.conflict);
      }
      setRecon('');
      load();
    } catch { onNotify('error', 'Failed to save reconciliation'); }
  };

  const confirmResolution = async () => {
    try {
      const r = await conflictsAPI.confirmResolution(selected.id);
      onNotify('success', 'Confirmed!');
      if (r.data?.conflict) {
        updateSelected(r.data.conflict);
      }
      load();
    } catch { onNotify('error', 'Confirmation failed'); }
  };

  const createRule = async () => {
    try {
      await conflictsAPI.createRule({ ...newRule, projectId: newRule.projectId || projectId });
      onNotify('success', 'Rule created'); load();
      setNewRule({ dsField:'', caField:'', acceptableVariancePercent:5, severity:'MEDIUM', isRegulatoryField:false, projectId:'' });
    } catch { onNotify('error', 'Failed to create rule'); }
  };

  const deleteRule = async (id) => {
    try { await conflictsAPI.deleteRule(id); onNotify('success', 'Rule deleted'); load(); }
    catch { onNotify('error', 'Failed to delete rule'); }
  };

  const loadTrend = async () => {
    try { const r = await conflictsAPI.getTrendReport({ projectId }); setTrendReport(r.data?.report); setView('trend'); }
    catch { onNotify('error', 'Failed to load trend report'); }
  };

  const saveSLA = async () => {
    try { await conflictsAPI.updateSettings({ slaDays: settings.slaDays }); onNotify('success', 'SLA updated'); }
    catch { onNotify('error', 'Failed to update SLA'); }
  };

  const sevColor = { LOW:'var(--info)', MEDIUM:'var(--warning)', HIGH:'orange', CRITICAL:'var(--danger)' };
  const statusColor = { OPEN:'var(--danger)', IN_RESOLUTION:'var(--warning)', ESCALATED:'orange', RESOLVED:'var(--success)' };

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display:'flex', gap:'0.5rem', marginBottom:'1rem', flexWrap:'wrap', alignItems:'center' }}>
        <button className={`btn btn-sm ${view==='list'?'btn-primary':'btn-ghost'}`} onClick={()=>setView('list')}>⚔️ Conflicts ({conflicts.filter(c=>c.status!=='RESOLVED').length})</button>
        {isAdmin && <button className={`btn btn-sm ${view==='rules'?'btn-primary':'btn-ghost'}`} onClick={()=>setView('rules')}>⚙️ Rules ({rules.length})</button>}
        {isAdmin && <button className={`btn btn-sm ${view==='trend'?'btn-primary':'btn-ghost'}`} onClick={loadTrend}>📊 Trend Report</button>}
        {isAdmin && <button className={`btn btn-sm ${view==='settings'?'btn-primary':'btn-ghost'}`} onClick={()=>setView('settings')}>⏱ SLA Settings</button>}
        <button className={`btn btn-sm ${view==='detect'?'btn-ca':'btn-ghost'}`} onClick={()=>setView('detect')}>🔍 Run Detection</button>
      </div>

      {/* CONFLICT LIST */}
      {view==='list' && (
        <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
          {conflicts.length===0 ? (
            <div style={{ textAlign:'center', padding:'3rem', color:'var(--muted)' }}>✅ No conflicts detected</div>
          ) : conflicts.map(c => (
            <div key={c.id} onClick={()=>setSelected(c)} style={{ background:selected?.id===c.id?'var(--ca-light)':'white', border:'1.5px solid var(--border)', borderRadius:'var(--radius-md)', padding:'0.75rem', cursor:'pointer', borderLeft:`4px solid ${statusColor[c.status]}` }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <strong style={{ fontSize:'0.85rem' }}>{c.field_name}</strong>
                  <span style={{ marginLeft:'0.5rem', fontSize:'0.7rem', padding:'0.15rem 0.4rem', borderRadius:'4px', background:sevColor[c.severity], color:'white' }}>{c.severity}</span>
                </div>
                <span style={{ fontSize:'0.75rem', padding:'0.15rem 0.5rem', borderRadius:'4px', background:statusColor[c.status], color:'white' }}>{c.status}</span>
              </div>
              <div style={{ fontSize:'0.75rem', color:'var(--muted)', marginTop:'0.3rem' }}>
                DS: {c.ds_value} | CA: {c.ca_actual_value} | Δ {Number(c.delta_percent).toFixed(1)}% {c.period_label && `| ${c.period_label}`}
              </div>
            </div>
          ))}

          {/* Resolution Panel */}
          {selected && (
            <div style={{ background:'white', border:'1.5px solid var(--ca)', borderRadius:'var(--radius-lg)', padding:'1rem', marginTop:'0.5rem' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.75rem' }}>
                <h4 style={{ fontFamily:'Syne', margin:0 }}>Resolution Workflow — {selected.field_name}</h4>
                <button className="btn btn-xs btn-ghost" onClick={()=>setSelected(null)} style={{ fontSize:'1rem' }}>✕</button>
              </div>

              {/* Progress indicator */}
              <div style={{ display:'flex', gap:'0.25rem', marginBottom:'1rem' }}>
                {['Root Cause','CA Response','Reconciliation','Confirmation'].map((step, i) => {
                  const done = [
                    !!selected.root_cause_category,
                    !!selected.ca_response_type,
                    !!selected.reconciliation_decision,
                    selected.status === 'RESOLVED'
                  ][i];
                  return (
                    <div key={step} style={{ flex:1, textAlign:'center' }}>
                      <div style={{ height:4, borderRadius:2, background: done ? 'var(--success)' : 'var(--border)', marginBottom:'0.25rem' }} />
                      <div style={{ fontSize:'0.65rem', color: done ? 'var(--success)' : 'var(--muted)' }}>{done ? '✅' : `${i+1}.`} {step}</div>
                    </div>
                  );
                })}
              </div>

              {/* Step 1: Root Cause (DS) */}
              <div style={{ marginBottom:'1rem', padding:'0.75rem', background:'var(--paper)', borderRadius:'var(--radius-md)' }}>
                <strong style={{ fontSize:'0.85rem' }}>Step 1: Root Cause Analysis {selected.root_cause_category ? '✅' : '(DS)'}</strong>
                {selected.root_cause_category ? (
                  <div style={{ fontSize:'0.8rem', marginTop:'0.3rem' }}><em>{selected.root_cause_category}</em>: {selected.root_cause_note}</div>
                ) : (isDS || isAdmin) ? (
                  <div style={{ marginTop:'0.5rem' }}>
                    <select className="form-input" value={rootCause.category} onChange={e=>setRootCause(p=>({...p,category:e.target.value}))} style={{ marginBottom:'0.4rem' }}>
                      <option value="">Select category...</option>
                      {['MODEL_ASSUMPTION_ERROR','DATA_SOURCE_MISMATCH','SCHEMA_CHANGE','CA_DATA_ENTRY_ERROR','EXTERNAL_MARKET_CHANGE','OTHER'].map(c=><option key={c} value={c}>{c.replace(/_/g,' ')}</option>)}
                    </select>
                    <textarea className="form-input" rows={2} placeholder="Root cause explanation (min 50 chars)..." value={rootCause.note} onChange={e=>setRootCause(p=>({...p,note:e.target.value}))} />
                    <button className="btn btn-ds btn-sm" style={{ marginTop:'0.4rem' }} onClick={submitRootCause} disabled={!rootCause.category||rootCause.note.length<50}>Submit</button>
                  </div>
                ) : <div style={{ fontSize:'0.8rem', color:'var(--muted)', marginTop:'0.3rem' }}>Awaiting DS input</div>}
              </div>

              {/* Step 2: CA Response */}
              <div style={{ marginBottom:'1rem', padding:'0.75rem', background:'var(--paper)', borderRadius:'var(--radius-md)' }}>
                <strong style={{ fontSize:'0.85rem' }}>Step 2: CA Response {selected.ca_response_type ? '✅' : '(CA)'}</strong>
                {selected.ca_response_type ? (
                  <div style={{ fontSize:'0.8rem', marginTop:'0.3rem' }}><em>{selected.ca_response_type}</em>: {selected.ca_response_note}</div>
                ) : (isCA || isAdmin) && selected.root_cause_category ? (
                  <div style={{ marginTop:'0.5rem' }}>
                    <div style={{ display:'flex', gap:'0.5rem', marginBottom:'0.4rem' }}>
                      {['CONFIRM','DISPUTE','ESCALATE'].map(t => (
                        <button key={t} className={`btn btn-xs ${caResp.type===t?'btn-primary':'btn-ghost'}`} onClick={()=>setCaResp(p=>({...p,type:t}))}>{t}</button>
                      ))}
                    </div>
                    <textarea className="form-input" rows={2} placeholder="Response note..." value={caResp.note} onChange={e=>setCaResp(p=>({...p,note:e.target.value}))} />
                    <button className="btn btn-ca btn-sm" style={{ marginTop:'0.4rem' }} onClick={submitCAResponse} disabled={!caResp.type||caResp.note.length<5}>Submit</button>
                  </div>
                ) : <div style={{ fontSize:'0.8rem', color:'var(--muted)', marginTop:'0.3rem' }}>{selected.root_cause_category ? 'Awaiting CA input' : 'Waiting for root cause first'}</div>}
              </div>

              {/* Step 3: Reconciliation */}
              <div style={{ marginBottom:'1rem', padding:'0.75rem', background:'var(--paper)', borderRadius:'var(--radius-md)' }}>
                <strong style={{ fontSize:'0.85rem' }}>Step 3: Reconciliation {selected.reconciliation_decision ? '✅' : ''}</strong>
                {selected.reconciliation_decision ? (
                  <div style={{ fontSize:'0.8rem', marginTop:'0.3rem' }}>{selected.reconciliation_decision}</div>
                ) : selected.ca_response_type ? (
                  <div style={{ marginTop:'0.5rem' }}>
                    <textarea className="form-input" rows={2} placeholder="Reconciliation decision..." value={recon} onChange={e=>setRecon(e.target.value)} />
                    <button className="btn btn-primary btn-sm" style={{ marginTop:'0.4rem' }} onClick={submitReconciliation} disabled={recon.length<5}>Save Decision</button>
                  </div>
                ) : <div style={{ fontSize:'0.8rem', color:'var(--muted)', marginTop:'0.3rem' }}>Waiting for CA response</div>}
              </div>

              {/* Step 4: Mutual Confirmation */}
              <div style={{ padding:'0.75rem', background:'var(--paper)', borderRadius:'var(--radius-md)' }}>
                <strong style={{ fontSize:'0.85rem' }}>Step 4: Confirmation (CA: {selected.ca_confirmed?'✅':'⏳'} DS: {selected.ds_confirmed?'✅':'⏳'})</strong>
                {selected.reconciliation_decision && selected.status !== 'RESOLVED' && (
                  <button className="btn btn-primary btn-sm" style={{ marginTop:'0.5rem', display:'block' }} onClick={confirmResolution}>
                    ✅ Confirm Resolution ({user?.team || 'Admin'})
                  </button>
                )}
                {selected.status === 'RESOLVED' && <div style={{ color:'var(--success)', fontWeight:600, marginTop:'0.3rem' }}>✅ RESOLVED</div>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* RULES VIEW */}
      {view==='rules' && isAdmin && (
        <div>
          <div style={{ background:'var(--paper)', borderRadius:'var(--radius-lg)', padding:'1rem', marginBottom:'1rem' }}>
            <h4 style={{ marginBottom:'0.75rem' }}>Add Detection Rule</h4>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'0.5rem', marginBottom:'0.5rem' }}>
              <input className="form-input" placeholder="DS Field" value={newRule.dsField} onChange={e=>setNewRule(p=>({...p,dsField:e.target.value}))} />
              <input className="form-input" placeholder="CA Field" value={newRule.caField} onChange={e=>setNewRule(p=>({...p,caField:e.target.value}))} />
              <input className="form-input" type="number" placeholder="Variance %" value={newRule.acceptableVariancePercent} onChange={e=>setNewRule(p=>({...p,acceptableVariancePercent:Number(e.target.value)}))} />
            </div>
            <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
              <select className="form-input" value={newRule.severity} onChange={e=>setNewRule(p=>({...p,severity:e.target.value}))}>
                {['LOW','MEDIUM','HIGH','CRITICAL'].map(s=><option key={s}>{s}</option>)}
              </select>
              <label style={{ fontSize:'0.8rem', display:'flex', alignItems:'center', gap:'0.3rem' }}>
                <input type="checkbox" checked={newRule.isRegulatoryField} onChange={e=>setNewRule(p=>({...p,isRegulatoryField:e.target.checked}))} /> Regulatory
              </label>
              <button className="btn btn-ca btn-sm" onClick={createRule} disabled={!newRule.dsField||!newRule.caField}>Create Rule</button>
            </div>
          </div>
          {rules.map(r => (
            <div key={r.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.6rem', background:'white', border:'1px solid var(--border)', borderRadius:'var(--radius-sm)', marginBottom:'0.4rem' }}>
              <div style={{ fontSize:'0.8rem' }}><strong>{r.ds_field}</strong> vs <strong>{r.ca_field}</strong> — ±{r.acceptable_variance_percent}% — {r.severity} {r.is_regulatory_field ? '🏛️' : ''}</div>
              <button className="btn btn-xs btn-ghost" style={{ color:'var(--danger)' }} onClick={()=>deleteRule(r.id)}>Delete</button>
            </div>
          ))}
        </div>
      )}

      {/* DETECT VIEW */}
      {view==='detect' && (
        <div style={{ background:'var(--paper)', borderRadius:'var(--radius-lg)', padding:'1rem' }}>
          <h4 style={{ marginBottom:'0.75rem' }}>Run Discrepancy Detection</h4>
          <p style={{ fontSize:'0.8rem', color:'var(--muted)', marginBottom:'0.75rem' }}>Enter DS projections and CA actuals as JSON to detect variances beyond configured thresholds.</p>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem', marginBottom:'0.75rem' }}>
            <div>
              <label className="form-label">DS Projections (JSON)</label>
              <textarea className="form-input" rows={4} style={{ fontFamily:'monospace', fontSize:'0.8rem' }} value={detectData.dsJson} onChange={e=>setDetectData(p=>({...p,dsJson:e.target.value}))} placeholder='{"revenue": 1000000}' />
            </div>
            <div>
              <label className="form-label">CA Actuals (JSON)</label>
              <textarea className="form-input" rows={4} style={{ fontFamily:'monospace', fontSize:'0.8rem' }} value={detectData.caJson} onChange={e=>setDetectData(p=>({...p,caJson:e.target.value}))} placeholder='{"revenue": 950000}' />
            </div>
          </div>
          <button className="btn btn-ca" onClick={runDetection}>🔍 Run Detection</button>
        </div>
      )}

      {/* TREND REPORT */}
      {view==='trend' && trendReport && (
        <div>
          <div style={{ display:'flex', gap:'1rem', marginBottom:'1rem', flexWrap:'wrap' }}>
            <div style={{ flex:1, background:'white', border:'1px solid var(--border)', borderRadius:'var(--radius-md)', padding:'1rem', textAlign:'center' }}>
              <div style={{ fontSize:'1.5rem', fontWeight:700, color:'var(--ca)' }}>{trendReport.summary?.total_conflicts||0}</div>
              <div style={{ fontSize:'0.75rem', color:'var(--muted)' }}>Total Conflicts</div>
            </div>
            <div style={{ flex:1, background:'white', border:'1px solid var(--border)', borderRadius:'var(--radius-md)', padding:'1rem', textAlign:'center' }}>
              <div style={{ fontSize:'1.5rem', fontWeight:700, color:'var(--success)' }}>{trendReport.summary?.resolved||0}</div>
              <div style={{ fontSize:'0.75rem', color:'var(--muted)' }}>Resolved</div>
            </div>
            <div style={{ flex:1, background:'white', border:'1px solid var(--border)', borderRadius:'var(--radius-md)', padding:'1rem', textAlign:'center' }}>
              <div style={{ fontSize:'1.5rem', fontWeight:700, color:'var(--ds)' }}>{Math.round(trendReport.summary?.avg_resolution_hours||0)}h</div>
              <div style={{ fontSize:'0.75rem', color:'var(--muted)' }}>Avg Resolution</div>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem' }}>
            <div style={{ background:'white', border:'1px solid var(--border)', borderRadius:'var(--radius-md)', padding:'1rem' }}>
              <h5 style={{ marginBottom:'0.5rem' }}>By Category</h5>
              {(trendReport.byCategory||[]).map((c,i) => (
                <div key={i} style={{ display:'flex', justifyContent:'space-between', fontSize:'0.8rem', padding:'0.3rem 0', borderBottom:'1px solid var(--border)' }}>
                  <span>{c.category}</span><strong>{c.total}</strong>
                </div>
              ))}
            </div>
            <div style={{ background:'white', border:'1px solid var(--border)', borderRadius:'var(--radius-md)', padding:'1rem' }}>
              <h5 style={{ marginBottom:'0.5rem' }}>Repeat Fields</h5>
              {(trendReport.repeatFields||[]).map((f,i) => (
                <div key={i} style={{ display:'flex', justifyContent:'space-between', fontSize:'0.8rem', padding:'0.3rem 0', borderBottom:'1px solid var(--border)' }}>
                  <span>{f.field_name}</span><strong>{f.occurrences}x</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SLA SETTINGS */}
      {view==='settings' && isAdmin && (
        <div style={{ background:'var(--paper)', borderRadius:'var(--radius-lg)', padding:'1rem', maxWidth:'400px' }}>
          <h4 style={{ marginBottom:'0.75rem' }}>SLA Configuration</h4>
          <label className="form-label">Escalation after (days)</label>
          <input className="form-input" type="number" min={1} max={30} value={settings.slaDays} onChange={e=>setSettings(p=>({...p,slaDays:Number(e.target.value)}))} />
          <button className="btn btn-ca btn-sm" style={{ marginTop:'0.75rem' }} onClick={saveSLA}>Save SLA</button>
        </div>
      )}
    </div>
  );
};

export default ConflictsTab;
