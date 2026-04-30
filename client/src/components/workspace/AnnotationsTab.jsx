import React, { useState, useEffect, useCallback, useRef } from 'react';
import { workspaceAPI } from '../../services/api';

const ANNOTATION_TYPES = [
  { value: 'FINANCIAL_CONSTRAINT', label: 'Financial Constraint', color: '#3B82F6', icon: '💰' },
  { value: 'REGULATORY_FLAG', label: 'Regulatory Flag', color: '#EF4444', icon: '🏛️' },
  { value: 'CLARIFICATION', label: 'Request Clarification', color: '#F59E0B', icon: '❓' },
  { value: 'APPROVAL', label: 'Approve this Output', color: '#10B981', icon: '✅' },
];

const AnnotationsTab = ({ projectId, files, user, onNotify }) => {
  const [annotations, setAnnotations] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [annotationMode, setAnnotationMode] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [selectionRange, setSelectionRange] = useState({ start: 0, end: 0 });
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newAnnotation, setNewAnnotation] = useState({ type: '', body: '', requiresResolution: false });
  const [replyText, setReplyText] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [filter, setFilter] = useState('ALL'); // ALL, OPEN, RESOLVED
  const [loading, setLoading] = useState(false);
  const [floatingPos, setFloatingPos] = useState(null);
  const contentRef = useRef();

  const isCA = user?.team === 'CA';
  const isDS = user?.team === 'DS';

  // Sync selectedFile with files prop to pick up latest content/status
  useEffect(() => {
    if (selectedFile) {
      const fresh = files.find(f => f.id === selectedFile.id);
      if (fresh) setSelectedFile(fresh);
    }
  }, [files]);

  // Load annotations for selected file
  const loadAnnotations = useCallback(async () => {
    if (!projectId) return;
    try {
      const params = selectedFile ? { documentId: selectedFile.id } : {};
      const r = await workspaceAPI.getAnnotations(projectId, params);
      setAnnotations(r.data?.annotations || []);
    } catch { onNotify?.('error', 'Failed to load annotations'); }
  }, [projectId, selectedFile]);

  useEffect(() => { loadAnnotations(); }, [loadAnnotations]);

  // Load file content when file selected
  const openFile = async (file) => {
    if (!file) { setSelectedFile(null); setFileContent(''); return; }
    setSelectedFile(file);
    setAnnotationMode(false);
    setShowCreateForm(false);
    try {
      const r = await workspaceAPI.getFileContent(projectId, file.id);
      setFileContent(r.data?.content || '(Binary file or empty — annotation mode available for text highlights)');
    } catch {
      setFileContent('(Could not load file content — you can still create annotations)');
    }
  };

  // Handle text selection in document viewer
  const handleTextSelect = () => {
    if (!annotationMode || !contentRef.current) return;
    const selection = window.getSelection();
    const text = selection.toString().trim();
    if (text.length > 0) {
      setSelectedText(text);
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      
      // Calculate position relative to container
      const containerRect = contentRef.current.getBoundingClientRect();
      setFloatingPos({
        top: rect.top - containerRect.top - 40,
        left: rect.left - containerRect.left + (rect.width / 2)
      });

      const preRange = document.createRange();
      preRange.selectNodeContents(contentRef.current);
      preRange.setEnd(range.startContainer, range.startOffset);
      const start = preRange.toString().length;
      setSelectionRange({ start, end: start + text.length });
      setShowCreateForm(true);
      setNewAnnotation({ type: '', body: '', requiresResolution: false });
    } else {
      setShowCreateForm(false);
      setFloatingPos(null);
    }
  };

  // Handle annotation type change — auto-force requiresResolution for certain types
  const setAnnotationType = (type) => {
    const forceResolution = type === 'FINANCIAL_CONSTRAINT' || type === 'REGULATORY_FLAG';
    setNewAnnotation(p => ({ ...p, type, requiresResolution: forceResolution ? true : p.requiresResolution }));
  };

  // Create annotation
  const createAnnotation = async () => {
    if (!newAnnotation.type || !newAnnotation.body.trim()) {
      onNotify?.('error', 'Please select a type and write your annotation');
      return;
    }
    setLoading(true);
    try {
      await workspaceAPI.createAnnotation(projectId, {
        documentId: selectedFile.id,
        documentVersion: selectedFile.version_number || '1.0',
        selectedText,
        positionStart: selectionRange.start,
        positionEnd: selectionRange.end,
        type: newAnnotation.type,
        body: newAnnotation.body,
        requiresResolution: newAnnotation.requiresResolution,
      });
      onNotify?.('success', 'Annotation created successfully');
      setShowCreateForm(false);
      setSelectedText('');
      setNewAnnotation({ type: '', body: '', requiresResolution: false });
      loadAnnotations();
    } catch { onNotify?.('error', 'Failed to create annotation'); }
    finally { setLoading(false); }
  };

  // Reply to annotation
  const submitReply = async (annotationId) => {
    if (!replyText.trim()) return;
    try {
      await workspaceAPI.addAnnotationReply(projectId, annotationId, { replyText });
      setReplyText('');
      setReplyingTo(null);
      onNotify?.('success', 'Reply added');
      loadAnnotations();
    } catch { onNotify?.('error', 'Failed to add reply'); }
  };

  // Resolve annotation
  const resolveAnnotation = async (annotationId) => {
    try {
      await workspaceAPI.resolveAnnotation(projectId, annotationId);
      onNotify?.('success', 'Annotation resolved');
      loadAnnotations();
    } catch { onNotify?.('error', 'Failed to resolve annotation'); }
  };

  const getTypeInfo = (type) => ANNOTATION_TYPES.find(t => t.value === type) || { label: type, color: '#6B7280', icon: '📌' };

  const filteredAnnotations = annotations.filter(a => {
    if (filter === 'OPEN') return a.status !== 'RESOLVED';
    if (filter === 'RESOLVED') return a.status === 'RESOLVED';
    return true;
  });

  const openCount = annotations.filter(a => a.status !== 'RESOLVED').length;

  const renderHighlightedContent = () => {
    if (!fileContent || !selectedFile) return null;
    const fileAnnotations = annotations
      .filter(a => a.document_id === selectedFile?.id && a.position_start != null)
      .sort((a, b) => a.position_start - b.position_start);

    if (fileAnnotations.length === 0) {
      return <span>{fileContent}</span>;
    }

    const parts = [];
    let lastIndex = 0;
    fileAnnotations.forEach((ann, i) => {
      const start = ann.position_start;
      const end = ann.position_end;
      if (start > lastIndex) {
        parts.push(<span key={`t-${i}`}>{fileContent.slice(lastIndex, start)}</span>);
      }
      const typeInfo = getTypeInfo(ann.type);
      parts.push(
        <span key={`a-${i}`} style={{
          background: `${typeInfo.color}22`, borderBottom: `2px solid ${typeInfo.color}`,
          cursor: 'pointer', padding: '0 2px', borderRadius: 2, position: 'relative'
        }} title={`${typeInfo.icon} ${ann.body}`}>
          {fileContent.slice(start, end)}
          <sup style={{ fontSize: '0.55rem', color: typeInfo.color, fontWeight: 700 }}>{typeInfo.icon}</sup>
        </span>
      );
      lastIndex = end;
    });
    if (lastIndex < fileContent.length) {
      parts.push(<span key="tail">{fileContent.slice(lastIndex)}</span>);
    }
    return parts;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', background:'var(--paper)', padding:'0.75rem', borderRadius:'var(--radius-lg)', border:'1.5px solid var(--border)', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h3 style={{ fontFamily: 'Syne', fontWeight: 800, margin: 0, fontSize: '0.95rem', display:'flex', alignItems:'center', gap:'0.4rem' }}>
            <span style={{ fontSize:'1.2rem' }}>📝</span> Annotation Engine
          </h3>
          
          <div style={{ position:'relative' }}>
            <select 
              className="form-input" 
              value={selectedFile?.id || ''} 
              onChange={(e) => openFile(files.find(f => f.id === e.target.value))}
              style={{ padding:'0.3rem 0.5rem', fontSize:'0.8rem', minWidth:'220px', borderRadius:'var(--radius-md)', borderColor:'var(--ca)' }}
            >
              <option value="">Select a document to annotate...</option>
              {files.map(f => (
                <option key={f.id} value={f.id}>📄 {f.original_name} ({f.latest_version || 'v1.0'})</option>
              ))}
            </select>
          </div>

          {openCount > 0 && (
            <span style={{ background: '#FEF3C7', color: '#92400E', padding: '0.15rem 0.6rem', borderRadius: 12, fontSize: '0.7rem', fontWeight: 700, border:'1px solid #FDE68A' }}>
              {openCount} unresolved
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems:'center' }}>
          <div style={{ display: 'flex', background:'white', padding:'2px', borderRadius:'var(--radius-md)', border:'1px solid var(--border)' }}>
            {['ALL', 'OPEN', 'RESOLVED'].map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: '0.25rem 0.75rem', border: 'none',
                background: filter === f ? 'var(--ca)' : 'transparent', 
                color: filter === f ? 'white' : 'var(--muted)',
                cursor: 'pointer', fontSize: '0.65rem', fontWeight: 700, borderRadius:'var(--radius-sm)',
                transition: 'all 0.2s'
              }}>{f}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedFile ? '1fr 320px' : '1fr', gap: '1.25rem', flex: 1, minHeight: 0 }}>
        
        {/* Document Viewer (centre/left) */}
        {selectedFile && (
          <div style={{ display: 'flex', flexDirection: 'column', background: 'white', borderRadius: 'var(--radius-lg)', border: '1.5px solid var(--border)', overflow: 'hidden', boxShadow:'var(--shadow-sm)' }}>
            {/* Document header with Mode Toggle */}
            <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#F8FAFC' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'0.6rem' }}>
                <span style={{ fontSize:'1.2rem' }}>📄</span>
                <div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color:'var(--ink)' }}>{selectedFile.original_name}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>
                    {selectedFile.domain} Output · v{selectedFile.version_number || '1.0'} · Uploaded by {selectedFile.uploaded_by_name}
                  </div>
                </div>
              </div>
              <button onClick={() => { setAnnotationMode(!annotationMode); if (!annotationMode) onNotify?.('info', 'Annotation Mode Active: Highlight text to flag issues.'); }} style={{
                padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer',
                background: annotationMode ? 'var(--warning)' : 'var(--ca)', color: 'white',
                fontSize: '0.75rem', fontWeight: 700, transition: 'all 0.2s',
                display:'flex', alignItems:'center', gap:'0.4rem',
                boxShadow: annotationMode ? '0 4px 12px rgba(245,158,11,0.2)' : '0 4px 12px rgba(59,130,246,0.15)'
              }}>
                {annotationMode ? '🚫 Stop Annotating' : '📝 Enter Annotation Mode'}
              </button>
            </div>

            {/* Floating Toolbar (Selection Trigger) */}
            {annotationMode && floatingPos && !showCreateForm && (
              <div style={{
                position: 'absolute', top: floatingPos.top, left: floatingPos.left,
                transform: 'translateX(-50%)', zIndex: 100, display: 'flex', gap: '4px',
                background: 'white', padding: '4px', borderRadius: '10px',
                boxShadow: '0 10px 25px rgba(0,0,0,0.2)', border: '1.5px solid var(--ca)',
                animation: 'popIn 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
              }}>
                <button onClick={() => { setAnnotationType('FINANCIAL_CONSTRAINT'); setShowCreateForm(true); }} style={{ padding: '6px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '1rem', borderRadius:'6px' }} className="hover-bg-paper" title="Financial Constraint">💰</button>
                <button onClick={() => { setAnnotationType('REGULATORY_FLAG'); setShowCreateForm(true); }} style={{ padding: '6px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '1rem', borderRadius:'6px' }} className="hover-bg-paper" title="Regulatory Breach">🏛️</button>
                <button onClick={() => { setAnnotationType('CLARIFICATION'); setShowCreateForm(true); }} style={{ padding: '6px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '1rem', borderRadius:'6px' }} className="hover-bg-paper" title="Ask Clarification">❓</button>
                <button onClick={() => { setAnnotationType('APPROVAL'); setShowCreateForm(true); }} style={{ padding: '6px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '1rem', borderRadius:'6px' }} className="hover-bg-paper" title="Approve Section">✅</button>
              </div>
            )}

            {/* Document content area */}
            <div ref={contentRef} onMouseUp={handleTextSelect} style={{
              flex: 1, padding: '2rem 2.5rem', overflowY: 'auto', 
              fontFamily: 'Inter, system-ui, sans-serif', fontSize: '0.92rem',
              lineHeight: 1.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              cursor: annotationMode ? 'crosshair' : 'default',
              background: annotationMode ? '#FFFBEB' : 'white',
              color: '#334155',
              userSelect: annotationMode ? 'text' : 'auto', transition: 'all 0.3s',
              position: 'relative'
            }}>
              {renderHighlightedContent()}
            </div>

            {/* Create Annotation Form (Docked at bottom when active) */}
            {showCreateForm && annotationMode && (
              <div style={{ padding: '1.25rem', borderTop: '2.5px solid var(--ca)', background: '#F8FAFC', animation:'slideUp 0.3s' }}>
                <div style={{ display:'flex', gap:'1rem' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ marginBottom: '0.5rem' }}>
                      <strong style={{ fontSize: '0.72rem', textTransform:'uppercase', color:'var(--muted)' }}>Context:</strong>
                      <div style={{ background: 'white', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-md)', fontSize: '0.8rem', fontStyle: 'italic', marginTop: '0.25rem', border: '1px solid var(--border)', color:'var(--ink)' }}>
                        "{selectedText.length > 300 ? selectedText.slice(0, 300) + '...' : selectedText}"
                      </div>
                    </div>
                    <textarea 
                      value={newAnnotation.body} 
                      onChange={e => setNewAnnotation(p => ({ ...p, body: e.target.value }))}
                      placeholder="Detail the issue or provide feedback here..."
                      style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', fontSize: '0.85rem', resize: 'vertical', minHeight: 80, fontFamily: 'inherit' }} 
                    />
                  </div>
                  <div style={{ width:'240px', display:'flex', flexDirection:'column', gap:'0.75rem' }}>
                    <div>
                      <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--muted)', marginBottom: '0.4rem', display: 'block' }}>TYPE</label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem' }}>
                        {ANNOTATION_TYPES.map(t => (
                          <button key={t.value} onClick={() => setAnnotationType(t.value)} style={{
                            padding: '0.4rem', borderRadius: 'var(--radius-sm)', border: `1.5px solid ${newAnnotation.type === t.value ? t.color : 'var(--border)'}`,
                            background: newAnnotation.type === t.value ? `${t.color}10` : 'white', cursor: 'pointer',
                            fontSize: '0.68rem', fontWeight: 700,
                            color: newAnnotation.type === t.value ? t.color : 'var(--text)', transition: 'all 0.2s'
                          }}>
                            {t.icon} {t.label.split(' ')[0]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: (newAnnotation.type === 'FINANCIAL_CONSTRAINT' || newAnnotation.type === 'REGULATORY_FLAG') ? 'not-allowed' : 'pointer' }}>
                      <input type="checkbox" checked={newAnnotation.requiresResolution}
                        disabled={newAnnotation.type === 'FINANCIAL_CONSTRAINT' || newAnnotation.type === 'REGULATORY_FLAG'}
                        onChange={e => setNewAnnotation(p => ({ ...p, requiresResolution: e.target.checked }))} />
                      Required Action
                    </label>
                    <div style={{ display: 'flex', gap: '0.4rem', marginTop:'auto' }}>
                      <button onClick={() => { setShowCreateForm(false); setSelectedText(''); }} className="btn btn-ghost btn-sm" style={{ flex:1 }}>Cancel</button>
                      <button onClick={createAnnotation} disabled={loading || !newAnnotation.type || !newAnnotation.body.trim()} className="btn btn-ca btn-sm" style={{ flex:2 }}>
                        {loading ? '...' : 'Save'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* No file selected state */}
        {!selectedFile && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'white', borderRadius: 'var(--radius-lg)', border: '2px dashed var(--border)', flex:1 }}>
            <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--muted)', maxWidth:'400px' }}>
              <div style={{ fontSize: '4rem', marginBottom: '1rem', opacity:0.5 }}>🖋️</div>
              <h3 style={{ fontFamily:'Syne', color:'var(--ink)', marginBottom:'0.5rem' }}>Ready to Review?</h3>
              <p style={{ fontSize: '0.85rem', lineHeight:1.6 }}>Select a document from the dropdown above to start adding inline annotations, flagging constraints, or approving outputs.</p>
            </div>
          </div>
        )}

        {/* Annotation Sidebar (right) */}
        {selectedFile && (
          <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '1rem', overflowY: 'auto', border: '1.5px solid var(--border)', display: 'flex', flexDirection: 'column', boxShadow:'var(--shadow-sm)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
              <h4 style={{ fontSize: '0.85rem', fontWeight: 800, margin:0, textTransform:'uppercase', letterSpacing:'0.02em' }}>
                Review Stream
              </h4>
              <span style={{ fontSize:'0.7rem', color:'var(--muted)', background:'var(--paper)', padding:'0.1rem 0.4rem', borderRadius:4 }}>
                {filteredAnnotations.filter(a => a.document_id === selectedFile.id).length} total
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {filteredAnnotations.filter(a => a.document_id === selectedFile.id).length === 0 && (
                <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--muted)', fontSize: '0.8rem', border:'1px dashed var(--border)', borderRadius:'var(--radius-md)' }}>
                  No annotations on this document yet.
                </div>
              )}

              {filteredAnnotations.filter(a => a.document_id === selectedFile.id).map(ann => {
                const typeInfo = getTypeInfo(ann.type);
                const isResolved = ann.status === 'RESOLVED';
                return (
                  <div key={ann.id} style={{
                    background: isResolved ? 'var(--paper)' : 'white', 
                    borderRadius: 'var(--radius-md)', padding: '0.8rem',
                    border: `1.5px solid ${isResolved ? 'var(--border)' : typeInfo.color}`,
                    boxShadow: isResolved ? 'none' : '0 2px 8px rgba(0,0,0,0.04)',
                    transition: 'all 0.2s'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.6rem', padding: '0.15rem 0.45rem', borderRadius: 4, background: `${typeInfo.color}15`, color: typeInfo.color, fontWeight: 800, textTransform:'uppercase' }}>
                        {typeInfo.icon} {typeInfo.label.split(' ')[0]}
                      </span>
                      {isResolved && <span style={{ fontSize: '0.62rem', color: 'var(--success)', fontWeight: 700 }}>✓ RESOLVED</span>}
                    </div>

                    {ann.selected_text && (
                      <div style={{ fontSize: '0.72rem', fontStyle: 'italic', color: '#64748b', background: '#F1F5F9', padding: '0.4rem 0.6rem', borderRadius: 6, marginBottom: '0.6rem', borderLeft: `3px solid ${typeInfo.color}` }}>
                        "{ann.selected_text.length > 100 ? ann.selected_text.slice(0, 100) + '...' : ann.selected_text}"
                      </div>
                    )}

                    <div style={{ fontSize: '0.82rem', lineHeight: 1.5, marginBottom: '0.6rem', color: '#1e293b' }}>{ann.body}</div>

                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderTop:'1px solid #f1f5f9', paddingTop:'0.5rem', marginTop:'0.5rem' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
                        <div style={{ width:18, height:18, borderRadius:'50%', background: ann.author?.team === 'CA' ? 'var(--ca)' : 'var(--ds)', color:'white', fontSize:'0.5rem', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700 }}>
                          {ann.author?.name?.[0] || '?' }
                        </div>
                        <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--ink)' }}>{ann.author?.name}</span>
                      </div>
                      <span style={{ fontSize: '0.6rem', color: 'var(--muted)' }}>{new Date(ann.created_at).toLocaleDateString()}</span>
                    </div>

                    {/* Replies */}
                    {ann.replies?.length > 0 && (
                      <div style={{ marginTop: '0.6rem', paddingLeft: '0.75rem', borderLeft: '2px solid #e2e8f0', display:'flex', flexDirection:'column', gap:'0.4rem' }}>
                        {ann.replies.map(r => (
                          <div key={r.id} style={{ fontSize: '0.75rem' }}>
                            <strong style={{ color: r.author?.team === 'CA' ? 'var(--ca)' : 'var(--ds)' }}>{r.author?.name}</strong>: {r.text}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    {!isResolved && (
                      <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.4rem' }}>
                        <button onClick={() => setReplyingTo(replyingTo === ann.id ? null : ann.id)} className="btn btn-xs btn-ghost" style={{ fontSize:'0.65rem' }}>💬 Reply</button>
                        <button onClick={() => resolveAnnotation(ann.id)} className="btn btn-xs btn-ghost" style={{ fontSize:'0.65rem', color:'var(--success)', borderColor:'var(--success)' }}>✓ Resolve</button>
                      </div>
                    )}

                    {replyingTo === ann.id && (
                      <div style={{ marginTop: '0.6rem', display: 'flex', gap: '0.3rem' }}>
                        <input value={replyText} onChange={e => setReplyText(e.target.value)}
                          placeholder="Write reply..." onKeyDown={e => e.key === 'Enter' && submitReply(ann.id)}
                          style={{ flex: 1, padding: '0.25rem 0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.72rem' }} />
                        <button onClick={() => submitReply(ann.id)} disabled={!replyText.trim()} className="btn btn-ca btn-xs">Send</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AnnotationsTab;
