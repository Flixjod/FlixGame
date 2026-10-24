# FLIX REVERSI — Every Move Matters

A responsive Reversi (Othello) platform featuring **Online Multiplayer**, **AI Opponents (Easy, Medium, Hard)**, and **Offline Local Pass-and-Play**. Engineered with an authoritative, framework-independent game engine, Web Worker AI search, synthesized Web Audio API acoustics, and real-time room synchronization.

## Architecture & Modules

- **`src/engine/GameEngine.mjs`**: Standard 8×8 Reversi rules, 8-direction bracket validation, disc capture calculation, automatic turn passing, match completion detection, and match statistics.
- **`src/ai/AIEngine.mjs`**: Three strategic AI difficulty levels:
  - **Easy**: Randomized legal move selection with light positional bias and deterministic seed support.
  - **Medium**: Depth-3 Minimax search with Alpha-Beta pruning, corner valuation, and mobility scoring.
  - **Hard**: Iterative-deepening Minimax with Alpha-Beta pruning, move ordering, dynamic corner-adjacency adjustments, frontier-disc penalties, edge stability estimation, and endgame solver extension. Runs inside a dedicated **Web Worker** in the browser so searches never block UI rendering.
- **`src/multiplayer/MultiplayerService.mjs`**: Authoritative room lifecycle (`createRoom`, `joinRoom`, `submitMove`, `reconnectMember`, `handleRematch`), optimistic concurrency control (`version`), bounded exponential backoff reconnection, and multi-transport support:
  1. **Supabase Realtime + PostgreSQL RPC** (`supabase/migrations/001_flix_reversi_schema.sql`) when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are configured.
  2. **Node.js HTTP/SSE Authoritative Backend** (`server/index.mjs`) when running the Docker container or Node server.
  3. **Cross-Tab BroadcastChannel + Shared Storage** for instant zero-config local multi-window testing in the browser.
- **`src/events/EventManager.mjs`**: Centralized typed event bus with network `eventId` deduplication so historical sounds and notifications never replay on reconnection.
- **`src/audio/AudioManager.mjs`**: Synthesized Web Audio API acoustic engine with master mute, SFX volume, optional ambient pad volume, test sound trigger, and persistent preferences.
- **`src/ui/NotificationManager.mjs` & `src/ui/SettingsManager.mjs`**: Deduplicated skipped-turn alerts (`NO LEGAL MOVES`), connection state banners, reduced-motion support, and persistent match history.

## Running, Testing & Building Locally

```bash
# 1. Run the automated test suite (19 unit & integration tests across Engine, AI, Multiplayer, Audio & UI)
npm test

# 2. Start the production HTTP + Authoritative Multiplayer server (default port 8080)
npm start

# 3. Verify healthcheck endpoint
curl http://localhost:8080/healthz
```

## Environment Variables & Backend Setup

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

- `PORT`: HTTP server port (default `8080`).
- `HOST`: Bind address (default `0.0.0.0`).
- `ROOM_STORE_PATH`: File path for durable room snapshots (default `/app/data/rooms_snapshot.json`).
- `CORS_ORIGIN`: Allowed CORS origin (default `*`).
- `RATE_LIMIT_PER_MIN`: Per-IP API rate limit (default `180`).
- `VITE_SUPABASE_URL` & `VITE_SUPABASE_ANON_KEY`: Optional Supabase project URL and public anon key (if using Supabase Realtime directly from the browser, apply `supabase/migrations/001_flix_reversi_schema.sql` in the Supabase SQL Editor). Never place `SUPABASE_SERVICE_ROLE_KEY` in client code.

## Production Deployment Guide

### 1. Deploying to Koyeb (Docker)

1. Push this repository to GitHub/GitLab.
2. In the **Koyeb Control Panel**, click **Create Web Service** → select **GitHub** and choose your repository.
3. Under **Builder**, select **Dockerfile** (`Dockerfile` at repository root).
4. Set the **Exposed Port** to `8080` and configure the **Health Check** path to `/healthz` (HTTP).
5. Add environment variables from `.env.example` (`NODE_ENV=production`, `PORT=8080`, and optional Supabase credentials).
6. Click **Deploy**. Koyeb automatically provisions HTTPS and supports persistent SSE/WebSocket connections.

### 2. Deploying to Render (Docker)

1. In the **Render Dashboard**, click **New +** → **Web Service** and connect your Git repository.
2. Select **Docker** as the Runtime.
3. Under **Advanced**, set **Health Check Path** to `/healthz`.
4. To persist active rooms across container restarts on a single instance, attach a **Render Disk** mounted at `/app/data` (or configure external Supabase Postgres/Realtime for multi-instance horizontal scaling).
5. Add environment variables from `.env.example` and click **Create Web Service**.

### 3. Deploying to an Ubuntu Linux VPS (Docker Compose + Reverse Proxy)

```bash
# 1. Install Docker & Docker Compose on Ubuntu 22.04/24.04 LTS
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2

# 2. Clone repository and configure environment
git clone <your-repo-url> flix-reversi
cd flix-reversi
cp .env.example .env

# 3. Build and start the container in detached mode with restart policy and persistent volume
sudo docker compose up -d --build

# 4. Verify container health
curl http://127.0.0.1:8080/healthz
```

For HTTPS and custom domains on a VPS, place **Caddy** or **Nginx** in front of `127.0.0.1:8080` with `proxy_buffering off;` and `Connection ''` / `Upgrade $http_upgrade` enabled so real-time SSE and WebSocket connections stream without buffering.
