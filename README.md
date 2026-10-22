# FLIX REVERSI — Every Move Matters

A responsive, tournament-accurate Reversi (Othello) web platform featuring **Online Multiplayer**, **Play vs AI** (Easy, Medium, Hard), and **Offline Local Pass-and-Play**.

---

## 1. Architecture & Modules

- **`src/engine/GameEngine.ts`**: Framework-independent TypeScript core engine implementing the 8×8 standard Reversi board, 4-disc diagonal starting layout, Black-moves-first rule, 8-directional bracket detection, multi-disc flipping, illegal move rejection without mutation, automatic turn passing (`TURN_SKIPPED`), end-of-game detection (`board_full` and `no_legal_moves`), move history snapshots, and match statistics.
- **`src/ai/AIEngine.ts`**: Three distinct AI strategies using legal moves from `GameEngine`:
  - **Easy**: Seeded/randomized opportunistic legal move selection with shallow positional bias.
  - **Medium**: Depth-3 Minimax with Alpha-Beta pruning, positional matrix, corner preference, and mobility scoring.
  - **Hard**: Depth-5 to Depth-9 Minimax with Alpha-Beta pruning, principal move ordering, dynamic corner/X-square/C-square evaluation, mobility, frontier-disc penalties, corner-anchored edge stability estimates, and endgame exact search extension. Executes inside a non-blocking Web Worker in the browser.
- **`src/events/EventManager.ts`**: Centralized typed event bus (`EventManager`) and `NotificationManager` with stable `eventId` ring-buffer deduplication.
- **`src/audio/AudioManager.ts`**: Procedural Web Audio API sound synthesizer supporting 20+ game and UI events, master mute, SFX volume, optional ambient lounge tone (disabled by default), test sound action, and strict user-gesture unlocking.
- **`src/multiplayer/MultiplayerEngine.ts` & `server/index.ts`**: Authoritative room store, membership token verification (`playerToken`), optimistic concurrency version checks (`STALE_STATE` protection), bounded exponential backoff reconnection, rematch request/accept/decline/30s-timeout state machine, RFC 6455 WebSocket server, REST endpoints, and atomic file-backed durable persistence (`DATA_DIR/rooms.db.json`).
- **`public/index.html` (`flix-reversi.html`)**: Self-contained responsive web application with offline CSS fallback layer so Local Multiplayer and AI modes work 100% offline without internet access.

---

## 2. Commands to Build, Test, and Run Locally

```bash
# 1. Compile TypeScript modules (src/, server/, tests/) to dist/
npm run build

# 2. Run the 19 automated unit & HTTP/WebSocket server integration tests
npm run test:unit

# 3. Run the 8 headless Chromium E2E UI & integration tests
npm run test:e2e

# 4. Start the production HTTP + WebSocket server (default port 8080)
npm start
```

---

## 3. Deployment Guide

### A. Deploying to Koyeb (Docker)
1. Push this repository to GitHub/GitLab.
2. In the Koyeb Control Panel, click **Create Web Service** → **GitHub** and select your repository.
3. Choose **Dockerfile** as the builder (`Dockerfile` at repository root).
4. Set the exposed port to `8080` and configure the health check path to `/healthz`.
5. Add environment variables from `.env.example` (`NODE_ENV=production`, `PORT=8080`, `CORS_ORIGIN=https://your-app.koyeb.app`).
6. Attach a Koyeb Persistent Volume mounted at `/app/data` (or configure `SUPABASE_URL` and `SUPABASE_ANON_KEY`) so active online rooms persist across container restarts.

### B. Deploying to Render (Docker Web Service)
1. In the Render Dashboard, click **New +** → **Web Service** and connect your repository.
2. Select **Docker** as the Runtime.
3. Set `PORT=8080` and configure the **Health Check Path** to `/healthz`.
4. Under **Advanced → Disks**, add a Persistent Disk mounted at `/app/data` (`DATA_DIR=/app/data`).
5. Click **Create Web Service**. Render automatically provisions HTTPS and supports RFC 6455 WebSocket upgrades out of the box.

### C. Deploying to an Ubuntu Linux VPS (Docker Compose + Reverse Proxy)
```bash
# 1. Clone repository & configure environment
cp .env.example .env

# 2. Build and start with Docker Compose (includes durable volume & healthcheck)
docker compose up -d --build

# 3. Verify healthcheck
curl http://127.0.0.1:8080/healthz
```
For HTTPS and custom domains on Ubuntu VPS, place **Caddy** or **Nginx** in front of port `8080` with WebSocket upgrade headers (`Upgrade $http_upgrade; Connection "upgrade";`).

---

## 4. Known Limitations & Honest Backend Disclosure
- In the standalone browser/Canvas preview without an external backend URL configured, Online Multiplayer synchronizes rooms across independent browser tabs/windows on the same device via `BroadcastChannel` and `localStorage` events (and includes a Dual-Seat verifier in the lobby).
- For cross-device internet multiplayer in production, run the included Node.js WebSocket server (`server/index.ts` via Docker) with a persistent disk mounted at `/app/data` (single-instance) or configure a shared managed database (such as Supabase Realtime/PostgreSQL) when scaling horizontally across multiple container instances.
