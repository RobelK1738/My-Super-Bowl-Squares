import { NFL_TEAMS } from "../constants";
import type {
  DigitProbabilityMatrix,
  SquareOddsComputationResult,
  SquareOddsComputationSource,
  SquareOddsSourceMode,
} from "../types";

type BuildSquareOddsInput = {
  homeTeamName: string;
  awayTeamName: string;
  rowLabels: number[];
  colLabels: number[];
};

type GameRecord = {
  season: number;
  gameday: string;
  awayTeam: string;
  awayScore: number;
  homeTeam: string;
  homeScore: number;
  totalLine: number | null;
  spreadLine: number | null;
};

type MoneylineRecord = {
  season: number;
  side: string;
  impliedProbability: number;
};

type TeamContext = {
  offenseDigitDist: number[];
  defenseDigitDist: number[];
  avgPointsFor: number;
  avgPointsAllowed: number;
  sampleSize: number;
};

type EspnTeamDescriptor = {
  id: string;
  abbreviation: string;
  displayName: string;
  shortDisplayName: string;
  nickname: string;
};

type EspnTeamStats = {
  pointsPerGame: number | null;
  thirdDownPct: number | null;
  redZonePct: number | null;
  turnoverDiff: number | null;
};

type SportsDbRecentForm = {
  avgScored: number;
  avgAllowed: number;
  offenseDigitDist: number[];
  defenseDigitDist: number[];
  sampleSize: number;
};

type CachedDigitModel = {
  digitProbabilities: DigitProbabilityMatrix;
  generatedAt: string;
  sourceMode: SquareOddsSourceMode;
  sourcesUsed: SquareOddsComputationSource[];
  warnings: string[];
  expectedHomePoints: number;
  expectedAwayPoints: number;
};

type CachedEntry = {
  expiresAt: number;
  value: CachedDigitModel;
};

const NFL_GAMES_CSV_URL =
  "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
const NFL_CLOSING_LINES_CSV_URL =
  "https://raw.githubusercontent.com/nflverse/nfldata/master/data/closing_lines.csv";
const ESPN_TEAMS_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams";
const ESPN_TEAM_STATS_URL = (teamId: string) =>
  `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/statistics`;
const SPORTS_DB_SEARCH_TEAMS_URL = (teamName: string) =>
  `https://www.thesportsdb.com/api/v1/json/123/searchteams.php?t=${encodeURIComponent(teamName)}`;
const SPORTS_DB_EVENTS_LAST_URL = (teamId: string) =>
  `https://www.thesportsdb.com/api/v1/json/123/eventslast.php?id=${teamId}`;

const MODEL_CACHE_PREFIX = "sb-lx-smart-odds-model-v1";
const MODEL_CACHE_TTL_MS = 1000 * 60 * 30;
const SOURCE_TIMEOUT_MS = 12_000;
const DIGIT_COUNT = 10;

let gamesPromise: Promise<GameRecord[]> | null = null;
let closingLinesPromise: Promise<MoneylineRecord[]> | null = null;
let espnTeamsPromise: Promise<Map<string, EspnTeamDescriptor>> | null = null;
const espnStatsPromiseByTeam = new Map<string, Promise<EspnTeamStats | null>>();
const sportsDbPromiseByTeam = new Map<string, Promise<SportsDbRecentForm | null>>();

const modelMemoryCache = new Map<string, CachedEntry>();

const createZeroMatrix = (): DigitProbabilityMatrix =>
  Array.from({ length: DIGIT_COUNT }, () =>
    Array.from({ length: DIGIT_COUNT }, () => 0),
  );

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const toDigit = (score: number): number => ((score % 10) + 10) % 10;

const createUniformDigitDist = (): number[] =>
  Array.from({ length: DIGIT_COUNT }, () => 1 / DIGIT_COUNT);

const createUniformDigitMatrix = (): DigitProbabilityMatrix =>
  Array.from({ length: DIGIT_COUNT }, () =>
    Array.from({ length: DIGIT_COUNT }, () => 1 / 100),
  );

const normalizeVector = (values: number[]): number[] => {
  const total = values.reduce((acc, value) => acc + Math.max(value, 0), 0);
  if (!Number.isFinite(total) || total <= 0) {
    return createUniformDigitDist();
  }

  return values.map((value) => Math.max(value, 0) / total);
};

const normalizeMatrix = (
  matrix: DigitProbabilityMatrix,
): DigitProbabilityMatrix => {
  let total = 0;
  for (let r = 0; r < DIGIT_COUNT; r += 1) {
    for (let c = 0; c < DIGIT_COUNT; c += 1) {
      total += Math.max(matrix[r][c], 0);
    }
  }

  if (!Number.isFinite(total) || total <= 0) {
    return createUniformDigitMatrix();
  }

  return matrix.map((row) => row.map((value) => Math.max(value, 0) / total));
};

const outerProduct = (a: number[], b: number[]): DigitProbabilityMatrix => {
  const output = createZeroMatrix();
  for (let r = 0; r < DIGIT_COUNT; r += 1) {
    for (let c = 0; c < DIGIT_COUNT; c += 1) {
      output[r][c] = a[r] * b[c];
    }
  }
  return normalizeMatrix(output);
};

const blendVectors = (parts: Array<{ values: number[]; weight: number }>): number[] => {
  const output = Array.from({ length: DIGIT_COUNT }, () => 0);
  let weightTotal = 0;

  for (const part of parts) {
    if (!part.values || part.values.length !== DIGIT_COUNT || part.weight <= 0) {
      continue;
    }
    for (let i = 0; i < DIGIT_COUNT; i += 1) {
      output[i] += part.values[i] * part.weight;
    }
    weightTotal += part.weight;
  }

  if (weightTotal <= 0) return createUniformDigitDist();
  return normalizeVector(output);
};

const blendMatrices = (
  parts: Array<{ matrix: DigitProbabilityMatrix; weight: number }>,
): DigitProbabilityMatrix => {
  const output = createZeroMatrix();
  let weightTotal = 0;

  for (const part of parts) {
    if (!part.matrix || part.weight <= 0) continue;
    for (let r = 0; r < DIGIT_COUNT; r += 1) {
      for (let c = 0; c < DIGIT_COUNT; c += 1) {
        output[r][c] += part.matrix[r][c] * part.weight;
      }
    }
    weightTotal += part.weight;
  }

  if (weightTotal <= 0) return createUniformDigitMatrix();
  return normalizeMatrix(output);
};

const parseNumeric = (value: string | undefined): number | null => {
  if (!value || value.trim() === "") return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const readCachedEntry = (key: string): CachedEntry | null => {
  const inMemory = modelMemoryCache.get(key);
  if (inMemory && inMemory.expiresAt > Date.now()) {
    return inMemory;
  }

  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as CachedEntry;
    if (parsed.expiresAt <= Date.now()) {
      window.localStorage.removeItem(key);
      return null;
    }
    modelMemoryCache.set(key, parsed);
    return parsed;
  } catch {
    window.localStorage.removeItem(key);
    return null;
  }
};

const writeCachedEntry = (key: string, value: CachedDigitModel): void => {
  const entry: CachedEntry = {
    expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
    value,
  };
  modelMemoryCache.set(key, entry);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Best-effort cache write.
  }
};

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const findTeamByNameOrCode = (teamNameOrCode: string) => {
  const normalized = normalizeText(teamNameOrCode);
  return (
    NFL_TEAMS.find((team) => normalizeText(team.id) === normalized) ??
    NFL_TEAMS.find((team) => normalizeText(team.name) === normalized) ??
    NFL_TEAMS.find((team) => normalized.endsWith(normalizeText(team.name))) ??
    null
  );
};

const resolveTeamCode = (teamNameOrCode: string): string => {
  const matched = findTeamByNameOrCode(teamNameOrCode);
  if (matched) return matched.id;
  throw new Error(`Unsupported team name or code: ${teamNameOrCode}`);
};

const parseCsvLine = (line: string): string[] => {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  fields.push(current);

  return fields;
};

const parseCsvWithSelectedColumns = <T extends string>(
  csv: string,
  columns: T[],
): Array<Record<T, string>> => {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]);
  const indexes = columns.map((column) => header.indexOf(column));
  if (indexes.some((index) => index < 0)) {
    throw new Error("Could not find required CSV columns.");
  }

  const records: Array<Record<T, string>> = [];
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const values = parseCsvLine(lines[lineIndex]);
    const record = {} as Record<T, string>;
    let isAnyValuePresent = false;
    for (let index = 0; index < columns.length; index += 1) {
      const value = values[indexes[index]] ?? "";
      if (value !== "") isAnyValuePresent = true;
      record[columns[index]] = value;
    }
    if (isAnyValuePresent) {
      records.push(record);
    }
  }

  return records;
};

const fetchWithTimeout = async (url: string): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(
    () => controller.abort(),
    SOURCE_TIMEOUT_MS,
  );
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json,text/plain,*/*" },
    });
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
};

const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return (await response.json()) as T;
};

const fetchText = async (url: string): Promise<string> => {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.text();
};

const loadGames = async (): Promise<GameRecord[]> => {
  if (gamesPromise) return gamesPromise;

  gamesPromise = (async () => {
    const csv = await fetchText(NFL_GAMES_CSV_URL);
    const rawRows = parseCsvWithSelectedColumns(csv, [
      "season",
      "gameday",
      "away_team",
      "away_score",
      "home_team",
      "home_score",
      "total_line",
      "spread_line",
    ]);

    return rawRows
      .map((row) => {
        const season = parseNumeric(row.season);
        const awayScore = parseNumeric(row.away_score);
        const homeScore = parseNumeric(row.home_score);
        if (
          season === null ||
          awayScore === null ||
          homeScore === null ||
          !row.away_team ||
          !row.home_team
        ) {
          return null;
        }

        return {
          season: Math.round(season),
          gameday: row.gameday,
          awayTeam: row.away_team.trim().toUpperCase(),
          awayScore: Math.round(awayScore),
          homeTeam: row.home_team.trim().toUpperCase(),
          homeScore: Math.round(homeScore),
          totalLine: parseNumeric(row.total_line),
          spreadLine: parseNumeric(row.spread_line),
        } satisfies GameRecord;
      })
      .filter((record): record is GameRecord => Boolean(record));
  })().catch((error) => {
    gamesPromise = null;
    throw error;
  });

  return gamesPromise;
};

const americanOddsToImpliedProbability = (odds: number): number => {
  if (!Number.isFinite(odds) || odds === 0) return 0.5;
  if (odds < 0) {
    return Math.abs(odds) / (Math.abs(odds) + 100);
  }
  return 100 / (odds + 100);
};

const loadClosingMoneylines = async (): Promise<MoneylineRecord[]> => {
  if (closingLinesPromise) return closingLinesPromise;

  closingLinesPromise = (async () => {
    const csv = await fetchText(NFL_CLOSING_LINES_CSV_URL);
    const rawRows = parseCsvWithSelectedColumns(csv, [
      "game_id",
      "type",
      "side",
      "odds",
    ]);

    return rawRows
      .map((row) => {
        if (row.type !== "MONEYLINE") return null;
        const odds = parseNumeric(row.odds);
        if (odds === null) return null;
        const season = Number.parseInt(row.game_id.slice(0, 4), 10);
        if (!Number.isInteger(season)) return null;

        return {
          season,
          side: row.side.trim().toUpperCase(),
          impliedProbability: clamp(
            americanOddsToImpliedProbability(odds),
            0.01,
            0.99,
          ),
        } satisfies MoneylineRecord;
      })
      .filter((record): record is MoneylineRecord => Boolean(record));
  })().catch((error) => {
    closingLinesPromise = null;
    throw error;
  });

  return closingLinesPromise;
};

const getLatestSeason = (games: GameRecord[]): number =>
  games.reduce((maxSeason, game) => Math.max(maxSeason, game.season), 0);

const buildBaselineMatrix = (
  games: GameRecord[],
  latestSeason: number,
): { matrix: DigitProbabilityMatrix; sampleSize: number } => {
  const counts = createZeroMatrix();
  for (let r = 0; r < DIGIT_COUNT; r += 1) {
    for (let c = 0; c < DIGIT_COUNT; c += 1) {
      counts[r][c] = 1;
    }
  }

  let sampleSize = 0;
  const startSeason = Math.max(1999, latestSeason - 15);

  for (const game of games) {
    if (game.season < startSeason) continue;
    if (game.homeScore < 0 || game.awayScore < 0) continue;

    const homeDigit = toDigit(game.homeScore);
    const awayDigit = toDigit(game.awayScore);
    const age = latestSeason - game.season;
    const recencyWeight = clamp(1.1 - age * 0.05, 0.35, 1.1);
    counts[homeDigit][awayDigit] += recencyWeight;
    sampleSize += 1;
  }

  return {
    matrix: normalizeMatrix(counts),
    sampleSize,
  };
};

const buildTeamContext = (
  games: GameRecord[],
  teamCode: string,
  latestSeason: number,
): TeamContext | null => {
  const cutoffSeason = latestSeason - 6;
  const teamGames = games
    .filter(
      (game) =>
        game.season >= cutoffSeason &&
        (game.homeTeam === teamCode || game.awayTeam === teamCode),
    )
    .sort((a, b) => b.gameday.localeCompare(a.gameday))
    .slice(0, 48);

  if (teamGames.length === 0) return null;

  const offenseCounts = Array.from({ length: DIGIT_COUNT }, () => 1);
  const defenseCounts = Array.from({ length: DIGIT_COUNT }, () => 1);
  let weightedPointsFor = 0;
  let weightedPointsAgainst = 0;
  let totalWeight = 0;

  teamGames.forEach((game, index) => {
    const isHome = game.homeTeam === teamCode;
    const pointsFor = isHome ? game.homeScore : game.awayScore;
    const pointsAllowed = isHome ? game.awayScore : game.homeScore;
    if (pointsFor < 0 || pointsAllowed < 0) return;

    const recencyWeight = Math.exp(-index / 18);
    offenseCounts[toDigit(pointsFor)] += recencyWeight;
    defenseCounts[toDigit(pointsAllowed)] += recencyWeight;
    weightedPointsFor += pointsFor * recencyWeight;
    weightedPointsAgainst += pointsAllowed * recencyWeight;
    totalWeight += recencyWeight;
  });

  if (totalWeight <= 0) return null;

  return {
    offenseDigitDist: normalizeVector(offenseCounts),
    defenseDigitDist: normalizeVector(defenseCounts),
    avgPointsFor: weightedPointsFor / totalWeight,
    avgPointsAllowed: weightedPointsAgainst / totalWeight,
    sampleSize: teamGames.length,
  };
};

const poissonDigitDistribution = (meanPoints: number): number[] => {
  const lambda = clamp(meanPoints, 8, 55);
  const maxScore = 85;
  const probabilities = Array.from({ length: DIGIT_COUNT }, () => 0);

  let pmf = Math.exp(-lambda);
  probabilities[0] += pmf;

  for (let score = 1; score <= maxScore; score += 1) {
    pmf *= lambda / score;
    probabilities[score % DIGIT_COUNT] += pmf;
  }

  const assigned = probabilities.reduce((sum, value) => sum + value, 0);
  const tail = Math.max(0, 1 - assigned);
  probabilities[Math.round(lambda) % DIGIT_COUNT] += tail;

  return normalizeVector(probabilities);
};

const weightedAverage = (
  parts: Array<{ value: number | null | undefined; weight: number }>,
  fallback: number,
): number => {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const part of parts) {
    if (
      part.value === null ||
      part.value === undefined ||
      !Number.isFinite(part.value) ||
      part.weight <= 0
    ) {
      continue;
    }
    weightedSum += part.value * part.weight;
    totalWeight += part.weight;
  }

  if (totalWeight <= 0) return fallback;
  return weightedSum / totalWeight;
};

const extractEspnNumericStats = (payload: unknown): Record<string, number> => {
  const output: Record<string, number> = {};
  const categories =
    (payload as { results?: { stats?: { categories?: Array<{ stats?: unknown[] }> } } })
      ?.results?.stats?.categories ?? [];

  for (const category of categories) {
    const stats = category?.stats;
    if (!Array.isArray(stats)) continue;
    for (const stat of stats) {
      const statName = (stat as { name?: string }).name;
      if (!statName) continue;
      const preferredValue = (stat as { perGameValue?: unknown }).perGameValue;
      const fallbackValue = (stat as { value?: unknown }).value;
      const numericValue =
        typeof preferredValue === "number" && Number.isFinite(preferredValue)
          ? preferredValue
          : typeof fallbackValue === "number" && Number.isFinite(fallbackValue)
            ? fallbackValue
            : null;
      if (numericValue !== null) {
        output[statName] = numericValue;
      }
    }
  }

  return output;
};

const getEspnTeams = async (): Promise<Map<string, EspnTeamDescriptor>> => {
  if (espnTeamsPromise) return espnTeamsPromise;

  espnTeamsPromise = (async () => {
    const payload = await fetchJson<{
      sports?: Array<{
        leagues?: Array<{
          teams?: Array<{
            team?: {
              id?: string;
              abbreviation?: string;
              displayName?: string;
              shortDisplayName?: string;
              nickname?: string;
            };
          }>;
        }>;
      }>;
    }>(ESPN_TEAMS_URL);

    const teamEntries = payload.sports?.[0]?.leagues?.[0]?.teams ?? [];
    const map = new Map<string, EspnTeamDescriptor>();

    for (const entry of teamEntries) {
      const team = entry.team;
      if (!team?.id || !team.abbreviation) continue;
      map.set(team.abbreviation.toUpperCase(), {
        id: team.id,
        abbreviation: team.abbreviation.toUpperCase(),
        displayName: team.displayName ?? team.shortDisplayName ?? team.nickname ?? "",
        shortDisplayName: team.shortDisplayName ?? team.displayName ?? "",
        nickname: team.nickname ?? "",
      });
    }

    if (map.size === 0) {
      throw new Error("Could not map ESPN team IDs.");
    }

    return map;
  })().catch((error) => {
    espnTeamsPromise = null;
    throw error;
  });

  return espnTeamsPromise;
};

const getEspnTeamStats = async (teamCode: string): Promise<EspnTeamStats | null> => {
  const cached = espnStatsPromiseByTeam.get(teamCode);
  if (cached) return cached;

  const promise = (async () => {
    const teams = await getEspnTeams();
    const team = teams.get(teamCode);
    if (!team) return null;

    const payload = await fetchJson<unknown>(ESPN_TEAM_STATS_URL(team.id));
    const stats = extractEspnNumericStats(payload);

    return {
      pointsPerGame:
        stats.totalPointsPerGame ??
        stats.offensivePointsPerGame ??
        stats.totalPoints ??
        null,
      thirdDownPct: stats.thirdDownConvPct ?? null,
      redZonePct:
        stats.redzoneScoringPct ?? stats.redzoneTouchdownPct ?? stats.redzoneEfficiencyPct ?? null,
      turnoverDiff: stats.turnOverDifferential ?? null,
    } satisfies EspnTeamStats;
  })().catch(() => null);

  espnStatsPromiseByTeam.set(teamCode, promise);
  return promise;
};

const matchTeamName = (candidate: string, names: string[]): boolean => {
  const normalizedCandidate = normalizeText(candidate);
  return names.some((name) => {
    const normalizedName = normalizeText(name);
    return (
      normalizedCandidate === normalizedName ||
      normalizedCandidate.endsWith(normalizedName) ||
      normalizedName.endsWith(normalizedCandidate)
    );
  });
};

const getSportsDbRecentForm = async (
  teamCode: string,
  nameCandidates: string[],
): Promise<SportsDbRecentForm | null> => {
  const cacheKey = `${teamCode}:${nameCandidates[0] ?? ""}`;
  const cached = sportsDbPromiseByTeam.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    let matchedTeamId: string | null = null;
    let matchedTeamName: string | null = null;

    for (const name of nameCandidates) {
      const searchPayload = await fetchJson<{
        teams?: Array<{ idTeam?: string; strTeam?: string; strLeague?: string }>;
      }>(SPORTS_DB_SEARCH_TEAMS_URL(name));

      const teams = searchPayload.teams ?? [];
      const nflTeam =
        teams.find(
          (team) =>
            team.idTeam &&
            team.strTeam &&
            team.strLeague?.toLowerCase() === "nfl",
        ) ??
        teams.find((team) => team.idTeam && team.strTeam);

      if (nflTeam?.idTeam && nflTeam.strTeam) {
        matchedTeamId = nflTeam.idTeam;
        matchedTeamName = nflTeam.strTeam;
        break;
      }
    }

    if (!matchedTeamId || !matchedTeamName) return null;

    const eventsPayload = await fetchJson<{
      results?: Array<{
        strHomeTeam?: string;
        strAwayTeam?: string;
        intHomeScore?: string;
        intAwayScore?: string;
      }>;
    }>(SPORTS_DB_EVENTS_LAST_URL(matchedTeamId));

    const events = eventsPayload.results ?? [];
    if (events.length === 0) return null;

    const offenseCounts = Array.from({ length: DIGIT_COUNT }, () => 1);
    const defenseCounts = Array.from({ length: DIGIT_COUNT }, () => 1);
    let totalScored = 0;
    let totalAllowed = 0;
    let sampleSize = 0;

    for (const event of events) {
      const homeScore = parseNumeric(event.intHomeScore ?? "");
      const awayScore = parseNumeric(event.intAwayScore ?? "");
      if (homeScore === null || awayScore === null) continue;

      const homeTeam = event.strHomeTeam ?? "";
      const awayTeam = event.strAwayTeam ?? "";

      const isHome = matchTeamName(homeTeam, [matchedTeamName, ...nameCandidates]);
      const isAway = matchTeamName(awayTeam, [matchedTeamName, ...nameCandidates]);
      if (!isHome && !isAway) continue;

      const teamScore = isHome ? homeScore : awayScore;
      const opponentScore = isHome ? awayScore : homeScore;

      offenseCounts[toDigit(teamScore)] += 1;
      defenseCounts[toDigit(opponentScore)] += 1;
      totalScored += teamScore;
      totalAllowed += opponentScore;
      sampleSize += 1;
    }

    if (sampleSize === 0) return null;

    return {
      avgScored: totalScored / sampleSize,
      avgAllowed: totalAllowed / sampleSize,
      offenseDigitDist: normalizeVector(offenseCounts),
      defenseDigitDist: normalizeVector(defenseCounts),
      sampleSize,
    } satisfies SportsDbRecentForm;
  })().catch(() => null);

  sportsDbPromiseByTeam.set(cacheKey, promise);
  return promise;
};

const buildTeamDigitMatrix = (
  homeContext: TeamContext | null,
  awayContext: TeamContext | null,
  homeSportsDb: SportsDbRecentForm | null,
  awaySportsDb: SportsDbRecentForm | null,
): DigitProbabilityMatrix => {
  const homeDist = blendVectors([
    {
      values: homeContext?.offenseDigitDist ?? createUniformDigitDist(),
      weight: 0.55,
    },
    {
      values: awayContext?.defenseDigitDist ?? createUniformDigitDist(),
      weight: 0.25,
    },
    {
      values: homeSportsDb?.offenseDigitDist ?? createUniformDigitDist(),
      weight: 0.12,
    },
    {
      values: awaySportsDb?.defenseDigitDist ?? createUniformDigitDist(),
      weight: 0.08,
    },
  ]);

  const awayDist = blendVectors([
    {
      values: awayContext?.offenseDigitDist ?? createUniformDigitDist(),
      weight: 0.55,
    },
    {
      values: homeContext?.defenseDigitDist ?? createUniformDigitDist(),
      weight: 0.25,
    },
    {
      values: awaySportsDb?.offenseDigitDist ?? createUniformDigitDist(),
      weight: 0.12,
    },
    {
      values: homeSportsDb?.defenseDigitDist ?? createUniformDigitDist(),
      weight: 0.08,
    },
  ]);

  return outerProduct(homeDist, awayDist);
};

const calculateLeagueAveragePoints = (
  games: GameRecord[],
  latestSeason: number,
): number => {
  const cutoff = latestSeason - 3;
  let scoreTotal = 0;
  let sample = 0;

  for (const game of games) {
    if (game.season < cutoff) continue;
    scoreTotal += game.homeScore + game.awayScore;
    sample += 2;
  }

  if (sample === 0) return 22;
  return scoreTotal / sample;
};

const calculateTeamMarketImpliedProb = (
  moneylines: MoneylineRecord[],
  teamCode: string,
  latestSeason: number,
): number | null => {
  const recentRows = moneylines.filter(
    (entry) => entry.side === teamCode && entry.season >= latestSeason - 8,
  );
  if (recentRows.length === 0) return null;

  let weightedSum = 0;
  let totalWeight = 0;
  for (const entry of recentRows) {
    const weight = clamp(1 + (entry.season - (latestSeason - 8)) * 0.12, 0.4, 2.2);
    weightedSum += entry.impliedProbability * weight;
    totalWeight += weight;
  }

  if (totalWeight <= 0) return null;
  return weightedSum / totalWeight;
};

const estimateExpectedPoints = (
  teamContext: TeamContext | null,
  opponentContext: TeamContext | null,
  teamEspn: EspnTeamStats | null,
  opponentEspn: EspnTeamStats | null,
  teamSportsDb: SportsDbRecentForm | null,
  leagueAvg: number,
): number => {
  let expected = weightedAverage(
    [
      { value: teamContext?.avgPointsFor, weight: 0.42 },
      { value: opponentContext?.avgPointsAllowed, weight: 0.28 },
      { value: teamEspn?.pointsPerGame, weight: 0.15 },
      { value: teamSportsDb?.avgScored, weight: 0.10 },
      { value: leagueAvg, weight: 0.05 },
    ],
    leagueAvg,
  );

  const thirdDownEdge =
    ((teamEspn?.thirdDownPct ?? 0) - (opponentEspn?.thirdDownPct ?? 0)) / 100;
  expected += thirdDownEdge * 2.2;

  const redZoneEdge =
    ((teamEspn?.redZonePct ?? 0) - (opponentEspn?.redZonePct ?? 0)) / 100;
  expected += redZoneEdge * 1.6;

  const turnoverEdge = (teamEspn?.turnoverDiff ?? 0) - (opponentEspn?.turnoverDiff ?? 0);
  expected += turnoverEdge * 0.12;

  if (teamSportsDb && teamContext) {
    expected += (teamSportsDb.avgScored - teamContext.avgPointsFor) * 0.12;
  }

  return clamp(expected, 10, 45);
};

const buildSimulationMatrix = (
  homeExpectedPoints: number,
  awayExpectedPoints: number,
): DigitProbabilityMatrix => {
  const homeDist = poissonDigitDistribution(homeExpectedPoints);
  const awayDist = poissonDigitDistribution(awayExpectedPoints);
  return outerProduct(homeDist, awayDist);
};

const buildFallbackModel = (
  rowLabels: number[],
  colLabels: number[],
): SquareOddsComputationResult => {
  const digitProbabilities = buildSimulationMatrix(23, 21);
  const boardPercentages = mapDigitMatrixToBoard(digitProbabilities, rowLabels, colLabels);

  return {
    boardPercentages,
    digitProbabilities,
    generatedAt: new Date().toISOString(),
    sourceMode: "baseline",
    sourcesUsed: ["fallback_model"],
    warnings: [
      "Live sports data sources were unavailable. Using a mathematically generated baseline model.",
    ],
    expectedHomePoints: 23,
    expectedAwayPoints: 21,
  };
};

const mapDigitMatrixToBoard = (
  digitMatrix: DigitProbabilityMatrix,
  rowLabels: number[],
  colLabels: number[],
): number[][] => {
  if (rowLabels.length !== DIGIT_COUNT || colLabels.length !== DIGIT_COUNT) {
    throw new Error("Expected row and column labels to each have length 10.");
  }
  return Array.from({ length: DIGIT_COUNT }, (_, rowIndex) => {
    const rowDigit = rowLabels[rowIndex];
    if (!Number.isInteger(rowDigit) || rowDigit < 0 || rowDigit > 9) {
      throw new Error("Invalid row label while mapping digit probabilities.");
    }
    return Array.from({ length: DIGIT_COUNT }, (_, colIndex) => {
      const colDigit = colLabels[colIndex];
      if (!Number.isInteger(colDigit) || colDigit < 0 || colDigit > 9) {
        throw new Error("Invalid column label while mapping digit probabilities.");
      }
      return digitMatrix[rowDigit][colDigit] * 100;
    });
  });
};

const finalizeBoardPercentages = (boardPercentages: number[][]): number[][] => {
  const flat = boardPercentages.flat();
  const total = flat.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return Array.from({ length: DIGIT_COUNT }, () =>
      Array.from({ length: DIGIT_COUNT }, () => 1),
    );
  }

  const scale = 100 / total;
  return boardPercentages.map((row) =>
    row.map((value) => clamp(value * scale, 0, 100)),
  );
};

const buildSmartDigitModel = async (
  homeTeamCode: string,
  awayTeamCode: string,
): Promise<CachedDigitModel> => {
  const warnings: string[] = [];
  const sourcesUsed = new Set<SquareOddsComputationSource>();

  let games: GameRecord[] = [];
  try {
    games = await loadGames();
    sourcesUsed.add("nflverse_games");
  } catch {
    warnings.push(
      "Unable to load NFL historical games dataset. Falling back to baseline simulation only.",
    );
    const fallbackDigitProbabilities = buildSimulationMatrix(23, 21);
    return {
      digitProbabilities: fallbackDigitProbabilities,
      generatedAt: new Date().toISOString(),
      sourceMode: "baseline",
      sourcesUsed: ["fallback_model"],
      warnings,
      expectedHomePoints: 23,
      expectedAwayPoints: 21,
    };
  }

  const latestSeason = getLatestSeason(games);
  const leagueAvgPoints = calculateLeagueAveragePoints(games, latestSeason);
  const baseline = buildBaselineMatrix(games, latestSeason);
  const homeContext = buildTeamContext(games, homeTeamCode, latestSeason);
  const awayContext = buildTeamContext(games, awayTeamCode, latestSeason);

  if (!homeContext || !awayContext) {
    warnings.push(
      "Limited team history found for one or both teams. Probabilities rely more heavily on league baseline.",
    );
  }

  const [moneylines, espnTeams] = await Promise.all([
    loadClosingMoneylines()
      .then((rows) => {
        sourcesUsed.add("nflverse_closing_lines");
        return rows;
      })
      .catch(() => {
        warnings.push("Moneyline data could not be loaded. Market adjustments disabled.");
        return [] as MoneylineRecord[];
      }),
    getEspnTeams().catch(() => {
      warnings.push("ESPN team metadata unavailable. Team-level API stats reduced.");
      return new Map<string, EspnTeamDescriptor>();
    }),
  ]);

  const homeDisplayCandidates = (() => {
    const descriptors = espnTeams.get(homeTeamCode);
    const nickname = NFL_TEAMS.find((team) => team.id === homeTeamCode)?.name ?? homeTeamCode;
    const candidates = [
      descriptors?.displayName,
      descriptors?.shortDisplayName,
      descriptors?.nickname,
      nickname,
    ].filter((value): value is string => Boolean(value && value.trim()));
    return Array.from(new Set(candidates));
  })();

  const awayDisplayCandidates = (() => {
    const descriptors = espnTeams.get(awayTeamCode);
    const nickname = NFL_TEAMS.find((team) => team.id === awayTeamCode)?.name ?? awayTeamCode;
    const candidates = [
      descriptors?.displayName,
      descriptors?.shortDisplayName,
      descriptors?.nickname,
      nickname,
    ].filter((value): value is string => Boolean(value && value.trim()));
    return Array.from(new Set(candidates));
  })();

  const [
    homeEspnStats,
    awayEspnStats,
    homeSportsDbRecent,
    awaySportsDbRecent,
  ] = await Promise.all([
    getEspnTeamStats(homeTeamCode),
    getEspnTeamStats(awayTeamCode),
    getSportsDbRecentForm(homeTeamCode, homeDisplayCandidates),
    getSportsDbRecentForm(awayTeamCode, awayDisplayCandidates),
  ]);

  if (homeEspnStats || awayEspnStats) {
    sourcesUsed.add("espn_team_stats");
  } else {
    warnings.push("ESPN team stats unavailable. Expected-points model uses historical-only inputs.");
  }

  if (homeSportsDbRecent || awaySportsDbRecent) {
    sourcesUsed.add("thesportsdb_recent_form");
  } else {
    warnings.push("Recent form feed unavailable. Team trend model uses historical games only.");
  }

  const homeMarketProb = calculateTeamMarketImpliedProb(
    moneylines,
    homeTeamCode,
    latestSeason,
  );
  const awayMarketProb = calculateTeamMarketImpliedProb(
    moneylines,
    awayTeamCode,
    latestSeason,
  );

  const teamMatrix = buildTeamDigitMatrix(
    homeContext,
    awayContext,
    homeSportsDbRecent,
    awaySportsDbRecent,
  );

  let expectedHomePoints = estimateExpectedPoints(
    homeContext,
    awayContext,
    homeEspnStats,
    awayEspnStats,
    homeSportsDbRecent,
    leagueAvgPoints,
  );
  let expectedAwayPoints = estimateExpectedPoints(
    awayContext,
    homeContext,
    awayEspnStats,
    homeEspnStats,
    awaySportsDbRecent,
    leagueAvgPoints,
  );

  if (homeMarketProb !== null && awayMarketProb !== null) {
    const marketEdge = homeMarketProb - awayMarketProb;
    expectedHomePoints = clamp(expectedHomePoints + marketEdge * 4.5, 10, 45);
    expectedAwayPoints = clamp(expectedAwayPoints - marketEdge * 4.5, 10, 45);
  }

  const simulationMatrix = buildSimulationMatrix(expectedHomePoints, expectedAwayPoints);

  let baselineWeight = 0.45;
  let teamWeight = 0.35;
  let simWeight = 0.2;

  if (!homeEspnStats && !awayEspnStats) {
    baselineWeight += 0.05;
    simWeight -= 0.05;
  }
  if (!homeSportsDbRecent && !awaySportsDbRecent) {
    baselineWeight += 0.03;
    teamWeight -= 0.03;
  }
  if (homeMarketProb === null || awayMarketProb === null) {
    baselineWeight += 0.02;
    simWeight -= 0.02;
  }

  baselineWeight = clamp(baselineWeight, 0.3, 0.7);
  teamWeight = clamp(teamWeight, 0.15, 0.45);
  simWeight = clamp(simWeight, 0.08, 0.35);
  const totalWeight = baselineWeight + teamWeight + simWeight;

  const digitProbabilities = blendMatrices([
    { matrix: baseline.matrix, weight: baselineWeight / totalWeight },
    { matrix: teamMatrix, weight: teamWeight / totalWeight },
    { matrix: simulationMatrix, weight: simWeight / totalWeight },
  ]);

  const sourceMode: SquareOddsSourceMode =
    sourcesUsed.size >= 3 ? "full" : "baseline";

  return {
    digitProbabilities,
    generatedAt: new Date().toISOString(),
    sourceMode,
    sourcesUsed: Array.from(sourcesUsed),
    warnings,
    expectedHomePoints,
    expectedAwayPoints,
  };
};

export const buildSquareOdds = async (
  input: BuildSquareOddsInput,
): Promise<SquareOddsComputationResult> => {
  const homeTeamCode = resolveTeamCode(input.homeTeamName);
  const awayTeamCode = resolveTeamCode(input.awayTeamName);
  const cacheKey = `${MODEL_CACHE_PREFIX}:${homeTeamCode}:${awayTeamCode}`;

  try {
    const cached = readCachedEntry(cacheKey);
    if (cached) {
      return {
        boardPercentages: finalizeBoardPercentages(
          mapDigitMatrixToBoard(
            cached.value.digitProbabilities,
            input.rowLabels,
            input.colLabels,
          ),
        ),
        digitProbabilities: cached.value.digitProbabilities,
        generatedAt: cached.value.generatedAt,
        sourceMode: cached.value.sourceMode,
        sourcesUsed: cached.value.sourcesUsed,
        warnings: cached.value.warnings,
        expectedHomePoints: cached.value.expectedHomePoints,
        expectedAwayPoints: cached.value.expectedAwayPoints,
      };
    }

    const computed = await buildSmartDigitModel(homeTeamCode, awayTeamCode);
    writeCachedEntry(cacheKey, computed);

    return {
      boardPercentages: finalizeBoardPercentages(
        mapDigitMatrixToBoard(
          computed.digitProbabilities,
          input.rowLabels,
          input.colLabels,
        ),
      ),
      digitProbabilities: computed.digitProbabilities,
      generatedAt: computed.generatedAt,
      sourceMode: computed.sourceMode,
      sourcesUsed: computed.sourcesUsed,
      warnings: computed.warnings,
      expectedHomePoints: computed.expectedHomePoints,
      expectedAwayPoints: computed.expectedAwayPoints,
    };
  } catch (error) {
    const fallback = buildFallbackModel(input.rowLabels, input.colLabels);
    if (error instanceof Error) {
      fallback.warnings.push(error.message);
    }
    return fallback;
  }
};
