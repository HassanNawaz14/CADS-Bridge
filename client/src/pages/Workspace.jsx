import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import { useAuth } from '../context/AuthContext';
import { workspaceAPI, tasksAPI, kpiAPI } from '../services/api';
import FilesTab from '../components/workspace/FilesTab';
import ChatTab from '../components/workspace/ChatTab';
import ConflictsTab from '../components/workspace/ConflictsTab';
import AuditTab from '../components/workspace/AuditTab';
import AnnotationsTab from '../components/workspace/AnnotationsTab';
import io from 'socket.io-client';

const Workspace = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [project, setProject] = useState({});
  const [members, setMembers] = useState([]);
  const [files, setFiles] = useState([]);
  const [messages, setMessages] = useState([]);
  const [activityFeed, setActivityFeed] = useState([]);
  const [projectHealth, setProjectHealth] = useState({});
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [tab, setTab] = useState('hub');
  const [loading, setLoading] = useState(true);
  const [socket, setSocket] = useState(null);
  const [notifs, setNotifs] = useState([]);
  const [tasks, setTasks] = useState([]);

  const addNotif = (type, message) => {
    const n = { id: Date.now(), type, message, ts: new Date() };
    setNotifs(prev => [n, ...prev.slice(0, 4)]);
    setTimeout(() => setNotifs(prev => prev.filter(x => x.id !== n.id)), 4000);
  };

  // WebSocket
  useEffect(() => {
    const s = io(process.env.REACT_APP_WS_URL || 'http://localhost:5000', {
      auth: { token: localStorage.getItem('accessToken') }
    });
    setSocket(s);
    return () => s.close();
  }, []);

  useEffect(() => {
    if (!socket || !id) return;
    socket.emit('join_workspace', { projectId: id });
    socket.on('user_joined', d => setOnlineUsers(p => new Set([...p, d.userId])));
    socket.on('user_left', d => setOnlineUsers(p => { const s = new Set(p); s.delete(d.userId); return s; }));
    socket.on('new_message', m => setMessages(p => [...p, m]));
    socket.on('workspace_activity', a => setActivityFeed(p => [a, ...p]));
    socket.on('new_file', f => setFiles(p => [f, ...p]));
    socket.on('conflicts_detected', d => addNotif('warning', `${d.count} new conflicts detected!`));
    socket.on('active_users', users => {
      if (Array.isArray(users)) setOnlineUsers(new Set(users.map(u => u.id)));
    });
    return () => {
      socket.emit('leave_workspace', { projectId: id });
      ['user_joined','user_left','new_message','workspace_activity','new_file','conflicts_detected','active_users'].forEach(e => socket.off(e));
    };
  }, [socket, id]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [, membersRes, filesRes, msgsRes, actRes, healthRes] = await Promise.all([
        workspaceAPI.getFiles(id).then(() => null).catch(() => null),
        workspaceAPI.getMembers(id),
        workspaceAPI.getFiles(id),
        workspaceAPI.getMessages(id),
        workspaceAPI.getActivityFeed(id),
        fetch(`${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/api/projects/${id}/workspace/health`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` }
        }).then(r => r.json()).catch(() => ({}))
      ]);
      try {
        const pRes = await fetch(`${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/api/projects/${id}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` }
        }).then(r => r.json());
        setProject(pRes.project || pRes.data || pRes || {});
      } catch { setProject({}); }
      try {
        const tRes = await tasksAPI.list({ projectId: id });
        setTasks(tRes.data?.tasks || []);
      } catch { setTasks([]); }
      setMembers(membersRes.data?.members || []);
      setFiles(filesRes.data?.files || []);
      setMessages(msgsRes.data?.messages || []);
      setActivityFeed(actRes.data?.activities || []);
      setProjectHealth(healthRes.health || healthRes.data?.health || {});
    } catch (e) {
      console.error('Load failed:', e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <DashboardLayout title="Loading Workspace...">
        <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'60vh' }}>
          <div className="loading-spinner" />
        </div>
      </DashboardLayout>
    );
  }

  const tabs = [
    { id:'hub', label:'Hub', icon:'🏠' },
    { id:'files', label:'Files & Co-editing', icon:'📁' },
    { id:'annotations', label:'Annotations', icon:'📝', badge: projectHealth.open_annotations || 0 },
    { id:'chat', label:'Chat', icon:'💬', badge: messages.length },
    { id:'conflicts', label:'Conflicts', icon:'⚔️' },
    { id:'audit', label:'Audit History', icon:'📜' },
  ];

  // Milestone progress
  const milestonesDone = projectHealth.completed_milestones || 0;
  const milestonesTotal = projectHealth.total_milestones || 0;
  const milestonePercent = milestonesTotal > 0 ? Math.round((milestonesDone / milestonesTotal) * 100) : 0;

  // Task Kanban grouping
  const tasksByStatus = { todo: [], in_progress: [], in_review: [], done: [] };
  tasks.forEach(t => { if (tasksByStatus[t.status]) tasksByStatus[t.status].push(t); });

  return (
    <DashboardLayout title={project.name || 'Workspace'}>
      {/* Notifications */}
      <div style={{ position:'fixed', top:80, right:20, zIndex:1000, maxWidth:300 }}>
        {notifs.map(n => (
          <div key={n.id} style={{ marginBottom:'0.5rem', padding:'0.6rem 1rem', borderRadius:'var(--radius-md)', background: n.type==='error'?'#fee2e2':n.type==='warning'?'#fef3c7':'#dcfce7', border:`1px solid ${n.type==='error'?'#fca5a5':n.type==='warning'?'#fcd34d':'#86efac'}`, fontSize:'0.8rem', fontWeight:500, animation:'fadeIn 0.3s' }}>
            {n.message}
          </div>
        ))}
      </div>

      {/* ═══ TOP BAR: Project name, milestone progress, days remaining, conflict count, annotation count ═══ */}
      <div style={{ background:'white', borderRadius:'var(--radius-lg)', border:'1.5px solid var(--border)', padding:'1rem 1.5rem', marginBottom:'1rem', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'1rem' }}>
        <div style={{ flex:'1 1 auto' }}>
          <h2 style={{ fontFamily:'Syne', fontWeight:700, margin:0, fontSize:'1.25rem' }}>{project.name || 'Project Workspace'}</h2>
          <div style={{ fontSize:'0.8rem', color:'var(--muted)', marginTop:'0.3rem', display:'flex', alignItems:'center', gap:'0.75rem', flexWrap:'wrap' }}>
            {projectHealth.project_status && <span className={`badge badge-${String(projectHealth.project_status).toLowerCase()==='active'?'success':'warning'}`}>{projectHealth.project_status}</span>}
            {projectHealth.days_remaining !== undefined && (
              <span>{projectHealth.days_remaining > 0 ? `${projectHealth.days_remaining} days remaining` : '⚠️ Overdue'}</span>
            )}
          </div>
        </div>

        {/* Milestone Progress Bar */}
        <div style={{ flex:'0 0 200px' }}>
          <div style={{ fontSize:'0.7rem', color:'var(--muted)', marginBottom:'0.25rem', display:'flex', justifyContent:'space-between' }}>
            <span>Milestones</span>
            <span>{milestonesDone}/{milestonesTotal}</span>
          </div>
          <div style={{ height:8, background:'var(--border)', borderRadius:4, overflow:'hidden' }}>
            <div style={{ height:'100%', width:`${milestonePercent}%`, background:'linear-gradient(90deg, var(--ca), var(--ds))', borderRadius:4, transition:'width 0.5s ease' }} />
          </div>
        </div>

        {/* Stat Badges */}
        <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap' }}>
          <div style={{ textAlign:'center', padding:'0.4rem 0.8rem', background:'var(--paper)', borderRadius:'var(--radius-md)', minWidth:60 }}>
            <div style={{ fontSize:'1.1rem', fontWeight:700, color:'var(--ca)' }}>{Math.round(projectHealth.task_completion_percentage||0)}%</div>
            <div style={{ fontSize:'0.6rem', color:'var(--muted)' }}>Tasks</div>
          </div>
          <div style={{ textAlign:'center', padding:'0.4rem 0.8rem', background: (projectHealth.open_conflicts||0)>0?'#fee2e2':'var(--paper)', borderRadius:'var(--radius-md)', minWidth:60 }}>
            <div style={{ fontSize:'1.1rem', fontWeight:700, color:(projectHealth.open_conflicts||0)>0?'var(--danger)':'var(--muted)' }}>{projectHealth.open_conflicts||0}</div>
            <div style={{ fontSize:'0.6rem', color:'var(--muted)' }}>Conflicts</div>
          </div>
          <div style={{ textAlign:'center', padding:'0.4rem 0.8rem', background: (projectHealth.open_annotations||0)>0?'#FEF3C7':'var(--paper)', borderRadius:'var(--radius-md)', minWidth:60 }}>
            <div style={{ fontSize:'1.1rem', fontWeight:700, color:(projectHealth.open_annotations||0)>0?'var(--warning)':'var(--muted)' }}>{projectHealth.open_annotations||0}</div>
            <div style={{ fontSize:'0.6rem', color:'var(--muted)' }}>Annotations</div>
          </div>
          <div style={{ textAlign:'center', padding:'0.4rem 0.8rem', background:'var(--paper)', borderRadius:'var(--radius-md)', minWidth:60 }}>
            <div style={{ fontSize:'1.1rem', fontWeight:700, color:'var(--ds)' }}>{onlineUsers.size}</div>
            <div style={{ fontSize:'0.6rem', color:'var(--muted)' }}>Online</div>
          </div>
        </div>
      </div>

      {/* ═══ MAIN 3-COLUMN LAYOUT ═══ */}
      <div style={{ display:'grid', gridTemplateColumns:'230px 1fr 280px', gap:'1rem', height:'calc(100vh - 280px)' }}>

        {/* ═══ LEFT PANEL: Project Members (CA=blue, DS=green, presence dots, role labels) ═══ */}
        <div style={{ background:'white', borderRadius:'var(--radius-lg)', border:'1.5px solid var(--border)', padding:'1rem', overflowY:'auto' }}>
          <h4 style={{ fontFamily:'Syne', fontWeight:700, fontSize:'0.9rem', marginBottom:'0.75rem', display:'flex', justifyContent:'space-between' }}>
            <span>Team</span>
            <span style={{ fontSize:'0.75rem', fontWeight:400, color:'var(--muted)' }}>{members.length} members</span>
          </h4>
          {members.length === 0 && (
            <div style={{ textAlign:'center', padding:'2rem 0.5rem', color:'var(--muted)', fontSize:'0.8rem' }}>
              <div style={{ fontSize:'1.5rem', marginBottom:'0.4rem' }}>👥</div>
              No members found. Project may not be active yet.
            </div>
          )}
          {members.map(m => {
            const isOnline = onlineUsers.has(m.id);
            const teamColor = (m.team||'').toUpperCase() === 'CA' ? 'var(--ca)' : 'var(--ds)';
            const teamBg = (m.team||'').toUpperCase() === 'CA' ? '#EBF5FF' : '#ECFDF5';
            return (
              <div key={m.id} style={{ display:'flex', alignItems:'center', gap:'0.5rem', padding:'0.5rem', borderRadius:'var(--radius-md)', background: isOnline ? teamBg : 'var(--paper)', marginBottom:'0.35rem', cursor:'pointer', transition:'all 0.2s' }}
                onMouseEnter={e => e.currentTarget.style.transform='translateX(2px)'}
                onMouseLeave={e => e.currentTarget.style.transform='none'}>
                {/* Avatar with team-colored ring */}
                <div style={{ width:32, height:32, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.75rem', fontWeight:600, color:'white', background: teamColor, border:`2.5px solid ${teamColor}`, flexShrink:0 }}>
                  {m.avatar_initials || m.full_name?.[0] || '?'}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:'0.78rem', fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{m.full_name}</div>
                  <div style={{ fontSize:'0.63rem', color:'var(--muted)' }}>
                    <span style={{ color: teamColor, fontWeight:600 }}>{m.team}</span> · {m.workspace_role || m.role || 'member'}
                  </div>
                </div>
                {/* Presence dot */}
                <div style={{ width:9, height:9, borderRadius:'50%', background: isOnline ? '#22c55e' : '#d1d5db', border:'1.5px solid white', flexShrink:0 }} title={isOnline ? 'Online' : 'Offline'} />
              </div>
            );
          })}
        </div>

        {/* ═══ CENTRE: Tab content area ═══ */}
        <div style={{ background:'white', borderRadius:'var(--radius-lg)', border:'1.5px solid var(--border)', display:'flex', flexDirection:'column', overflow:'hidden' }}>
          {/* Tab Bar */}
          <div style={{ display:'flex', borderBottom:'1px solid var(--border)', padding:'0 0.5rem', background:'var(--paper)' }}>
            {tabs.map(t => (
              <button key={t.id} onClick={()=>setTab(t.id)} style={{
                padding:'0.6rem 1rem', border:'none', background:'none', cursor:'pointer',
                borderBottom: tab===t.id ? '2px solid var(--ca)' : '2px solid transparent',
                fontWeight: tab===t.id ? 600 : 400, fontSize:'0.8rem', color: tab===t.id ? 'var(--ca)' : 'var(--muted)',
                display:'flex', alignItems:'center', gap:'0.3rem', transition:'all 0.2s'
              }}>
                {t.icon} {t.label}
                {t.badge > 0 && <span style={{ background:'var(--ca)', color:'white', borderRadius:10, padding:'0 0.35rem', fontSize:'0.6rem', fontWeight:700 }}>{t.badge}</span>}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div style={{ flex:1, padding:'1rem', overflowY:'auto' }}>
            {/* HUB TAB — Activity Feed (centre main area per spec 3.8.1) */}
            {tab === 'hub' && (
              <div>
                <h4 style={{ fontFamily:'Syne', fontWeight:700, fontSize:'0.95rem', marginBottom:'1rem' }}>📋 Activity Feed</h4>
                {activityFeed.length === 0 ? (
                  <div style={{ textAlign:'center', padding:'3rem', color:'var(--muted)' }}>
                    <div style={{ fontSize:'2rem', marginBottom:'0.5rem' }}>📭</div>
                    <p style={{ fontSize:'0.85rem' }}>No activity yet. Actions like file uploads, task updates, messages, and annotations will appear here.</p>
                  </div>
                ) : activityFeed.map((a, i) => {
                  const teamColor = a.actor_team === 'CA' ? 'var(--ca)' : a.actor_team === 'DS' ? 'var(--ds)' : 'var(--muted)';
                  const actionIcons = { file_upload:'📁', task_created:'📌', task_status_changed:'✅', message_sent:'💬', annotation_created:'📝', conflict_detection_run:'⚔️', file_edited:'✏️', version_published:'📦' };
                  const icon = actionIcons[a.action_type || a.activityType] || '🔵';
                  return (
                    <div key={a.id||i} style={{ display:'flex', gap:'0.75rem', padding:'0.7rem 0', borderBottom:'1px solid var(--border)' }}>
                      <div style={{ fontSize:'1.1rem', flexShrink:0, marginTop:'0.1rem' }}>{icon}</div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:'0.82rem' }}>
                          <strong style={{ color: teamColor }}>{a.actor_name || a.user_name || 'System'}</strong>{' '}
                          <span style={{ color:'var(--text)' }}>{a.description || a.action_type?.replace(/_/g, ' ') || 'performed an action'}</span>
                          {a.target_name && <span style={{ color:'var(--muted)' }}> — {a.target_name}</span>}
                        </div>
                        <div style={{ fontSize:'0.68rem', color:'var(--muted)', marginTop:'0.15rem' }}>
                          {new Date(a.created_at || a.timestamp).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {tab === 'files' && <FilesTab projectId={id} files={files} setFiles={setFiles} user={user} onNotify={addNotif} socket={socket} />}
            {tab === 'annotations' && <AnnotationsTab projectId={id} files={files} user={user} onNotify={addNotif} />}
            {tab === 'chat' && <ChatTab projectId={id} messages={messages} setMessages={setMessages} user={user} socket={socket} members={members} onNotify={addNotif} />}
            {tab === 'conflicts' && <ConflictsTab projectId={id} user={user} onNotify={addNotif} />}
            {tab === 'audit' && <AuditTab projectId={id} members={members} onNotify={addNotif} />}
          </div>
        </div>

        {/* ═══ RIGHT PANEL: Quick Access — Task Board, Files, Annotations, Conflicts, KPI ═══ */}
        <div style={{ display:'flex', flexDirection:'column', gap:'0.75rem', overflowY:'auto' }}>

          {/* Task Board Mini (Kanban) */}
          <div style={{ background:'white', borderRadius:'var(--radius-lg)', border:'1.5px solid var(--border)', padding:'0.75rem' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.6rem' }}>
              <h4 style={{ fontFamily:'Syne', fontWeight:700, fontSize:'0.85rem', margin:0 }}>📋 Task Board</h4>
              <button className="btn btn-xs btn-ghost" onClick={()=>setTab('hub')} style={{ fontSize:'0.65rem' }}>See All →</button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.3rem' }}>
              {[{k:'todo',l:'To Do',c:'var(--muted)'},{k:'in_progress',l:'In Progress',c:'var(--ca)'},{k:'in_review',l:'Review',c:'var(--warning)'},{k:'done',l:'Done',c:'var(--success)'}].map(s=>(
                <div key={s.k} style={{ padding:'0.3rem 0.4rem', background:'var(--paper)', borderRadius:'var(--radius-sm)', borderLeft:`3px solid ${s.c}` }}>
                  <div style={{ fontSize:'1rem', fontWeight:700, color:s.c }}>{tasksByStatus[s.k]?.length||0}</div>
                  <div style={{ fontSize:'0.6rem', color:'var(--muted)' }}>{s.l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Files Quick Access */}
          <div style={{ background:'white', borderRadius:'var(--radius-lg)', border:'1.5px solid var(--border)', padding:'0.75rem' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.5rem' }}>
              <h4 style={{ fontFamily:'Syne', fontWeight:700, fontSize:'0.85rem', margin:0 }}>📁 Files</h4>
              <button className="btn btn-xs btn-ghost" onClick={()=>setTab('files')} style={{ fontSize:'0.65rem' }}>See All →</button>
            </div>
            {files.slice(0,4).map(f => (
              <div key={f.id} style={{ fontSize:'0.72rem', padding:'0.25rem 0', borderBottom:'1px solid var(--border)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                📄 {f.original_name} <span style={{ color:'var(--muted)' }}>· {f.uploaded_by_name}</span>
              </div>
            ))}
            {files.length === 0 && <div style={{ fontSize:'0.72rem', color:'var(--muted)', padding:'0.3rem 0' }}>No files</div>}
          </div>

          {/* Annotation Engine */}
          <div onClick={()=>setTab('files')} style={{ background:'white', borderRadius:'var(--radius-lg)', border:'1.5px solid var(--border)', padding:'0.75rem', cursor:'pointer', transition:'all 0.2s' }}
            onMouseEnter={e=>e.currentTarget.style.borderColor='var(--warning)'}
            onMouseLeave={e=>e.currentTarget.style.borderColor='var(--border)'}>
            <h4 style={{ fontFamily:'Syne', fontWeight:700, fontSize:'0.85rem', margin:'0 0 0.3rem 0' }}>📝 Annotations</h4>
            <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
              <div style={{ fontSize:'1.3rem', fontWeight:700, color: (projectHealth.open_annotations||0)>0?'var(--warning)':'var(--muted)' }}>{projectHealth.open_annotations||0}</div>
              <div style={{ fontSize:'0.7rem', color:'var(--muted)' }}>open annotations requiring resolution</div>
            </div>
          </div>

          {/* Conflict Alerts */}
          <div onClick={()=>setTab('conflicts')} style={{ background: (projectHealth.open_conflicts||0)>0?'#FEF2F2':'white', borderRadius:'var(--radius-lg)', border:`1.5px solid ${(projectHealth.open_conflicts||0)>0?'#FECACA':'var(--border)'}`, padding:'0.75rem', cursor:'pointer', transition:'all 0.2s' }}
            onMouseEnter={e=>e.currentTarget.style.transform='translateY(-1px)'}
            onMouseLeave={e=>e.currentTarget.style.transform='none'}>
            <h4 style={{ fontFamily:'Syne', fontWeight:700, fontSize:'0.85rem', margin:'0 0 0.3rem 0', color:(projectHealth.open_conflicts||0)>0?'var(--danger)':'inherit' }}>⚔️ Conflict Alerts</h4>
            <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
              <div style={{ fontSize:'1.3rem', fontWeight:700, color: (projectHealth.open_conflicts||0)>0?'var(--danger)':'var(--muted)' }}>{projectHealth.open_conflicts||0}</div>
              <div style={{ fontSize:'0.7rem', color: (projectHealth.open_conflicts||0)>0?'var(--danger)':'var(--muted)' }}>
                {(projectHealth.open_conflicts||0)>0 ? 'active conflicts need resolution' : 'no conflicts'}
              </div>
            </div>
          </div>

          {/* KPI Snapshot */}
          <div style={{ background:'white', borderRadius:'var(--radius-lg)', border:'1.5px solid var(--border)', padding:'0.75rem', flex:'0 0 auto' }}>
            <h4 style={{ fontFamily:'Syne', fontWeight:700, fontSize:'0.85rem', margin:'0 0 0.5rem 0' }}>📊 KPI Snapshot</h4>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.4rem' }}>
              <div style={{ padding:'0.35rem', background:'var(--paper)', borderRadius:'var(--radius-sm)', textAlign:'center' }}>
                <div style={{ fontSize:'1rem', fontWeight:700, color:'var(--ca)' }}>{Math.round(projectHealth.task_completion_percentage||0)}%</div>
                <div style={{ fontSize:'0.58rem', color:'var(--muted)' }}>Task Completion</div>
              </div>
              <div style={{ padding:'0.35rem', background:'var(--paper)', borderRadius:'var(--radius-sm)', textAlign:'center' }}>
                <div style={{ fontSize:'1rem', fontWeight:700, color:'var(--ds)' }}>{milestonePercent}%</div>
                <div style={{ fontSize:'0.58rem', color:'var(--muted)' }}>Milestones</div>
              </div>
              <div style={{ padding:'0.35rem', background:'var(--paper)', borderRadius:'var(--radius-sm)', textAlign:'center' }}>
                <div style={{ fontSize:'1rem', fontWeight:700, color:'var(--warning)' }}>{projectHealth.overdue_tasks||0}</div>
                <div style={{ fontSize:'0.58rem', color:'var(--muted)' }}>Overdue</div>
              </div>
              <div style={{ padding:'0.35rem', background:'var(--paper)', borderRadius:'var(--radius-sm)', textAlign:'center' }}>
                <div style={{ fontSize:'1rem', fontWeight:700, color:'var(--info)' }}>{projectHealth.unread_messages||0}</div>
                <div style={{ fontSize:'0.58rem', color:'var(--muted)' }}>Unread Msgs</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Workspace;
