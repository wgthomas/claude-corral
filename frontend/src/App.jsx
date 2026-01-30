import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

// --- WebSocket hook ---

function useWebSocket() {
  const wsRef = useRef(null);
  const [sessions, setSessions] = useState([]);
  const [connected, setConnected] = useState(false);
  const onDataRef = useRef(null);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setTimeout(connect, 2000);
    };
    ws.onerror = () => ws.close();

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'sessions') {
        setSessions(msg.sessions);
      } else if (msg.type === 'data') {
        onDataRef.current?.(msg.sessionId, msg.data);
      }
    };
  }, []);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  const send = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const attach = useCallback((sessionId) => send({ type: 'attach', sessionId }), [send]);
  const sendInput = useCallback((data) => send({ type: 'input', data }), [send]);
  const sendResize = useCallback((cols, rows) => send({ type: 'resize', cols, rows }), [send]);

  return { sessions, connected, attach, sendInput, sendResize, onDataRef };
}

// --- Terminal view ---

function TerminalView({ sessionId, sendInput, sendResize, onDataRef, status }) {
  const termRef = useRef(null);
  const containerRef = useRef(null);
  const fitRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      theme: {
        background: '#1a1a2e',
        foreground: '#e0e0e0',
        cursor: '#f39c12',
        selectionBackground: '#44475a',
        black: '#282a36',
        red: '#ff5555',
        green: '#50fa7b',
        yellow: '#f1fa8c',
        blue: '#bd93f9',
        magenta: '#ff79c6',
        cyan: '#8be9fd',
        white: '#f8f8f2',
      },
      scrollback: 10000,
      convertEol: false,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);

    // Try WebGL, fall back silently
    try {
      term.loadAddon(new WebglAddon());
    } catch {}

    fit.fit();
    fitRef.current = fit;
    termRef.current = term;

    // Send keyboard input to server
    term.onData((data) => sendInput(data));

    // Send resize events
    term.onResize(({ cols, rows }) => sendResize(cols, rows));

    // Receive PTY output
    onDataRef.current = (sid, data) => {
      if (sid === sessionId) {
        term.write(data);
      }
    };

    // Window resize handler
    const handleResize = () => {
      fit.fit();
    };
    window.addEventListener('resize', handleResize);

    // Initial resize report
    sendResize(term.cols, term.rows);

    return () => {
      window.removeEventListener('resize', handleResize);
      onDataRef.current = null;
      term.dispose();
    };
  }, [sessionId, sendInput, sendResize, onDataRef]);

  // Re-fit when session changes
  useEffect(() => {
    if (fitRef.current) {
      setTimeout(() => fitRef.current.fit(), 50);
    }
  }, [sessionId]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
      />
      {status === 'waiting' && (
        <QuickActions sendInput={sendInput} />
      )}
    </div>
  );
}

// --- Quick action buttons overlay ---

function QuickActions({ sendInput }) {
  const actions = [
    { label: 'y', value: 'y\r' },
    { label: 'n', value: 'n\r' },
    { label: 'Continue', value: '\r' },
    { label: 'Ctrl+C', value: '\x03' },
  ];

  return (
    <div style={{
      position: 'absolute',
      bottom: 16,
      right: 16,
      display: 'flex',
      gap: 8,
      zIndex: 10,
    }}>
      {actions.map((a) => (
        <button
          key={a.label}
          onClick={() => sendInput(a.value)}
          style={{
            padding: '6px 14px',
            background: '#2d2d4e',
            color: '#e0e0e0',
            border: '1px solid #444',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 13,
            fontFamily: 'inherit',
            transition: 'background 0.15s',
          }}
          onMouseOver={(e) => (e.target.style.background = '#3d3d6e')}
          onMouseOut={(e) => (e.target.style.background = '#2d2d4e')}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

// --- Session sidebar ---

function Sidebar({ sessions, activeId, onSelect, onDelete, onNew }) {
  return (
    <div style={{
      width: 240,
      minWidth: 240,
      background: '#16162a',
      borderRight: '1px solid #2a2a4a',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
    }}>
      <div style={{
        padding: '16px 12px 12px',
        borderBottom: '1px solid #2a2a4a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>🐴 Corral</span>
        <button
          onClick={onNew}
          style={{
            padding: '4px 10px',
            background: '#2d2d4e',
            color: '#e0e0e0',
            border: '1px solid #444',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          + New
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {sessions.length === 0 && (
          <div style={{ padding: '16px 12px', color: '#666', fontSize: 13 }}>
            No sessions. Launch one with <code>bossclaude</code> or click + New.
          </div>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => onSelect(s.id)}
            style={{
              padding: '10px 12px',
              cursor: 'pointer',
              background: s.id === activeId ? '#2a2a4a' : 'transparent',
              borderLeft: s.id === activeId ? '3px solid #bd93f9' : '3px solid transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              transition: 'background 0.1s',
            }}
            onMouseOver={(e) => {
              if (s.id !== activeId) e.currentTarget.style.background = '#1e1e3a';
            }}
            onMouseOut={(e) => {
              if (s.id !== activeId) e.currentTarget.style.background = 'transparent';
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 13,
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {s.name}
              </div>
              <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                <StatusDot status={s.status} /> {s.status}
              </div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
              style={{
                background: 'none',
                border: 'none',
                color: '#666',
                cursor: 'pointer',
                fontSize: 14,
                padding: '2px 4px',
              }}
              title="Kill session"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div style={{
        padding: '8px 12px',
        borderTop: '1px solid #2a2a4a',
        fontSize: 11,
        color: '#555',
      }}>
        {sessions.length} session{sessions.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

function StatusDot({ status }) {
  const colors = {
    working: '#50fa7b',
    waiting: '#f1fa8c',
    exited: '#ff5555',
  };
  return (
    <span style={{
      display: 'inline-block',
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: colors[status] || '#888',
      marginRight: 4,
    }} />
  );
}

// --- App ---

export default function App() {
  const { sessions, connected, attach, sendInput, sendResize, onDataRef } = useWebSocket();
  const [activeSessionId, setActiveSessionId] = useState(null);

  // Auto-select first session if none active
  useEffect(() => {
    if (!activeSessionId && sessions.length > 0) {
      setActiveSessionId(sessions[0].id);
    }
    // Clear active if session was removed
    if (activeSessionId && !sessions.find((s) => s.id === activeSessionId)) {
      setActiveSessionId(sessions.length > 0 ? sessions[0].id : null);
    }
  }, [sessions, activeSessionId]);

  // Attach to session when active changes
  useEffect(() => {
    if (activeSessionId) {
      attach(activeSessionId);
    }
  }, [activeSessionId, attach]);

  const handleSelect = (id) => setActiveSessionId(id);

  const handleDelete = async (id) => {
    await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
  };

  const handleNew = async () => {
    const name = prompt('Session name (blank for default):') ?? '';
    const cwd = prompt('Working directory (blank for home):') ?? '';
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tabName: name || undefined, cwd: cwd || undefined }),
    });
    if (res.ok) {
      const session = await res.json();
      setActiveSessionId(session.id);
    }
  };

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
      <Sidebar
        sessions={sessions}
        activeId={activeSessionId}
        onSelect={handleSelect}
        onDelete={handleDelete}
        onNew={handleNew}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header bar */}
        <div style={{
          height: 36,
          minHeight: 36,
          background: '#16162a',
          borderBottom: '1px solid #2a2a4a',
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          fontSize: 13,
          gap: 12,
        }}>
          <span style={{ color: connected ? '#50fa7b' : '#ff5555' }}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
          {activeSession && (
            <>
              <span style={{ color: '#555' }}>|</span>
              <span style={{ color: '#bd93f9' }}>{activeSession.name}</span>
              <span style={{ color: '#555' }}>|</span>
              <span style={{ color: '#888' }}>{activeSession.cwd}</span>
            </>
          )}
        </div>

        {/* Terminal area */}
        <div style={{ flex: 1, minHeight: 0 }}>
          {activeSessionId ? (
            <TerminalView
              key={activeSessionId}
              sessionId={activeSessionId}
              sendInput={sendInput}
              sendResize={sendResize}
              onDataRef={onDataRef}
              status={activeSession?.status}
            />
          ) : (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#555',
              fontSize: 15,
            }}>
              No active session. Launch one with <code style={{ margin: '0 6px', color: '#bd93f9' }}>bossclaude</code> or click + New.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
