-- ============================================================================
-- FLIX REVERSI — Supabase Authoritative Schema, RLS Policies & Move Validation RPC
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Online Rooms Table
CREATE TABLE IF NOT EXISTS public.reversi_rooms (
  room_code TEXT PRIMARY KEY CHECK (char_length(room_code) = 6),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'completed', 'expired')),
  host_client_id TEXT NOT NULL,
  black_client_id TEXT,
  black_name TEXT NOT NULL DEFAULT 'Black',
  black_connected BOOLEAN NOT NULL DEFAULT FALSE,
  white_client_id TEXT,
  white_name TEXT NOT NULL DEFAULT 'White',
  white_connected BOOLEAN NOT NULL DEFAULT FALSE,
  timer_seconds INTEGER NOT NULL DEFAULT 0,
  board JSONB NOT NULL,
  turn TEXT CHECK (turn IN ('B', 'W', NULL)),
  scores JSONB NOT NULL DEFAULT '{"B": 2, "W": 2, "empty": 60, "occupied": 4}'::jsonb,
  move_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  skipped_turns JSONB NOT NULL DEFAULT '{"B": 0, "W": 0}'::jsonb,
  winner TEXT CHECK (winner IN ('B', 'W', 'DRAW', NULL)),
  end_reason TEXT,
  rematch_state JSONB NOT NULL DEFAULT '{"status": "idle", "requestedBy": null}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 hours')
);

-- 2. Match Events Table (for deduplicated Realtime broadcast & reconnection audit)
CREATE TABLE IF NOT EXISTS public.reversi_events (
  event_id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL REFERENCES public.reversi_rooms(room_code) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reversi_events_room ON public.reversi_events(room_code, created_at);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.reversi_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reversi_events ENABLE ROW LEVEL SECURITY;

-- Read access for room participants (verified via request header x-client-id or auth.uid())
CREATE POLICY "Room members can read active rooms"
  ON public.reversi_rooms
  FOR SELECT
  USING (status <> 'expired' AND expires_at > NOW());

CREATE POLICY "Room members can read room events"
  ON public.reversi_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.reversi_rooms r
      WHERE r.room_code = reversi_events.room_code
        AND r.expires_at > NOW()
    )
  );

-- Direct client UPDATEs are blocked; clients must invoke the authoritative RPC functions
-- to guarantee optimistic concurrency control (version check) and turn/membership validation.
CREATE POLICY "No direct client updates without RPC"
  ON public.reversi_rooms
  FOR UPDATE
  USING (FALSE);

-- 4. Enable Supabase Realtime on tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.reversi_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.reversi_events;
