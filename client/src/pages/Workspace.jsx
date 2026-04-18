import React, { useEffect, useState, useRef } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { projectsAPI, workspaceAPI, tasksAPI, conflictsAPI } from '../services/api';
import DashboardLayout from '../components/DashboardLayout';

const Workspace = () => {
  const { id } = useParams();
  const { user, getSocket } = useAuth();
  const [project, setProject] = useState(null);
  const [messages, setMessages] = useState([]);
  const [files, setFiles] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [msgInput, setMsgInput] = useState('');
  const [tab, setTab] = useState('chat'); // 'chat' | 'files' | 'tasks' | 'history' | 'breaches' | 'annotations' | 'conflicts'
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notMember, setNotMember] = useState(false);
  const [history, setHistory] = useState([]);
  const [breaches, setBreaches] = useState([]);
  const [annotations, setAnnotations] = useState([]);
  const [conflicts, setConflicts] = useState([]);
  const [fileMeta, setFileMeta] = useState({ outputType: 'OTHER', changeNote: '', publish: false });
  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [pRes, mRes, fRes, tRes, hRes, bRes, aRes] = await Promise.all([
          projectsAPI.get(id),
          workspaceAPI.getMessages(id),
          workspaceAPI.getFiles(id),
          tasksAPI.list({ projectId: id }),
          projectsAPI.history(id),
          workspaceAPI.getBreaches(id),
          workspaceAPI.getAnnotations(id),
        ]);
        setProject(pRes.data.project);
        setMessages(mRes.data.messages || []);
        setFiles(fRes.data.files || []);
        setTasks(tRes.data.tasks || []);
        setHistory(hRes.data.history || []);
        setBreaches(bRes.data.breaches || []);
        setAnnotations(aRes.data.annotations || []);
        const cRes = await conflictsAPI.list({ projectId: id });
        setConflicts(cRes.data.conflicts || []);
      } catch (e) {
        if (e.response?.status === 403) setNotMember(true);
      }
      setLoading(false);
    };
    load();
  }, [id]);

  // Join socket room
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('join_project', id);
    socket.on('new_message', (msg) => setMessages((p) => [...p, msg]));
    socket.on('new_file', (file) => setFiles((p) => [file, ...p]));
    return () => {
      socket.emit('leave_project', id);
      socket.off('new_message');
      socket.off('new_file');
    };
  }, [id, getSocket]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!msgInput.trim() || sending) return;
    setSending(true);
    try {
      await workspaceAPI.sendMessage(id, msgInput);
      setMsgInput('');
    } catch {}
    setSending(false);
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('outputType', fileMeta.outputType);
      form.append('changeNote', fileMeta.changeNote);
      form.append('publish', fileMeta.publish ? 'true' : 'false');
      await workspaceAPI.uploadFile(id, form);
      if (fileMeta.publish) {
        const bRes = await workspaceAPI.getBreaches(id);
        setBreaches(bRes.data.breaches || []);
      }
    } catch (e) {
      alert(e.response?.data?.message || 'Upload failed.');
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleStatusChange = async (taskId, newStatus) => {
    try {
      await tasksAPI.updateStatus(taskId, newStatus);
      setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: newStatus } : t));
    } catch (e) {
      alert(e.response?.data?.message || 'Failed to update task.');
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (notMember) return <Navigate to="/projects" replace />;

  if (loading) return (
    <DashboardLayout title="Loading workspace...">
      <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
        <span className="spinner spinner-dark" style={{ width: 32, height: 32 }} />
      </div>
    </DashboardLayout>
  );

  if (!project) return (
    <DashboardLayout title="Workspace">
      <div className="alert alert-error">Project not found.</div>
    </DashboardLayout>
  );

  const members = project.members || [];

  return (
    <DashboardLayout title={project.name} subtitle="Shared Collaborative Workspace">
      {/* Team bar */}
      <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1.5px solid var(--border)', padding: '0.75rem 1.25rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Team</span>
        {members.map((m) => (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.25rem 0.7rem', background: 'var(--paper)', borderRadius: '1rem', fontSize: '0.8rem' }}>
            <div className={`avatar avatar-sm avatar-${m.team.toLowerCase()}`}>{m.avatar_initials || m.team[0]}</div>
            <span>{m.full_name} <span style={{ color: 'var(--muted)' }}>({m.team})</span></span>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem' }}>
        {['chat', 'files', 'tasks', 'annotations', 'conflicts', 'history', 'breaches'].map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`btn btn-sm ${tab === t ? 'btn-primary' : 'btn-ghost'}`}>
            {t === 'chat' ? '💬 Chat' : t === 'files' ? `📁 Files (${files.length})` : t === 'tasks' ? `✅ Tasks (${tasks.length})` : t === 'annotations' ? '📝 Annotations' : t === 'conflicts' ? `⚔️ Conflicts (${conflicts.filter((c) => c.status !== 'RESOLVED').length})` : t === 'history' ? '📜 History' : `⚠️ Breaches (${breaches.filter((b) => b.status !== 'RESOLVED').length})`}
          </button>
        ))}
      </div>

      {/* Chat */}
      {tab === 'chat' && (
        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 320px)', minHeight: 400 }}>
          <div style={{ flex: 1, overflowY: 'auto', background: 'white', borderRadius: 'var(--radius-lg)', border: '1.5px solid var(--border)', padding: '1rem', marginBottom: '0.75rem' }}>
            {messages.length === 0 ? (
              <div className="empty-state"><div className="empty-icon">💬</div><p>No messages yet. Start the conversation!</p></div>
            ) : messages.map((m) => {
              const isMe = m.sender_id === user.id;
              return (
                <div key={m.id} style={{ marginBottom: '0.85rem', display: 'flex', flexDirection: isMe ? 'row-reverse' : 'row', gap: '0.6rem', alignItems: 'flex-start' }}>
                  <div className={`avatar avatar-sm avatar-${m.team?.toLowerCase() || 'ca'}`}>{m.avatar_initials || m.team?.[0] || '?'}</div>
                  <div style={{ maxWidth: '70%' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginBottom: '0.2rem', textAlign: isMe ? 'right' : 'left' }}>
                      {m.full_name} · {new Date(m.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div style={{
                      padding: '0.6rem 0.9rem',
                      borderRadius: isMe ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                      background: isMe ? 'var(--ca)' : 'var(--paper)',
                      color: isMe ? 'white' : 'var(--ink)',
                      fontSize: '0.88rem',
                      lineHeight: 1.5,
                    }}>{m.content}</div>
                  </div>
                </div>
              );
            })}
            <div ref={chatEndRef} />
          </div>
          <form onSubmit={sendMessage} style={{ display: 'flex', gap: '0.6rem' }}>
            <input
              className="form-input"
              placeholder="Type a message..."
              value={msgInput}
              onChange={(e) => setMsgInput(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-ca" disabled={sending || !msgInput.trim()}>
              {sending ? <span className="spinner" /> : 'Send'}
            </button>
          </form>
        </div>
      )}

      {/* Files */}
      {tab === 'files' && (
        <div>
          <div className="card" style={{ marginBottom: '0.9rem', padding: '0.9rem 1rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: '0.6rem', alignItems: 'end' }}>
              <div>
                <label className="form-label">Output Type</label>
                <select className="form-input" value={fileMeta.outputType} onChange={(e) => setFileMeta((p) => ({ ...p, outputType: e.target.value }))}>
                  <option>MODEL_REPORT</option>
                  <option>FINANCIAL_ANALYSIS</option>
                  <option>JOINT_SUMMARY</option>
                  <option>RAW_DATA</option>
                  <option>OTHER</option>
                </select>
              </div>
              <div>
                <label className="form-label">Change Note</label>
                <input className="form-input" value={fileMeta.changeNote} onChange={(e) => setFileMeta((p) => ({ ...p, changeNote: e.target.value }))} placeholder="e.g., Updated with Q3 actuals." />
              </div>
              <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.8rem', color: 'var(--muted)' }}>
                <input type="checkbox" checked={fileMeta.publish} onChange={(e) => setFileMeta((p) => ({ ...p, publish: e.target.checked }))} />
                Run pre-check
              </label>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <input type="file" ref={fileInputRef} onChange={handleUpload} style={{ display: 'none' }} />
            <button className="btn btn-ca" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? <><span className="spinner" />Uploading...</> : '+ Upload File'}
            </button>
          </div>
          {files.length === 0 ? (
            <div className="empty-state" style={{ padding: '4rem' }}>
              <div className="empty-icon">📁</div>
              <p>No files uploaded yet.</p>
            </div>
          ) : (
            <div className="card">
              {files.map((f, i) => (
                <div key={f.id} style={{ padding: '0.85rem 1.25rem', borderBottom: i < files.length - 1 ? '1px solid var(--border)' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ fontSize: '1.3rem' }}>
                      {f.mime_type?.includes('pdf') ? '📄' : f.mime_type?.includes('sheet') ? '📊' : f.mime_type?.includes('image') ? '🖼️' : '📎'}
                    </span>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: '0.88rem' }}>{f.original_name}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                        {formatFileSize(f.file_size)} · {f.uploaded_by_name} ({f.uploaded_by_team}) · {new Date(f.uploaded_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <a href={workspaceAPI.downloadFile(id, f.id)} className="btn btn-ghost btn-sm" target="_blank" rel="noreferrer">
                      ⬇ Download
                    </a>
                    <button className="btn btn-ghost btn-sm" onClick={() => {
                      // Simple annotation modal for now
                      const type = prompt('Annotation type (FINANCIAL_CONSTRAINT, REGULATORY_FLAG, CLARIFICATION, APPROVAL):', 'CLARIFICATION');
                      if (!type) return;
                      const body = prompt('Annotation body:');
                      if (!body) return;
                      const selectedText = prompt('Selected text (optional):');
                      workspaceAPI.createAnnotation(id, {
                        documentId: f.id,
                        type,
                        body,
                        selectedText: selectedText || null,
                        requiresResolution: type === 'FINANCIAL_CONSTRAINT' || type === 'REGULATORY_FLAG',
                      }).then(() => {
                        workspaceAPI.getAnnotations(id).then(res => setAnnotations(res.data.annotations || []));
                      }).catch(e => alert(e.response?.data?.message || 'Failed to create annotation'));
                    }}>
                      📝 Annotate
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tasks */}
      {tab === 'tasks' && (
        <div>
          {['todo', 'in_progress', 'in_review', 'done'].map((status) => {
            const statusTasks = tasks.filter((t) => t.status === status);
            const labels = { todo: '📋 To Do', in_progress: '🔄 In Progress', in_review: '🕵️ In Review', done: '✅ Done' };
            const nextStatus = { todo: 'in_progress', in_progress: 'in_review', in_review: 'done', done: null };
            return (
              <div key={status} style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.6rem' }}>
                  <h4 style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: '0.9rem' }}>{labels[status]}</h4>
                  <span className="badge badge-muted">{statusTasks.length}</span>
                </div>
                {statusTasks.length === 0 ? (
                  <div style={{ padding: '1rem', background: 'white', borderRadius: 'var(--radius-md)', border: '1.5px dashed var(--border)', textAlign: 'center', fontSize: '0.8rem', color: 'var(--muted)' }}>
                    No tasks here
                  </div>
                ) : statusTasks.map((t) => (
                  <div key={t.id} className="card" style={{ marginBottom: '0.5rem', padding: '0.85rem 1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, fontSize: '0.88rem', textDecoration: t.status === 'done' ? 'line-through' : 'none', color: t.status === 'done' ? 'var(--muted)' : 'inherit' }}>
                        {t.title}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '0.15rem' }}>
                        {t.assigned_to_name ? `→ ${t.assigned_to_name}` : 'Unassigned'}
                        {t.due_date && ` · Due ${new Date(t.due_date).toLocaleDateString()}`}
                        <span className={`badge badge-${t.priority === 'High' ? 'danger' : t.priority === 'Low' ? 'muted' : 'warning'}`} style={{ marginLeft: '0.4rem' }}>{t.priority}</span>
                      </div>
                    </div>
                    {nextStatus[status] && (t.assigned_to_name === user.fullName || t.created_by_name === user.fullName) && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleStatusChange(t.id, nextStatus[status])}
                      >
                        {status === 'todo' ? 'Start →' : status === 'in_progress' ? 'Review →' : 'Done ✓'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* History */}
      {tab === 'history' && (
        <div>
          {history.length === 0 ? (
            <div className="empty-state" style={{ padding: '4rem' }}>
              <div className="empty-icon">📜</div>
              <p>No history yet.</p>
            </div>
          ) : (
            <div className="card">
              {history.map((h, i) => (
                <div key={i} style={{ padding: '0.85rem 1.25rem', borderBottom: i < history.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--muted)' }}>
                      {h.change_type.charAt(0).toUpperCase() + h.change_type.slice(1)}
                    </span>
                    {h.changed_by_name && (
                      <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                        by {h.changed_by_name} ({h.changed_by_team})
                      </span>
                    )}
                    <span style={{ fontSize: '0.7rem', color: 'var(--muted)', marginLeft: 'auto' }}>
                      {new Date(h.changed_at).toLocaleString()}
                    </span>
                  </div>
                  {h.field_name && (
                    <div style={{ fontSize: '0.8rem', marginBottom: '0.3rem' }}>
                      <strong>{h.field_name}:</strong> {h.old_value || '–'} → {h.new_value || '–'}
                    </div>
                  )}
                  {h.change_note && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--muted)', fontStyle: 'italic' }}>
                      {h.change_note}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Annotations */}
      {tab === 'annotations' && (
        <div>
          {annotations.length === 0 ? (
            <div className="empty-state" style={{ padding: '4rem' }}>
              <div className="empty-icon">📝</div>
              <p>No annotations yet. Open a document to start annotating!</p>
            </div>
          ) : (
            <div>
              {files.filter(f => annotations.some(a => a.document_id === f.id)).map(file => {
                const fileAnnotations = annotations.filter(a => a.document_id === file.id);
                return (
                  <div key={file.id} className="card" style={{ marginBottom: '1rem' }}>
                    <div style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid var(--border)', background: 'var(--paper)' }}>
                      <strong>{file.original_name}</strong>
                      <span style={{ marginLeft: '1rem', fontSize: '0.8rem', color: 'var(--muted)' }}>
                        {fileAnnotations.length} annotation{fileAnnotations.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {fileAnnotations.map((ann, i) => (
                      <div key={ann.id} style={{ padding: '0.85rem 1.25rem', borderBottom: i < fileAnnotations.length - 1 ? '1px solid var(--border)' : 'none' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span className={`badge ${ann.type === 'FINANCIAL_CONSTRAINT' ? 'badge-danger' : ann.type === 'REGULATORY_FLAG' ? 'badge-warning' : ann.type === 'CLARIFICATION' ? 'badge-info' : 'badge-success'}`}>
                              {ann.type.replace('_', ' ')}
                            </span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                              {ann.author.name} · {new Date(ann.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          <span className={`badge ${ann.status === 'RESOLVED' ? 'badge-success' : 'badge-muted'}`}>
                            {ann.status}
                          </span>
                        </div>
                        {ann.selected_text && (
                          <div style={{ fontStyle: 'italic', background: 'var(--paper)', padding: '0.5rem', borderRadius: '4px', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                            "{ann.selected_text}"
                          </div>
                        )}
                        <div style={{ marginBottom: '0.5rem' }}>{ann.body}</div>
                        {ann.replies && ann.replies.length > 0 && (
                          <div style={{ marginTop: '0.5rem', paddingLeft: '1rem', borderLeft: '2px solid var(--border)' }}>
                            {ann.replies.map(reply => (
                              <div key={reply.id} style={{ fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                                <strong>{reply.author.name}:</strong> {reply.text}
                                <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--muted)' }}>
                                  {new Date(reply.created_at).toLocaleDateString()}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Conflicts */}
      {tab === 'conflicts' && (
        <div>
          {conflicts.length === 0 ? (
            <div className="empty-state" style={{ padding: '4rem' }}>
              <div className="empty-icon">⚔️</div>
              <p>No conflicts detected yet.</p>
            </div>
          ) : (
            <div className="card">
              {conflicts.map((c, i) => (
                <div key={c.id} style={{ padding: '0.85rem 1.25rem', borderBottom: i < conflicts.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                    <strong>{c.field_name}</strong>
                    <span className={`badge ${c.status === 'RESOLVED' ? 'badge-success' : c.status === 'ESCALATED' ? 'badge-danger' : 'badge-warning'}`}>{c.status}</span>
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
                    DS {Number(c.ds_value).toFixed(2)} vs CA {Number(c.ca_actual_value).toFixed(2)} · Delta {Number(c.delta_percent).toFixed(2)}%
                  </div>
                  <div style={{ marginTop: '0.55rem', display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={async () => {
                        const rootCauseCategory = prompt('Root cause category (MODEL_ASSUMPTION_ERROR, DATA_SOURCE_MISMATCH, SCHEMA_CHANGE, CA_DATA_ENTRY_ERROR, EXTERNAL_MARKET_CHANGE, OTHER):', c.root_cause_category || 'OTHER');
                        if (!rootCauseCategory) return;
                        const rootCauseNote = prompt('Root cause note (min 50 chars):', c.root_cause_note || '');
                        if (!rootCauseNote) return;
                        try {
                          await conflictsAPI.addRootCause(c.id, { rootCauseCategory, rootCauseNote });
                          const res = await conflictsAPI.list({ projectId: id });
                          setConflicts(res.data.conflicts || []);
                        } catch (e) {
                          alert(e.response?.data?.message || 'Failed to save root cause.');
                        }
                      }}
                    >
                      DS Root Cause
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={async () => {
                        const responseType = prompt('CA response (CONFIRM, DISPUTE, ESCALATE):', c.ca_response_type || 'CONFIRM');
                        if (!responseType) return;
                        const responseNote = prompt('CA response note:', c.ca_response_note || '');
                        if (!responseNote) return;
                        try {
                          await conflictsAPI.addCAResponse(c.id, { responseType, responseNote });
                          const res = await conflictsAPI.list({ projectId: id });
                          setConflicts(res.data.conflicts || []);
                        } catch (e) {
                          alert(e.response?.data?.message || 'Failed to save CA response.');
                        }
                      }}
                    >
                      CA Response
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={async () => {
                        const reconciliationDecision = prompt('Reconciliation decision: ', c.reconciliation_decision || '');
                        if (!reconciliationDecision) return;
                        try {
                          await conflictsAPI.setReconciliation(c.id, { reconciliationDecision });
                          const res = await conflictsAPI.list({ projectId: id });
                          setConflicts(res.data.conflicts || []);
                        } catch (e) {
                          alert(e.response?.data?.message || 'Failed to save reconciliation.');
                        }
                      }}
                    >
                      Reconciliation
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={async () => {
                        try {
                          await conflictsAPI.confirmResolution(c.id);
                          const res = await conflictsAPI.list({ projectId: id });
                          setConflicts(res.data.conflicts || []);
                        } catch (e) {
                          alert(e.response?.data?.message || 'Failed to confirm resolution.');
                        }
                      }}
                    >
                      Confirm Resolution
                    </button>
                  </div>
                  {(c.root_cause_note || c.ca_response_note || c.reconciliation_decision) && (
                    <div style={{ marginTop: '0.55rem', fontSize: '0.8rem', color: 'var(--muted)' }}>
                      {c.root_cause_note && <div><strong>Root cause:</strong> {c.root_cause_category} — {c.root_cause_note}</div>}
                      {c.ca_response_note && <div><strong>CA:</strong> {c.ca_response_type} — {c.ca_response_note}</div>}
                      {c.reconciliation_decision && <div><strong>Decision:</strong> {c.reconciliation_decision}</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'breaches' && (
        <div>
          {breaches.length === 0 ? (
            <div className="empty-state" style={{ padding: '4rem' }}>
              <div className="empty-icon">✅</div>
              <p>No compliance breaches logged.</p>
            </div>
          ) : (
            <div className="card">
              {breaches.map((b, i) => (
                <div key={b.id} style={{ padding: '0.85rem 1.25rem', borderBottom: i < breaches.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <strong>{b.field_name || 'Manual Breach'}</strong>
                    <span className={`badge ${b.status === 'RESOLVED' ? 'badge-success' : 'badge-danger'}`}>{b.status}</span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{b.description}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </DashboardLayout>
  );
};

export default Workspace;
