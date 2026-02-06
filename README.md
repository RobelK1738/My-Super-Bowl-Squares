# Super Bowl LX Squares

A single-page React + Vite app for running a classic 10x10 Super Bowl squares board. It supports an admin-only workflow for assigning squares, shuffling the row/column numbers, and locking the board so numbers are revealed fairly at game time.

**App Overview**
- 10x10 grid (100 squares) with row and column labels.
- Admin workflow to assign squares and manage the board.
- Numbers are hidden until the board is locked.
- Pot size is computed from filled squares and the per-square cost.

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
- Admin:
  - Can assign and clear squares.
  - Can shuffle row/column numbers.
  - Can lock/unlock the board.
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

**State & Persistence**
- All state lives in memory inside React state.
- There is no backend and no persistence across page reloads.
- Admin login is client-side only and uses a hardcoded passcode.

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
3. Run the dev server:
   `npm run dev`

You can also use the helper script:
```bash
./runApp.sh
```

**Build & Preview**
- Build:
  `npm run build`
- Preview the production build:
  `npm run preview`

**Admin Passcode**
Set `VITE_ADMIN_PASSCODE` in `.env.local`. Vite only exposes variables prefixed with `VITE_`.

**Notes**
- Team names are currently hardcoded in `App.tsx` to `Seahawks` (home) and `Patriots` (away).
- Team logos are loaded from ESPN via `constants.ts`.
