import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { notifAPI } from '../services/api';

const Topbar = ({ title, subtitle }) => {
  const { notifications, unreadCount, markNotifRead, setNotifications } = useAuth();
  const [showNotifs, setShowNotifs] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setShowNotifs(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleMarkRead = async (id) => {
    markNotifRead(id);
    try { await notifAPI.markRead(id); } catch {}
  };

  const handleMarkAll = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    try { await notifAPI.readAll(); } catch {}
  };

  return (
    <div className="topbar">
      <div>
        <h2 className="syne" style={{ fontSize: '1.05rem', fontWeight: 700 }}>{title}</h2>
        {subtitle && <p style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '0.05rem' }}>{subtitle}</p>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }} ref={ref}>
        {/* Notification Bell */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowNotifs((p) => !p)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', position: 'relative', padding: '0.3rem' }}
          >
            🔔
            {unreadCount > 0 && (
              <span style={{
                position: 'absolute', top: 0, right: 0,
                width: 10, height: 10, background: 'var(--ds)',
                borderRadius: '50%', border: '2px solid var(--paper)'
              }} />
            )}
          </button>

          {showNotifs && (
            <div style={{
              position: 'absolute', top: '110%', right: 0,
              width: 340, background: 'white',
              border: '1.5px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-lg)',
              zIndex: 200,
              overflow: 'hidden',
            }}>
              <div style={{ padding: '0.9rem 1.1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: '0.9rem' }}>Notifications</span>
                {unreadCount > 0 && (
                  <button onClick={handleMarkAll} style={{ fontSize: '0.72rem', color: 'var(--ca)', fontWeight: 600, cursor: 'pointer', background: 'none', border: 'none' }}>
                    Mark all read
                  </button>
                )}
              </div>
              <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                {notifications.length === 0 ? (
                  <div className="empty-state" style={{ padding: '2rem' }}>
                    <div className="empty-icon">🔕</div>
                    <p>No notifications yet</p>
                  </div>
                ) : (
                  notifications.slice(0, 20).map((n) => (
                    <div
                      key={n.id}
                      onClick={() => handleMarkRead(n.id)}
                      style={{
                        padding: '0.8rem 1.1rem',
                        borderBottom: '1px solid var(--border)',
                        background: n.isRead ? 'transparent' : 'rgba(26,107,255,0.03)',
                        cursor: 'pointer',
                        transition: 'background 0.1s',
                      }}
                    >
                      <div style={{ fontWeight: n.isRead ? 400 : 600, fontSize: '0.82rem' }}>{n.title}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.2rem' }}>{n.body}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Topbar;
