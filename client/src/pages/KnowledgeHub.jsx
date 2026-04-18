import React, { useEffect, useMemo, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { knowledgeHubAPI, projectsAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';

const TabBtn = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className="btn"
    style={{
      padding: '0.55rem 0.85rem',
      borderRadius: 12,
      border: `1.5px solid ${active ? 'var(--ca)' : 'var(--border)'}`,
      background: active ? 'var(--ca-light)' : 'white',
      fontWeight: 700,
      fontSize: '0.82rem',
      cursor: 'pointer',
    }}
  >
    {children}
  </button>
);

const Modal = ({ title, children, onClose, width = 640 }) => (
  <div className="modal-overlay" onClick={onClose}>
    <div
      className="modal"
      onClick={(e) => e.stopPropagation()}
      style={{ maxWidth: width, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 className="modal-title" style={{ fontSize: '1.2rem', fontWeight: 800 }}>
          {title}
        </h2>
        <button onClick={onClose} style={{ background: 'none', border: 0, fontSize: '1.4rem', cursor: 'pointer', color: 'var(--muted)' }}>
          ×
        </button>
      </div>
      {children}
    </div>
  </div>
);

const formatApiError = (err) => {
  const data = err?.response?.data;
  if (!data) return 'Request failed. Please try again.';
  if (typeof data.message === 'string' && data.message.trim()) return data.message;
  if (Array.isArray(data.errors) && data.errors.length) {
    // express-validator format: [{ msg, path, ... }]
    return data.errors.map((e) => e.msg).filter(Boolean).join(' ');
  }
  return 'Request failed. Please try again.';
};

const KnowledgeHub = () => {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState('glossary'); // glossary | library | guidelines

  // Glossary state
  const [gQuery, setGQuery] = useState('');
  const [gStatus, setGStatus] = useState('PUBLISHED');
  const [terms, setTerms] = useState([]);
  const [gLoading, setGLoading] = useState(false);
  const [showPropose, setShowPropose] = useState(false);
  const [showPublish, setShowPublish] = useState(null); // term object

  // Guidelines state
  const [guidelines, setGuidelines] = useState([]);
  const [guidelineQ, setGuidelineQ] = useState('');
  const [guidelineDomain, setGuidelineDomain] = useState('');
  const [guidelineLoading, setGuidelineLoading] = useState(false);
  const [showGuidelineCreate, setShowGuidelineCreate] = useState(false);
  const [activeGuideline, setActiveGuideline] = useState(null);
  const [activeGuidelineDetail, setActiveGuidelineDetail] = useState(null);

  // Library state
  const [library, setLibrary] = useState([]);
  const [libLoading, setLibLoading] = useState(false);
  const [libQ, setLibQ] = useState('');
  const [libDomain, setLibDomain] = useState('');
  const [showPublishLibrary, setShowPublishLibrary] = useState(false);

  const loadGlossary = async () => {
    try {
      setGLoading(true);
      const res = await knowledgeHubAPI.glossarySearch({ q: gQuery || undefined, status: isAdmin ? gStatus : 'PUBLISHED' });
      setTerms(res.data.terms || []);
    } finally {
      setGLoading(false);
    }
  };

  const loadGuidelines = async () => {
    try {
      setGuidelineLoading(true);
      const res = await knowledgeHubAPI.listGuidelines({
        q: guidelineQ || undefined,
        domain: guidelineDomain || undefined,
      });
      setGuidelines(res.data.guidelines || []);
    } finally {
      setGuidelineLoading(false);
    }
  };

  const loadLibrary = async () => {
    try {
      setLibLoading(true);
      const res = await knowledgeHubAPI.listLibrary({
        q: libQ || undefined,
        domain: libDomain || undefined,
      });
      setLibrary(res.data.entries || []);
    } finally {
      setLibLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'glossary') loadGlossary();
    if (tab === 'guidelines') loadGuidelines();
    if (tab === 'library') loadLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Refresh on search changes (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      if (tab === 'glossary') loadGlossary();
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gQuery, gStatus]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (tab === 'guidelines') loadGuidelines();
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidelineQ, guidelineDomain]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (tab === 'library') loadLibrary();
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libQ, libDomain]);

  const subtitle = useMemo(() => 'Glossary · Past Projects · Guidelines', []);

  return (
    <DashboardLayout title="Knowledge Hub" subtitle={subtitle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <TabBtn active={tab === 'glossary'} onClick={() => setTab('glossary')}>📚 Glossary</TabBtn>
          <TabBtn active={tab === 'library'} onClick={() => setTab('library')}>🗃️ Past Projects</TabBtn>
          <TabBtn active={tab === 'guidelines'} onClick={() => setTab('guidelines')}>📄 Guidelines</TabBtn>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {tab === 'glossary' && (
            <button className="btn btn-primary" onClick={() => setShowPropose(true)}>
              + Propose Term
            </button>
          )}
          {tab === 'guidelines' && isAdmin && (
            <button className="btn btn-primary" onClick={() => setShowGuidelineCreate(true)}>
              + New Guideline
            </button>
          )}
          {tab === 'library' && isAdmin && (
            <button className="btn btn-primary" onClick={() => setShowPublishLibrary(true)}>
              + Publish Entry
            </button>
          )}
        </div>
      </div>

      {/* ── Glossary ───────────────────────────────────────── */}
      {tab === 'glossary' && (
        <div className="card">
          <div className="card-header" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <h3 style={{ flex: 1 }}>Bilingual Glossary</h3>
            {isAdmin && (
              <select className="form-input" style={{ width: 180 }} value={gStatus} onChange={(e) => setGStatus(e.target.value)}>
                <option value="PUBLISHED">Published</option>
                <option value="PENDING">Pending</option>
                <option value="ALL">All</option>
              </select>
            )}
            <input
              className="form-input"
              style={{ width: 320 }}
              placeholder="Search term, definition, description…"
              value={gQuery}
              onChange={(e) => setGQuery(e.target.value)}
            />
          </div>
          <div className="card-body">
            {gLoading ? (
              <div style={{ padding: '2rem', textAlign: 'center' }}><span className="spinner spinner-dark" /></div>
            ) : terms.length === 0 ? (
              <div className="empty-state" style={{ padding: '2rem' }}>
                <div className="empty-icon">📚</div>
                <p>No glossary terms found.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '0.9rem' }}>
                {terms.map((t) => (
                  <div key={t.id} style={{ border: '1.5px solid var(--border)', borderRadius: 14, padding: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                      <div style={{ fontFamily: 'Syne', fontWeight: 900, fontSize: '1.05rem' }}>{t.term}</div>
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        <span className={`badge ${t.status === 'PUBLISHED' ? 'badge-success' : 'badge-warning'}`}>
                          {t.status}
                        </span>
                        {isAdmin && t.status === 'PENDING' && (
                          <button className="btn btn-ghost" onClick={() => setShowPublish(t)} style={{ padding: '0.35rem 0.6rem' }}>
                            Publish
                          </button>
                        )}
                      </div>
                    </div>

                    <div style={{ marginTop: '0.65rem', fontSize: '0.85rem' }}>
                      <div style={{ fontWeight: 800, fontSize: '0.75rem', color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                        CA Definition
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap', marginBottom: 10 }}>{t.ca_definition}</div>

                      <div style={{ fontWeight: 800, fontSize: '0.75rem', color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                        DS Definition
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap', marginBottom: 10 }}>{t.ds_definition || '—'}</div>

                      <div style={{ fontWeight: 800, fontSize: '0.75rem', color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                        Plain English
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{t.plain_english_description}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Past projects library ──────────────────────────── */}
      {tab === 'library' && (
        <div className="card">
          <div className="card-header" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <h3 style={{ flex: 1 }}>Past Project Deliverables Library</h3>
            <select className="form-input" style={{ width: 180 }} value={libDomain} onChange={(e) => setLibDomain(e.target.value)}>
              <option value="">All domains</option>
              <option value="CA">CA</option>
              <option value="DS">DS</option>
              <option value="JOINT">Joint</option>
            </select>
            <input
              className="form-input"
              style={{ width: 320 }}
              placeholder="Search by project, file, or lessons…"
              value={libQ}
              onChange={(e) => setLibQ(e.target.value)}
            />
          </div>
          <div className="card-body">
            {libLoading ? (
              <div style={{ padding: '2rem', textAlign: 'center' }}><span className="spinner spinner-dark" /></div>
            ) : library.length === 0 ? (
              <div className="empty-state" style={{ padding: '2rem' }}>
                <div className="empty-icon">🗃️</div>
                <p>No published entries yet.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '0.9rem' }}>
                {library.map((e) => (
                  <div key={e.id} style={{ border: '1.5px solid var(--border)', borderRadius: 14, padding: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                      <div style={{ fontWeight: 900, fontFamily: 'Syne' }}>{e.project_name}</div>
                      <span className="badge badge-primary">{e.domain}</span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: 4 }}>
                      Published {new Date(e.published_at).toLocaleDateString()}
                    </div>
                    <div style={{ marginTop: 10, fontSize: '0.85rem', color: 'var(--muted)' }}>
                      <div style={{ fontWeight: 800, fontSize: '0.75rem', color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                        Key lessons
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap', color: 'var(--ink)' }}>{e.key_lessons}</div>
                    </div>
                    <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {(e.tags || []).slice(0, 6).map((t, idx) => (
                        <span key={idx} className="badge badge-secondary">{t}</span>
                      ))}
                    </div>
                    <div style={{ marginTop: 10, fontSize: '0.82rem' }}>
                      <div><strong>Deliverable:</strong> {e.file_name || '—'}</div>
                      <div><strong>Decision Rationale:</strong> {e.decision_rationale_path ? 'Available' : '—'}</div>
                    </div>
                    <div style={{ marginTop: 10, display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {e.file_id && (
                        <button
                          className="btn btn-ghost"
                          onClick={() => window.open(`/api/projects/${e.project_id}/files/${e.file_id}/download`, '_blank')}
                        >
                          Open deliverable
                        </button>
                      )}
                      {e.decision_rationale_path && (
                        <button
                          className="btn btn-ghost"
                          onClick={() => window.open(`/uploads/${e.decision_rationale_path}`, '_blank')}
                        >
                          Open decision rationale
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Guidelines ─────────────────────────────────────── */}
      {tab === 'guidelines' && (
        <div className="card">
          <div className="card-header" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <h3 style={{ flex: 1 }}>Best-Practice Guidelines</h3>
            <select className="form-input" style={{ width: 180 }} value={guidelineDomain} onChange={(e) => setGuidelineDomain(e.target.value)}>
              <option value="">All domains</option>
              <option value="CA">CA</option>
              <option value="DS">DS</option>
              <option value="JOINT">Joint</option>
            </select>
            <input
              className="form-input"
              style={{ width: 320 }}
              placeholder="Search guidelines…"
              value={guidelineQ}
              onChange={(e) => setGuidelineQ(e.target.value)}
            />
          </div>
          <div className="card-body">
            {guidelineLoading ? (
              <div style={{ padding: '2rem', textAlign: 'center' }}><span className="spinner spinner-dark" /></div>
            ) : guidelines.length === 0 ? (
              <div className="empty-state" style={{ padding: '2rem' }}>
                <div className="empty-icon">📄</div>
                <p>No guidelines found.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '0.9rem' }}>
                {guidelines.map((g) => (
                  <button
                    key={g.id}
                    onClick={async () => {
                      setActiveGuideline(g);
                      const res = await knowledgeHubAPI.getGuideline(g.id);
                      setActiveGuidelineDetail(res.data);
                    }}
                    style={{
                      textAlign: 'left',
                      padding: '1rem',
                      borderRadius: 14,
                      border: '1.5px solid var(--border)',
                      background: 'white',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                      <div style={{ fontFamily: 'Syne', fontWeight: 900 }}>{g.title}</div>
                      <span className="badge badge-primary">{g.domain}</span>
                    </div>
                    <div style={{ marginTop: 6, fontSize: '0.78rem', color: 'var(--muted)' }}>
                      Latest v{g.version_number || 1} · Updated {new Date(g.updated_at).toLocaleDateString()}
                    </div>
                    <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {(g.tags || []).slice(0, 6).map((t, idx) => (
                        <span key={idx} className="badge badge-secondary">{t}</span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────── */}
      {showPropose && (
        <ProposeTermModal
          onClose={() => setShowPropose(false)}
          onDone={async () => {
            setShowPropose(false);
            await loadGlossary();
          }}
        />
      )}

      {showPublish && (
        <PublishTermModal
          term={showPublish}
          onClose={() => setShowPublish(null)}
          onDone={async () => {
            setShowPublish(null);
            await loadGlossary();
          }}
        />
      )}

      {showGuidelineCreate && (
        <CreateGuidelineModal
          onClose={() => setShowGuidelineCreate(false)}
          onDone={async () => {
            setShowGuidelineCreate(false);
            await loadGuidelines();
          }}
        />
      )}

      {activeGuideline && activeGuidelineDetail && (
        <GuidelineDetailModal
          data={activeGuidelineDetail}
          isAdmin={isAdmin}
          onClose={() => {
            setActiveGuideline(null);
            setActiveGuidelineDetail(null);
          }}
          onChanged={async () => {
            await loadGuidelines();
            const res = await knowledgeHubAPI.getGuideline(activeGuideline.id);
            setActiveGuidelineDetail(res.data);
          }}
        />
      )}

      {showPublishLibrary && (
        <PublishLibraryModal
          onClose={() => setShowPublishLibrary(false)}
          onDone={async () => {
            setShowPublishLibrary(false);
            await loadLibrary();
          }}
        />
      )}
    </DashboardLayout>
  );
};

const ProposeTermModal = ({ onClose, onDone }) => {
  const [form, setForm] = useState({ term: '', caDefinition: '', dsDefinition: '', plainEnglishDescription: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    const term = form.term.trim();
    const caDef = form.caDefinition.trim();
    const dsDef = form.dsDefinition.trim();
    const plain = form.plainEnglishDescription.trim();
    if (term.length < 2) return setError('Term must be at least 2 characters.');
    if (caDef.length < 2) return setError('CA definition is required (min 2 chars).');
    if (plain.length < 5) return setError('Plain English description is required (min 5 chars).');
    setSaving(true);
    try {
      await knowledgeHubAPI.proposeTerm({
        term,
        caDefinition: caDef,
        dsDefinition: dsDef || null,
        plainEnglishDescription: plain,
      });
      await onDone();
    } catch (e) {
      setError(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Propose a New Glossary Term" onClose={onClose}>
      {error && <div style={{ marginBottom: '0.75rem', color: 'var(--danger)', fontWeight: 700 }}>⚠️ {error}</div>}
      <div className="form-group">
        <label className="form-label">Term</label>
        <input className="form-input" value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} />
      </div>
      <div className="form-group">
        <label className="form-label">CA Definition</label>
        <textarea className="form-input" rows={3} value={form.caDefinition} onChange={(e) => setForm({ ...form, caDefinition: e.target.value })} />
      </div>
      <div className="form-group">
        <label className="form-label">DS Definition (optional)</label>
        <textarea className="form-input" rows={3} value={form.dsDefinition} onChange={(e) => setForm({ ...form, dsDefinition: e.target.value })} />
      </div>
      <div className="form-group">
        <label className="form-label">Plain English Description</label>
        <textarea className="form-input" rows={3} value={form.plainEnglishDescription} onChange={(e) => setForm({ ...form, plainEnglishDescription: e.target.value })} />
      </div>
      <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={saving}>
          {saving ? 'Submitting…' : 'Submit for approval'}
        </button>
      </div>
    </Modal>
  );
};

const PublishTermModal = ({ term, onClose, onDone }) => {
  const [form, setForm] = useState({
    term: term.term || '',
    caDefinition: term.ca_definition || '',
    dsDefinition: term.ds_definition || '',
    plainEnglishDescription: term.plain_english_description || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    const next = {
      term: form.term.trim(),
      caDefinition: form.caDefinition.trim(),
      dsDefinition: form.dsDefinition.trim(),
      plainEnglishDescription: form.plainEnglishDescription.trim(),
    };
    if (next.term.length < 2) return setError('Term must be at least 2 characters.');
    if (next.caDefinition.length < 2) return setError('CA definition is required (min 2 chars).');
    if (next.plainEnglishDescription.length < 5) return setError('Plain English description is required (min 5 chars).');
    setSaving(true);
    try {
      await knowledgeHubAPI.publishTerm(term.id, next);
      await onDone();
    } catch (e) {
      setError(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Publish Glossary Term" onClose={onClose}>
      {error && <div style={{ marginBottom: '0.75rem', color: 'var(--danger)', fontWeight: 700 }}>⚠️ {error}</div>}
      <div className="form-group">
        <label className="form-label">Term</label>
        <input className="form-input" value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} />
      </div>
      <div className="form-group">
        <label className="form-label">CA Definition</label>
        <textarea className="form-input" rows={3} value={form.caDefinition} onChange={(e) => setForm({ ...form, caDefinition: e.target.value })} />
      </div>
      <div className="form-group">
        <label className="form-label">DS Definition</label>
        <textarea className="form-input" rows={3} value={form.dsDefinition} onChange={(e) => setForm({ ...form, dsDefinition: e.target.value })} />
      </div>
      <div className="form-group">
        <label className="form-label">Plain English Description</label>
        <textarea className="form-input" rows={3} value={form.plainEnglishDescription} onChange={(e) => setForm({ ...form, plainEnglishDescription: e.target.value })} />
      </div>
      <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={saving}>
          {saving ? 'Publishing…' : 'Publish'}
        </button>
      </div>
    </Modal>
  );
};

const CreateGuidelineModal = ({ onClose, onDone }) => {
  const [form, setForm] = useState({ title: '', domain: 'JOINT', tags: '', content: '', changeNote: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (form.title.trim().length < 3) return setError('Title must be at least 3 characters.');
    if (form.content.trim().length < 20) return setError('Content must be at least 20 characters.');
    setSaving(true);
    try {
      const tags = form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      await knowledgeHubAPI.createGuideline({
        title: form.title.trim(),
        domain: form.domain,
        tags,
        content: form.content.trim(),
        changeNote: form.changeNote?.trim?.() || null,
      });
      await onDone();
    } catch (e) {
      setError(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Create Guideline" onClose={onClose}>
      {error && <div style={{ marginBottom: '0.75rem', color: 'var(--danger)', fontWeight: 700 }}>⚠️ {error}</div>}
      <div className="form-group">
        <label className="form-label">Title</label>
        <input className="form-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </div>
      <div className="form-group">
        <label className="form-label">Domain</label>
        <select className="form-input" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })}>
          <option value="CA">CA</option>
          <option value="DS">DS</option>
          <option value="JOINT">Joint</option>
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Tags (comma separated)</label>
        <input className="form-input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="e.g., forecasting, audit, data-quality" />
      </div>
      <div className="form-group">
        <label className="form-label">Content</label>
        <textarea className="form-input" rows={10} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
      </div>
      <div className="form-group">
        <label className="form-label">Change note (optional)</label>
        <input className="form-input" value={form.changeNote} onChange={(e) => setForm({ ...form, changeNote: e.target.value })} />
      </div>
      <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={saving}>
          {saving ? 'Creating…' : 'Create'}
        </button>
      </div>
    </Modal>
  );
};

const GuidelineDetailModal = ({ data, isAdmin, onClose, onChanged }) => {
  const guideline = data.guideline;
  const versions = data.versions || [];
  const latest = versions[0];
  const [mode, setMode] = useState('read'); // read | propose
  const [proposal, setProposal] = useState({ content: latest?.content || '', comment: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submitProposal = async () => {
    setError('');
    if ((proposal.content || '').trim().length < 20) return setError('Proposed content must be at least 20 characters.');
    setSaving(true);
    try {
      await knowledgeHubAPI.proposeGuidelineEdit(guideline.id, {
        content: proposal.content.trim(),
        comment: proposal.comment?.trim?.() || '',
      });
      setMode('read');
      await onChanged();
    } catch (e) {
      setError(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const review = async (editId, decision) => {
    await knowledgeHubAPI.reviewProposedEdit(guideline.id, editId, { decision });
    await onChanged();
  };

  return (
    <Modal title={guideline.title} onClose={onClose} width={840}>
      {error && <div style={{ marginBottom: '0.75rem', color: 'var(--danger)', fontWeight: 700 }}>⚠️ {error}</div>}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <span className="badge badge-primary">{guideline.domain}</span>
        {(guideline.tags || []).map((t, idx) => <span key={idx} className="badge badge-secondary">{t}</span>)}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
          Latest version: <strong>v{latest?.version_number || 1}</strong>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-ghost" onClick={() => setMode('read')}>Read</button>
          <button className="btn btn-primary" onClick={() => setMode('propose')}>Suggest Edit</button>
        </div>
      </div>

      {mode === 'read' ? (
        <div style={{ border: '1.5px solid var(--border)', borderRadius: 14, padding: '1rem', whiteSpace: 'pre-wrap' }}>
          {latest?.content || '—'}
        </div>
      ) : (
        <div>
          <div className="form-group">
            <label className="form-label">Proposed content</label>
            <textarea className="form-input" rows={12} value={proposal.content} onChange={(e) => setProposal({ ...proposal, content: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Comment (optional)</label>
            <input className="form-input" value={proposal.comment} onChange={(e) => setProposal({ ...proposal, comment: e.target.value })} />
          </div>
          <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button className="btn btn-ghost" onClick={() => setMode('read')}>Cancel</button>
            <button className="btn btn-primary" onClick={submitProposal} disabled={saving}>
              {saving ? 'Submitting…' : 'Submit edit suggestion'}
            </button>
          </div>
        </div>
      )}

      {isAdmin && (data.proposedEdits || []).length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <div style={{ fontWeight: 900, fontFamily: 'Syne', marginBottom: '0.6rem' }}>Proposed edits</div>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {data.proposedEdits.map((pe) => (
              <div key={pe.id} style={{ border: '1.5px solid var(--border)', borderRadius: 14, padding: '0.85rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                  <div style={{ fontWeight: 800 }}>{pe.proposed_by_name || 'User'}</div>
                  <span className={`badge ${pe.status === 'PENDING' ? 'badge-warning' : pe.status === 'APPROVED' ? 'badge-success' : 'badge-danger'}`}>
                    {pe.status}
                  </span>
                </div>
                {pe.comment && <div style={{ marginTop: 6, color: 'var(--muted)', fontSize: '0.82rem' }}>{pe.comment}</div>}
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 700 }}>View proposed content</summary>
                  <div style={{ marginTop: 8, whiteSpace: 'pre-wrap', border: '1px solid var(--border)', borderRadius: 12, padding: '0.75rem' }}>
                    {pe.proposed_content}
                  </div>
                </details>
                {pe.status === 'PENDING' && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: 10 }}>
                    <button className="btn btn-ghost" onClick={() => review(pe.id, 'REJECT')}>Reject</button>
                    <button className="btn btn-primary" onClick={() => review(pe.id, 'APPROVE')}>Approve</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
};

const PublishLibraryModal = ({ onClose, onDone }) => {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [options, setOptions] = useState({ files: [], decisionRationales: [] });
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [form, setForm] = useState({
    domain: 'JOINT',
    fileId: '',
    decisionRationaleId: '',
    tags: '',
    keyLessons: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      const res = await projectsAPI.list({ status: 'completed' });
      setProjects(res.data.projects || []);
    };
    load();
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!projectId) return;
      setLoadingOptions(true);
      try {
        const res = await knowledgeHubAPI.getLibraryPublishOptions({ projectId });
        setOptions({ files: res.data.files || [], decisionRationales: res.data.decisionRationales || [] });
      } finally {
        setLoadingOptions(false);
      }
    };
    load();
  }, [projectId]);

  const submit = async () => {
    setError('');
    if (!projectId) return setError('Select a completed project first.');
    if ((form.keyLessons || '').trim().length < 5) return setError('Key lessons is required (min 5 chars).');
    setSaving(true);
    try {
      const tags = form.tags.split(',').map((t) => t.trim()).filter(Boolean);
      await knowledgeHubAPI.publishLibraryEntry({
        projectId,
        domain: form.domain,
        fileId: form.fileId || null,
        decisionRationaleId: form.decisionRationaleId || null,
        tags,
        keyLessons: form.keyLessons.trim(),
      });
      await onDone();
    } catch (e) {
      setError(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Publish Past Project Entry" onClose={onClose}>
      {error && <div style={{ marginBottom: '0.75rem', color: 'var(--danger)', fontWeight: 700 }}>⚠️ {error}</div>}
      <div className="form-group">
        <label className="form-label">Completed project</label>
        <select className="form-input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Select a completed project…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">Domain</label>
        <select className="form-input" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} disabled={!projectId}>
          <option value="CA">CA</option>
          <option value="DS">DS</option>
          <option value="JOINT">Joint</option>
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">Deliverable file (optional)</label>
        <select className="form-input" value={form.fileId} onChange={(e) => setForm({ ...form, fileId: e.target.value })} disabled={!projectId || loadingOptions}>
          <option value="">—</option>
          {options.files.map((f) => (
            <option key={f.id} value={f.id}>{f.original_name}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">Decision rationale document (optional)</label>
        <select
          className="form-input"
          value={form.decisionRationaleId}
          onChange={(e) => setForm({ ...form, decisionRationaleId: e.target.value })}
          disabled={!projectId || loadingOptions}
        >
          <option value="">—</option>
          {options.decisionRationales.map((d) => (
            <option key={d.id} value={d.id}>{d.document_path} ({new Date(d.generated_at).toLocaleDateString()})</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">Tags (comma separated)</label>
        <input className="form-input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} disabled={!projectId} />
      </div>

      <div className="form-group">
        <label className="form-label">Key lessons (required)</label>
        <textarea className="form-input" rows={5} value={form.keyLessons} onChange={(e) => setForm({ ...form, keyLessons: e.target.value })} disabled={!projectId} />
      </div>

      <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={saving || !projectId}>
          {saving ? 'Publishing…' : 'Publish'}
        </button>
      </div>
    </Modal>
  );
};

export default KnowledgeHub;

