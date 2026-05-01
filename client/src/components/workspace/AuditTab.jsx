import React, { useState, useEffect, useCallback } from 'react';
import { workspaceAPI } from '../../services/api';

const AuditTab = ({ projectId, members, onNotify }) => {
  const [history, setHistory] = useState([]);
  const [summary, setSummary] = useState([]);
  const [view, setView] = useState('timeline');
  const [filters, setFilters] = useState({ userId:'', actionType:'', dateFrom:'', dateTo:'' });

  const load = useCallback(async () => {
    try {
      const [hRes, sRes] = await Promise.all([
        workspaceAPI.getAuditHistory(projectId, { limit: 100 }),
        workspaceAPI.getAuditSummary(projectId)
      ]);
      setHistory(hRes.data?.audits || []);
      setSummary(sRes.data?.summary || []);
    } catch { onNotify('error', 'Failed to load audit data'); }
  }, [projectId, onNotify]);

  useEffect(() => { load(); }, [load]);

  const exportCSV = async () => {
    try {
      const r = await workspaceAPI.exportAuditHistory(projectId, { format: 'csv' });
      const blob = new Blob([r.data], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-${projectId}-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a); a.click();
      window.URL.revokeObjectURL(url); document.body.removeChild(a);
      onNotify('success', 'Audit exported');
    } catch { onNotify('error', 'Export failed'); }
  };

  const filtered = history.filter(h => {
    if (filters.userId && h.actor_id !== filters.userId) return false;
    const type = h.action_type || h.activity_type;
    if (filters.actionType && type !== filters.actionType) return false;
    if (filters.dateFrom) {
      const d = new Date(h.created_at || h.timestamp);
      if (d < new Date(filters.dateFrom)) return false;
    }
    if (filters.dateTo) {
      const d = new Date(h.created_at || h.timestamp);
      const endOfDay = new Date(filters.dateTo);
      endOfDay.setHours(23, 59, 59, 999);
      if (d > endOfDay) return false;
    }
    return true;
  });

  const fmt = (d) => d ? new Date(d).toLocaleString() : '';

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display:'flex', gap:'0.5rem', marginBottom:'1rem', alignItems:'center', flexWrap:'wrap' }}>
        <button className={`btn btn-sm ${view==='timeline'?'btn-primary':'btn-ghost'}`} onClick={()=>setView('timeline')}>📜 Timeline</button>
        <button className={`btn btn-sm ${view==='summary'?'btn-primary':'btn-ghost'}`} onClick={()=>setView('summary')}>📊 Contribution Summary</button>
        <div style={{ flex:1 }}/>
        <button className="btn btn-sm btn-ca" onClick={exportCSV}>⬇ Export CSV</button>
      </div>

      {/* TIMELINE VIEW */}
      {view==='timeline' && (
        <div>
          {/* Filters */}
          <div style={{ display:'flex', gap:'0.5rem', marginBottom:'1rem', flexWrap:'wrap' }}>
            <select className="form-input" style={{ flex:1, fontSize:'0.8rem' }} value={filters.userId} onChange={e=>setFilters(p=>({...p,userId:e.target.value}))}>
              <option value="">All Users</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
            <select className="form-input" style={{ flex:1, fontSize:'0.8rem' }} value={filters.actionType} onChange={e=>setFilters(p=>({...p,actionType:e.target.value}))}>
              <option value="">All Actions</option>
              <option value="file_upload">File Upload</option>
              <option value="file_locked">File Lock</option>
              <option value="file_content_updated">File Update</option>
              <option value="message_sent">Message</option>
              <option value="task_created">Task Created</option>
              <option value="task_status_updated">Task Progress</option>
              <option value="annotation_created">Annotation</option>
              <option value="annotation_resolved">Resolution</option>
              <option value="breach_resolved">Constraint Fixed</option>
              <option value="regulatory_precheck_run">Pre-check Run</option>
            </select>
            <input type="date" className="form-input" style={{ flex:1, fontSize:'0.8rem' }} value={filters.dateFrom} onChange={e=>setFilters(p=>({...p,dateFrom:e.target.value}))} placeholder="From" title="From date" />
            <input type="date" className="form-input" style={{ flex:1, fontSize:'0.8rem' }} value={filters.dateTo} onChange={e=>setFilters(p=>({...p,dateTo:e.target.value}))} placeholder="To" title="To date" />
          </div>

          {/* Timeline */}
          <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem' }}>
            {filtered.length === 0 ? (
              <div style={{ textAlign:'center', padding:'3rem', color:'var(--muted)' }}>📜 No audit records found</div>
            ) : filtered.map((h,i) => (
              <div key={h.id||i} style={{ display:'flex', gap:'0.75rem', padding:'0.6rem', background:'white', border:'1px solid var(--border)', borderRadius:'var(--radius-md)', fontSize:'0.8rem', boxShadow:'var(--shadow-sm)' }}>
                <div style={{ width:'6px', borderRadius:'3px', background:`var(--${h.actor_team==='CA'?'ca':h.actor_team==='DS'?'ds':'muted'})`, flexShrink:0 }} />
                <div style={{ flex:1 }}>
                  <div style={{ display:'flex', justifyContent:'space-between' }}>
                    <strong>{h.actor_name||h.user_name}</strong>
                    <span style={{ fontSize:'0.7rem', color:'var(--muted)' }}>{fmt(h.created_at||h.timestamp)}</span>
                  </div>
                  <div style={{ color:'var(--text)', marginTop:'0.2rem', fontWeight:500 }}>
                    {h.action_type?.replace(/_/g, ' ').toUpperCase() || h.activity_type?.replace(/_/g, ' ').toUpperCase()}
                  </div>
                  <div style={{ color:'var(--muted)', fontSize:'0.75rem' }}>
                    {h.target_name || h.description || h.target_type || '—'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SUMMARY VIEW */}
      {view==='summary' && (
        <div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(250px, 1fr))', gap:'1rem' }}>
            {summary.length === 0 ? (
              <div style={{ gridColumn:'1/-1', textAlign:'center', padding:'3rem', color:'var(--muted)' }}>No contribution data available</div>
            ) : summary.map((s,i) => (
              <div key={s.user_id||i} style={{ background:'white', border:'1.5px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'1rem' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.75rem' }}>
                  <div className={`avatar avatar-sm avatar-${(s.team||'ca').toLowerCase()}`}>{s.full_name?.[0]||'?'}</div>
                  <div>
                    <div style={{ fontWeight:600, fontSize:'0.85rem' }}>{s.full_name}</div>
                    <div style={{ fontSize:'0.7rem', color:'var(--muted)' }}>{s.team}</div>
                  </div>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.4rem', fontSize:'0.75rem' }}>
                  <div>Total Actions: <strong>{s.total_actions}</strong></div>
                  <div>File Uploads: <strong>{s.file_uploads}</strong></div>
                  <div>Messages: <strong>{s.messages}</strong></div>
                  <div>Annotations: <strong>{s.annotations}</strong></div>
                  <div>Task Actions: <strong>{s.task_actions}</strong></div>
                  <div style={{ fontSize:'0.7rem', color:'var(--muted)' }}>Last: {fmt(s.last_activity)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AuditTab;
