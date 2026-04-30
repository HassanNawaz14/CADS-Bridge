/**
 * CADS-Bridge Workspace API Service
 * API functions for Feature 3.8 Workspace functionality
 */

import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const getAuthConfig = () => ({
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('token')}`,
    'Content-Type': 'application/json'
  }
});

const getMultiPartConfig = () => ({
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('token')}`,
    'Content-Type': 'multipart/form-data'
  }
});

// ===== WORKSPACE HUB APIS =====

export const getWorkspaceHealth = async (projectId) => {
  const response = await axios.get(`${API_BASE}/projects/${projectId}/workspace/health`, getAuthConfig());
  return response.data;
};

export const getActivityFeed = async (projectId, params = {}) => {
  const response = await axios.get(`${API_BASE}/projects/${projectId}/workspace/activity-feed`, {
    ...getAuthConfig(),
    params
  });
  return response.data;
};

export const getTasks = async (projectId) => {
  const response = await axios.get(`${API_BASE}/projects/${projectId}/tasks`, getAuthConfig());
  return response.data;
};

export const logWorkspaceActivity = async (projectId, activityData) => {
  const response = await axios.post(`${API_BASE}/projects/${projectId}/workspace/activity`, activityData, getAuthConfig());
  return response.data;
};

export const trackWorkspaceSession = async (projectId, sessionData) => {
  const response = await axios.post(`${API_BASE}/projects/${projectId}/workspace/session`, sessionData, getAuthConfig());
  return response.data;
};

// ===== FILE COLLABORATION APIS =====

export const getFileEditors = async (projectId, fileId) => {
  const response = await axios.get(`${API_BASE}/projects/${projectId}/files/${fileId}/editors`, getAuthConfig());
  return response.data;
};

export const joinFileEditing = async (projectId, fileId, editorData) => {
  const response = await axios.post(`${API_BASE}/projects/${projectId}/files/${fileId}/editors/join`, editorData, getAuthConfig());
  return response.data;
};

export const leaveFileEditing = async (projectId, fileId) => {
  const response = await axios.post(`${API_BASE}/projects/${projectId}/files/${fileId}/editors/leave`, {}, getAuthConfig());
  return response.data;
};

export const updateCursorPosition = async (projectId, fileId, cursorData) => {
  const response = await axios.put(`${API_BASE}/projects/${projectId}/files/${fileId}/editors/cursor`, cursorData, getAuthConfig());
  return response.data;
};

export const getFileContent = async (projectId, fileId) => {
  const response = await axios.get(`${API_BASE}/projects/${projectId}/files/${fileId}/content`, getAuthConfig());
  return response.data;
};

export const saveFileContent = async (projectId, fileId, contentData) => {
  const response = await axios.put(`${API_BASE}/projects/${projectId}/files/${fileId}/content`, contentData, getAuthConfig());
  return response.data;
};

export const lockFile = async (projectId, fileId, lockData = {}) => {
  const response = await axios.post(`${API_BASE}/projects/${projectId}/files/${fileId}/lock`, lockData, getAuthConfig());
  return response.data;
};

export const unlockFile = async (projectId, fileId) => {
  const response = await axios.post(`${API_BASE}/projects/${projectId}/files/${fileId}/unlock`, {}, getAuthConfig());
  return response.data;
};

export const uploadFile = async (projectId, formData) => {
  const response = await axios.post(`${API_BASE}/projects/${projectId}/files`, formData, getMultiPartConfig());
  return response.data;
};

export const getFiles = async (projectId) => {
  const response = await axios.get(`${API_BASE}/projects/${projectId}/files`, getAuthConfig());
  return response.data;
};

export const getFileVersions = async (projectId, fileId) => {
  const response = await axios.get(`${API_BASE}/projects/${projectId}/files/${fileId}/versions`, getAuthConfig());
  return response.data;
};

export const restoreFileVersion = async (projectId, fileId, versionData) => {
  const response = await axios.post(`${API_BASE}/projects/${projectId}/files/${fileId}/restore`, versionData, getAuthConfig());
  return response.data;
};

export const downloadFile = async (projectId, fileId) => {
  const response = await axios.get(`${API_BASE}/projects/${projectId}/files/${fileId}/download`, {
    ...getAuthConfig(),
    responseType: 'blob'
  });
  return response.data;
};

// ===== ENHANCED MESSAGING APIS =====

export const getThreadedMessages = async (projectId, params = {}) => {
  const response = await axios.get(`${API_BASE}/projects/${projectId}/messages/threaded`, {
    ...getAuthConfig(),
    params
  });
  return response.data;
};

export const sendThreadedMessage = async (projectId, messageData) => {
  const response = await axios.post(`${API_BASE}/projects/${projectId}/messages/threaded`, messageData, getAuthConfig());
  return response.data;
};

export const convertMessageToTask = async (projectId, messageId, taskData) => {
  const response = await axios.post(`${API_BASE}/projects/${projectId}/messages/${messageId}/task`, taskData, getAuthConfig());
  return response.data;
};

export const getMessages = async (projectId) => {
  const response = await axios.get(`${API_BASE}/projects/${projectId}/messages`, getAuthConfig());
  return response.data;
};

export const sendMessage = async (projectId, messageData) => {
  const response = await axios.post(`${API_BASE}/projects/${projectId}/messages`, messageData, getAuthConfig());
  return response.data;
};

// ===== WORKSPACE AUDIT HISTORY APIS =====

export const getHistory = async (projectId, params = {}) => {
  const response = await axios.get(`${API_BASE}/projects/${projectId}/workspace/audit`, {
    ...getAuthConfig(),
    params
  });
  return response.data;
};

export const getContributionSummary = async (projectId, params = {}) => {
  const response = await axios.get(`${API_BASE}/projects/${projectId}/workspace/audit/summary`, {
    ...getAuthConfig(),
    params
  });
  return response.data;
};

export const exportAuditHistory = async (projectId, params = {}) => {
  const response = await axios.get(`${API_BASE}/projects/${projectId}/workspace/audit/export`, {
    ...getAuthConfig(),
    params,
    responseType: params.format === 'csv' ? 'blob' : 'json'
  });
  return response;
};

// ===== EXISTING APIS =====

export const getProject = async (projectId) => {
  const response = await axios.get(`${API_BASE}/projects/${projectId}`, getAuthConfig());
  return response.data;
};

// ✅ FIX: Added missing getMembers function
export const getMembers = async (projectId) => {
  const response = await axios.get(`${API_BASE}/projects/${projectId}/members`, getAuthConfig());
  return response.data;
};

export const getActivity = async (projectId, params = {}) => {
  const response = await axios.get(`${API_BASE}/projects/${projectId}/activity`, {
    ...getAuthConfig(),
    params
  });
  return response.data;
};

// ✅ FIX: Restored missing return statement and closing brace
export const updateTaskStatus = async (projectId, taskId, statusData) => {
  const response = await axios.patch(`${API_BASE}/projects/${projectId}/tasks/${taskId}`, statusData, getAuthConfig());
  return response.data;
};

export const getConflicts = async (projectId) => {
  const response = await axios.get(`${API_BASE}/projects/${projectId}/workspace/conflicts`, getAuthConfig());
  return response.data;
};

export const getBreaches = async (projectId) => {
  const response = await axios.get(`${API_BASE}/projects/${projectId}/workspace/breaches`, getAuthConfig());
  return response.data;
};

export const getAnnotations = async (projectId, params = {}) => {
  const response = await axios.get(`${API_BASE}/projects/${projectId}/annotations`, {
    ...getAuthConfig(),
    params
  });
  return response.data;
};

export const createAnnotation = async (projectId, annotationData) => {
  const response = await axios.post(`${API_BASE}/projects/${projectId}/annotations`, annotationData, getAuthConfig());
  return response.data;
};

export const addAnnotationReply = async (projectId, annotationId, replyData) => {
  const response = await axios.post(`${API_BASE}/projects/${projectId}/annotations/${annotationId}/replies`, replyData, getAuthConfig());
  return response.data;
};

export const resolveAnnotation = async (projectId, annotationId) => {
  const response = await axios.patch(`${API_BASE}/projects/${projectId}/annotations/${annotationId}/resolve`, {}, getAuthConfig());
  return response.data;
};

export const createBreach = async (projectId, breachData) => {
  const response = await axios.post(`${API_BASE}/projects/${projectId}/breaches`, breachData, getAuthConfig());
  return response.data;
};

export const resolveBreach = async (projectId, breachId, resolutionData) => {
  const response = await axios.patch(`${API_BASE}/projects/${projectId}/breaches/${breachId}/resolve`, resolutionData, getAuthConfig());
  return response.data;
};

// ===== MESSAGING EXTRAS =====

export const searchMessages = async (projectId, searchTerm) => {
  const response = await axios.get(`${API_BASE}/projects/${projectId}/messages/search`, {
    ...getAuthConfig(),
    params: { q: searchTerm }
  });
  return response.data;
};

export const getMessageReactions = async (projectId, messageId) => {
  const response = await axios.get(`${API_BASE}/projects/${projectId}/messages/${messageId}/reactions`, getAuthConfig());
  return response.data;
};

export const addMessageReaction = async (projectId, messageId, reactionData) => {
  const response = await axios.post(`${API_BASE}/projects/${projectId}/messages/${messageId}/reactions`, reactionData, getAuthConfig());
  return response.data;
};

export const removeMessageReaction = async (projectId, messageId, reactionType) => {
  const response = await axios.delete(`${API_BASE}/projects/${projectId}/messages/${messageId}/reactions/${reactionType}`, getAuthConfig());
  return response.data;
};

// ===== WORKSPACE EXTRAS =====

export const getWorkspaceAnalytics = async (projectId, params = {}) => {
  const response = await axios.get(`${API_BASE}/projects/${projectId}/workspace/analytics`, {
    ...getAuthConfig(),
    params
  });
  return response.data;
};

export const getWorkspaceBookmarks = async (projectId) => {
  const response = await axios.get(`${API_BASE}/projects/${projectId}/workspace/bookmarks`, getAuthConfig());
  return response.data;
};

export const createWorkspaceBookmark = async (projectId, bookmarkData) => {
  const response = await axios.post(`${API_BASE}/projects/${projectId}/workspace/bookmarks`, bookmarkData, getAuthConfig());
  return response.data;
};

export const deleteWorkspaceBookmark = async (projectId, bookmarkId) => {
  const response = await axios.delete(`${API_BASE}/projects/${projectId}/workspace/bookmarks/${bookmarkId}`, getAuthConfig());
  return response.data;
};

export const getWorkspaceTemplates = async (params = {}) => {
  const response = await axios.get(`${API_BASE}/workspace/templates`, {
    ...getAuthConfig(),
    params
  });
  return response.data;
};

export const createWorkspaceFromTemplate = async (templateId, projectData) => {
  const response = await axios.post(`${API_BASE}/workspace/templates/${templateId}/create`, projectData, getAuthConfig());
  return response.data;
};

// ===== UTILITY FUNCTIONS =====

export const handleApiError = (error) => {
  if (error.response) {
    const message = error.response.data?.message || 'Server error occurred';
    console.error('API Error:', error.response.data);
    return message;
  } else if (error.request) {
    console.error('Network Error:', error.request);
    return 'Network error. Please check your connection.';
  } else {
    console.error('Error:', error.message);
    return 'An unexpected error occurred.';
  }
};

export const formatDate = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleString();
};

export const getRelativeTime = (dateString) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  return date.toLocaleDateString();
};

export const generateCursorColor = () => {
  const colors = [
    '#FF5722', '#E91E63', '#9C27B0', '#673AB7', '#3F51B5',
    '#2196F3', '#03A9F4', '#00BCD4', '#009688', '#4CAF50',
    '#8BC34A', '#CDDC39', '#FFEB3B', '#FFC107', '#FF9800'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
};

export const validateFileType = (file, allowedTypes = []) => {
  if (allowedTypes.length === 0) {
    allowedTypes = [
      'text/plain', 'text/csv', 'application/json',
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
  }
  return allowedTypes.includes(file.type) || allowedTypes.some(type => file.type.startsWith(type));
};

export const validateFileSize = (file, maxSizeMB = 10) => {
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  return file.size <= maxSizeBytes;
};

export const createFilePreview = (file) => {
  if (file.type.startsWith('image/')) {
    return URL.createObjectURL(file);
  }
  return null;
};

// ✅ FIX: Default export now uses correct function names throughout
export default {
  // Workspace Hub
  getWorkspaceHealth,
  getMembers,           // ✅ was getWorkspaceMembers (didn't exist)
  getActivityFeed,
  logWorkspaceActivity,
  trackWorkspaceSession,

  // File Collaboration
  getFileEditors,
  joinFileEditing,
  leaveFileEditing,
  updateCursorPosition,
  getFileContent,
  saveFileContent,
  lockFile,
  unlockFile,
  uploadFile,
  getFiles,
  getFileVersions,
  restoreFileVersion,
  downloadFile,

  // Messaging
  getThreadedMessages,
  sendThreadedMessage,
  convertMessageToTask,
  getMessages,
  sendMessage,
  searchMessages,
  getMessageReactions,
  addMessageReaction,
  removeMessageReaction,

  // Audit History
  getHistory,           // ✅ was getAuditHistory (didn't exist)
  getContributionSummary,
  exportAuditHistory,

  // Legacy APIs
  getProject,
  getActivity,
  getTasks,
  updateTaskStatus,
  getConflicts,
  getBreaches,
  getAnnotations,
  createAnnotation,
  addAnnotationReply,
  resolveAnnotation,
  createBreach,
  resolveBreach,

  // Utilities
  handleApiError,
  formatDate,
  getRelativeTime,
  generateCursorColor,
  validateFileType,
  validateFileSize,
  createFilePreview,    // ✅ removed formatFileSize (didn't belong here)

  // Additional Features
  getWorkspaceAnalytics,
  getWorkspaceBookmarks,
  createWorkspaceBookmark,
  deleteWorkspaceBookmark,
  getWorkspaceTemplates,
  createWorkspaceFromTemplate,
};