import React, {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from "react";
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
import { WinnerModal } from "./components/WinnerModal";
import { INITIAL_COLS, INITIAL_ROWS } from "./constants";
import { GameResult, GridCell } from "./types";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

const STORAGE_KEY = "sb-lx-squares-v1";
const BOARD_ID = import.meta.env.VITE_BOARD_ID || "default";
const SHOULD_USE_LOCAL_SQLITE =
  import.meta.env.DEV && import.meta.env.VITE_USE_LOCAL_SQLITE !== "false";
const SQLITE_API_BASE = "/api/board-state";
const DEFAULT_GAME_DATE = "2026-02-08";
const SCORE_ENTRY_HOUR = 22;
const SCORE_ENTRY_MINUTE = 0;

const createEmptyGrid = (): GridCell[][] =>
  Array(10)
    .fill(null)
    .map((_, r) =>
      Array(10)
        .fill(null)
        .map((__, c) => ({
          row: r,
          col: c,
          player: null,
          status: "empty" as const,
        })),
    );

type PersistedState = {
  version: 2;
  pricePerSquare: number;
  isLocked: boolean;
  rowLabels: number[];
  colLabels: number[];
  grid: GridCell[][];
  gameResult: GameResult | null;
};

const coerceLabels = (value: unknown): number[] | null => {
  if (!Array.isArray(value) || value.length !== 10) return null;
  if (!value.every((n) => typeof n === "number" && Number.isFinite(n))) {
    return null;
  }
  return value;
};

const coerceGrid = (value: unknown): GridCell[][] | null => {
  if (!Array.isArray(value) || value.length !== 10) return null;
  const rows: GridCell[][] = [];
  for (let r = 0; r < 10; r += 1) {
    const row = value[r];
    if (!Array.isArray(row) || row.length !== 10) return null;
    const nextRow: GridCell[] = [];
    for (let c = 0; c < 10; c += 1) {
      const cell = row[c] as Partial<GridCell> | null;
      const status =
        cell?.status === "approved" ||
        cell?.status === "pending" ||
        cell?.status === "empty"
          ? cell.status
          : "empty";
      nextRow.push({
        row: r,
        col: c,
        player: typeof cell?.player === "string" ? cell.player : null,
        status,
      });
    }
    rows.push(nextRow);
  }
  return rows;
};

const coerceGameResult = (value: unknown): GameResult | null => {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<GameResult>;

  const fields = [
    data.homeScore,
    data.awayScore,
    data.homeLastDigit,
    data.awayLastDigit,
    data.winnerRow,
    data.winnerCol,
    data.winnerSquareNumber,
  ];

  if (
    !fields.every(
      (entry) => typeof entry === "number" && Number.isFinite(entry),
    )
  ) {
    return null;
  }

  if (
    !Number.isInteger(data.homeScore) ||
    !Number.isInteger(data.awayScore) ||
    data.homeScore < 0 ||
    data.awayScore < 0
  ) {
    return null;
  }

  if (
    !Number.isInteger(data.homeLastDigit) ||
    !Number.isInteger(data.awayLastDigit) ||
    data.homeLastDigit < 0 ||
    data.homeLastDigit > 9 ||
    data.awayLastDigit < 0 ||
    data.awayLastDigit > 9
  ) {
    return null;
  }

  if (
    !Number.isInteger(data.winnerRow) ||
    !Number.isInteger(data.winnerCol) ||
    data.winnerRow < 0 ||
    data.winnerRow > 9 ||
    data.winnerCol < 0 ||
    data.winnerCol > 9
  ) {
    return null;
  }

  if (
    !Number.isInteger(data.winnerSquareNumber) ||
    data.winnerSquareNumber < 1 ||
    data.winnerSquareNumber > 100
  ) {
    return null;
  }

  if (
    data.winnerStatus !== "approved" &&
    data.winnerStatus !== "pending" &&
    data.winnerStatus !== "empty"
  ) {
    return null;
  }

  if (data.winnerName !== null && typeof data.winnerName !== "string") {
    return null;
  }

  if (typeof data.submittedAt !== "string") return null;
  if (Number.isNaN(Date.parse(data.submittedAt))) return null;

  return {
    homeScore: data.homeScore,
    awayScore: data.awayScore,
    homeLastDigit: data.homeLastDigit,
    awayLastDigit: data.awayLastDigit,
    winnerRow: data.winnerRow,
    winnerCol: data.winnerCol,
    winnerSquareNumber: data.winnerSquareNumber,
    winnerName: data.winnerName,
    winnerStatus: data.winnerStatus,
    submittedAt: data.submittedAt,
  };
};

const normalizePersistedState = (payload: unknown): PersistedState | null => {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Partial<PersistedState>;
  const pricePerSquare =
    typeof data.pricePerSquare === "number" &&
    Number.isFinite(data.pricePerSquare)
      ? data.pricePerSquare
      : 3;

  return {
    version: 2,
    pricePerSquare,
    isLocked: typeof data.isLocked === "boolean" ? data.isLocked : false,
    rowLabels: coerceLabels(data.rowLabels) ?? INITIAL_ROWS,
    colLabels: coerceLabels(data.colLabels) ?? INITIAL_COLS,
    grid: coerceGrid(data.grid) ?? createEmptyGrid(),
    gameResult: coerceGameResult(data.gameResult),
  };
};

const loadPersistedState = (): PersistedState | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return normalizePersistedState(parsed);
  } catch (error) {
    console.warn("Failed to load saved board state.", error);
    return null;
  }
};

const getScoreLastDigit = (score: number): number => ((score % 10) + 10) % 10;

const parseGameDate = (value: string | undefined): Date | null => {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const parsed = new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const formatTimestamp = (date: Date): string =>
  new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);

const App: React.FC = () => {
  const [persistedState] = useState(() => loadPersistedState());
  const [isRemoteReady, setIsRemoteReady] = useState(
    SHOULD_USE_LOCAL_SQLITE ? false : !isSupabaseConfigured,
  );
  const skipNextSaveRef = useRef(false);
  const lastSavedRef = useRef<string | null>(null);
  const announcedResultRef = useRef<string | null>(null);
  const seedRef = useRef<PersistedState>(
    normalizePersistedState(persistedState) ?? {
      version: 2,
      pricePerSquare: 3,
      isLocked: false,
      rowLabels: INITIAL_ROWS,
      colLabels: INITIAL_COLS,
      grid: createEmptyGrid(),
      gameResult: null,
    },
  );

  // Game Configuration State
  const [homeTeam] = useState("Seahawks");
  const [awayTeam] = useState("Patriots");
  const [pricePerSquare, setPricePerSquare] = useState(
    () => persistedState?.pricePerSquare ?? 3,
  );
  const [isLocked, setIsLocked] = useState(
    () => persistedState?.isLocked ?? false,
  );
  const [adminPasscode, setAdminPasscode] = useState<string | null>(null);

  // Board State
  const [rowLabels, setRowLabels] = useState<number[]>(
    () => persistedState?.rowLabels ?? INITIAL_ROWS,
  );
  const [colLabels, setColLabels] = useState<number[]>(
    () => persistedState?.colLabels ?? INITIAL_COLS,
  );

  // 10x10 grid state
  const [grid, setGrid] = useState<GridCell[][]>(
    () => persistedState?.grid ?? createEmptyGrid(),
  );
  const [gameResult, setGameResult] = useState<GameResult | null>(
    () => persistedState?.gameResult ?? null,
  );

  // UI State
  const [activeCell, setActiveCell] = useState<{
    row: number;
    col: number;
  } | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isWinnerModalOpen, setIsWinnerModalOpen] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [homeFinalScore, setHomeFinalScore] = useState(
    () =>
      persistedState?.gameResult ? String(persistedState.gameResult.homeScore) : "",
  );
  const [awayFinalScore, setAwayFinalScore] = useState(
    () =>
      persistedState?.gameResult ? String(persistedState.gameResult.awayScore) : "",
  );

  const adminPasscodeEnv = import.meta.env.VITE_ADMIN_PASSCODE;
  const isAdmin = !!adminPasscodeEnv && adminPasscode === adminPasscodeEnv;
  const isLandingPath = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.location.pathname === "/";
  }, []);

  const scoreUnlockAt = useMemo(() => {
    const gameDate = parseGameDate(
      (import.meta.env.VITE_GAME_DATE as string | undefined) ??
        DEFAULT_GAME_DATE,
    );
    if (!gameDate) return null;
    return new Date(
      gameDate.getFullYear(),
      gameDate.getMonth(),
      gameDate.getDate(),
      SCORE_ENTRY_HOUR,
      SCORE_ENTRY_MINUTE,
      0,
      0,
    );
  }, []);

  const scoreUnlockText = scoreUnlockAt
    ? formatTimestamp(scoreUnlockAt)
    : "10:00 PM Sunday";
  const canFinalizeGame = isLocked;

  const applyPersistedState = useCallback((next: PersistedState) => {
    setPricePerSquare(next.pricePerSquare);
    setIsLocked(next.isLocked);
    setRowLabels(next.rowLabels);
    setColLabels(next.colLabels);
    setGrid(next.grid);
    setGameResult(next.gameResult);
  }, []);

  useEffect(() => {
    if (!gameResult) return;
    if (!isLandingPath) return;
    if (announcedResultRef.current === gameResult.submittedAt) return;
    announcedResultRef.current = gameResult.submittedAt;
    setHomeFinalScore(String(gameResult.homeScore));
    setAwayFinalScore(String(gameResult.awayScore));
    setIsWinnerModalOpen(true);
  }, [gameResult, isLandingPath]);

  useEffect(() => {
    if (!SHOULD_USE_LOCAL_SQLITE) return;
    let cancelled = false;

    const handleLocalSqlitePayload = (payload: unknown) => {
      const normalized = normalizePersistedState(payload);
      if (!normalized) return;
      const nextString = JSON.stringify(normalized);
      if (nextString === lastSavedRef.current) return;
      skipNextSaveRef.current = true;
      applyPersistedState(normalized);
    };

    const loadLocalSqliteState = async () => {
      try {
        const response = await fetch(
          `${SQLITE_API_BASE}/${encodeURIComponent(BOARD_ID)}`,
        );
        if (!response.ok) {
          throw new Error(`Local SQLite fetch failed with ${response.status}`);
        }
        const data = (await response.json()) as { data?: unknown };

        if (cancelled) return;

        if (data?.data) {
          handleLocalSqlitePayload(data.data);
        } else {
          await fetch(`${SQLITE_API_BASE}/${encodeURIComponent(BOARD_ID)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: seedRef.current }),
          });
        }
      } catch (error) {
        console.warn("Failed to load board from local SQLite.", error);
      } finally {
        if (!cancelled) setIsRemoteReady(true);
      }
    };

    loadLocalSqliteState();

    return () => {
      cancelled = true;
    };
  }, [applyPersistedState]);

  useEffect(() => {
    if (SHOULD_USE_LOCAL_SQLITE || !isSupabaseConfigured || !supabase) return;
    let cancelled = false;

    const handleRemotePayload = (payload: unknown) => {
      const normalized = normalizePersistedState(payload);
      if (!normalized) return;
      const nextString = JSON.stringify(normalized);
      if (nextString === lastSavedRef.current) return;
      skipNextSaveRef.current = true;
      applyPersistedState(normalized);
    };

    const loadRemoteState = async () => {
      const { data, error } = await supabase
        .from("board_state")
        .select("data")
        .eq("id", BOARD_ID)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.warn("Failed to load board from Supabase.", error);
        setIsRemoteReady(true);
        return;
      }

      if (data?.data) {
        handleRemotePayload(data.data);
      } else {
        await supabase.from("board_state").upsert({
          id: BOARD_ID,
          data: seedRef.current,
        });
      }

      setIsRemoteReady(true);
    };

    loadRemoteState();

    const channel = supabase
      .channel(`board-state:${BOARD_ID}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "board_state",
          filter: `id=eq.${BOARD_ID}`,
        },
        (payload) => handleRemotePayload(payload.new?.data),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "board_state",
          filter: `id=eq.${BOARD_ID}`,
        },
        (payload) => handleRemotePayload(payload.new?.data),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [applyPersistedState]);

  useEffect(() => {
    if (SHOULD_USE_LOCAL_SQLITE || isSupabaseConfigured) return;
    const payload: PersistedState = {
      version: 2,
      pricePerSquare,
      isLocked,
      rowLabels,
      colLabels,
      grid,
      gameResult,
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn("Failed to save board state.", error);
    }
  }, [pricePerSquare, isLocked, rowLabels, colLabels, grid, gameResult]);

  useEffect(() => {
    if (!SHOULD_USE_LOCAL_SQLITE || !isRemoteReady) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    const payload: PersistedState = {
      version: 2,
      pricePerSquare,
      isLocked,
      rowLabels,
      colLabels,
      grid,
      gameResult,
    };
    const payloadString = JSON.stringify(payload);
    if (payloadString === lastSavedRef.current) return;
    lastSavedRef.current = payloadString;

    fetch(`${SQLITE_API_BASE}/${encodeURIComponent(BOARD_ID)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: payload }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Local SQLite save failed with ${response.status}`);
        }
      })
      .catch((error) => {
        console.warn("Failed to save board to local SQLite.", error);
      });
  }, [
    pricePerSquare,
    isLocked,
    rowLabels,
    colLabels,
    grid,
    gameResult,
    isRemoteReady,
  ]);

  useEffect(() => {
    if (
      SHOULD_USE_LOCAL_SQLITE ||
      !isSupabaseConfigured ||
      !supabase ||
      !isRemoteReady
    ) {
      return;
    }
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    const payload: PersistedState = {
      version: 2,
      pricePerSquare,
      isLocked,
      rowLabels,
      colLabels,
      grid,
      gameResult,
    };
    const payloadString = JSON.stringify(payload);
    if (payloadString === lastSavedRef.current) return;
    lastSavedRef.current = payloadString;
    supabase
      .from("board_state")
      .upsert({ id: BOARD_ID, data: payload })
      .then(({ error }) => {
        if (error) {
          console.warn("Failed to save board to Supabase.", error);
        }
      });
  }, [
    pricePerSquare,
    isLocked,
    rowLabels,
    colLabels,
    grid,
    gameResult,
    isRemoteReady,
  ]);

  // Derived State
  const totalEntries = useMemo(() => {
    let count = 0;
    grid.forEach((row) =>
      row.forEach((cell) => {
        if (cell.status === "approved" || cell.status === "pending") count += 1;
      }),
    );
    return count;
  }, [grid]);

  const totalPot = totalEntries * pricePerSquare;
  const finalScoreDisplay = gameResult
    ? `${homeTeam} ${gameResult.homeScore} - ${awayTeam} ${gameResult.awayScore}`
    : "Not available";
  const finalScoreStatusMessage = gameResult
    ? `Final score posted. Winning square: #${gameResult.winnerSquareNumber}.`
    : "Final score not available yet.";
  const isFinalScorePristine =
    !gameResult &&
    homeFinalScore.trim() === "" &&
    awayFinalScore.trim() === "" &&
    !finalizeError;

  // Actions
  const handleShuffle = useCallback(() => {
    if (!isAdmin || isLocked) return;
    const shuffle = (array: number[]) => {
      const newArr = [...array];
      for (let i = newArr.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
      }
      return newArr;
    };
    setRowLabels(shuffle(rowLabels));
    setColLabels(shuffle(colLabels));
  }, [rowLabels, colLabels, isAdmin, isLocked]);

  const handleSquareClick = (row: number, col: number) => {
    if (!isAdmin) return;
    setActiveCell({ row, col });
    setIsEditModalOpen(true);
  };

  const handleSaveSquare = (name: string) => {
    if (activeCell && isAdmin) {
      const newGrid = grid.map((row) => [...row]);
      const cell = newGrid[activeCell.row][activeCell.col];

      newGrid[activeCell.row][activeCell.col] = {
        ...cell,
        player: name || null,
        status: name ? "approved" : "empty",
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
      setGrid(createEmptyGrid());
      setRowLabels(INITIAL_ROWS);
      setColLabels(INITIAL_COLS);
      setIsLocked(false);
      setGameResult(null);
      setHomeFinalScore("");
      setAwayFinalScore("");
      setFinalizeError(null);
    }
  };

  const handleFinalizeGame = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isAdmin) return;

    if (!isLocked) {
      setFinalizeError("Lock the board before finalizing the game.");
      return;
    }

    const homeScore = Number.parseInt(homeFinalScore, 10);
    const awayScore = Number.parseInt(awayFinalScore, 10);

    if (
      !Number.isInteger(homeScore) ||
      !Number.isInteger(awayScore) ||
      homeScore < 0 ||
      awayScore < 0
    ) {
      setFinalizeError("Enter valid non-negative whole-number scores.");
      return;
    }

    const homeLastDigit = getScoreLastDigit(homeScore);
    const awayLastDigit = getScoreLastDigit(awayScore);

    const winnerRow = rowLabels.findIndex((label) => label === homeLastDigit);
    const winnerCol = colLabels.findIndex((label) => label === awayLastDigit);

    if (winnerRow === -1 || winnerCol === -1) {
      setFinalizeError("Could not map score digits to the board labels.");
      return;
    }

    const winningCell = grid[winnerRow][winnerCol];

    const nextResult: GameResult = {
      homeScore,
      awayScore,
      homeLastDigit,
      awayLastDigit,
      winnerRow,
      winnerCol,
      winnerSquareNumber: winnerRow * 10 + winnerCol + 1,
      winnerName: winningCell.player ? winningCell.player.trim() : null,
      winnerStatus: winningCell.status,
      submittedAt: new Date().toISOString(),
    };

    setGameResult(nextResult);
    setFinalizeError(null);
    setIsWinnerModalOpen(true);
  };

  const handleResetFinalScore = () => {
    if (!isAdmin) return;
    if (
      !window.confirm(
        "Reset final score and winner announcement back to initial state?",
      )
    ) {
      return;
    }
    setGameResult(null);
    setHomeFinalScore("");
    setAwayFinalScore("");
    setFinalizeError(null);
    setIsWinnerModalOpen(false);
    announcedResultRef.current = null;
  };

  return (
    <div className="min-h-screen pb-20 bg-slate-950">
      {/* Navbar / Header */}
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-30 shadow-2xl">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-3 md:py-0 md:h-24 flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-0">
          <div className="flex items-center gap-4">
            <div className="bg-gradient-to-br from-emerald-600 to-emerald-800 p-3 rounded-xl shadow-lg shadow-emerald-900/50">
              <Trophy className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-white leading-none tracking-tight">
                SUPER BOWL LX SQUARES
              </h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <p className="text-xs sm:text-sm text-slate-400">
                  Official Game Host: Robel Kebede
                </p>
                {isAdmin ? (
                  <span className="text-xs bg-emerald-900 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-700">
                    Admin Mode
                  </span>
                ) : (
                  <div
                    className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-bold uppercase tracking-wider ${
                      isLocked
                        ? "bg-red-900/50 border-red-800 text-red-400"
                        : "bg-emerald-900/50 border-emerald-800 text-emerald-400"
                    }`}
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

          <div className="flex items-center gap-3 lg:gap-6 flex-wrap">
            <div className="hidden lg:flex flex-col items-end mr-4">
              <div className="text-xs text-slate-400 uppercase tracking-widest font-bold mb-1">
                Current Pot Size
              </div>
              <div className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-200 drop-shadow-sm">
                ${totalPot.toLocaleString()}
              </div>
            </div>

            {isAdmin ? (
              <div className="flex gap-2 flex-wrap">
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

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-10">
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
                    ${pricePerSquare} per square. Total pot grows as players join.
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
                    <span className="text-white font-bold">5:30 PM Sunday</span>.
                    No entries after this time.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="bg-slate-800 p-2 rounded-lg text-amber-400">
                  <Lock size={20} />
                </div>
                <div>
                  <p className="font-semibold text-white mb-1">Fair Play Numbers</p>
                  <p>
                    Row and column numbers (0-9) are hidden and randomized. They are
                    revealed only after the board is locked.
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
          <p className="text-4xl sm:text-5xl font-black text-emerald-400">
            ${totalPot.toLocaleString()}
          </p>
        </div>

        {/* Controls Section (Admin Only) */}
        {isAdmin && (
          <section className="bg-slate-900 rounded-xl border border-slate-800 p-6 shadow-xl">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
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
                    <span className="absolute left-3 top-2 text-slate-500">$</span>
                    <input
                      type="number"
                      min="0"
                      value={pricePerSquare}
                      onChange={(e) =>
                        setPricePerSquare(parseInt(e.target.value, 10) || 0)
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 pl-6 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-4">
                <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider">
                  Board Actions
                </h2>
                <div className="flex gap-3 flex-col sm:flex-row">
                  <Button
                    onClick={handleShuffle}
                    variant="secondary"
                    className="flex-1"
                    icon={<Shuffle size={16} />}
                    disabled={isLocked}
                    title={isLocked ? "Unlock board to shuffle" : "Shuffle row and column numbers"}
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
                {isLocked && (
                  <p className="text-xs text-slate-400">
                    Numbers are frozen while the board is locked.
                  </p>
                )}
              </div>

              {/* Final Score Controls */}
              <div className="space-y-4 bg-slate-950/60 border border-slate-700/80 rounded-lg p-4">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider">
                  Finalize Game
                </h2>
                <p className="text-xs text-slate-400">
                  Enter the final score to calculate the winning square and announce the
                  winner. For players, results are typically posted around {scoreUnlockText}.
                  Admins can submit anytime after the board is locked.
                </p>

                <form onSubmit={handleFinalizeGame} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block text-xs text-slate-400">
                      {homeTeam} score
                      <input
                        type="number"
                        min="0"
                        inputMode="numeric"
                        value={homeFinalScore}
                        onChange={(e) => {
                          setHomeFinalScore(e.target.value);
                          setFinalizeError(null);
                        }}
                        className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                        placeholder="0"
                      />
                    </label>
                    <label className="block text-xs text-slate-400">
                      {awayTeam} score
                      <input
                        type="number"
                        min="0"
                        inputMode="numeric"
                        value={awayFinalScore}
                        onChange={(e) => {
                          setAwayFinalScore(e.target.value);
                          setFinalizeError(null);
                        }}
                        className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                        placeholder="0"
                      />
                    </label>
                  </div>

                  {finalizeError && (
                    <p className="text-xs text-red-400">{finalizeError}</p>
                  )}
                  {!isLocked && (
                    <p className="text-xs text-amber-300">
                      Lock the board before entering the final score.
                    </p>
                  )}
                  <div className="flex gap-2 flex-col sm:flex-row">
                    <Button type="submit" className="flex-1" disabled={!canFinalizeGame}>
                      {gameResult ? "Update Result" : "Finalize Winner"}
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      className="flex-1"
                      onClick={handleResetFinalScore}
                      disabled={isFinalScorePristine}
                    >
                      Reset Final Score
                    </Button>
                    {gameResult && (
                      <Button
                        type="button"
                        variant="ghost"
                        className="flex-1"
                        onClick={() => setIsWinnerModalOpen(true)}
                      >
                        Preview Modal
                      </Button>
                    )}
                  </div>
                </form>
              </div>
            </div>
          </section>
        )}

        {/* Final Score View */}
        <section className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 shadow-xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider">
                Final Score
              </h2>
              <p className="mt-1 text-2xl sm:text-3xl font-black text-white">
                {finalScoreDisplay}
              </p>
              <p className="mt-1 text-sm text-slate-400">
                {finalScoreStatusMessage}
              </p>
            </div>
            {gameResult && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setIsWinnerModalOpen(true)}
              >
                View Winner
              </Button>
            )}
          </div>
        </section>

        {/* The Grid */}
        <section>
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
            <div className="text-left sm:text-right">
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
            winningCell={
              gameResult
                ? {
                    row: gameResult.winnerRow,
                    col: gameResult.winnerCol,
                  }
                : null
            }
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
        initialName={activeCell ? grid[activeCell.row][activeCell.col].player : ""}
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

      <WinnerModal
        isOpen={isWinnerModalOpen}
        onClose={() => setIsWinnerModalOpen(false)}
        result={gameResult}
        homeTeam={homeTeam}
        awayTeam={awayTeam}
      />
    </div>
  );
};

export default App;
