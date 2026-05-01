import React, { useState, useRef, useEffect, useCallback } from 'react';
import { workspaceAPI } from '../../services/api';

const FilesTab = ({ projectId, files, setFiles, user, onNotify, socket, onRefresh }) => {
  const [uploading, setUploading] = useState(false);
  const [fileMeta, setFileMeta] = useState({ domain:'JOINT', fileType:'MODEL_REPORT', changeNote:'', publish:false });
  const [editorOpen, setEditorOpen] = useState(null);
  const [editorContent, setEditorContent] = useState('');
  const [versions, setVersions] = useState([]);
  const [showVersions, setShowVersions] = useState(null);
  const [activeEditors, setActiveEditors] = useState([]);
  const [remoteCursors, setRemoteCursors] = useState([]);
  const fileRef = useRef();
  const editorRef = useRef();

  const fmtSize = (b) => { if(!b) return '0B'; const k=1024; const s=['B','KB','MB','GB']; const i=Math.floor(Math.log(b)/Math.log(k)); return (b/Math.pow(k,i)).toFixed(1)+' '+s[i]; };

  // ── WebSocket co-editing integration ────────────────────────────────
  useEffect(() => {
    if (!socket || !editorOpen) return;

    // Join file editing session
    socket.emit('join_file_editing', { fileId: editorOpen, projectId });

    const handleEditorJoined = (data) => {
      setActiveEditors(data.activeEditors || []);
      onNotify('info', `A team member joined editing`);
    };

    const handleEditorLeft = (data) => {
      setActiveEditors(prev => prev.filter(e => e.id !== data.userId));
      setRemoteCursors(prev => prev.filter(c => c.userId !== data.userId));
    };

    const handleCursorUpdate = (data) => {
      setRemoteCursors(prev => {
        const existing = prev.filter(c => c.userId !== data.userId);
        return [...existing, { userId: data.userId, position: data.position, color: data.color }];
      });
    };

    const handleFileEdited = (data) => {
      // Apply remote edit
      if (data.editData?.content !== undefined) {
        setEditorContent(data.editData.content);
      }
    };

    const handleActiveEditors = (editors) => {
      setActiveEditors(editors || []);
    };

    socket.on('editor_joined', handleEditorJoined);
    socket.on('editor_left', handleEditorLeft);
    socket.on('cursor_update', handleCursorUpdate);
    socket.on('file_edited', handleFileEdited);
    socket.on('active_editors', handleActiveEditors);

    return () => {
      socket.emit('leave_file_editing', { fileId: editorOpen });
      socket.off('editor_joined', handleEditorJoined);
      socket.off('editor_left', handleEditorLeft);
      socket.off('cursor_update', handleCursorUpdate);
      socket.off('file_edited', handleFileEdited);
      socket.off('active_editors', handleActiveEditors);
      setActiveEditors([]);
      setRemoteCursors([]);
    };
  }, [socket, editorOpen, projectId, onNotify, user]);

  // Broadcast cursor position on selection change
  const handleEditorSelect = useCallback((e) => {
    if (!socket || !editorOpen) return;
    const pos = e.target.selectionStart;
    socket.emit('cursor_position', { fileId: editorOpen, position: pos, color: user?.team === 'CA' ? '#3B82F6' : '#10B981' });
  }, [socket, editorOpen, user]);

  // Broadcast content changes
  const handleEditorChange = useCallback((e) => {
    const newContent = e.target.value;
    setEditorContent(newContent);
    if (socket && editorOpen) {
      socket.emit('file_edit', { fileId: editorOpen, editData: { content: newContent } });
    }
  }, [socket, editorOpen]);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (fileMeta.publish && (!fileMeta.changeNote || fileMeta.changeNote.length < 10)) {
      onNotify('error', 'Change note (min 10 chars) is required for pre-check publication');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('domain', fileMeta.domain);
      fd.append('fileType', fileMeta.fileType);
      fd.append('changeNote', fileMeta.changeNote);
      fd.append('publish', fileMeta.publish);
      await workspaceAPI.uploadFile(projectId, fd);
      const r = await workspaceAPI.getFiles(projectId);
      setFiles(r.data?.files || []);
      setFileMeta({ domain:'JOINT', fileType:'MODEL_REPORT', changeNote:'', publish:false });
      fileRef.current.value = '';
      onNotify('success', 'File uploaded successfully');
      onRefresh?.();
    } catch (e) {
      if (e.response?.data?.precheck) {
        const v = e.response.data.precheck.violations;
        onNotify('error', `Pre-check failed: ${v.length} violations found.`);
        console.error('Regulatory violations:', v);
      } else {
        onNotify('error', e.response?.data?.message || 'Upload failed');
      }
    } finally { setUploading(false); }
  };

  const openEditor = async (fid) => {
    try {
      const r = await workspaceAPI.getFileContent(projectId, fid);
      setEditorContent(r.data?.content || '');
      setEditorOpen(fid);
    } catch (e) { onNotify('error', e.response?.data?.message || 'Failed to open file'); }
  };

  const saveEditor = async () => {
    try {
      await workspaceAPI.saveFileContent(projectId, editorOpen, editorContent);
      onNotify('success', 'File saved');
      // Refresh files list
      const r = await workspaceAPI.getFiles(projectId);
      setFiles(r.data?.files || []);
      onRefresh?.();
    } catch (e) { onNotify('error', e.response?.data?.message || 'Save failed'); }
  };

  const closeEditor = () => {
    setEditorOpen(null);
    setActiveEditors([]);
    setRemoteCursors([]);
  };

  const lockFile = async (fid) => {
    try { await workspaceAPI.lockFile(projectId, fid); onNotify('success', 'File locked'); const r = await workspaceAPI.getFiles(projectId); setFiles(r.data?.files||[]); onRefresh?.(); }
    catch (e) { onNotify('error', e.response?.data?.message || 'Lock failed'); }
  };

  const unlockFile = async (fid) => {
    try { await workspaceAPI.unlockFile(projectId, fid); onNotify('success', 'File unlocked'); const r = await workspaceAPI.getFiles(projectId); setFiles(r.data?.files||[]); onRefresh?.(); }
    catch (e) { onNotify('error', e.response?.data?.message || 'Unlock failed'); }
  };

  const loadVersions = async (fid) => {
    try {
      if (showVersions === fid) { setShowVersions(null); return; }
      const r = await workspaceAPI.getFileVersions(projectId, fid);
      setVersions(r.data?.versions || []);
      setShowVersions(fid);
    } catch { onNotify('error', 'Failed to load versions'); }
  };

  const restoreVersion = async (fid, vid) => {
    try {
      await workspaceAPI.restoreFileVersion(projectId, fid, vid);
      onNotify('success', 'Version restored');
      loadVersions(fid);
    } catch { onNotify?.('error', 'Restore failed'); }
  };

  const handleDelete = async (fid, name) => {
    if (!window.confirm(`Are you sure you want to delete "${name}"? This will permanently remove all version history and annotations.`)) return;
    try {
      await workspaceAPI.deleteFile(projectId, fid);
      onNotify('success', 'File deleted successfully');
      const r = await workspaceAPI.getFiles(projectId);
      setFiles(r.data?.files || []);
      onRefresh?.();
    } catch (e) {
      onNotify('error', e.response?.data?.message || 'Delete failed');
    }
  };

  const currentFile = files.find(f => f.id === editorOpen);
  const isLockOwner = (f) => f.locked_by === user?.id;

  return (
    <div>
      {/* Upload Form */}
      <div style={{ background:'var(--paper)', borderRadius:'var(--radius-lg)', padding:'1rem', marginBottom:'1rem', border:'1px solid var(--border)' }}>
        <h4 style={{ fontFamily:'Syne', fontWeight:700, marginBottom:'0.75rem' }}>📁 Upload File</h4>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'0.75rem', marginBottom:'0.75rem' }}>
          <div>
            <label className="form-label" style={{ fontSize:'0.75rem' }}>Domain</label>
            <select className="form-input" value={fileMeta.domain} onChange={e=>setFileMeta(p=>({...p, domain:e.target.value}))}>
              <option value="CA">CA</option><option value="DS">DS</option><option value="JOINT">Joint</option>
            </select>
          </div>
          <div>
            <label className="form-label" style={{ fontSize:'0.75rem' }}>File Type</label>
            <select className="form-input" value={fileMeta.fileType} onChange={e=>setFileMeta(p=>({...p, fileType:e.target.value}))}>
              <option value="MODEL_REPORT">Model Report</option><option value="FINANCIAL_ANALYSIS">Financial Analysis</option>
              <option value="JOINT_SUMMARY">Joint Summary</option><option value="RAW_DATA">Raw Data</option><option value="OTHER">Other</option>
            </select>
          </div>
          <div>
            <label className="form-label" style={{ fontSize:'0.75rem' }}>Change Note</label>
            <input className="form-input" placeholder="Describe changes..." value={fileMeta.changeNote} onChange={e=>setFileMeta(p=>({...p, changeNote:e.target.value}))} />
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'1rem' }}>
          <label style={{ fontSize:'0.8rem', display:'flex', alignItems:'center', gap:'0.3rem', cursor:'pointer' }} title="Runs regulatory rules against data before publishing">
            <input type="checkbox" checked={fileMeta.publish} onChange={e=>setFileMeta(p=>({...p, publish:e.target.checked}))} /> Pre-check publication
          </label>
          {fileMeta.publish && <span style={{ fontSize:'0.7rem', color:'var(--warning)', fontWeight:600 }}>⚠️ Requires min 10 char note</span>}
          <input type="file" ref={fileRef} onChange={handleUpload} style={{ display:'none' }} />
          <button className="btn btn-ca btn-sm" onClick={()=>fileRef.current?.click()} disabled={uploading}>
            {uploading ? '⏳ Uploading...' : '📁 Upload File'}
          </button>
        </div>
      </div>

      {/* File Library */}
      <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
        {files.length === 0 ? (
          <div style={{ textAlign:'center', padding:'3rem', color:'var(--muted)' }}>📂 No files uploaded yet</div>
        ) : files.map(f => (
          <div key={f.id} style={{ background:'white', border:`1.5px solid ${f.is_locked?'var(--danger)':'var(--border)'}`, borderRadius:'var(--radius-md)', padding:'0.75rem' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ fontWeight:600, fontSize:'0.85rem' }}>{f.is_locked && '🔒 '}{f.original_name}</div>
                <div style={{ fontSize:'0.7rem', color:'var(--muted)' }}>
                  {fmtSize(f.file_size)} · {f.uploaded_by_name} · {f.domain||'JOINT'} · {f.file_type||'OTHER'}
                  {f.is_locked && f.locked_by_name && <span style={{ color:'var(--danger)', marginLeft:'0.5rem' }}>Locked by {f.locked_by_name}</span>}
                </div>
              </div>
              <div style={{ display:'flex', gap:'0.3rem' }}>
                <button className="btn btn-xs btn-primary" onClick={()=>openEditor(f.id)} disabled={f.is_locked && !isLockOwner(f)}>
                  ✏️ Edit
                </button>
                <button className="btn btn-xs btn-ghost" onClick={()=>loadVersions(f.id)}>📋 Versions</button>
                {!f.is_locked && <button className="btn btn-xs btn-ghost" onClick={()=>lockFile(f.id)}>🔒 Lock</button>}
                {f.is_locked && isLockOwner(f) && <button className="btn btn-xs btn-ghost" style={{ color:'var(--success)' }} onClick={()=>unlockFile(f.id)}>🔓 Unlock</button>}
                <a className="btn btn-xs btn-ghost" href={`${process.env.REACT_APP_API_URL||'http://localhost:5000'}/api/projects/${projectId}/files/${f.id}/download`} target="_blank" rel="noreferrer" title="Download">⬇️</a>
                {(user?.role === 'admin' || user?.role === 'platform_admin' || f.uploaded_by === user?.id) && (
                  <button className="btn btn-xs btn-ghost" style={{ color:'var(--danger)' }} onClick={()=>handleDelete(f.id, f.original_name)} title="Delete File">🗑️</button>
                )}
              </div>
            </div>
            {showVersions===f.id && (
              <div style={{ marginTop:'0.5rem', padding:'0.5rem', background:'var(--paper)', borderRadius:'var(--radius-sm)', fontSize:'0.75rem' }}>
                <strong>Version History</strong>
                {versions.map(v => (
                  <div key={v.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.3rem 0', borderBottom:'1px solid var(--border)' }}>
                    <span>v{v.version_number} — {v.change_note||'No note'} — {v.published_by_name}</span>
                    <button className="btn btn-xs btn-ghost" onClick={()=>restoreVersion(f.id, v.id)}>Restore</button>
                  </div>
                ))}
                {versions.length===0 && <div style={{ color:'var(--muted)', padding:'0.5rem' }}>No versions</div>}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Co-Editing Modal */}
      {editorOpen && (
        <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ background:'white', borderRadius:'var(--radius-lg)', width:'85%', height:'85%', display:'flex', flexDirection:'column' }}>
            {/* Editor Header */}
            <div style={{ padding:'1rem', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <h4 style={{ margin:0 }}>✏️ Editing: {currentFile?.original_name}</h4>
                {/* Active Editors Indicator */}
                {activeEditors.length > 0 && (
                  <div style={{ display:'flex', alignItems:'center', gap:'0.3rem', marginTop:'0.3rem' }}>
                    <span style={{ fontSize:'0.7rem', color:'var(--muted)' }}>Co-editing with:</span>
                    {activeEditors.filter(e => e.id !== user?.id).map(e => (
                      <div key={e.id} style={{
                        display:'inline-flex', alignItems:'center', gap:'0.2rem',
                        padding:'0.15rem 0.4rem', borderRadius:'12px', fontSize:'0.65rem', fontWeight:500,
                        background: e.team === 'CA' ? 'var(--ca-light, #EBF5FF)' : 'var(--ds-light, #ECFDF5)',
                        color: e.team === 'CA' ? 'var(--ca)' : 'var(--ds)',
                        border: `1px solid ${e.cursor_color || '#ccc'}`
                      }}>
                        <div style={{ width:6, height:6, borderRadius:'50%', background: e.cursor_color || 'var(--success)' }} />
                        {e.full_name}
                      </div>
                    ))}
                    {activeEditors.filter(e => e.id !== user?.id).length === 0 && (
                      <span style={{ fontSize:'0.65rem', color:'var(--muted)' }}>No one else is editing</span>
                    )}
                  </div>
                )}
              </div>
              <div style={{ display:'flex', gap:'0.5rem' }}>
                <button className="btn btn-ca btn-sm" onClick={saveEditor}>💾 Save</button>
                <button className="btn btn-ghost btn-sm" onClick={closeEditor}>✕ Close</button>
              </div>
            </div>

            {/* Editor Body */}
            <div style={{ flex:1, position:'relative' }}>
              <textarea
                ref={editorRef}
                value={editorContent}
                onChange={handleEditorChange}
                onSelect={handleEditorSelect}
                onClick={handleEditorSelect}
                style={{
                  width:'100%', height:'100%', padding:'1rem', border:'none', resize:'none',
                  fontFamily:'monospace', fontSize:'0.85rem', outline:'none',
                  background:'#1e1e1e', color:'#d4d4d4',
                  lineHeight:1.6
                }}
                spellCheck={false}
              />

              {/* Remote cursor indicators (overlay) */}
              {remoteCursors.length > 0 && (
                <div style={{ position:'absolute', top:8, right:8, display:'flex', flexDirection:'column', gap:'0.2rem' }}>
                  {remoteCursors.map(c => {
                    const editor = activeEditors.find(e => e.id === c.userId);
                    return (
                      <div key={c.userId} style={{
                        padding:'0.15rem 0.4rem', borderRadius:'4px', fontSize:'0.6rem', fontWeight:500,
                        background: c.color || '#3B82F6', color:'white', opacity:0.9
                      }}>
                        {editor?.full_name || 'User'} @ line {Math.floor((c.position || 0) / 60) + 1}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FilesTab;
