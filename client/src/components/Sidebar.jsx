import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Sidebar = ({ onNewProject, isCollapsed, onToggle }) => {
  const { user, logout, isAdmin, accentColor } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);

  const isCA = user?.team === 'CA';
  const team = user?.team;

  const isActive = (path) => location.pathname.startsWith(path);

  const handleLogout = async () => {
    setLoggingOut(true);
    await logout();
    navigate('/login');
  };

  return (
    <aside className="sidebar">
      {/* Toggle Button - Now outside scroll area */}
      <button className="sb-toggle" onClick={onToggle} title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}>
        <span>◀</span>
      </button>

      {/* Logo Section - Fixed at top */}
      <div className="sb-logo">
        <div className="sb-logo-inner">
          <span className="logo-accent">CA</span>
          <span className="logo-ds">DS</span>
          <span className="logo-bridge">Bridge</span>
        </div>
      </div>

      {/* Scrollable Content Area */}
      <div className="sb-content">
        {/* User */}
        <div className="sb-user">
          <div className={`avatar avatar-md ${isCA ? 'avatar-ca' : user?.team === 'DS' ? 'avatar-ds' : 'avatar-primary'}`}>
            {user?.initials || user?.avatarInitials || '??'}
          </div>
          <div className="sb-user-info">
            <div className="sb-name">{user?.fullName}</div>
            <div className="sb-role">
              <div className="role-dot" style={{ background: accentColor }} />
              {user?.designation || (team === 'NA' ? 'Super Admin' : `${team} ${user?.role === 'admin' ? 'Admin' : 'Member'}`)}
            </div>
          </div>
          <span className={`badge badge-${isCA ? 'ca' : user?.team === 'DS' ? 'ds' : 'primary'}`}>{team === 'NA' ? 'None' : team}</span>
        </div>

        {/* New Project Button */}
        <button className="sb-new-project" onClick={onNewProject}>
          <span className="nav-icon">＋</span>
          <span>Start New Project</span>
        </button>

        {/* Navigation */}
        <div className="sb-cat">1 · KPI</div>
        <ul className="sb-nav">
          <li>
            <Link to="/dashboard" className={`nav-item ${isActive('/dashboard') && location.pathname === '/dashboard' ? 'active' : ''}`}>
              <span className="nav-icon">📊</span>
              <span>Overview</span>
            </Link>
          </li>
          <li>
            <Link to="/kpi" className={`nav-item ${isActive('/kpi') ? 'active' : ''}`}>
              <span className="nav-icon">👥</span>
              <span>Performance</span>
            </Link>
          </li>
        </ul>

        <div className="sb-cat">2 · Audit Trails</div>
        <ul className="sb-nav">
          <li>
            <Link to="/tasks" className={`nav-item ${isActive('/tasks') ? 'active' : ''}`}>
              <span className="nav-icon">📋</span>
              <span>Task Board</span>
            </Link>
          </li>
          {isAdmin && (
            <li>
              <Link to="/audit-logs" className={`nav-item ${isActive('/audit-logs') ? 'active' : ''}`}>
                <span className="nav-icon">🗂️</span>
                <span>Audit Logs</span>
              </Link>
            </li>
          )}
        </ul>

        <div className="sb-cat">3 · Collaboration</div>
        <ul className="sb-nav">
          <li>
            <Link to="/projects" className={`nav-item ${isActive('/projects') ? 'active' : ''}`}>
              <span className="nav-icon">🚀</span>
              <span>My Projects</span>
            </Link>
          </li>
          <li>
            <Link to="/knowledge-hub" className={`nav-item ${isActive('/knowledge-hub') ? 'active' : ''}`}>
              <span className="nav-icon">📚</span>
              <span>Knowledge Hub</span>
            </Link>
          </li>
        </ul>

        {/* Admin section */}
        {isAdmin && (
          <>
            <div className="sb-cat">4 · Admin</div>
            <ul className="sb-nav">
              <li>
                <Link to="/admin/users" className={`nav-item ${isActive('/admin/users') ? 'active' : ''}`}>
                  <span className="nav-icon">👤</span>
                  <span>Manage Users</span>
                </Link>
              </li>
              <li>
                <Link to="/admin/kpi-settings" className={`nav-item ${isActive('/admin/kpi-settings') ? 'active' : ''}`}>
                  <span className="nav-icon">⚙️</span>
                  <span>KPI Settings</span>
                </Link>
              </li>
            </ul>
          </>
        )}
      </div>

      {/* Footer - Fixed at bottom */}
      <div className="sb-footer">
        <Link to="/settings" className="sb-footer-btn" title="Settings">
          <span className="nav-icon">⚙️</span>
          <span>Settings</span>
        </Link>
        <button className="sb-footer-btn" onClick={handleLogout} disabled={loggingOut} title="Exit">
          <span className="nav-icon">{loggingOut ? '...' : '←'}</span>
          <span>Exit</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
