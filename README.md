# Super Bowl LX Squares

A single-page React + Vite app for running a classic 10x10 Super Bowl squares board. It supports an admin-only workflow for assigning squares, shuffling the row/column numbers, and locking the board so numbers are revealed fairly at game time.

**App Overview**
- 10x10 grid (100 squares) with row and column labels.
- Admin workflow to assign squares and manage the board.
- Numbers are hidden until the board is locked.
- Admin final-score workflow that computes and announces the winner.
- Pot size is computed from filled squares and the per-square cost.
- Realtime heatmap updates after kickoff (score, play events, penalties, clock, and commentary sentiment).
- Dev-only admin local stream simulator to test realtime heatmap without a live game.

**How The App Works**
1. The board starts with 10x10 empty squares and row/column labels from `0-9`.
2. The admin assigns players to squares by clicking any square.
3. Each assigned square is considered “taken” and contributes to the pot.
4. The admin can shuffle row/column labels to randomize numbers.
5. When the board is locked, row/column numbers are revealed to everyone.

**Roles**
- Viewer:
  - Can view the board, but cannot edit.
  - Sees row/column numbers only after the board is locked.
  - Sees winner announcement modal after the final score is submitted.
- Admin:
  - Can assign and clear squares.
  - Can shuffle row/column numbers.
  - Can lock/unlock the board.
  - Can submit final score to determine winner from score last digits.
  - Can reset the entire board.

**Key Behaviors**
- **Pot Size**: `totalPot = takenSquares * pricePerSquare`.
- **Square Status**:
  - `empty`: no player assigned.
  - `approved`: player assigned (admin assignment).
  - `pending` exists in the types, but the current UI assigns directly to `approved`.
- **Locking**:
  - When locked, row/column numbers are visible for all users.
  - When unlocked, non-admin users see placeholders instead of numbers.
- **Shuffling**:
  - Shuffles the `rowLabels` and `colLabels` arrays in place.
  - Disabled while board is locked to keep revealed numbers fixed.
- **Winner Calculation**:
  - Admin enters final score (home/away).
  - Winner is determined by the last digit of each team score:
    - Home score last digit maps to row label.
    - Away score last digit maps to column label.
  - Intersecting square owner is announced as the winner.

**State & Persistence**
- When running `npm run dev` locally, app state is persisted to SQLite (`.data/board-state.sqlite`) via a Vite dev API.
- This keeps one shared board state for your local dev server across browser reloads/tabs.
- To disable local SQLite in dev and use the old fallback, set `VITE_USE_LOCAL_SQLITE=false` in `.env.local`.
- For shared persistence across devices/users outside local dev, configure Supabase (see below).
- Admin login is client-side only and uses a hardcoded passcode.

**Shared Persistence (Supabase)**
1. Create a Supabase project.
2. Create the table:
   ```sql
   create table if not exists public.board_state (
     id text primary key,
     data jsonb not null,
     updated_at timestamp with time zone default now()
   );
   ```
3. (Recommended) Enable Realtime for `board_state` in Supabase:
   - Database → Replication → Enable `board_state`.
4. Disable RLS for the table **or** add open policies (anon access):
   ```sql
   alter table public.board_state enable row level security;

   create policy "board_state_read"
     on public.board_state for select
     using (true);

   create policy "board_state_write"
     on public.board_state for insert
     with check (true);

   create policy "board_state_update"
     on public.board_state for update
     using (true);
   ```
5. Add these to `.env.local`:
   - `VITE_SUPABASE_URL=...`
   - `VITE_SUPABASE_ANON_KEY=...`
   - `VITE_BOARD_ID=default` (optional; use a different ID for another board)

**Security Note**
- With only a client-side passcode, anyone with the URL can still write if your
  Supabase policies are open. For real auth/authorization, add Supabase Auth or
  a server-side API.

**Files To Know**
- `App.tsx`: main app state, admin actions, and layout.
- `components/GridBoard.tsx`: renders headers, labels, and the 10x10 board.
- `components/EditModal.tsx`: admin square editor.
- `components/AuthModal.tsx`: admin login dialog.
- `constants.ts`: NFL team list, logos, and default labels.
- `types.ts`: shared types for teams and grid cells.

**Run Locally**
Prerequisite: Node.js

1. Install dependencies:
   `npm install`
2. Set environment variables in `.env.local` (if required by your environment):
   - `GEMINI_API_KEY=YOUR_KEY`
   - `VITE_ADMIN_PASSCODE=YOUR_PASSCODE`
   - Optional: `VITE_GAME_DATE=2026-02-08` (defaults to this date if omitted; final-score entry opens at 10:00 PM local time)
   - Optional: `VITE_NFL_EVENT_ID=401671813` (force a specific ESPN event ID for realtime odds updates)
   - Optional: `VITE_USE_LOCAL_SQLITE=false` to disable SQLite in local dev
   - Optional: `VITE_ENABLE_LOCAL_LIVE_SIMULATOR=false` to hide/disable the dev-only local simulator panel
3. Run the dev server:
   `npm run dev`

In dev mode, admin users get a **Local Live Simulator** panel in the controls section.
Use it to override the live stream locally and inject scoring/penalty/turnover events.

You can also use the helper script:
```bash
./runApp.sh
```

**Build & Preview**
- Build:
  `npm run build`
- Preview the production build:
  `npm run preview`

**Deploy On Vercel**
1. Import the repo in Vercel (framework preset: Vite).
2. Build command: `npm run build`
3. Output directory: `dist`
4. Set environment variables in Vercel:
   - `VITE_ADMIN_PASSCODE` (required for admin mode)
   - `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (optional, for shared persistence)
   - `VITE_BOARD_ID` (optional)
   - `VITE_GAME_DATE` (optional)
   - `VITE_NFL_EVENT_ID` (optional)
5. Do not enable local SQLite on Vercel. It is dev-only.

**Admin Passcode**
Set `VITE_ADMIN_PASSCODE` in `.env.local`. Vite only exposes variables prefixed with `VITE_`.

**Notes**
- Team names are currently hardcoded in `App.tsx` to `Seahawks` (home) and `Patriots` (away).
- Team logos are loaded from ESPN via `constants.ts`.
