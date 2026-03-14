import React, { useEffect, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { tasksAPI, adminAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';

const COLUMNS = [
  { status: 'todo',        label: '📋 To Do',       color: 'var(--muted)' },
  { status: 'in_progress', label: '🔄 In Progress',  color: 'var(--ca)'   },
  { status: 'done',        label: '✅ Done',          color: 'var(--success)' },
];

const priorityBadge = (p) => ({
  High:   'badge-danger',
  Medium: 'badge-warning',
  Low:    'badge-muted',
}[p] || 'badge-muted');

const TaskCard = ({ task, onStatusChange, userId }) => {
  const isOverdue = task.due_date && task.status !== 'done' && new Date(task.due_date) < new Date();
  const nextStatus = { todo: 'in_progress', in_progress: 'done', done: null };
  const canAdvance = nextStatus[task.status];

  return (
    <div style={{
      background: 'white',
      border: `1.5px solid ${isOverdue ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`,
      borderRadius: 'var(--radius-md)',
      padding: '0.9rem 1rem',
      marginBottom: '0.5rem',
      boxShadow: 'var(--shadow-sm)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
        <div style={{
          fontWeight: 600, fontSize: '0.86rem', lineHeight: 1.4,
          textDecoration: task.status === 'done' ? 'line-through' : 'none',
          color: task.status === 'done' ? 'var(--muted)' : 'var(--ink)',
          flex: 1, marginRight: '0.5rem',
        }}>
          {task.title}
        </div>
        <span className={`badge ${priorityBadge(task.priority)}`} style={{ flexShrink: 0 }}>{task.priority}</span>
      </div>

      {task.description && (
        <p style={{ fontSize: '0.76rem', color: 'var(--muted)', marginBottom: '0.5rem', lineHeight: 1.4 }}>
          {task.description}
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {task.assigned_to_name && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <div className={`avatar avatar-sm avatar-${task.assigned_to_team?.toLowerCase() || 'ca'}`}>
                {task.avatar_initials || task.assigned_to_team?.[0] || '?'}
              </div>
              <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>{task.assigned_to_name}</span>
            </div>
          )}
          {task.due_date && (
            <span style={{ fontSize: '0.7rem', color: isOverdue ? 'var(--danger)' : 'var(--muted)', fontWeight: isOverdue ? 700 : 400 }}>
              {isOverdue ? '⚠️ ' : ''}Due {new Date(task.due_date).toLocaleDateString()}
            </span>
          )}
        </div>
        {canAdvance && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem' }}
            onClick={() => onStatusChange(task.id, nextStatus[task.status])}
          >
            {task.status === 'todo' ? 'Start →' : 'Done ✓'}
          </button>
        )}
      </div>
    </div>
  );
};

const Tasks = () => {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [envUsers, setEnvUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', priority: 'Medium', dueDate: '', assignedTo: '' });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');
  const [viewMine, setViewMine] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = viewMine ? { assignedTo: user.id } : {};
      const [tRes, uRes] = await Promise.all([
        tasksAPI.list(params),
        adminAPI.getUsers({ status: 'active' }),
      ]);
      setTasks(tRes.data.tasks || []);
      setEnvUsers(uRes.data.users || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [viewMine]);

  const handleStatusChange = async (id, newStatus) => {
    try {
      await tasksAPI.updateStatus(id, newStatus);
      setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: newStatus } : t));
    } catch (e) {
      alert(e.response?.data?.message || 'Failed to update.');
    }
  };

  const handleCreate = async () => {
    if (!form.title.trim()) { setCreateError('Task title is required.'); return; }
    setCreateLoading(true); setCreateError('');
    try {
      await tasksAPI.create({
        title: form.title,
        description: form.description || undefined,
        priority: form.priority,
        dueDate: form.dueDate || undefined,
        assignedTo: form.assignedTo || undefined,
      });
      setShowCreate(false);
      setForm({ title: '', description: '', priority: 'Medium', dueDate: '', assignedTo: '' });
      load();
    } catch (e) {
      setCreateError(e.response?.data?.message || 'Failed to create task.');
    }
    setCreateLoading(false);
  };

  const tasksByStatus = (status) => tasks.filter((t) => t.status === status);

  return (
    <DashboardLayout title="Task Board" subtitle="Assign and track team tasks">
      {/* Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className={`btn btn-sm ${!viewMine ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setViewMine(false)}>All Tasks</button>
          <button className={`btn btn-sm ${viewMine ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setViewMine(true)}>My Tasks</button>
        </div>
        <button className="btn btn-ca" onClick={() => setShowCreate(true)}>+ New Task</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem' }}>
          <span className="spinner spinner-dark" style={{ width: 32, height: 32 }} />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.25rem', alignItems: 'start' }}>
          {COLUMNS.map((col) => {
            const colTasks = tasksByStatus(col.status);
            return (
              <div key={col.status}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.85rem' }}>
                  <h3 style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: '0.9rem' }}>{col.label}</h3>
                  <span style={{
                    background: 'var(--paper)', border: '1.5px solid var(--border)',
                    borderRadius: '1rem', padding: '0.1rem 0.5rem',
                    fontSize: '0.72rem', fontWeight: 700, color: col.color,
                  }}>{colTasks.length}</span>
                </div>
                <div style={{ minHeight: 100 }}>
                  {colTasks.length === 0 ? (
                    <div style={{ padding: '1.5rem', border: '1.5px dashed var(--border)', borderRadius: 'var(--radius-md)', textAlign: 'center', fontSize: '0.8rem', color: 'var(--muted)' }}>
                      No tasks
                    </div>
                  ) : colTasks.map((t) => (
                    <TaskCard key={t.id} task={t} onStatusChange={handleStatusChange} userId={user.id} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Task Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">New Task</h2>
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
              Create a task and optionally assign it to a team member.
            </p>
            {createError && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>⚠️ {createError}</div>}

            <div className="form-group">
              <label className="form-label">Task Title *</label>
              <input className="form-input" placeholder="e.g. Review Q3 financial report" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea className="form-input" rows={3} placeholder="Optional details..." value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} style={{ resize: 'vertical' }} />
            </div>
            <div className="form-row">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Priority</label>
                <select className="form-input" value={form.priority} onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}>
                  <option>High</option>
                  <option>Medium</option>
                  <option>Low</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Due Date</label>
                <input type="date" className="form-input" value={form.dueDate} onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))} min={new Date().toISOString().split('T')[0]} />
              </div>
            </div>
            <div className="form-group" style={{ marginTop: '0.75rem' }}>
              <label className="form-label">Assign To</label>
              <select className="form-input" value={form.assignedTo} onChange={(e) => setForm((p) => ({ ...p, assignedTo: e.target.value }))}>
                <option value="">Unassigned</option>
                {envUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name} ({u.team})</option>
                ))}
              </select>
            </div>

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-ca" onClick={handleCreate} disabled={createLoading}>
                {createLoading ? <><span className="spinner" />Creating...</> : 'Create Task'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default Tasks;
