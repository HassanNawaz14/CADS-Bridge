import React from 'react';

const HubTab = ({ projectHealth, activityFeed, members, onlineUsers, files }) => {
  const fmt = (d) => d ? new Date(d).toLocaleString() : '';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
      {/* Health Cards */}
      <div style={{ gridColumn: '1/-1', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        {[
          { label: 'Tasks Done', val: `${Math.round(projectHealth.task_completion_percentage||0)}%`, color: 'var(--ca)' },
          { label: 'Open Conflicts', val: projectHealth.open_conflicts||0, color: 'var(--danger)' },
          { label: 'Overdue Tasks', val: projectHealth.overdue_tasks||0, color: 'var(--warning)' },
          { label: 'Days Left', val: projectHealth.days_remaining||'—', color: 'var(--ds)' },
          { label: 'Milestones', val: `${projectHealth.completed_milestones||0}/${projectHealth.total_milestones||0}`, color: 'var(--ca)' },
          { label: 'Unread Msgs', val: projectHealth.unread_messages||0, color: 'var(--info)' },
        ].map((c,i) => (
          <div key={i} style={{ flex:'1', minWidth:'120px', background:'white', border:'1.5px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'1rem', textAlign:'center' }}>
            <div style={{ fontSize:'1.5rem', fontWeight:700, color:c.color }}>{c.val}</div>
            <div style={{ fontSize:'0.75rem', color:'var(--muted)', marginTop:'0.25rem' }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Activity Feed */}
      <div style={{ background:'white', border:'1.5px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'1rem', maxHeight:'400px', overflowY:'auto' }}>
        <h4 style={{ fontFamily:'Syne', fontWeight:700, marginBottom:'0.75rem' }}>Recent Activity</h4>
        {activityFeed.length === 0 ? (
          <p style={{ color:'var(--muted)', fontSize:'0.85rem', textAlign:'center', padding:'2rem' }}>No activity yet</p>
        ) : activityFeed.slice(0,20).map((a,i) => (
          <div key={a.id||i} style={{ padding:'0.6rem', borderRadius:'var(--radius-md)', background:'var(--paper)', marginBottom:'0.5rem', borderLeft:`3px solid var(--${a.actor_team==='CA'?'ca':a.actor_team==='DS'?'ds':'muted'})`, fontSize:'0.8rem' }}>
            <strong style={{ color:`var(--${a.actor_team==='CA'?'ca':'ds'})` }}>{a.actor_name||a.user_name}</strong> {a.description||a.action_type}
            <div style={{ fontSize:'0.7rem', color:'var(--muted)', marginTop:'0.2rem' }}>{fmt(a.created_at||a.timestamp)}</div>
          </div>
        ))}
      </div>

      {/* Team Overview */}
      <div style={{ background:'white', border:'1.5px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'1rem', maxHeight:'400px', overflowY:'auto' }}>
        <h4 style={{ fontFamily:'Syne', fontWeight:700, marginBottom:'0.75rem' }}>Team ({members.length})</h4>
        {members.length === 0 ? (
          <div style={{ textAlign:'center', padding:'2rem', color:'var(--muted)' }}>
            <div style={{ fontSize:'2rem', marginBottom:'0.5rem' }}>👥</div>
            <p style={{ fontSize:'0.85rem' }}>No team members found</p>
            <p style={{ fontSize:'0.75rem' }}>Members will appear once the project is active and users are assigned.</p>
          </div>
        ) : members.map(m => (
          <div key={m.id} style={{ display:'flex', alignItems:'center', gap:'0.5rem', padding:'0.5rem', borderRadius:'var(--radius-md)', background: onlineUsers.has(m.id)?'var(--success-bg)':'var(--paper)', marginBottom:'0.4rem' }}>
            <div className={`avatar avatar-sm avatar-${(m.team||'ca').toLowerCase()}`}>{m.avatar_initials||m.full_name?.[0]||'?'}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:'0.8rem', fontWeight:500 }}>{m.full_name}</div>
              <div style={{ fontSize:'0.7rem', color:'var(--muted)' }}>
                {m.team} · {m.workspace_role || m.role || 'member'}
                {m.pending_tasks > 0 && <span style={{ marginLeft:'0.3rem', color:'var(--warning)' }}>· {m.pending_tasks} pending</span>}
              </div>
            </div>
            {onlineUsers.has(m.id) && <div style={{ width:8, height:8, borderRadius:'50%', background:'var(--success)' }}/>}
          </div>
        ))}
      </div>

      {/* Recent Files */}
      <div style={{ gridColumn:'1/-1', background:'white', border:'1.5px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'1rem' }}>
        <h4 style={{ fontFamily:'Syne', fontWeight:700, marginBottom:'0.75rem' }}>Recent Files</h4>
        <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap' }}>
          {files.slice(0,6).map(f => (
            <div key={f.id} style={{ padding:'0.6rem 1rem', background:'var(--paper)', borderRadius:'var(--radius-md)', fontSize:'0.8rem', border:'1px solid var(--border)' }}>
              📄 {f.original_name} <span style={{ color:'var(--muted)', fontSize:'0.7rem' }}>by {f.uploaded_by_name}</span>
            </div>
          ))}
          {files.length===0 && <p style={{ color:'var(--muted)', fontSize:'0.85rem' }}>No files uploaded yet</p>}
        </div>
      </div>
    </div>
  );
};

export default HubTab;
