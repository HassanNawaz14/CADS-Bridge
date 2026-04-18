import axios from 'axios';

const isLocalhost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_BASE = process.env.REACT_APP_API_URL || (isLocalhost ? 'http://localhost:5000' : '');

const api = axios.create({
  baseURL: `${API_BASE}/api`,
  withCredentials: true,
  timeout: 15000,
});

// Attach JWT on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle 401 globally — clear session and redirect to login
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;

// ── Auth ──────────────────────────────────────────────────
export const authAPI = {
  checkEnv:  (envCode)  => api.post('/auth/check-env', { envCode }),
  register:  (data)     => api.post('/auth/register', data),
  login:     (data)     => api.post('/auth/login', data),
  logout:    ()         => api.post('/auth/logout'),
  me:        ()         => api.get('/auth/me'),
};

// ── Admin ─────────────────────────────────────────────────
export const adminAPI = {
  getPendingUsers:    ()          => api.get('/admin/users/pending'),
  getUsers:           (params)    => api.get('/admin/users', { params }),
  approveUser:        (id)        => api.post(`/admin/users/${id}/approve`),
  rejectUser:         (id, reason)=> api.post(`/admin/users/${id}/reject`, { reason }),
  deactivateUser:     (id)        => api.post(`/admin/users/${id}/deactivate`),
  createAdmin:        (data)      => api.post('/admin/users', data),
  getAuditLogs:       (params)    => api.get('/admin/audit-logs', { params }),
  getKpiThresholds:   ()          => api.get('/admin/kpi-thresholds'),
  updateKpiThreshold: (key, data) => api.put(`/admin/kpi-thresholds/${key}`, data),
  getRegulatoryRules: (params)    => api.get('/admin/regulatory-rules', { params }),
  createRegulatoryRule:(data)     => api.post('/admin/regulatory-rules', data),
  getComplianceBreaches:(params)  => api.get('/admin/compliance-breaches', { params }),
};

// ── Projects ──────────────────────────────────────────────
export const projectsAPI = {
  list:    (params) => api.get('/projects', { params }),
  get:     (id)     => api.get(`/projects/${id}`),
  create:  (data)   => api.post('/projects', data),
  approve: (id)     => api.post(`/projects/${id}/approve`),
  reject:  (id, reason) => api.post(`/projects/${id}/reject`, { reason }),
  requestChanges: (id, reason) => api.post(`/projects/${id}/request-changes`, { reason }),
  history: (id)     => api.get(`/projects/${id}/history`),
  complete: (id)    => api.post(`/projects/${id}/complete`),
  getTeamUsers: (params) => api.get('/projects/team/users', { params }),
};

// ── Workspace ─────────────────────────────────────────────
export const workspaceAPI = {
  getMessages:  (pid)        => api.get(`/projects/${pid}/messages`),
  sendMessage:  (pid, content) => api.post(`/projects/${pid}/messages`, { content }),
  getFiles:     (pid)        => api.get(`/projects/${pid}/files`),
  uploadFile:   (pid, form)  => api.post(`/projects/${pid}/files`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  downloadFile: (pid, fid)   => `/api/projects/${pid}/files/${fid}/download`,
  getFileVersions: (pid, fid) => api.get(`/projects/${pid}/files/${fid}/versions`),
  restoreFileVersion: (pid, fid, versionId) => api.post(`/projects/${pid}/files/${fid}/restore`, { versionId }),
  getBreaches: (pid) => api.get(`/projects/${pid}/breaches`),
  createBreach: (pid, data) => api.post(`/projects/${pid}/breaches`, data),
  resolveBreach: (pid, breachId, data) => api.patch(`/projects/${pid}/breaches/${breachId}/resolve`, data),
  getAnnotations: (pid, params) => api.get(`/projects/${pid}/annotations`, { params }),
  createAnnotation: (pid, data) => api.post(`/projects/${pid}/annotations`, data),
  addAnnotationReply: (pid, annotationId, data) => api.post(`/projects/${pid}/annotations/${annotationId}/replies`, data),
  resolveAnnotation: (pid, annotationId) => api.patch(`/projects/${pid}/annotations/${annotationId}/resolve`),
};

// ── Tasks ─────────────────────────────────────────────────
export const tasksAPI = {
  list:         (params) => api.get('/tasks', { params }),
  create:       (data)   => api.post('/tasks', data),
  updateStatus: (id, status) => api.patch(`/tasks/${id}/status`, { status }),
  addComment:   (id, comment) => api.post(`/tasks/${id}/comments`, { comment }),
  adminUpdate:  (id, data) => api.patch(`/tasks/${id}/admin`, data),
  setDependencies: (id, blockedBy) => api.post(`/tasks/${id}/dependencies`, { blockedBy }),
  getDependencies: (projectId) => api.get(`/tasks/project/${projectId}/dependencies`),
  getAccountabilityChain: (projectId) => api.get(`/tasks/project/${projectId}/accountability-chain`),
};

// ── KPI ───────────────────────────────────────────────────
export const kpiAPI = {
  get:                 (params) => api.get('/kpi', { params }),
  record:              (data) => api.post('/kpi', data),
  saveLayout:          (layout) => api.post('/kpi/layout', { layout }),
  addInsight:          (data) => api.post('/kpi/insights', data),
  addPeerRating:       (data) => api.post('/kpi/peer-rating', data),
  addRecommendation:   (data) => api.post('/kpi/recommendations', data),
};

// ── Notifications ─────────────────────────────────────────
export const notifAPI = {
  list:    ()   => api.get('/notifications'),
  markRead:(id) => api.patch(`/notifications/${id}/read`),
  readAll: ()   => api.patch('/notifications/read-all'),
};

// ── Onboarding ────────────────────────────────────────────
export const onboardingAPI = {
  checkFirm:     (data)          => api.post('/onboarding/check-firm', data),
  provision:     (data)          => api.post('/onboarding/provision', data),
  inviteMembers: (data)          => api.post('/onboarding/invite-members', data),
};

// ── Knowledge Hub (3.6) ───────────────────────────────────
export const knowledgeHubAPI = {
  glossarySearch: (params) => api.get('/knowledge-hub/glossary', { params }),
  proposeTerm: (data) => api.post('/knowledge-hub/glossary/propose', data),
  publishTerm: (id, data) => api.post(`/knowledge-hub/glossary/${id}/publish`, data),

  listGuidelines: (params) => api.get('/knowledge-hub/guidelines', { params }),
  getGuideline: (id) => api.get(`/knowledge-hub/guidelines/${id}`),
  createGuideline: (data) => api.post('/knowledge-hub/guidelines', data),
  proposeGuidelineEdit: (id, data) => api.post(`/knowledge-hub/guidelines/${id}/propose-edit`, data),
  reviewProposedEdit: (id, editId, data) =>
    api.post(`/knowledge-hub/guidelines/${id}/proposed-edits/${editId}/review`, data),

  listLibrary: (params) => api.get('/knowledge-hub/library', { params }),
  publishLibraryEntry: (data) => api.post('/knowledge-hub/library/publish', data),
  getLibraryPublishOptions: (params) => api.get('/knowledge-hub/library/publish-options', { params }),
};

// ── Conflicts (3.7) ────────────────────────────────────────
export const conflictsAPI = {
  list: (params) => api.get('/conflicts', { params }),
  addRootCause: (id, data) => api.post(`/conflicts/${id}/root-cause`, data),
  addCAResponse: (id, data) => api.post(`/conflicts/${id}/ca-response`, data),
  setReconciliation: (id, data) => api.post(`/conflicts/${id}/reconciliation`, data),
  confirmResolution: (id) => api.post(`/conflicts/${id}/confirm`),
  listRules: (params) => api.get('/conflicts/rules/list', { params }),
  createRule: (data) => api.post('/conflicts/rules', data),
  getSettings: () => api.get('/conflicts/settings'),
  updateSettings: (data) => api.put('/conflicts/settings', data),
};
