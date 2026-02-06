import React, { useState, useCallback, useMemo } from "react";
import {
  Trophy,
  Shuffle,
  DollarSign,
  RotateCcw,
  Lock,
  Unlock,
  LogOut,
  UserCog,
  Info,
  CalendarClock,
  ShieldCheck,
} from "lucide-react";
import { Button } from "./components/Button";
import { GridBoard } from "./components/GridBoard";
import { EditModal } from "./components/EditModal";
import { AuthModal } from "./components/AuthModal";
import { INITIAL_COLS, INITIAL_ROWS } from "./constants";
import { GridCell } from "./types";

const App: React.FC = () => {
  // Game Configuration State
  const [homeTeam] = useState("Seahawks");
  const [awayTeam] = useState("Patriots");
  const [pricePerSquare, setPricePerSquare] = useState(3);
  const [isLocked, setIsLocked] = useState(false);
  const [adminPasscode, setAdminPasscode] = useState<string | null>(null);

  // Board State
  const [rowLabels, setRowLabels] = useState<number[]>(INITIAL_ROWS);
  const [colLabels, setColLabels] = useState<number[]>(INITIAL_COLS);

  // 10x10 grid state
  const [grid, setGrid] = useState<GridCell[][]>(
    Array(10)
      .fill(null)
      .map((_, r) =>
        Array(10)
          .fill(null)
          .map((_, c) => ({
            row: r,
            col: c,
            player: null,
            status: "empty",
          })),
      ),
  );

  // UI State
  const [activeCell, setActiveCell] = useState<{
    row: number;
    col: number;
  } | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const adminPasscodeEnv = import.meta.env.VITE_ADMIN_PASSCODE;
  const isAdmin = !!adminPasscodeEnv && adminPasscode === adminPasscodeEnv;

  // Derived State
  const totalEntries = useMemo(() => {
    let count = 0;
    grid.forEach((row) =>
      row.forEach((cell) => {
        if (cell.status === "approved" || cell.status === "pending") count++;
      }),
    );
    return count;
  }, [grid]);

  const totalPot = totalEntries * pricePerSquare;

  // Actions
  const handleShuffle = useCallback(() => {
    if (!isAdmin) return;
    const shuffle = (array: number[]) => {
      const newArr = [...array];
      for (let i = newArr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
      }
      return newArr;
    };
    setRowLabels(shuffle(rowLabels));
    setColLabels(shuffle(colLabels));
  }, [rowLabels, colLabels, isAdmin]);

  const handleSquareClick = (row: number, col: number) => {
    // Only Admin can click to edit/assign squares
    if (!isAdmin) return;

    setActiveCell({ row, col });
    setIsEditModalOpen(true);
  };

  const handleSaveSquare = (name: string) => {
    if (activeCell && isAdmin) {
      const newGrid = grid.map((row) => [...row]); // Deep copy rows for safety
      const cell = newGrid[activeCell.row][activeCell.col];

      newGrid[activeCell.row][activeCell.col] = {
        ...cell,
        player: name || null,
        status: name ? "approved" : "empty", // Admins auto-approve
      };

      setGrid(newGrid);
    }
  };

  const handleDeleteSquare = () => {
    if (activeCell && isAdmin) {
      const newGrid = grid.map((row) => [...row]);
      newGrid[activeCell.row][activeCell.col] = {
        ...newGrid[activeCell.row][activeCell.col],
        player: null,
        status: "empty",
      };
      setGrid(newGrid);
    }
  };

  const handleApproveSquare = () => {
    if (activeCell && isAdmin) {
      const newGrid = grid.map((row) => [...row]);
      newGrid[activeCell.row][activeCell.col] = {
        ...newGrid[activeCell.row][activeCell.col],
        status: "approved",
      };
      setGrid(newGrid);
    }
  };

  const handleResetBoard = () => {
    if (!isAdmin) return;
    if (
      window.confirm(
        "Are you sure you want to clear the entire board? This cannot be undone.",
      )
    ) {
      // Create a completely new grid array
      const newGrid = Array(10)
        .fill(null)
        .map((_, r) =>
          Array(10)
            .fill(null)
            .map((_, c) => ({
              row: r,
              col: c,
              player: null,
              status: "empty" as const,
            })),
        );
      setGrid(newGrid);
      setRowLabels(INITIAL_ROWS);
      setColLabels(INITIAL_COLS);
      setIsLocked(false);
    }
  };

  return (
    <div className="min-h-screen pb-20 bg-slate-950">
      {/* Navbar / Header */}
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-30 shadow-2xl">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 h-24 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-gradient-to-br from-emerald-600 to-emerald-800 p-3 rounded-xl shadow-lg shadow-emerald-900/50">
              <Trophy className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white leading-none tracking-tight">
                SUPER BOWL LX SQUARES
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-sm text-slate-400">
                  Official Game Host: Robel Kebede
                </p>
                {isAdmin ? (
                  <span className="text-xs bg-emerald-900 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-700">
                    Admin Mode
                  </span>
                ) : (
                  <div
                    className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-bold uppercase tracking-wider ${isLocked ? "bg-red-900/50 border-red-800 text-red-400" : "bg-emerald-900/50 border-emerald-800 text-emerald-400"}`}
                  >
                    {isLocked ? (
                      <>
                        <Lock size={10} /> Closed
                      </>
                    ) : (
                      <>
                        <Unlock size={10} /> Open
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="hidden lg:flex flex-col items-end mr-4">
              <div className="text-xs text-slate-400 uppercase tracking-widest font-bold mb-1">
                Current Pot Size
              </div>
              <div className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-200 drop-shadow-sm">
                ${totalPot.toLocaleString()}
              </div>
            </div>

            {isAdmin ? (
              <div className="flex gap-2">
                <Button
                  variant={isLocked ? "danger" : "primary"}
                  size="sm"
                  onClick={() => setIsLocked(!isLocked)}
                  icon={isLocked ? <Lock size={16} /> : <Unlock size={16} />}
                >
                  {isLocked ? "Board Locked" : "Board Open"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAdminPasscode(null)}
                  icon={<LogOut size={16} />}
                >
                  Logout
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsAuthModalOpen(true)}
                icon={<UserCog size={16} />}
              >
                Admin Login
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
        {/* Game Info Banner */}
        <section className="bg-slate-900/50 border border-slate-800 rounded-xl p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Info size={120} />
          </div>
          <div className="relative z-10">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <ShieldCheck className="text-emerald-400" size={20} />
              Game Rules & Information
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm text-slate-300">
              <div className="flex items-start gap-3">
                <div className="bg-slate-800 p-2 rounded-lg text-emerald-400">
                  <DollarSign size={20} />
                </div>
                <div>
                  <p className="font-semibold text-white mb-1">Entry Cost</p>
                  <p>
                    ${pricePerSquare} per square. Total pot grows as players
                    join.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="bg-slate-800 p-2 rounded-lg text-blue-400">
                  <CalendarClock size={20} />
                </div>
                <div>
                  <p className="font-semibold text-white mb-1">Game Deadline</p>
                  <p>
                    Board locks at{" "}
                    <span className="text-white font-bold">5:30 PM Sunday</span>
                    . No entries after this time.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="bg-slate-800 p-2 rounded-lg text-amber-400">
                  <Lock size={20} />
                </div>
                <div>
                  <p className="font-semibold text-white mb-1">
                    Fair Play Numbers
                  </p>
                  <p>
                    Row & Column numbers (0-9) are hidden and randomized. They
                    are revealed only after the board is locked.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Mobile Pot Display */}
        <div className="lg:hidden bg-slate-900 rounded-xl p-6 border border-slate-800 text-center shadow-2xl">
          <p className="text-sm text-slate-400 uppercase tracking-widest font-bold mb-2">
            Current Pot Size
          </p>
          <p className="text-5xl font-black text-emerald-400">
            ${totalPot.toLocaleString()}
          </p>
        </div>

        {/* Controls Section (Admin Only) */}
        {isAdmin && (
          <section className="bg-slate-900 rounded-xl border border-slate-800 p-6 shadow-xl">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Money Settings */}
              <div className="space-y-4">
                <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                  <DollarSign size={16} /> Pot Configuration
                </h2>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">
                    Cost Per Square
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-slate-500">
                      $
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={pricePerSquare}
                      onChange={(e) =>
                        setPricePerSquare(parseInt(e.target.value) || 0)
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 pl-6 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-4">
                <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                  Board Actions
                </h2>
                <div className="flex gap-3">
                  <Button
                    onClick={handleShuffle}
                    variant="secondary"
                    className="flex-1"
                    icon={<Shuffle size={16} />}
                  >
                    Shuffle Numbers
                  </Button>
                  <Button
                    onClick={handleResetBoard}
                    variant="danger"
                    className="flex-1"
                    icon={<RotateCcw size={16} />}
                  >
                    Reset Board
                  </Button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* The Grid */}
        <section>
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-white mb-1">Game Board</h2>
              {!isAdmin && (
                <p className="text-slate-400 text-sm">
                  Tell the admin which number (1-100) you want to claim.
                </p>
              )}
              {isAdmin && (
                <p className="text-emerald-400 text-sm">
                  You are in admin mode. Click any square to assign it.
                </p>
              )}
            </div>
            <div className="text-right">
              <span className="text-3xl font-bold text-emerald-400">
                {totalEntries}
              </span>
              <span className="text-slate-500 text-sm font-medium uppercase tracking-wider ml-2">
                Squares Taken
              </span>
            </div>
          </div>

          <GridBoard
            rowLabels={rowLabels}
            colLabels={colLabels}
            grid={grid}
            onSquareClick={handleSquareClick}
            homeTeamName={homeTeam}
            awayTeamName={awayTeam}
            isAdmin={isAdmin}
            isLocked={isLocked}
          />
        </section>
      </main>

      {/* Modals */}
      <EditModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSave={handleSaveSquare}
        onDelete={handleDeleteSquare}
        onApprove={handleApproveSquare}
        initialName={
          activeCell ? grid[activeCell.row][activeCell.col].player : ""
        }
        currentStatus={
          activeCell ? grid[activeCell.row][activeCell.col].status : "empty"
        }
        cellCoords={activeCell}
        isAdmin={isAdmin}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onLogin={setAdminPasscode}
      />
    </div>
  );
};

export default App;
