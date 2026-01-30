# 🐴 Claude Corral

A web-based terminal manager for multiple [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions. Monitor, interact with, and manage all your Claude Code instances from a single browser tab.

![Claude Corral Screenshot](docs/screenshot.png)

## Features

- **Multi-session management** — Run multiple Claude Code sessions and switch between them
- **Real terminal emulation** — Full xterm.js with WebGL acceleration, colors, resize support
- **Quick actions** — One-click buttons for common responses (y/n/continue/Ctrl+C)
- **Session status** — Visual indicators for working/waiting/exited states
- **Scrollback replay** — Reconnect and see what you missed (50KB buffer)
- **Cross-platform** — Works on Windows (ConPTY) and Unix (pty)

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/claude_corral.git
cd claude_corral

# Install server dependencies
cd server
npm install

# Install and build frontend
cd ../frontend
npm install
npm run build
```

### 2. Start the server

```bash
cd server
node index.js
```

Server runs on `http://localhost:3001` by default.

### 3. Open the dashboard

Navigate to `http://localhost:3001` in your browser.

### 4. Create sessions

**Option A: From the web UI**
- Click **+ New** in the sidebar
- Enter a session name and working directory

**Option B: From PowerShell (Windows)**

Add this to your PowerShell profile (`$PROFILE`):

```powershell
function bossclaude {
    param(
        [Parameter(Position=0)]
        [string]$Name = (Split-Path -Leaf (Get-Location)),
        [string]$Server = "http://localhost:3001"
    )
    
    $body = @{ tabName = $Name; cwd = (Get-Location).Path } | ConvertTo-Json
    $response = Invoke-RestMethod -Uri "$Server/api/sessions" -Method Post -Body $body -ContentType "application/json"
    
    Write-Host "🐴 Session started: $($response.name)" -ForegroundColor Cyan
    Write-Host "   ID: $($response.id)" -ForegroundColor DarkGray
    Write-Host "   View at: $Server" -ForegroundColor DarkGray
}
```

Then from any directory:
```powershell
bossclaude              # uses folder name
bossclaude "My Task"    # custom name
```

## Architecture

```
Browser (xterm.js)
    |
    | WebSocket (/ws)
    v
Node.js Server (Express + ws)
    |
    | node-pty (ConPTY on Windows, pty on Unix)
    v
Claude Code CLI Sessions
```

The server spawns Claude Code processes in pseudo-terminals, streams their output to connected browsers, and forwards keyboard input back to the PTY.

## API Reference

### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/sessions` | List all sessions |
| `POST` | `/api/sessions` | Create session (`{tabName, cwd}`) |
| `DELETE` | `/api/sessions/:id` | Kill session |

### WebSocket Protocol (`/ws`)

**Client → Server:**
```json
{"type": "attach", "sessionId": "uuid"}     // Attach to session (replays scrollback)
{"type": "input", "data": "text"}           // Send keyboard input
{"type": "resize", "cols": 120, "rows": 30} // Resize terminal
```

**Server → Client:**
```json
{"type": "sessions", "sessions": [...]}     // Session list update
{"type": "data", "sessionId": "uuid", "data": "output"} // Terminal output
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |

### Session Manager Options

Edit `server/session-manager.js` to customize:

- `SCROLLBACK_SIZE` — Ring buffer size (default: 50KB)
- `CLEANUP_DELAY` — Time before removing exited sessions (default: 60s)
- Command to spawn (default: `claude --dangerously-skip-permissions`)

## Reverse Proxy Setup (Optional)

To expose Corral through nginx with HTTPS:

```nginx
upstream corral {
    server 127.0.0.1:3001;
}

server {
    listen 443 ssl;
    server_name corral.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://corral;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;
    }
}
```

**Important:** WebSocket support requires `proxy_http_version 1.1` and the `Upgrade`/`Connection` headers.

## Troubleshooting

### "Connection refused" from reverse proxy

1. Check Windows Firewall allows inbound on your port:
   ```powershell
   New-NetFirewallRule -DisplayName "Corral" -Direction Inbound -LocalPort 3001 -Protocol TCP -Action Allow
   ```

2. Verify server is listening on all interfaces:
   ```powershell
   netstat -an | findstr 3001
   # Should show 0.0.0.0:3001, not 127.0.0.1:3001
   ```

### Sessions not appearing in UI

- Check browser DevTools → Network → WS for WebSocket connection
- Check server console for errors
- Verify `/api/sessions` returns your sessions

### PTY spawn fails on Windows

- Ensure Claude Code CLI is in your PATH
- The server spawns via `cmd.exe /c claude` to resolve npm globals

## Development

```bash
# Frontend dev server with hot reload
cd frontend
npm run dev

# Server (in another terminal)
cd server
node index.js
```

Frontend dev server proxies API/WebSocket requests to the backend.

## License

MIT

## Credits

Built with:
- [xterm.js](https://xtermjs.org/) — Terminal emulator
- [node-pty](https://github.com/microsoft/node-pty) — PTY bindings
- [Express](https://expressjs.com/) — Web server
- [ws](https://github.com/websockets/ws) — WebSocket library
- [Vite](https://vitejs.dev/) + [React](https://react.dev/) — Frontend
