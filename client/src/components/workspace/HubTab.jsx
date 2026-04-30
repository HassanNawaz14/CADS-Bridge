import React, { useState } from 'react';
import { projectsAPI } from '../../services/api';

const HubTab = ({ projectId, projectHealth, activityFeed, members, onlineUsers, files, milestones, onRefresh, onNotify }) => {
  const [toggling, setToggling] = useState(null);
  const fmt = (d) => d ? new Date(d).toLocaleString() : '';

  const toggleMilestone = async (mid) => {
    setToggling(mid);
    try {
      await projectsAPI.toggleMilestone(projectId, mid);
      onRefresh();
    } catch (e) {
      onNotify?.('error', 'Failed to update milestone');
    } finally {
      setToggling(null);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
      {/* Health Cards */}
      <div style={{ gridColumn: '1/-1', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        {[
          { label: 'Tasks Done', val: `${Math.round(projectHealth.task_completion_percentage||0)}%`, color: 'var(--ca)', icon: '✅' },
          { label: 'Open Conflicts', val: projectHealth.open_conflicts||0, color: 'var(--danger)', icon: '⚠️' },
          { label: 'Overdue Tasks', val: projectHealth.overdue_tasks||0, color: 'var(--warning)', icon: '⏰' },
          { label: 'Days Left', val: projectHealth.days_remaining||'—', color: 'var(--ds)', icon: '📅' },
          { label: 'Milestones', val: `${projectHealth.completed_milestones||0}/${projectHealth.total_milestones||0}`, color: 'var(--info)', icon: '🏆' },
          { label: 'Unread Msgs', val: projectHealth.unread_messages||0, color: '#8b5cf6', icon: '💬' },
        ].map((c,i) => (
          <div key={i} style={{ flex:'1', minWidth:'140px', background:'white', border:'1.5px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'1.25rem 1rem', textAlign:'center', transition:'transform 0.2s', cursor:'default' }} onMouseEnter={e => e.currentTarget.style.transform='translateY(-2px)'} onMouseLeave={e => e.currentTarget.style.transform='none'}>
            <div style={{ fontSize:'1.1rem', marginBottom:'0.4rem' }}>{c.icon}</div>
            <div style={{ fontSize:'1.5rem', fontWeight:800, color:c.color, fontFamily:'Syne' }}>{c.val}</div>
            <div style={{ fontSize:'0.72rem', fontWeight:600, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginTop:'0.3rem' }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Milestones Panel */}
      <div style={{ background:'white', border:'1.5px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'1.25rem' }}>
        <h4 style={{ fontFamily:'Syne', fontWeight:700, marginBottom:'1rem', display:'flex', alignItems:'center', gap:'0.5rem' }}>
          🎯 Key Milestones
        </h4>
        <div style={{ display:'flex', flexDirection:'column', gap:'0.75rem' }}>
          {(milestones || []).length === 0 ? (
            <p style={{ color:'var(--muted)', fontSize:'0.85rem', textAlign:'center', padding:'2rem' }}>No milestones defined</p>
          ) : milestones.map(m => (
            <div key={m.id} style={{ display:'flex', alignItems:'center', gap:'0.75rem', padding:'0.75rem', borderRadius:'var(--radius-md)', background: m.is_completed ? '#f0fdf4' : 'var(--paper)', border: `1px solid ${m.is_completed ? '#bbf7d0' : 'var(--border)'}`, transition:'all 0.2s' }}>
              <button 
                onClick={() => toggleMilestone(m.id)}
                disabled={toggling === m.id}
                style={{ 
                  width:24, height:24, borderRadius:6, border:`2px solid ${m.is_completed ? 'var(--success)' : 'var(--border)'}`, 
                  background: m.is_completed ? 'var(--success)' : 'white', cursor:'pointer', 
                  display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontSize:'0.8rem'
                }}
              >
                {m.is_completed ? '✓' : ''}
              </button>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:'0.85rem', fontWeight:600, color: m.is_completed ? '#166534' : 'var(--ink)', textDecoration: m.is_completed ? 'line-through' : 'none' }}>{m.title}</div>
                <div style={{ fontSize:'0.7rem', color:'var(--muted)' }}>Due: {new Date(m.due_date).toLocaleDateString()}</div>
              </div>
              {m.is_completed && <span style={{ fontSize:'0.65rem', fontWeight:700, color:'var(--success)', textTransform:'uppercase' }}>Done</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Activity Feed */}
      <div style={{ background:'white', border:'1.5px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'1.25rem', maxHeight:'400px', overflowY:'auto' }}>
        <h4 style={{ fontFamily:'Syne', fontWeight:700, marginBottom:'1rem' }}>⚡ Recent Activity</h4>
        {activityFeed.length === 0 ? (
          <p style={{ color:'var(--muted)', fontSize:'0.85rem', textAlign:'center', padding:'2rem' }}>No activity yet</p>
        ) : activityFeed.slice(0,20).map((a,i) => (
          <div key={a.id||i} style={{ padding:'0.6rem 0.8rem', borderRadius:'var(--radius-md)', background:'var(--paper)', marginBottom:'0.6rem', borderLeft:`4px solid var(--${a.actor_team==='CA'?'ca':a.actor_team==='DS'?'ds':'muted'})`, fontSize:'0.82rem' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.2rem' }}>
              <strong style={{ color:`var(--${a.actor_team==='CA'?'ca':'ds'})`, fontWeight:700 }}>{a.actor_name||a.user_name}</strong>
              <span style={{ fontSize:'0.68rem', color:'var(--muted)' }}>{fmt(a.created_at||a.timestamp)}</span>
            </div>
            <div style={{ color:'var(--ink)', lineHeight:1.4 }}>{a.description||a.action_type}</div>
          </div>
        ))}
      </div>

      {/* Team Overview */}
      <div style={{ background:'white', border:'1.5px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'1.25rem', maxHeight:'400px', overflowY:'auto' }}>
        <h4 style={{ fontFamily:'Syne', fontWeight:700, marginBottom:'1rem' }}>👥 Team Overview</h4>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem' }}>
          {members.map(m => (
            <div key={m.id} style={{ display:'flex', alignItems:'center', gap:'0.6rem', padding:'0.6rem', borderRadius:'var(--radius-md)', background: onlineUsers.has(m.id)?'#f0fdf4':'var(--paper)', border:'1px solid var(--border)' }}>
              <div className={`avatar avatar-xs avatar-${(m.team||'ca').toLowerCase()}`} style={{ width:32, height:32, fontSize:'0.75rem' }}>{m.avatar_initials||m.full_name?.[0]||'?'}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:'0.78rem', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{m.full_name}</div>
                <div style={{ fontSize:'0.65rem', color:'var(--muted)' }}>{m.team} · {m.workspace_role || 'Member'}</div>
              </div>
              {onlineUsers.has(m.id) && <div style={{ width:6, height:6, borderRadius:'50%', background:'var(--success)', flexShrink:0 }}/>}
            </div>
          ))}
        </div>
      </div>

      {/* Recent Files */}
      <div style={{ background:'white', border:'1.5px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'1.25rem' }}>
        <h4 style={{ fontFamily:'Syne', fontWeight:700, marginBottom:'1rem' }}>📂 Recent Files</h4>
        <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
          {files.slice(0,5).map(f => (
            <div key={f.id} style={{ display:'flex', alignItems:'center', gap:'0.6rem', padding:'0.6rem 0.8rem', background:'var(--paper)', borderRadius:'var(--radius-md)', fontSize:'0.82rem', border:'1px solid var(--border)' }}>
              <span style={{ fontSize:'1rem' }}>📄</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.original_name}</div>
                <div style={{ fontSize:'0.68rem', color:'var(--muted)' }}>Uploaded by {f.uploaded_by_name}</div>
              </div>
            </div>
          ))}
          {files.length===0 && <p style={{ color:'var(--muted)', fontSize:'0.85rem', textAlign:'center', padding:'1rem' }}>No files yet</p>}
        </div>
      </div>
    </div>
  );
};

export default HubTab;
