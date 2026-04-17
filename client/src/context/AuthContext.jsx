import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { authAPI } from '../services/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser]               = useState(null);
  const [loading, setLoading]         = useState(true);
  const [notifications, setNotifications] = useState([]);
  const socketRef = useRef(null);

  // Restore session from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('user');
    const token  = localStorage.getItem('accessToken');
    if (stored && token) {
      try {
        setUser(JSON.parse(stored));
      } catch {
        localStorage.removeItem('user');
        localStorage.removeItem('accessToken');
      }
    }
    setLoading(false);
  }, []);

  // Connect Socket.IO when user logs in
  useEffect(() => {
    if (!user) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    const token = localStorage.getItem('accessToken');
    const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    const socketUrl = process.env.REACT_APP_API_URL || (isLocalhost ? 'http://localhost:5000' : window.location.origin);
    const socket = io(socketUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      console.log('Socket connected');
    });

    socket.on('notification', (notif) => {
      setNotifications((prev) => [notif, ...prev]);
    });

    socket.on('connect_error', (err) => {
      console.warn('Socket error:', err.message);
    });

    socketRef.current = socket;
    return () => { socket.disconnect(); };
  }, [user]);

  const login = useCallback((userData, token) => {
    localStorage.setItem('accessToken', token);
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
  }, []);

  const logout = useCallback(async () => {
    try { await authAPI.logout(); } catch {}
    localStorage.removeItem('accessToken');
    localStorage.removeItem('user');
    setUser(null);
    setNotifications([]);
  }, []);

  const updateUser = useCallback((updates) => {
    setUser((prev) => {
      const updated = { ...prev, ...updates };
      localStorage.setItem('user', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const markNotifRead = useCallback((id) => {
    setNotifications((prev) =>
      prev.map((n) => n.id === id ? { ...n, isRead: true } : n)
    );
  }, []);

  const getSocket = useCallback(() => socketRef.current, []);

  const value = {
    user,
    loading,
    notifications,
    setNotifications,
    unreadCount: notifications.filter((n) => !n.isRead).length,
    login,
    logout,
    updateUser,
    markNotifRead,
    getSocket,
    isCA: user?.team === 'CA',
    isDS: user?.team === 'DS',
    isAdmin: ['admin', 'platform_admin', 'super_admin'].includes(user?.role),
    accentColor: user?.team === 'DS' ? 'var(--ds)' : user?.team === 'CA' ? 'var(--ca)' : 'var(--primary)',
    accentClass: user?.team === 'DS' ? 'ds' : user?.team === 'CA' ? 'ca' : 'primary',
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div className="spinner spinner-dark" style={{ width: 32, height: 32 }} />
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
