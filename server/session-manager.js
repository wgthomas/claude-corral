const pty = require('node-pty');
const { v4: uuidv4 } = require('uuid');
const { EventEmitter } = require('events');
const path = require('path');
const os = require('os');

const SCROLLBACK_SIZE = 50 * 1024; // 50KB ring buffer
const CLEANUP_DELAY = 60_000; // 60s after exit

class SessionManager extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map();
  }

  createSession({ tabName, cwd }) {
    const id = uuidv4();
    const resolvedCwd = cwd || os.homedir();
    const name = tabName || path.basename(resolvedCwd);

    // On Windows, spawn through cmd.exe so npm-global commands resolve
    const shell = os.platform() === 'win32' ? 'cmd.exe' : '/bin/sh';
    const args = os.platform() === 'win32'
      ? ['/c', 'claude', '--dangerously-skip-permissions']
      : ['-c', 'claude --dangerously-skip-permissions'];

    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: resolvedCwd,
      env: { ...process.env, TERM: 'xterm-256color' },
      useConpty: true,
    });

    const session = {
      id,
      name,
      cwd: resolvedCwd,
      pid: ptyProcess.pid,
      pty: ptyProcess,
      scrollback: '',
      status: 'working',
      createdAt: new Date().toISOString(),
      exitCode: null,
      cleanupTimer: null,
    };

    // Collect output into scrollback ring buffer
    ptyProcess.onData((data) => {
      session.scrollback += data;
      if (session.scrollback.length > SCROLLBACK_SIZE) {
        session.scrollback = session.scrollback.slice(-SCROLLBACK_SIZE);
      }

      // Detect status from recent output
      session.status = this._detectStatus(session.scrollback);

      this.emit('data', { sessionId: id, data });
      this.emit('sessions-changed');
    });

    ptyProcess.onExit(({ exitCode }) => {
      session.exitCode = exitCode;
      session.status = 'exited';
      this.emit('sessions-changed');

      // Auto-cleanup after delay
      session.cleanupTimer = setTimeout(() => {
        this.sessions.delete(id);
        this.emit('sessions-changed');
      }, CLEANUP_DELAY);
    });

    this.sessions.set(id, session);
    this.emit('sessions-changed');

    return { id, name, cwd: resolvedCwd, pid: ptyProcess.pid };
  }

  writeToSession(id, data) {
    const session = this.sessions.get(id);
    if (!session || session.exitCode !== null) return false;
    session.pty.write(data);
    return true;
  }

  resizeSession(id, cols, rows) {
    const session = this.sessions.get(id);
    if (!session || session.exitCode !== null) return false;
    session.pty.resize(cols, rows);
    return true;
  }

  killSession(id) {
    const session = this.sessions.get(id);
    if (!session) return false;

    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
    }

    if (session.exitCode === null) {
      session.pty.kill();
    }

    this.sessions.delete(id);
    this.emit('sessions-changed');
    return true;
  }

  getSession(id) {
    const session = this.sessions.get(id);
    if (!session) return null;
    return this._serialize(session);
  }

  getScrollback(id) {
    const session = this.sessions.get(id);
    return session ? session.scrollback : '';
  }

  listSessions() {
    return Array.from(this.sessions.values()).map((s) => this._serialize(s));
  }

  _serialize(session) {
    return {
      id: session.id,
      name: session.name,
      cwd: session.cwd,
      pid: session.pid,
      status: session.status,
      createdAt: session.createdAt,
      exitCode: session.exitCode,
    };
  }

  _detectStatus(scrollback) {
    // Look at the last ~500 chars for prompt patterns
    const tail = scrollback.slice(-500);

    // Claude waiting for user input patterns
    if (/\(y\/n\)/i.test(tail)) return 'waiting';
    if (/\[Y\/n\]/i.test(tail)) return 'waiting';
    if (/\bcontinue\?\s*$/i.test(tail)) return 'waiting';
    if (/\bproceed\?\s*$/i.test(tail)) return 'waiting';
    if (/>\s*$/.test(tail)) return 'waiting';

    return 'working';
  }
}

module.exports = SessionManager;
