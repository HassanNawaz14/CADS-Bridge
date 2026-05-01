import React, { useState, useCallback, useEffect } from 'react';
import { tasksAPI } from '../../services/api';

const COLUMNS = [
  { status: 'todo', label: '📋 To Do', color: 'var(--muted)' },
  { status: 'in_progress', label: '🔄 In Progress', color: 'var(--ca)' },
  { status: 'in_review', label: '🔍 In Review', color: 'var(--warning)' },
  { status: 'done', label: '✅ Done', color: 'var(--success)' },
];

const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
const TYPES = [
  { value: 'DATA_TASK', label: 'Data Task' },
  { value: 'FINANCIAL_REVIEW', label: 'Financial Review' },
  { value: 'MODEL_VALIDATION', label: 'Model Validation' },
  { value: 'DOCUMENTATION', label: 'Documentation' },
  { value: 'OTHER', label: 'Other' },
];

const priorityColor = (p) => ({ Critical: 'var(--danger)', High: '#F97316', Medium: 'var(--warning)', Low: 'var(--muted)' }[p] || 'var(--muted)');
const nextStatus = { todo: 'in_progress', in_progress: 'in_review', in_review: 'done' };
const advanceLabel = { todo: 'Start →', in_progress: 'Review →', in_review: 'Done ✓' };

const TasksTab = ({ projectId, tasks, setTasks, members, user, onNotify, socket, onRefresh }) => {
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', priority: 'Medium', type: 'OTHER', dueDate: '', assignedTo: '', blockedBy: [] });
  const [creating, setCreating] = useState(false);
  const [comment, setComment] = useState('');
  const [filter, setFilter] = useState({ assignee: '', priority: '', search: '' });

  const isAdmin = ['admin', 'platform_admin', 'super_admin'].includes(user?.role);

  const loadTasks = useCallback(async () => {
    try {
      const r = await tasksAPI.list({ projectId });
      setTasks(r.data?.tasks || []);
    } catch { /* silent */ }
  }, [projectId, setTasks]);

  // Refresh detail when tasks change
  useEffect(() => {
    if (detail) {
      const fresh = tasks.find(t => t.id === detail.id);
      if (fresh) setDetail(fresh);
    }
  }, [tasks, detail]);

  const createTask = async () => {
    if (form.title.trim().length < 3) { onNotify('error', 'Task title must be at least 3 characters'); return; }
    setCreating(true);
    try {
      await tasksAPI.create({
        title: form.title, description: form.description || undefined,
        priority: form.priority, type: form.type,
        dueDate: form.dueDate || undefined,
        assignedTo: form.assignedTo || undefined,
        projectId, blockedBy: form.blockedBy,
      });
      onNotify('success', 'Task created');
      setShowCreate(false);
      setForm({ title: '', description: '', priority: 'Medium', type: 'OTHER', dueDate: '', assignedTo: '', blockedBy: [] });
      loadTasks();
      onRefresh?.();
    } catch (e) {
      const msg = e.response?.data?.errors?.[0]?.msg || e.response?.data?.message || 'Failed to create task';
      onNotify('error', msg);
    } finally { setCreating(false); }
  };

  const changeStatus = async (id, newStatus) => {
    try {
      await tasksAPI.updateStatus(id, newStatus);
      onNotify('success', `Task moved to ${newStatus.replace('_', ' ')}`);
      loadTasks();
      onRefresh?.();
    } catch (e) { onNotify('error', e.response?.data?.message || 'Failed'); }
  };

  const addComment = async (taskId) => {
    if (!comment.trim()) return;
    try {
      await tasksAPI.addComment(taskId, comment.trim());
      setComment('');
      onNotify('success', 'Comment added');
      loadTasks();
    } catch { onNotify('error', 'Failed to add comment'); }
  };

  const adminForceClose = async (taskId) => {
    const reason = prompt('Enter reason for force-closing this task:');
    if (!reason?.trim()) return;
    try {
      await tasksAPI.adminUpdate(taskId, { forceCloseReason: reason });
      onNotify('success', 'Task force-closed');
      loadTasks();
      onRefresh?.();
    } catch { onNotify('error', 'Failed'); }
  };

  // Filter tasks
  const filtered = tasks.filter(t => {
    if (filter.assignee && t.assigned_to !== filter.assignee) return false;
    if (filter.priority && t.priority !== filter.priority) return false;
    if (filter.search && !t.title.toLowerCase().includes(filter.search.toLowerCase())) return false;
    return true;
  });

  const byStatus = (status) => filtered.filter(t => t.status === status);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h3 style={{ fontFamily: 'Syne', fontWeight: 700, margin: 0, fontSize: '1rem' }}>📋 Project Tasks</h3>
          <span style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 10, padding: '0.1rem 0.5rem', fontSize: '0.7rem', fontWeight: 600 }}>
            {tasks.length} total · {tasks.filter(t => t.status === 'done').length} done
          </span>
        </div>
        <button className="btn btn-ca btn-sm" onClick={() => setShowCreate(true)}>+ New Task</button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <input className="form-input" placeholder="🔍 Search tasks..." value={filter.search}
          onChange={e => setFilter(p => ({ ...p, search: e.target.value }))}
          style={{ flex: '1 1 150px', fontSize: '0.78rem', padding: '0.35rem 0.6rem' }} />
        <select className="form-input" value={filter.assignee} onChange={e => setFilter(p => ({ ...p, assignee: e.target.value }))}
          style={{ flex: '0 0 auto', fontSize: '0.78rem', padding: '0.35rem' }}>
          <option value="">All Members</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.full_name} ({m.team})</option>)}
        </select>
        <select className="form-input" value={filter.priority} onChange={e => setFilter(p => ({ ...p, priority: e.target.value }))}
          style={{ flex: '0 0 auto', fontSize: '0.78rem', padding: '0.35rem' }}>
          <option value="">All Priorities</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* Kanban Board */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.6rem', flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {COLUMNS.map(col => {
          const colTasks = byStatus(col.status);
          return (
            <div key={col.status} style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem', padding: '0.4rem 0.6rem', background: 'var(--paper)', borderRadius: 'var(--radius-md)', borderLeft: `3px solid ${col.color}` }}>
                <span style={{ fontWeight: 700, fontSize: '0.8rem' }}>{col.label}</span>
                <span style={{ fontSize: '0.7rem', fontWeight: 600, color: col.color, background: 'white', borderRadius: 10, padding: '0.05rem 0.4rem' }}>{colTasks.length}</span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {colTasks.length === 0 && (
                  <div style={{ padding: '1.5rem 0.5rem', border: '1.5px dashed var(--border)', borderRadius: 'var(--radius-md)', textAlign: 'center', fontSize: '0.75rem', color: 'var(--muted)' }}>No tasks</div>
                )}
                {colTasks.map(t => {
                  const isOverdue = t.due_date && t.status !== 'done' && new Date(t.due_date) < new Date();
                  const blockingTasks = (t.blockedBy || []).map(bid => tasks.find(ot => ot.id === bid)).filter(ot => ot && ot.status !== 'done');
                  const isBlocked = blockingTasks.length > 0;
                  const canAdvance = nextStatus[t.status] && !isBlocked;
                  return (
                    <div key={t.id} onClick={() => setDetail(t)} style={{
                      background: 'white', border: `1.5px solid ${isOverdue ? '#FCA5A5' : detail?.id === t.id ? 'var(--ca)' : 'var(--border)'}`,
                      borderRadius: 'var(--radius-md)', padding: '0.6rem', cursor: 'pointer',
                      transition: 'all 0.15s', boxShadow: detail?.id === t.id ? '0 0 0 2px rgba(59,130,246,0.15)' : 'var(--shadow-sm)'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.3rem' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.8rem', flex: 1, lineHeight: 1.3,
                          textDecoration: t.status === 'done' ? 'line-through' : 'none',
                          color: t.status === 'done' ? 'var(--muted)' : 'var(--ink)' }}>{t.title}</div>
                        <span style={{ fontSize: '0.6rem', padding: '0.1rem 0.3rem', borderRadius: 4, background: `${priorityColor(t.priority)}18`, color: priorityColor(t.priority), fontWeight: 600, flexShrink: 0, marginLeft: '0.3rem' }}>{t.priority}</span>
                      </div>
                      {isOverdue && <div style={{ fontSize: '0.65rem', color: 'var(--danger)', fontWeight: 600, marginBottom: '0.2rem' }}>⚠️ Overdue</div>}
                      {isBlocked && (
                        <div style={{ fontSize: '0.65rem', color: 'var(--danger)', marginBottom: '0.2rem', fontWeight: 600 }}>
                          🔒 Blocked by {blockingTasks.length} task(s): {blockingTasks.map(bt => bt.title).join(', ')}
                        </div>
                      )}
                      <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginBottom: '0.3rem' }}>
                        {t.type?.replace(/_/g, ' ') || 'OTHER'}
                        {t.due_date && <span> · Due {new Date(t.due_date).toLocaleDateString()}</span>}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          {t.assigned_to_name && (
                            <>
                              <div style={{ width: 20, height: 20, borderRadius: '50%', fontSize: '0.55rem', fontWeight: 600, color: 'white',
                                background: t.assigned_to_team === 'CA' ? 'var(--ca)' : 'var(--ds)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {t.avatar_initials || t.assigned_to_name?.[0]}
                              </div>
                              <span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>{t.assigned_to_name}</span>
                            </>
                          )}
                        </div>
                        {canAdvance && (
                          <button className="btn btn-xs btn-ghost" style={{ fontSize: '0.65rem', padding: '0.15rem 0.4rem' }}
                            onClick={(e) => { e.stopPropagation(); changeStatus(t.id, nextStatus[t.status]); }}>
                            {advanceLabel[t.status]}
                          </button>
                        )}
                      </div>
                      <div style={{ fontSize: '0.6rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
                        💬 {t.comments?.length || 0}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Task Detail Panel */}
      {detail && (
        <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: '420px', background: 'white', boxShadow: '-4px 0 20px rgba(0,0,0,0.1)', zIndex: 999, display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--border)' }}>
          <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <h4 style={{ margin: 0, fontFamily: 'Syne', fontWeight: 700, fontSize: '1rem' }}>{detail.title}</h4>
              <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: 4, background: `${priorityColor(detail.priority)}18`, color: priorityColor(detail.priority), fontWeight: 600 }}>{detail.priority}</span>
                <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: 4, background: 'var(--paper)', color: 'var(--muted)' }}>{detail.type?.replace(/_/g, ' ')}</span>
                <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: 4, background: detail.status === 'done' ? '#DCFCE7' : '#EFF6FF', color: detail.status === 'done' ? 'var(--success)' : 'var(--ca)' }}>{detail.status.replace('_', ' ')}</span>
              </div>
            </div>
            <button onClick={() => setDetail(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--muted)' }}>✕</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
            {detail.description && <div style={{ fontSize: '0.82rem', lineHeight: 1.5, marginBottom: '1rem', padding: '0.6rem', background: 'var(--paper)', borderRadius: 'var(--radius-md)' }}>{detail.description}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1rem', fontSize: '0.78rem' }}>
              <div><strong>Assignee:</strong> {detail.assigned_to_name || 'Unassigned'}</div>
              <div><strong>Created by:</strong> {detail.created_by_name}</div>
              <div><strong>Due:</strong> {detail.due_date ? new Date(detail.due_date).toLocaleDateString() : 'No due date'}</div>
              <div><strong>Created:</strong> {new Date(detail.created_at).toLocaleDateString()}</div>
            </div>
            {(() => {
              const activeBlockers = (detail.blockedBy || []).map(bid => tasks.find(ot => ot.id === bid)).filter(ot => ot && ot.status !== 'done');
              if (activeBlockers.length === 0) return null;
              return (
                <div style={{ marginBottom: '1rem', padding: '0.6rem', background: '#FEF2F2', borderRadius: 'var(--radius-md)', border: '1px solid #FECACA' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--danger)', fontWeight: 700, marginBottom: '0.3rem' }}>🔒 Blocked by {activeBlockers.length} active task(s):</div>
                  <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.72rem', color: '#B91C1C' }}>
                    {activeBlockers.map(bt => <li key={bt.id}>{bt.title} ({bt.status.replace('_', ' ')})</li>)}
                  </ul>
                </div>
              );
            })()}
            {/* Status actions */}
            {detail.status !== 'done' && (
              <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                {nextStatus[detail.status] && (
                  <button className="btn btn-ca btn-sm" onClick={() => { changeStatus(detail.id, nextStatus[detail.status]); }}>
                    {advanceLabel[detail.status]}
                  </button>
                )}
                {isAdmin && <button className="btn btn-sm" style={{ background: 'var(--danger)', color: 'white', border: 'none' }} onClick={() => adminForceClose(detail.id)}>Force Close</button>}
              </div>
            )}
            {detail.force_closed_reason && (
              <div style={{ marginBottom: '1rem', padding: '0.5rem', background: '#FEF3C7', borderRadius: 'var(--radius-md)', fontSize: '0.78rem' }}>
                <strong>Force-closed:</strong> {detail.force_closed_reason}
              </div>
            )}
            {/* Comments */}
            <div>
              <h5 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>💬 Comments ({detail.comments?.length || 0})</h5>
              {(detail.comments || []).map(c => (
                <div key={c.id} style={{ padding: '0.5rem', marginBottom: '0.3rem', background: 'var(--paper)', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem' }}>
                  <strong style={{ color: c.author_team === 'CA' ? 'var(--ca)' : 'var(--ds)' }}>{c.author_name}</strong>
                  <span style={{ color: 'var(--muted)', fontSize: '0.65rem', marginLeft: '0.4rem' }}>{new Date(c.created_at).toLocaleString()}</span>
                  <div style={{ marginTop: '0.2rem' }}>{c.comment_text}</div>
                </div>
              ))}
              <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.4rem' }}>
                <input className="form-input" placeholder="Add comment..." value={comment} onChange={e => setComment(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addComment(detail.id)} style={{ flex: 1, fontSize: '0.78rem' }} />
                <button className="btn btn-ca btn-sm" onClick={() => addComment(detail.id)} disabled={!comment.trim()}>Add</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Task Modal */}
      {showCreate && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowCreate(false)}>
          <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '1.5rem', width: '500px', maxHeight: '85vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ fontFamily: 'Syne', fontWeight: 700, marginBottom: '1rem' }}>Create Project Task</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <label className="form-label">Title *</label>
                <input className="form-input" placeholder="e.g. Review Q3 financial report" value={form.title}
                  onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Description</label>
                <textarea className="form-input" rows={3} placeholder="Details..." value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))} style={{ resize: 'vertical' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label className="form-label">Priority</label>
                  <select className="form-input" value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}>
                    {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Type</label>
                  <select className="form-input" value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
                    {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Due Date</label>
                  <input type="date" className="form-input" value={form.dueDate}
                    onChange={e => setForm(p => ({ ...p, dueDate: e.target.value }))}
                    min={new Date().toISOString().split('T')[0]} />
                </div>
              </div>
              <div>
                <label className="form-label">Assign To</label>
                <select className="form-input" value={form.assignedTo} onChange={e => setForm(p => ({ ...p, assignedTo: e.target.value }))}>
                  <option value="">Unassigned</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.full_name} ({m.team})</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Blocked By (hold Ctrl to multi-select)</label>
                <select className="form-input" multiple value={form.blockedBy}
                  onChange={e => setForm(p => ({ ...p, blockedBy: Array.from(e.target.selectedOptions).map(o => o.value) }))}
                  style={{ minHeight: 70 }}>
                  {tasks.filter(t => t.status !== 'done').map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
              <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-ca" onClick={createTask} disabled={creating}>{creating ? 'Creating...' : 'Create Task'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TasksTab;
