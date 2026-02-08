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
import { INITIAL_COLS, INITIAL_ROWS, NFL_TEAMS } from "./constants";
import { buildSquareOdds } from "./services/squareOddsService";
import {
  GameResult,
  LiveGameStatus,
  GridCell,
  LiveGameSnapshot,
  LivePlayEvent,
  RealtimeSquareOddsComputationResult,
  SquareOddsComputationResult,
} from "./types";
import { isSupabaseConfigured, supabase } from "./supabaseClient";
import {
  fetchLiveGameSnapshot,
  getLivePollIntervalMs,
} from "./services/liveGameFeedService";
import { buildRealtimeSquareOdds } from "./services/realtimeSquareOddsService";

const STORAGE_KEY = "sb-lx-squares-v1";
const BOARD_ID = import.meta.env.VITE_BOARD_ID || "default";
const SHOULD_USE_LOCAL_SQLITE =
  import.meta.env.DEV && import.meta.env.VITE_USE_LOCAL_SQLITE !== "false";
const SQLITE_API_BASE = "/api/board-state";
const DEFAULT_GAME_DATE = "2026-02-08";
const SCORE_ENTRY_HOUR = 22;
const SCORE_ENTRY_MINUTE = 0;
const LIVE_SNAPSHOT_STALE_AFTER_MS = 1000 * 90;
const ENABLE_LOCAL_LIVE_SIMULATOR =
  import.meta.env.DEV &&
  (
    (import.meta.env.VITE_ENABLE_LOCAL_LIVE_SIMULATOR as string | undefined) ??
    "true"
  )
    .trim()
    .toLowerCase() !== "false";
const LIVE_EVENT_ID_OVERRIDE =
  (import.meta.env.VITE_NFL_EVENT_ID as string | undefined)?.trim() || undefined;

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

const PRE_LOCK_UNIFORM_ODDS: number[][] = Array.from({ length: 10 }, () =>
  Array.from({ length: 10 }, () => 1),
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

type SimulatorEventTeam = "home" | "away" | "neutral";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const resolveTeamCodeByName = (teamNameOrCode: string): string => {
  const normalized = normalizeText(teamNameOrCode);
  const found =
    NFL_TEAMS.find((team) => normalizeText(team.id) === normalized) ??
    NFL_TEAMS.find((team) => normalizeText(team.name) === normalized) ??
    NFL_TEAMS.find((team) => normalized.endsWith(normalizeText(team.name))) ??
    null;

  if (found) return found.id.toUpperCase();

  const fallback = teamNameOrCode.trim().slice(0, 3).toUpperCase();
  return fallback || "UNK";
};

const parseClockToSeconds = (value: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const minutes = Number.parseInt(match[1], 10);
  const seconds = Number.parseInt(match[2], 10);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  if (minutes < 0 || seconds < 0 || seconds > 59) return null;
  return clamp(minutes * 60 + seconds, 0, 15 * 60);
};

const formatSecondsAsClock = (seconds: number): string => {
  const safe = clamp(Math.round(seconds), 0, 15 * 60);
  const minutesPart = Math.floor(safe / 60);
  const secondsPart = safe % 60;
  return `${minutesPart}:${secondsPart.toString().padStart(2, "0")}`;
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
  const [squareOdds, setSquareOdds] = useState<SquareOddsComputationResult | null>(
    null,
  );
  const [realtimeSquareOdds, setRealtimeSquareOdds] =
    useState<RealtimeSquareOddsComputationResult | null>(null);
  const [liveSnapshot, setLiveSnapshot] = useState<LiveGameSnapshot | null>(null);
  const [isLiveFeedLoading, setIsLiveFeedLoading] = useState(false);
  const [liveFeedError, setLiveFeedError] = useState<string | null>(null);
  const [isLocalLiveSimulatorEnabled, setIsLocalLiveSimulatorEnabled] =
    useState(false);
  const [isLocalLiveClockRunning, setIsLocalLiveClockRunning] = useState(false);
  const [localLiveStatus, setLocalLiveStatus] = useState<LiveGameStatus>("pregame");
  const [localLivePeriod, setLocalLivePeriod] = useState(1);
  const [localLiveClock, setLocalLiveClock] = useState("15:00");
  const [localHomeLiveScore, setLocalHomeLiveScore] = useState("0");
  const [localAwayLiveScore, setLocalAwayLiveScore] = useState("0");
  const [localLivePlays, setLocalLivePlays] = useState<LivePlayEvent[]>([]);
  const [localCustomEventText, setLocalCustomEventText] = useState("");
  const [localCustomEventTeam, setLocalCustomEventTeam] =
    useState<SimulatorEventTeam>("neutral");
  const localLiveEventCounterRef = useRef(1);
  const [isSquareOddsLoading, setIsSquareOddsLoading] = useState(false);
  const [squareOddsError, setSquareOddsError] = useState<string | null>(null);

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
  const shouldComputeSquareOdds = isLocked && !gameResult;
  const shouldShowSquareOdds = !gameResult;
  const homeTeamCode = useMemo(() => resolveTeamCodeByName(homeTeam), [homeTeam]);
  const awayTeamCode = useMemo(() => resolveTeamCodeByName(awayTeam), [awayTeam]);
  const isUsingLocalLiveSimulator =
    ENABLE_LOCAL_LIVE_SIMULATOR && isAdmin && isLocalLiveSimulatorEnabled;
  const activeSquareOdds = realtimeSquareOdds ?? squareOdds;
  const boardSquareOdds = useMemo(() => {
    if (gameResult) return null;
    if (!isLocked) return PRE_LOCK_UNIFORM_ODDS;
    return activeSquareOdds?.boardPercentages ?? null;
  }, [gameResult, isLocked, activeSquareOdds]);

  const applyPersistedState = useCallback((next: PersistedState) => {
    setPricePerSquare(next.pricePerSquare);
    setIsLocked(next.isLocked);
    setRowLabels(next.rowLabels);
    setColLabels(next.colLabels);
    setGrid(next.grid);
    setGameResult(next.gameResult);
  }, []);

  const appendLocalLivePlay = useCallback(
    (input: {
      team: SimulatorEventTeam;
      text: string;
      points?: number;
      isScoringPlay?: boolean;
      isPenalty?: boolean;
      isTurnover?: boolean;
      isExplosivePlay?: boolean;
      sentimentScore?: number;
    }) => {
      const normalizedPoints = Math.max(0, Math.round(input.points ?? 0));

      if (normalizedPoints > 0 && input.team === "home") {
        setLocalHomeLiveScore((prev) => {
          const parsed = Number.parseInt(prev, 10);
          return String((Number.isFinite(parsed) ? parsed : 0) + normalizedPoints);
        });
      }

      if (normalizedPoints > 0 && input.team === "away") {
        setLocalAwayLiveScore((prev) => {
          const parsed = Number.parseInt(prev, 10);
          return String((Number.isFinite(parsed) ? parsed : 0) + normalizedPoints);
        });
      }

      const teamCode =
        input.team === "home"
          ? homeTeamCode
          : input.team === "away"
            ? awayTeamCode
            : null;

      const sentimentScore =
        typeof input.sentimentScore === "number" && Number.isFinite(input.sentimentScore)
          ? clamp(input.sentimentScore, -1, 1)
          : 0;

      const nextEventId = `sim-${localLiveEventCounterRef.current}`;
      localLiveEventCounterRef.current += 1;

      const nextPlay: LivePlayEvent = {
        id: nextEventId,
        text: input.text.trim() || "Simulated play",
        teamCode,
        period: localLivePeriod,
        clock: localLiveClock,
        isScoringPlay: Boolean(input.isScoringPlay),
        isPenalty: Boolean(input.isPenalty),
        isTurnover: Boolean(input.isTurnover),
        isExplosivePlay: Boolean(input.isExplosivePlay),
        sentimentScore,
      };

      setLocalLivePlays((prev) => [...prev.slice(-159), nextPlay]);
    },
    [awayTeamCode, homeTeamCode, localLiveClock, localLivePeriod],
  );

  const resetLocalLiveSimulator = useCallback(() => {
    setLocalLiveStatus("pregame");
    setLocalLivePeriod(1);
    setLocalLiveClock("15:00");
    setLocalHomeLiveScore("0");
    setLocalAwayLiveScore("0");
    setLocalLivePlays([]);
    setLocalCustomEventText("");
    setLocalCustomEventTeam("neutral");
    setIsLocalLiveClockRunning(false);
    localLiveEventCounterRef.current = 1;
  }, []);

  const buildLocalLiveSnapshot = useCallback((): LiveGameSnapshot => {
    const period = clamp(Math.round(localLivePeriod), 1, 10);
    const homeScore = Math.max(0, Number.parseInt(localHomeLiveScore, 10) || 0);
    const awayScore = Math.max(0, Number.parseInt(localAwayLiveScore, 10) || 0);

    const secondsRemainingInPeriod = parseClockToSeconds(localLiveClock);
    const secondsRemainingGame =
      localLiveStatus === "final" || localLiveStatus === "postponed"
        ? 0
        : localLiveStatus === "pregame"
          ? 4 * 15 * 60
          : localLiveStatus === "halftime"
            ? 2 * 15 * 60
            : secondsRemainingInPeriod === null
              ? null
              : period <= 4
                ? (4 - period) * 15 * 60 + secondsRemainingInPeriod
                : secondsRemainingInPeriod;

    const recentPlays = localLivePlays.slice(-80);
    let homeWeighted = 0;
    let awayWeighted = 0;
    let neutralWeighted = 0;
    let homeWeight = 0;
    let awayWeight = 0;
    let neutralWeight = 0;

    for (let index = 0; index < recentPlays.length; index += 1) {
      const play = recentPlays[index];
      const recencyWeight = Math.exp(-(recentPlays.length - 1 - index) / 12);
      if (play.teamCode === homeTeamCode) {
        homeWeighted += play.sentimentScore * recencyWeight;
        homeWeight += recencyWeight;
        continue;
      }
      if (play.teamCode === awayTeamCode) {
        awayWeighted += play.sentimentScore * recencyWeight;
        awayWeight += recencyWeight;
        continue;
      }
      neutralWeighted += play.sentimentScore * recencyWeight;
      neutralWeight += recencyWeight;
    }

    const statusDetail =
      localLiveStatus === "in_progress"
        ? `Q${period} ${localLiveClock}`
        : localLiveStatus === "pregame"
          ? "Simulator Pregame"
          : localLiveStatus === "halftime"
            ? "Halftime (Simulator)"
            : localLiveStatus === "final"
              ? "Final (Simulator)"
              : "Local Simulator";

    return {
      eventId: `LOCAL-SIM-${homeTeamCode}-${awayTeamCode}`,
      fetchedAt: new Date().toISOString(),
      status: localLiveStatus,
      statusDetail,
      homeTeamCode,
      awayTeamCode,
      homeTeamName: homeTeam,
      awayTeamName: awayTeam,
      homeScore,
      awayScore,
      clock: {
        period,
        displayClock: localLiveClock,
        secondsRemainingInPeriod,
        secondsRemainingGame,
      },
      plays: recentPlays,
      sentiment: {
        home: homeWeight > 0 ? clamp(homeWeighted / homeWeight, -1, 1) : 0,
        away: awayWeight > 0 ? clamp(awayWeighted / awayWeight, -1, 1) : 0,
        neutral:
          neutralWeight > 0
            ? clamp((neutralWeighted / neutralWeight + 1) / 2, 0, 1)
            : 1,
      },
    };
  }, [
    awayTeam,
    awayTeamCode,
    homeTeam,
    homeTeamCode,
    localAwayLiveScore,
    localHomeLiveScore,
    localLiveClock,
    localLivePeriod,
    localLivePlays,
    localLiveStatus,
  ]);

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
    if (isAdmin) return;
    if (!isLocalLiveSimulatorEnabled) return;
    setIsLocalLiveSimulatorEnabled(false);
    setIsLocalLiveClockRunning(false);
  }, [isAdmin, isLocalLiveSimulatorEnabled]);

  useEffect(() => {
    if (localLiveStatus === "in_progress") return;
    setIsLocalLiveClockRunning(false);
  }, [localLiveStatus]);

  useEffect(() => {
    if (!isUsingLocalLiveSimulator) return;
    if (!isLocalLiveClockRunning) return;
    if (localLiveStatus !== "in_progress") return;

    const timer = window.setInterval(() => {
      setLocalLiveClock((prev) => {
        const seconds = parseClockToSeconds(prev);
        if (seconds === null) return prev;
        if (seconds <= 0) {
          setIsLocalLiveClockRunning(false);
          return "0:00";
        }
        return formatSecondsAsClock(seconds - 1);
      });
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [
    isLocalLiveClockRunning,
    isUsingLocalLiveSimulator,
    localLiveStatus,
  ]);

  useEffect(() => {
    if (!shouldComputeSquareOdds || !squareOdds || !isUsingLocalLiveSimulator) return;

    const snapshot = buildLocalLiveSnapshot();
    setLiveSnapshot(snapshot);
    setIsLiveFeedLoading(false);
    setLiveFeedError(null);

    if (
      snapshot.status === "in_progress" ||
      snapshot.status === "halftime" ||
      snapshot.status === "final"
    ) {
      const realtime = buildRealtimeSquareOdds({
        baseModel: squareOdds,
        snapshot,
        rowLabels,
        colLabels,
      });
      setRealtimeSquareOdds(realtime);
    } else {
      setRealtimeSquareOdds(null);
    }
  }, [
    buildLocalLiveSnapshot,
    colLabels,
    isUsingLocalLiveSimulator,
    rowLabels,
    shouldComputeSquareOdds,
    squareOdds,
  ]);

  useEffect(() => {
    let cancelled = false;

    if (!shouldComputeSquareOdds) {
      setIsSquareOddsLoading(false);
      setSquareOddsError(null);
      setSquareOdds(null);
      setRealtimeSquareOdds(null);
      setLiveSnapshot(null);
      setIsLiveFeedLoading(false);
      setLiveFeedError(null);
      return () => {
        cancelled = true;
      };
    }

    setIsSquareOddsLoading(true);
    setSquareOddsError(null);
    setRealtimeSquareOdds(null);
    setLiveSnapshot(null);
    setLiveFeedError(null);

    buildSquareOdds({
      homeTeamName: homeTeam,
      awayTeamName: awayTeam,
      rowLabels,
      colLabels,
    })
      .then((result) => {
        if (cancelled) return;
        setSquareOdds(result);
      })
      .catch((error) => {
        if (cancelled) return;
        setSquareOddsError(
          error instanceof Error
            ? error.message
            : "Could not compute square probability model.",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setIsSquareOddsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [shouldComputeSquareOdds, homeTeam, awayTeam, rowLabels, colLabels]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let failureCount = 0;

    if (!shouldComputeSquareOdds || !squareOdds) {
      setIsLiveFeedLoading(false);
      setLiveFeedError(null);
      setLiveSnapshot(null);
      setRealtimeSquareOdds(null);
      return () => {
        cancelled = true;
      };
    }

    if (isUsingLocalLiveSimulator) {
      setIsLiveFeedLoading(false);
      setLiveFeedError(null);
      return () => {
        cancelled = true;
      };
    }

    const pollLiveFeed = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      setIsLiveFeedLoading(true);

      try {
        const snapshot = await fetchLiveGameSnapshot({
          homeTeamName: homeTeam,
          awayTeamName: awayTeam,
          gameDate:
            (import.meta.env.VITE_GAME_DATE as string | undefined) ??
            DEFAULT_GAME_DATE,
          eventIdOverride: LIVE_EVENT_ID_OVERRIDE,
        });

        if (cancelled) return;

        failureCount = 0;
        setLiveFeedError(null);

        if (!snapshot) {
          setLiveSnapshot(null);
          setRealtimeSquareOdds(null);
          timer = setTimeout(pollLiveFeed, 45_000);
          return;
        }

        setLiveSnapshot(snapshot);

        if (
          snapshot.status === "in_progress" ||
          snapshot.status === "halftime" ||
          snapshot.status === "final"
        ) {
          const nextRealtime = buildRealtimeSquareOdds({
            baseModel: squareOdds,
            snapshot,
            rowLabels,
            colLabels,
          });
          setRealtimeSquareOdds(nextRealtime);
        } else {
          setRealtimeSquareOdds(null);
        }

        timer = setTimeout(pollLiveFeed, getLivePollIntervalMs(snapshot));
      } catch (error) {
        if (cancelled) return;
        failureCount += 1;
        setLiveFeedError(
          error instanceof Error
            ? error.message
            : "Could not fetch live in-game updates.",
        );
        const retryDelay = Math.min(60_000, 12_000 + failureCount * 8_000);
        timer = setTimeout(pollLiveFeed, retryDelay);
      } finally {
        inFlight = false;
        if (!cancelled) {
          setIsLiveFeedLoading(false);
        }
      }
    };

    pollLiveFeed();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [
    isUsingLocalLiveSimulator,
    shouldComputeSquareOdds,
    squareOdds,
    homeTeam,
    awayTeam,
    rowLabels,
    colLabels,
  ]);

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
  const squareOddsGeneratedText = activeSquareOdds
    ? formatTimestamp(new Date(activeSquareOdds.generatedAt))
    : null;
  const squareOddsStatusMessage = realtimeSquareOdds
    ? "Realtime model active: score, play events, penalties, clock, and commentary sentiment are updating each square."
    : squareOdds
      ? squareOdds.sourceMode === "full"
      ? "Smart model active: historical scores + market lines + team APIs."
      : "Baseline model active: live feeds unavailable, using historical/poisson fallback."
      : null;
  const liveSnapshotUpdatedText = liveSnapshot
    ? formatTimestamp(new Date(liveSnapshot.fetchedAt))
    : null;
  const liveSnapshotAgeMs = liveSnapshot
    ? Date.now() - new Date(liveSnapshot.fetchedAt).getTime()
    : null;
  const isLiveSnapshotStale =
    !isUsingLocalLiveSimulator &&
    liveSnapshotAgeMs !== null &&
    liveSnapshotAgeMs > LIVE_SNAPSHOT_STALE_AFTER_MS;

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

  const handleLocalSimulatorQuickEvent = useCallback(
    (
      team: Exclude<SimulatorEventTeam, "neutral">,
      type: "touchdown" | "field_goal" | "penalty" | "turnover" | "big_play",
    ) => {
      if (!isUsingLocalLiveSimulator) return;

      if (type === "touchdown") {
        appendLocalLivePlay({
          team,
          text: team === "home" ? `${homeTeam} touchdown` : `${awayTeam} touchdown`,
          points: 7,
          isScoringPlay: true,
          sentimentScore: 0.95,
        });
        return;
      }

      if (type === "field_goal") {
        appendLocalLivePlay({
          team,
          text: team === "home" ? `${homeTeam} field goal is good` : `${awayTeam} field goal is good`,
          points: 3,
          isScoringPlay: true,
          sentimentScore: 0.55,
        });
        return;
      }

      if (type === "penalty") {
        appendLocalLivePlay({
          team,
          text: team === "home" ? `Penalty on ${homeTeam}` : `Penalty on ${awayTeam}`,
          isPenalty: true,
          sentimentScore: -0.65,
        });
        return;
      }

      if (type === "turnover") {
        appendLocalLivePlay({
          team,
          text:
            team === "home"
              ? `${homeTeam} turnover on the play`
              : `${awayTeam} turnover on the play`,
          isTurnover: true,
          sentimentScore: -0.95,
        });
        return;
      }

      appendLocalLivePlay({
        team,
        text: team === "home" ? `${homeTeam} explosive gain` : `${awayTeam} explosive gain`,
        isExplosivePlay: true,
        sentimentScore: 0.45,
      });
    },
    [appendLocalLivePlay, awayTeam, homeTeam, isUsingLocalLiveSimulator],
  );

  const handleAddCustomLocalEvent = () => {
    if (!isUsingLocalLiveSimulator) return;
    const text = localCustomEventText.trim();
    if (!text) return;

    appendLocalLivePlay({
      team: localCustomEventTeam,
      text,
      sentimentScore: 0.1,
    });
    setLocalCustomEventText("");
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
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8">
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

              {ENABLE_LOCAL_LIVE_SIMULATOR && (
                <div className="space-y-4 bg-slate-950/60 border border-slate-700/80 rounded-lg p-4">
                  <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider">
                    Local Live Simulator
                  </h2>
                  <p className="text-xs text-slate-400">
                    Dev-only backdoor for testing realtime heatmap updates. This override
                    runs locally in your browser and bypasses live ESPN polling while active.
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={isUsingLocalLiveSimulator ? "danger" : "secondary"}
                      onClick={() => {
                        setIsLocalLiveSimulatorEnabled((prev) => !prev);
                        setIsLocalLiveClockRunning(false);
                      }}
                    >
                      {isUsingLocalLiveSimulator
                        ? "Disable Local Stream"
                        : "Enable Local Stream"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={resetLocalLiveSimulator}
                      disabled={!isUsingLocalLiveSimulator}
                    >
                      Reset Simulator
                    </Button>
                  </div>

                  {isUsingLocalLiveSimulator && (
                    <>
                      {!isLocked && (
                        <p className="text-[11px] text-amber-300">
                          Lock the board to see simulator-driven realtime odds on the grid.
                        </p>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="block text-xs text-slate-400">
                          Status
                          <select
                            value={localLiveStatus}
                            onChange={(e) =>
                              setLocalLiveStatus(e.target.value as LiveGameStatus)
                            }
                            className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-2 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                          >
                            <option value="pregame">Pregame</option>
                            <option value="in_progress">In Progress</option>
                            <option value="halftime">Halftime</option>
                            <option value="final">Final</option>
                            <option value="postponed">Postponed</option>
                          </select>
                        </label>

                        <label className="block text-xs text-slate-400">
                          Period
                          <input
                            type="number"
                            min="1"
                            max="10"
                            value={localLivePeriod}
                            onChange={(e) => {
                              const next = Number.parseInt(e.target.value, 10);
                              if (Number.isFinite(next)) {
                                setLocalLivePeriod(clamp(next, 1, 10));
                              }
                            }}
                            className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-2 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                          />
                        </label>

                        <label className="block text-xs text-slate-400">
                          Clock (mm:ss)
                          <input
                            value={localLiveClock}
                            onChange={(e) => setLocalLiveClock(e.target.value)}
                            onBlur={() => {
                              const parsedSeconds = parseClockToSeconds(localLiveClock);
                              if (parsedSeconds === null) {
                                setLocalLiveClock("15:00");
                                return;
                              }
                              setLocalLiveClock(formatSecondsAsClock(parsedSeconds));
                            }}
                            className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-2 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                            placeholder="12:34"
                          />
                        </label>

                        <div className="flex items-end">
                          <Button
                            type="button"
                            size="sm"
                            variant={isLocalLiveClockRunning ? "danger" : "secondary"}
                            className="w-full"
                            disabled={localLiveStatus !== "in_progress"}
                            onClick={() =>
                              setIsLocalLiveClockRunning((prev) => !prev)
                            }
                          >
                            {isLocalLiveClockRunning ? "Pause Clock" : "Start Clock"}
                          </Button>
                        </div>

                        <label className="block text-xs text-slate-400">
                          {homeTeam} score
                          <input
                            type="number"
                            min="0"
                            value={localHomeLiveScore}
                            onChange={(e) =>
                              setLocalHomeLiveScore(
                                String(
                                  Math.max(
                                    0,
                                    Number.parseInt(e.target.value || "0", 10) || 0,
                                  ),
                                ),
                              )
                            }
                            className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-2 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                          />
                        </label>

                        <label className="block text-xs text-slate-400">
                          {awayTeam} score
                          <input
                            type="number"
                            min="0"
                            value={localAwayLiveScore}
                            onChange={(e) =>
                              setLocalAwayLiveScore(
                                String(
                                  Math.max(
                                    0,
                                    Number.parseInt(e.target.value || "0", 10) || 0,
                                  ),
                                ),
                              )
                            }
                            className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-2 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                          />
                        </label>
                      </div>

                      <div className="space-y-2">
                        <p className="text-[11px] text-slate-500 uppercase tracking-wider">
                          Quick Event Injectors
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              handleLocalSimulatorQuickEvent("home", "touchdown")
                            }
                          >
                            {homeTeam} +7
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              handleLocalSimulatorQuickEvent("away", "touchdown")
                            }
                          >
                            {awayTeam} +7
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              handleLocalSimulatorQuickEvent("home", "field_goal")
                            }
                          >
                            {homeTeam} +3
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              handleLocalSimulatorQuickEvent("away", "field_goal")
                            }
                          >
                            {awayTeam} +3
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleLocalSimulatorQuickEvent("home", "penalty")
                            }
                          >
                            Penalty {homeTeam}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleLocalSimulatorQuickEvent("away", "penalty")
                            }
                          >
                            Penalty {awayTeam}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleLocalSimulatorQuickEvent("home", "turnover")
                            }
                          >
                            Turnover {homeTeam}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleLocalSimulatorQuickEvent("away", "turnover")
                            }
                          >
                            Turnover {awayTeam}
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <p className="text-[11px] text-slate-500 uppercase tracking-wider">
                          Custom Event
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <select
                            value={localCustomEventTeam}
                            onChange={(e) =>
                              setLocalCustomEventTeam(
                                e.target.value as SimulatorEventTeam,
                              )
                            }
                            className="bg-slate-900 border border-slate-700 rounded px-2 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                          >
                            <option value="neutral">Neutral</option>
                            <option value="home">{homeTeam}</option>
                            <option value="away">{awayTeam}</option>
                          </select>
                          <input
                            value={localCustomEventText}
                            onChange={(e) => setLocalCustomEventText(e.target.value)}
                            placeholder="Type any simulated play text"
                            className="sm:col-span-2 bg-slate-900 border border-slate-700 rounded px-2 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={handleAddCustomLocalEvent}
                            disabled={localCustomEventText.trim() === ""}
                          >
                            Add Custom Event
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setLocalLivePlays([])}
                            disabled={localLivePlays.length === 0}
                          >
                            Clear Events
                          </Button>
                        </div>
                      </div>

                      {localLivePlays[0] && (
                        <div className="rounded border border-slate-700/80 bg-slate-900/70 p-2">
                          <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">
                            Recent Sim Events
                          </p>
                          <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
                            {localLivePlays
                              .slice(-5)
                              .reverse()
                              .map((play) => (
                                <p key={play.id} className="text-[11px] text-slate-300">
                                  [{play.clock ?? "--:--"}] {play.text}
                                </p>
                              ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
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
              {shouldShowSquareOdds && (
                <div className="mt-2 space-y-1">
                  {!isLocked && (
                    <p className="text-xs text-slate-300">
                      Board is open: each square is an equal{" "}
                      <span className="font-semibold text-white">1.00%</span> chance
                      until the board is locked and numbers are revealed.
                    </p>
                  )}
                  {isLocked && (
                    <>
                      {isSquareOddsLoading && (
                        <p className="text-xs text-sky-300">
                          Computing smart square probabilities and heatmap...
                        </p>
                      )}
                      {!isSquareOddsLoading && squareOddsStatusMessage && (
                        <p className="text-xs text-slate-300">{squareOddsStatusMessage}</p>
                      )}
                      {!isSquareOddsLoading &&
                        !realtimeSquareOdds &&
                        isLiveFeedLoading && (
                          <p className="text-[11px] text-sky-300">
                            Connecting realtime in-game feed...
                          </p>
                        )}
                      {!isSquareOddsLoading &&
                        !realtimeSquareOdds &&
                        liveSnapshot?.status === "pregame" && (
                          <p className="text-[11px] text-slate-400">
                            {isUsingLocalLiveSimulator
                              ? "Local simulator is in pregame mode. Switch status to In Progress or inject events to drive dynamic heatmap shifts."
                              : "Live feed connected. Dynamic heatmap updates will intensify once kickoff begins."}
                          </p>
                        )}
                      {!isSquareOddsLoading && realtimeSquareOdds && (
                        <p className="text-[11px] text-emerald-300">
                          Live game state: {realtimeSquareOdds.liveStatusDetail} (
                          {realtimeSquareOdds.liveClock}).
                        </p>
                      )}
                      {!isSquareOddsLoading &&
                        realtimeSquareOdds &&
                        liveSnapshotUpdatedText && (
                          <p className="text-[11px] text-slate-500">
                            Last live update {liveSnapshotUpdatedText}
                            {isLiveSnapshotStale ? " (stale feed, retrying)." : "."}
                          </p>
                        )}
                      {!isSquareOddsLoading &&
                        activeSquareOdds &&
                        squareOddsGeneratedText && (
                        <p className="text-[11px] text-slate-500">
                          Generated {squareOddsGeneratedText}. Projected final points:{" "}
                          {homeTeam} {activeSquareOdds.expectedHomePoints.toFixed(1)} /{" "}
                          {awayTeam} {activeSquareOdds.expectedAwayPoints.toFixed(1)}.
                        </p>
                      )}
                      {!isSquareOddsLoading && activeSquareOdds?.warnings?.[0] && (
                        <p className="text-[11px] text-amber-300">
                          Model note: {activeSquareOdds.warnings[0]}
                        </p>
                      )}
                      {squareOddsError && (
                        <p className="text-[11px] text-red-300">
                          Could not refresh smart odds: {squareOddsError}
                        </p>
                      )}
                      {liveFeedError && (
                        <p className="text-[11px] text-red-300">
                          Could not refresh realtime game feed: {liveFeedError}
                        </p>
                      )}
                    </>
                  )}
                </div>
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
            showSquareOdds={shouldShowSquareOdds}
            isSquareOddsLoading={shouldComputeSquareOdds && isSquareOddsLoading}
            squareOddsPercentages={boardSquareOdds}
            liveHeatmapStatusLabel={
              realtimeSquareOdds
                ? `${realtimeSquareOdds.liveStatusDetail} (${realtimeSquareOdds.liveClock})`
                : liveSnapshot?.status === "pregame"
                  ? isUsingLocalLiveSimulator
                    ? "Local simulator ready. Set In Progress and inject events to test realtime heatmap."
                    : "Live feed connected. Waiting for kickoff to increase realtime influence."
                  : null
            }
            liveHeatmapUpdatedAt={liveSnapshotUpdatedText}
            isLiveHeatmapStale={isLiveSnapshotStale}
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
