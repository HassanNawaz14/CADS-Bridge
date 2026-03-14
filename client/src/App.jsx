import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

// Public pages
import Landing    from './pages/Landing';
import Login      from './pages/Login';
import Register   from './pages/Register';
import Onboarding from './pages/Onboarding';

// Authenticated pages
import Dashboard   from './pages/Dashboard';
import KPIPage     from './pages/KPI';
import Projects    from './pages/Projects';
import Workspace   from './pages/Workspace';
import Tasks       from './pages/Tasks';
import AuditLogs   from './pages/AuditLogs';
import AdminUsers  from './pages/AdminUsers';
import KpiSettings from './pages/KpiSettings';

import './styles/globals.css';
import './styles/sidebar.css';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* ── Public ───────────────────────────────────── */}
          <Route path="/"           element={<Landing />} />
          <Route path="/login"      element={<Login />} />
          <Route path="/register"   element={<Register />} />
          <Route path="/onboarding" element={<Onboarding />} />

          {/* ── Authenticated — all roles ─────────────────── */}
          <Route path="/dashboard"     element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/kpi"           element={<ProtectedRoute><KPIPage /></ProtectedRoute>} />
          <Route path="/projects"      element={<ProtectedRoute><Projects /></ProtectedRoute>} />
          <Route path="/projects/:id"  element={<ProtectedRoute><Workspace /></ProtectedRoute>} />
          <Route path="/tasks"         element={<ProtectedRoute><Tasks /></ProtectedRoute>} />

          {/* ── Admin only ───────────────────────────────── */}
          <Route path="/audit-logs"         element={<ProtectedRoute adminOnly><AuditLogs /></ProtectedRoute>} />
          <Route path="/admin/users"        element={<ProtectedRoute adminOnly><AdminUsers /></ProtectedRoute>} />
          <Route path="/admin/kpi-settings" element={<ProtectedRoute adminOnly><KpiSettings /></ProtectedRoute>} />

          {/* ── Catch-all ────────────────────────────────── */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
