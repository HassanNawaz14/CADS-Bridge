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
  const contentRef = useRef();

  const isCA = user?.team === 'CA';
  const isDS = user?.team === 'DS';

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
    setSelectedFile(file);
    setAnnotationMode(false);
    setShowCreateForm(false);
    try {
      const r = await workspaceAPI.getFileContent(projectId, file.id);
      setFileContent(r.data?.content || '(Binary file — annotation mode available for text highlights)');
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
      // Get position relative to content
      const range = selection.getRangeAt(0);
      const preRange = document.createRange();
      preRange.selectNodeContents(contentRef.current);
      preRange.setEnd(range.startContainer, range.startOffset);
      const start = preRange.toString().length;
      setSelectionRange({ start, end: start + text.length });
      setShowCreateForm(true);
      setNewAnnotation({ type: '', body: '', requiresResolution: false });
    }
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

  // Render highlighted content with annotation markers
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h3 style={{ fontFamily: 'Syne', fontWeight: 700, margin: 0, fontSize: '1rem' }}>📝 Annotations</h3>
          {openCount > 0 && (
            <span style={{ background: '#FEF3C7', color: '#92400E', padding: '0.15rem 0.5rem', borderRadius: 10, fontSize: '0.7rem', fontWeight: 600 }}>
              {openCount} open
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.3rem' }}>
          {['ALL', 'OPEN', 'RESOLVED'].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '0.3rem 0.6rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
              background: filter === f ? 'var(--ca)' : 'white', color: filter === f ? 'white' : 'var(--text)',
              cursor: 'pointer', fontSize: '0.7rem', fontWeight: 500
            }}>{f}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedFile ? '220px 1fr 300px' : '1fr', gap: '1rem', flex: 1, minHeight: 0 }}>
        {/* File Picker (left) */}
        <div style={{ background: 'var(--paper)', borderRadius: 'var(--radius-lg)', padding: '0.75rem', overflowY: 'auto', border: '1px solid var(--border)' }}>
          <h4 style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.5rem' }}>Select Document</h4>
          {(files || []).length === 0 && <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>No documents uploaded</p>}
          {(files || []).map(f => {
            const fileAnns = annotations.filter(a => a.document_id === f.id && a.status !== 'RESOLVED');
            return (
              <div key={f.id} onClick={() => openFile(f)} style={{
                padding: '0.5rem', marginBottom: '0.3rem', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                background: selectedFile?.id === f.id ? 'white' : 'transparent',
                border: selectedFile?.id === f.id ? '1.5px solid var(--ca)' : '1px solid transparent',
                transition: 'all 0.15s'
              }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  📄 {f.original_name}
                </div>
                <div style={{ fontSize: '0.63rem', color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{f.uploaded_by_name}</span>
                  {fileAnns.length > 0 && (
                    <span style={{ color: 'var(--warning)', fontWeight: 600 }}>{fileAnns.length} open</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Document Viewer (centre) */}
        {selectedFile && (
          <div style={{ display: 'flex', flexDirection: 'column', background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', overflow: 'hidden' }}>
            {/* Document header */}
            <div style={{ padding: '0.75rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--paper)' }}>
              <div>
                <strong style={{ fontSize: '0.85rem' }}>{selectedFile.original_name}</strong>
                <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>
                  {selectedFile.domain || 'JOINT'} · {selectedFile.uploaded_by_name}
                </div>
              </div>
              <button onClick={() => setAnnotationMode(!annotationMode)} style={{
                padding: '0.4rem 0.8rem', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer',
                background: annotationMode ? 'var(--ca)' : 'var(--paper)', color: annotationMode ? 'white' : 'var(--text)',
                fontSize: '0.75rem', fontWeight: 600, transition: 'all 0.2s',
                boxShadow: annotationMode ? '0 2px 8px rgba(59,130,246,0.3)' : 'none'
              }}>
                {annotationMode ? '✏️ Annotation Mode ON' : '📝 Enter Annotation Mode'}
              </button>
            </div>

            {/* Annotation mode banner */}
            {annotationMode && (
              <div style={{ padding: '0.5rem 0.75rem', background: '#EFF6FF', borderBottom: '1px solid #BFDBFE', fontSize: '0.75rem', color: '#1E40AF' }}>
                <strong>Annotation Mode Active</strong> — Highlight any text below to add an annotation. Options: Add Annotation, Flag as Concern, Approve this Output, Request Clarification.
              </div>
            )}

            {/* Document content area */}
            <div ref={contentRef} onMouseUp={handleTextSelect} style={{
              flex: 1, padding: '1rem', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.82rem',
              lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              cursor: annotationMode ? 'text' : 'default',
              background: annotationMode ? '#FEFCE8' : 'white',
              userSelect: annotationMode ? 'text' : 'auto', transition: 'background 0.3s'
            }}>
              {renderHighlightedContent()}
            </div>

            {/* Create Annotation Popup */}
            {showCreateForm && annotationMode && (
              <div style={{ padding: '1rem', borderTop: '2px solid var(--ca)', background: '#F8FAFC' }}>
                <div style={{ marginBottom: '0.5rem' }}>
                  <strong style={{ fontSize: '0.8rem' }}>Selected text:</strong>
                  <div style={{ background: '#FEF3C7', padding: '0.4rem 0.6rem', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', fontStyle: 'italic', marginTop: '0.25rem', borderLeft: '3px solid var(--warning)' }}>
                    "{selectedText.length > 200 ? selectedText.slice(0, 200) + '...' : selectedText}"
                  </div>
                </div>

                {/* Annotation type buttons */}
                <div style={{ marginBottom: '0.5rem' }}>
                  <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--muted)', marginBottom: '0.3rem', display: 'block' }}>Annotation Type</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                    {ANNOTATION_TYPES.map(t => (
                      <button key={t.value} onClick={() => setNewAnnotation(p => ({ ...p, type: t.value }))} style={{
                        padding: '0.3rem 0.6rem', borderRadius: 'var(--radius-sm)', border: `1.5px solid ${newAnnotation.type === t.value ? t.color : 'var(--border)'}`,
                        background: newAnnotation.type === t.value ? `${t.color}15` : 'white', cursor: 'pointer',
                        fontSize: '0.7rem', fontWeight: newAnnotation.type === t.value ? 600 : 400,
                        color: newAnnotation.type === t.value ? t.color : 'var(--text)', transition: 'all 0.15s'
                      }}>
                        {t.icon} {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Annotation body */}
                <textarea value={newAnnotation.body} onChange={e => setNewAnnotation(p => ({ ...p, body: e.target.value }))}
                  placeholder="Write your annotation... (e.g. 'This 14% growth projection does not account for the Q4 depreciation write-down of £2.3M')"
                  style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.8rem', resize: 'vertical', minHeight: 60, fontFamily: 'inherit' }} />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
                  <label style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={newAnnotation.requiresResolution} onChange={e => setNewAnnotation(p => ({ ...p, requiresResolution: e.target.checked }))} />
                    Requires resolution (creates linked task)
                  </label>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button onClick={() => { setShowCreateForm(false); setSelectedText(''); }} style={{ padding: '0.35rem 0.7rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'white', cursor: 'pointer', fontSize: '0.75rem' }}>Cancel</button>
                    <button onClick={createAnnotation} disabled={loading || !newAnnotation.type || !newAnnotation.body.trim()} style={{
                      padding: '0.35rem 0.7rem', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer',
                      background: 'var(--ca)', color: 'white', fontSize: '0.75rem', fontWeight: 600,
                      opacity: (!newAnnotation.type || !newAnnotation.body.trim()) ? 0.5 : 1
                    }}>{loading ? 'Saving...' : '📝 Add Annotation'}</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* No file selected state */}
        {!selectedFile && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--paper)', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--border)' }}>
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
              <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>📝</div>
              <h4 style={{ marginBottom: '0.3rem' }}>Cross-Team Inline Annotations</h4>
              <p style={{ fontSize: '0.8rem' }}>Select a document to start annotating. {isCA ? 'As CA, you can annotate DS model outputs.' : isDS ? 'As DS, you can annotate CA financial reports.' : 'Select any document.'}</p>
            </div>
          </div>
        )}

        {/* Annotation Sidebar (right) */}
        {selectedFile && (
          <div style={{ background: 'var(--paper)', borderRadius: 'var(--radius-lg)', padding: '0.75rem', overflowY: 'auto', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
            <h4 style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.5rem' }}>
              Annotations ({filteredAnnotations.filter(a => a.document_id === selectedFile.id).length})
            </h4>

            {filteredAnnotations.filter(a => a.document_id === selectedFile.id).length === 0 && (
              <div style={{ textAlign: 'center', padding: '2rem 0.5rem', color: 'var(--muted)', fontSize: '0.78rem' }}>
                No annotations on this document yet. Enter Annotation Mode to add one.
              </div>
            )}

            {filteredAnnotations.filter(a => a.document_id === selectedFile.id).map(ann => {
              const typeInfo = getTypeInfo(ann.type);
              const isResolved = ann.status === 'RESOLVED';
              return (
                <div key={ann.id} style={{
                  background: 'white', borderRadius: 'var(--radius-md)', padding: '0.6rem', marginBottom: '0.5rem',
                  borderLeft: `3px solid ${isResolved ? '#d1d5db' : typeInfo.color}`,
                  opacity: isResolved ? 0.7 : 1, transition: 'all 0.2s'
                }}>
                  {/* Annotation header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.3rem' }}>
                    <span style={{ fontSize: '0.63rem', padding: '0.1rem 0.35rem', borderRadius: 4, background: `${typeInfo.color}15`, color: typeInfo.color, fontWeight: 600 }}>
                      {typeInfo.icon} {typeInfo.label}
                    </span>
                    {isResolved && <span style={{ fontSize: '0.6rem', color: 'var(--success)', fontWeight: 600 }}>✅ Resolved</span>}
                  </div>

                  {/* Selected text */}
                  {ann.selected_text && (
                    <div style={{ fontSize: '0.7rem', fontStyle: 'italic', color: 'var(--muted)', background: '#FEF3C7', padding: '0.2rem 0.4rem', borderRadius: 3, marginBottom: '0.3rem' }}>
                      "{ann.selected_text.length > 80 ? ann.selected_text.slice(0, 80) + '...' : ann.selected_text}"
                    </div>
                  )}

                  {/* Body */}
                  <div style={{ fontSize: '0.78rem', lineHeight: 1.4, marginBottom: '0.3rem' }}>{ann.body}</div>

                  {/* Author and time */}
                  <div style={{ fontSize: '0.63rem', color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: ann.author?.team === 'CA' ? 'var(--ca)' : 'var(--ds)', fontWeight: 600 }}>
                      {ann.author?.team} · {ann.author?.name}
                    </span>
                    <span>{new Date(ann.created_at).toLocaleString()}</span>
                  </div>

                  {/* Replies */}
                  {ann.replies?.length > 0 && (
                    <div style={{ marginTop: '0.4rem', paddingTop: '0.4rem', borderTop: '1px solid var(--border)' }}>
                      {ann.replies.map(r => (
                        <div key={r.id} style={{ fontSize: '0.72rem', padding: '0.3rem 0', borderBottom: '1px dashed #eee' }}>
                          <strong style={{ color: r.author?.team === 'CA' ? 'var(--ca)' : 'var(--ds)' }}>{r.author?.name}</strong>: {r.text}
                          <div style={{ fontSize: '0.6rem', color: 'var(--muted)' }}>{new Date(r.created_at).toLocaleString()}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  {!isResolved && (
                    <div style={{ marginTop: '0.4rem', display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      <button onClick={() => setReplyingTo(replyingTo === ann.id ? null : ann.id)} style={{
                        padding: '0.2rem 0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
                        background: 'white', cursor: 'pointer', fontSize: '0.65rem'
                      }}>💬 Reply</button>
                      <button onClick={() => resolveAnnotation(ann.id)} style={{
                        padding: '0.2rem 0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--success)',
                        background: 'white', cursor: 'pointer', fontSize: '0.65rem', color: 'var(--success)'
                      }}>✅ Resolve</button>
                    </div>
                  )}

                  {/* Reply input */}
                  {replyingTo === ann.id && (
                    <div style={{ marginTop: '0.4rem', display: 'flex', gap: '0.3rem' }}>
                      <input value={replyText} onChange={e => setReplyText(e.target.value)}
                        placeholder="Your reply..." onKeyDown={e => e.key === 'Enter' && submitReply(ann.id)}
                        style={{ flex: 1, padding: '0.3rem 0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.72rem' }} />
                      <button onClick={() => submitReply(ann.id)} disabled={!replyText.trim()} style={{
                        padding: '0.3rem 0.5rem', borderRadius: 'var(--radius-sm)', border: 'none',
                        background: 'var(--ca)', color: 'white', cursor: 'pointer', fontSize: '0.7rem'
                      }}>Send</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default AnnotationsTab;
