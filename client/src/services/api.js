import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
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
};

// ── Projects ──────────────────────────────────────────────
export const projectsAPI = {
  list:    (params) => api.get('/projects', { params }),
  get:     (id)     => api.get(`/projects/${id}`),
  create:  (data)   => api.post('/projects', data),
  approve: (id)     => api.post(`/projects/${id}/approve`),
  reject:  (id, reason) => api.post(`/projects/${id}/reject`, { reason }),
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
};

// ── Tasks ─────────────────────────────────────────────────
export const tasksAPI = {
  list:         (params) => api.get('/tasks', { params }),
  create:       (data)   => api.post('/tasks', data),
  updateStatus: (id, status) => api.patch(`/tasks/${id}/status`, { status }),
};

// ── KPI ───────────────────────────────────────────────────
export const kpiAPI = {
  get:    () => api.get('/kpi'),
  record: (data) => api.post('/kpi', data),
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
