const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const SessionManager = require('./session-manager');

const PORT = parseInt(process.env.PORT || '3001', 10);
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const manager = new SessionManager();

app.use(express.json());

// Serve built frontend static files
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendDist));

// --- REST API ---

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', sessions: manager.listSessions().length });
});

app.get('/api/sessions', (_req, res) => {
  res.json(manager.listSessions());
});

app.post('/api/sessions', (req, res) => {
  const { tabName, cwd } = req.body || {};
  try {
    const session = manager.createSession({ tabName, cwd });
    res.status(201).json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sessions/:id', (req, res) => {
  const ok = manager.killSession(req.params.id);
  if (ok) {
    res.json({ deleted: true });
  } else {
    res.status(404).json({ error: 'Session not found' });
  }
});

// SPA fallback — serve index.html for non-API routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

// --- WebSocket ---

wss.on('connection', (ws) => {
  let attachedSessionId = null;

  // Send current session list on connect
  ws.send(JSON.stringify({ type: 'sessions', sessions: manager.listSessions() }));

  const onData = ({ sessionId, data }) => {
    if (sessionId === attachedSessionId) {
      ws.send(JSON.stringify({ type: 'data', sessionId, data }));
    }
  };

  const onSessionsChanged = () => {
    ws.send(JSON.stringify({ type: 'sessions', sessions: manager.listSessions() }));
  };

  manager.on('data', onData);
  manager.on('sessions-changed', onSessionsChanged);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'attach': {
        attachedSessionId = msg.sessionId;
        // Send scrollback replay
        const scrollback = manager.getScrollback(msg.sessionId);
        if (scrollback) {
          ws.send(JSON.stringify({ type: 'data', sessionId: msg.sessionId, data: scrollback }));
        }
        break;
      }

      case 'input': {
        if (attachedSessionId) {
          manager.writeToSession(attachedSessionId, msg.data);
        }
        break;
      }

      case 'resize': {
        if (attachedSessionId && msg.cols && msg.rows) {
          manager.resizeSession(attachedSessionId, msg.cols, msg.rows);
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    manager.removeListener('data', onData);
    manager.removeListener('sessions-changed', onSessionsChanged);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🐴 Claude Corral server listening on http://0.0.0.0:${PORT}`);
});
