import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Sidebar = ({ onNewProject }) => {
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
      {/* Logo */}
      <div className="sb-logo">
        <span style={{ color: 'var(--ca)' }}>CA</span>
        <span style={{ color: 'var(--paper)', opacity: 0.7 }}>DS</span>
        <span style={{ color: 'var(--ds)' }}>-Bridge</span>
      </div>

      {/* User */}
      <div className="sb-user">
        <div className={`avatar avatar-md ${isCA ? 'avatar-ca' : user?.team === 'DS' ? 'avatar-ds' : 'avatar-primary'}`}>
          {user?.initials || user?.avatarInitials || '??'}
        </div>
        <div style={{ flex: 1 }}>
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
        ＋ Start New Project
      </button>

      {/* Navigation */}
      <div className="sb-cat">1 · KPI</div>
      <ul className="sb-nav">
        <li>
          <Link to="/dashboard" className={`nav-item ${isActive('/dashboard') && location.pathname === '/dashboard' ? 'active' : ''}`}>
            <span className="nav-icon">📊</span>Overview
          </Link>
        </li>
        <li>
          <Link to="/kpi" className={`nav-item ${isActive('/kpi') ? 'active' : ''}`}>
            <span className="nav-icon">👥</span>Team Performance
          </Link>
        </li>
      </ul>

      <div className="sb-cat">2 · Audit Trails</div>
      <ul className="sb-nav">
        <li>
          <Link to="/tasks" className={`nav-item ${isActive('/tasks') ? 'active' : ''}`}>
            <span className="nav-icon">📋</span>Task Board
          </Link>
        </li>
        {isAdmin && (
          <li>
            <Link to="/audit-logs" className={`nav-item ${isActive('/audit-logs') ? 'active' : ''}`}>
              <span className="nav-icon">🗂️</span>Audit Logs
            </Link>
          </li>
        )}
      </ul>

      <div className="sb-cat">3 · Collaboration</div>
      <ul className="sb-nav">
        <li>
          <Link to="/projects" className={`nav-item ${isActive('/projects') ? 'active' : ''}`}>
            <span className="nav-icon">🚀</span>My Projects
          </Link>
        </li>
        <li>
          <Link to="/knowledge-hub" className={`nav-item ${isActive('/knowledge-hub') ? 'active' : ''}`}>
            <span className="nav-icon">📚</span>Knowledge Hub
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
                <span className="nav-icon">👤</span>Manage Users
              </Link>
            </li>
            <li>
              <Link to="/admin/kpi-settings" className={`nav-item ${isActive('/admin/kpi-settings') ? 'active' : ''}`}>
                <span className="nav-icon">⚙️</span>KPI Thresholds
              </Link>
            </li>
          </ul>
        </>
      )}

      {/* Footer */}
      <div className="sb-footer">
        <Link to="/settings" className="sb-footer-btn">⚙️ Settings</Link>
        <button className="sb-footer-btn" onClick={handleLogout} disabled={loggingOut}>
          {loggingOut ? '...' : '← Exit'}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
