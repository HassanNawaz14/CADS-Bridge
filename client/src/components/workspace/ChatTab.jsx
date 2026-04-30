import React, { useState, useRef, useEffect } from 'react';
import { workspaceAPI } from '../../services/api';

const ChatTab = ({ projectId, messages, setMessages, user, socket, members, onNotify }) => {
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState('');
  const [taskModal, setTaskModal] = useState(null);
  const [taskForm, setTaskForm] = useState({ title: '', assignee: '', priority: 'Medium' });
  const chatEnd = useRef();

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior:'smooth' }); }, [messages]);

  const send = async (e) => {
    e.preventDefault();
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      const r = await workspaceAPI.sendMessage(projectId, { content: input.trim() });
      if (r.data?.message) setMessages(prev => [...prev, r.data.message]);
      setInput(''); setReplyTo(null);
    } catch { onNotify('error', 'Failed to send'); }
    finally { setSending(false); }
  };

  const convertToTask = async () => {
    if (!taskModal || !taskForm.title.trim()) return;
    try {
      await workspaceAPI.convertMessageToTask(projectId, taskModal.id, {
        title: taskForm.title.trim(),
        assigneeId: taskForm.assignee || undefined,
        priority: taskForm.priority,
        description: `Created from chat message: "${taskModal.content}"`,
      });
      onNotify('success', 'Task created from message');
      setTaskModal(null);
      setTaskForm({ title: '', assignee: '', priority: 'Medium' });
    } catch (e) { onNotify('error', e.response?.data?.message || 'Failed to create task'); }
  };

  const filtered = search ? messages.filter(m => m.content?.toLowerCase().includes(search.toLowerCase())) : messages;
  const isMe = (m) => m.sender_id === user?.id;

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      {/* Search */}
      <div style={{ marginBottom:'0.75rem' }}>
        <input className="form-input" placeholder="🔍 Search messages..." value={search} onChange={e=>setSearch(e.target.value)} style={{ fontSize:'0.8rem' }} />
      </div>

      {/* Messages */}
      <div style={{ flex:1, overflowY:'auto', marginBottom:'0.75rem', padding:'0.5rem' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign:'center', padding:'3rem', color:'var(--muted)' }}>💬 {search ? 'No matching messages' : 'No messages yet. Start the conversation!'}</div>
        ) : filtered.map(m => (
          <div key={m.id} style={{ marginBottom:'0.6rem', display:'flex', flexDirection:isMe(m)?'row-reverse':'row', gap:'0.4rem', alignItems:'flex-start' }}>
            <div className={`avatar avatar-xs avatar-${(m.team||m.sender_team||'ca').toLowerCase()}`}>
              {m.avatar_initials || m.full_name?.[0] || m.sender_name?.[0] || '?'}
            </div>
            <div style={{ maxWidth:'70%' }}>
              <div style={{ fontSize:'0.65rem', color:'var(--muted)', marginBottom:'0.1rem', textAlign:isMe(m)?'right':'left' }}>
                {m.full_name||m.sender_name} · {new Date(m.sent_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}
              </div>
              {m.parent_message_id && (
                <div style={{ fontSize:'0.7rem', color:'var(--muted)', fontStyle:'italic', marginBottom:'0.2rem', borderLeft:'2px solid var(--border)', paddingLeft:'0.4rem' }}>
                  ↩ Reply
                </div>
              )}
              <div style={{
                padding:'0.5rem 0.7rem', borderRadius: isMe(m)?'12px 12px 2px 12px':'12px 12px 12px 2px',
                background: isMe(m)?'var(--ca)':'var(--paper)', color: isMe(m)?'white':'var(--ink)',
                fontSize:'0.8rem', lineHeight:1.5
              }}>
                {m.content}
              </div>
              {m.linked_task_id && (
                <div style={{ fontSize: '0.65rem', color: 'var(--ca)', marginTop: '0.15rem', fontWeight: 500 }}>📋 Linked to task</div>
              )}
              <div style={{ display:'flex', gap:'0.3rem', marginTop:'0.2rem', justifyContent:isMe(m)?'flex-end':'flex-start' }}>
                <button className="btn btn-xs btn-ghost" style={{ fontSize:'0.65rem', padding:'0.1rem 0.3rem' }} onClick={()=>setReplyTo(m)}>↩ Reply</button>
                {!m.linked_task_id && (
                  <button className="btn btn-xs btn-ghost" style={{ fontSize:'0.65rem', padding:'0.1rem 0.3rem' }}
                    onClick={()=>{setTaskModal(m);setTaskForm({ title: m.content?.substring(0,80) || '', assignee: '', priority: 'Medium' })}}>📋 Task</button>
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={chatEnd} />
      </div>

      {/* Reply indicator */}
      {replyTo && (
        <div style={{ padding:'0.4rem 0.6rem', background:'var(--paper)', borderRadius:'var(--radius-sm)', marginBottom:'0.4rem', fontSize:'0.75rem', display:'flex', justifyContent:'space-between' }}>
          <span>↩ Replying to {replyTo.full_name||replyTo.sender_name}: "{replyTo.content?.substring(0,40)}..."</span>
          <button onClick={()=>setReplyTo(null)} style={{ background:'none', border:'none', cursor:'pointer' }}>✕</button>
        </div>
      )}

      {/* Input */}
      <form onSubmit={send} style={{ display:'flex', gap:'0.4rem' }}>
        <input className="form-input" placeholder="Type a message... (use @name to mention)" value={input} onChange={e=>setInput(e.target.value)} style={{ flex:1, fontSize:'0.85rem' }} />
        <button type="submit" className="btn btn-ca btn-sm" disabled={sending||!input.trim()}>
          {sending ? '...' : 'Send'}
        </button>
      </form>

      {/* Task conversion modal */}
      {taskModal && (
        <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.4)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={() => setTaskModal(null)}>
          <div style={{ background:'white', borderRadius:'var(--radius-lg)', padding:'1.5rem', width:'440px' }}
            onClick={e => e.stopPropagation()}>
            <h4 style={{ marginBottom:'0.5rem', fontFamily:'Syne', fontWeight:700 }}>Convert Message to Task</h4>
            <p style={{ fontSize:'0.78rem', color:'var(--muted)', marginBottom:'0.75rem', background:'var(--paper)', padding:'0.5rem', borderRadius:'var(--radius-sm)', borderLeft:'3px solid var(--ca)' }}>
              "{taskModal.content?.substring(0,120)}{taskModal.content?.length > 120 ? '...' : ''}"
            </p>
            <div style={{ display:'flex', flexDirection:'column', gap:'0.6rem' }}>
              <div>
                <label className="form-label">Task Title *</label>
                <input className="form-input" placeholder="Task title" value={taskForm.title}
                  onChange={e=>setTaskForm(p=>({...p, title: e.target.value}))} />
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem' }}>
                <div>
                  <label className="form-label">Assign To</label>
                  <select className="form-input" value={taskForm.assignee} onChange={e=>setTaskForm(p=>({...p, assignee: e.target.value}))}>
                    <option value="">Unassigned</option>
                    {(members||[]).map(m => <option key={m.id} value={m.id}>{m.full_name} ({m.team})</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Priority</label>
                  <select className="form-input" value={taskForm.priority} onChange={e=>setTaskForm(p=>({...p, priority: e.target.value}))}>
                    <option>Critical</option><option>High</option><option>Medium</option><option>Low</option>
                  </select>
                </div>
              </div>
            </div>
            <div style={{ display:'flex', gap:'0.5rem', justifyContent:'flex-end', marginTop:'1rem' }}>
              <button className="btn btn-ghost btn-sm" onClick={()=>setTaskModal(null)}>Cancel</button>
              <button className="btn btn-ca btn-sm" onClick={convertToTask} disabled={!taskForm.title.trim()}>Create Task</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatTab;
