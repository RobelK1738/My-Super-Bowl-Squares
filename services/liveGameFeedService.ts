import { NFL_TEAMS } from "../constants";
import type {
  LiveCommentarySentiment,
  LiveGameClock,
  LiveGameSnapshot,
  LiveGameStatus,
  LivePlayEvent,
} from "../types";
import {
  analyzeCommentarySentiment,
  scoreCommentaryText,
} from "./liveSentimentService";

type FetchLiveGameSnapshotInput = {
  homeTeamName: string;
  awayTeamName: string;
  gameDate?: string;
  eventIdOverride?: string;
};

type TeamResolution = {
  code: string;
  name: string;
};

type ParsedSnapshotCore = {
  eventId: string;
  status: LiveGameStatus;
  statusDetail: string;
  homeScore: number;
  awayScore: number;
  homeTeamName: string;
  awayTeamName: string;
  clock: LiveGameClock;
};

const ESPN_SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const ESPN_SUMMARY_URL = (eventId: string) =>
  `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(eventId)}`;

const SOURCE_TIMEOUT_MS = 10_000;
const MAX_PLAY_EVENTS = 160;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const getString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const getNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const fetchWithTimeout = async (url: string): Promise<Response> => {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json,text/plain,*/*" },
    });
  } finally {
    globalThis.clearTimeout(timeout);
  }
};

const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Live feed request failed (${response.status}) for ${url}`);
  }
  return (await response.json()) as T;
};

const resolveTeam = (teamNameOrCode: string): TeamResolution => {
  const normalized = normalizeText(teamNameOrCode);

  const matched =
    NFL_TEAMS.find((team) => normalizeText(team.id) === normalized) ??
    NFL_TEAMS.find((team) => normalizeText(team.name) === normalized) ??
    NFL_TEAMS.find((team) => normalized.endsWith(normalizeText(team.name))) ??
    null;

  if (!matched) {
    throw new Error(`Unsupported team: ${teamNameOrCode}`);
  }

  return {
    code: matched.id.toUpperCase(),
    name: matched.name,
  };
};

const parseClockToSeconds = (clock: string | null): number | null => {
  if (!clock) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!match) return null;
  const minutes = Number.parseInt(match[1], 10);
  const seconds = Number.parseInt(match[2], 10);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  return clamp(minutes * 60 + seconds, 0, 15 * 60);
};

const mapStatus = (state: string | null, detail: string): LiveGameStatus => {
  const lowerDetail = detail.toLowerCase();
  if (state === "pre") return "pregame";
  if (state === "in") {
    if (lowerDetail.includes("halftime")) return "halftime";
    return "in_progress";
  }
  if (state === "post") {
    if (lowerDetail.includes("postponed") || lowerDetail.includes("canceled")) {
      return "postponed";
    }
    return "final";
  }
  if (lowerDetail.includes("halftime")) return "halftime";
  if (lowerDetail.includes("final")) return "final";
  return "unknown";
};

const calculateRemainingGameSeconds = (
  status: LiveGameStatus,
  period: number,
  secondsInPeriod: number | null,
): number | null => {
  if (status === "final" || status === "postponed") return 0;
  if (status === "pregame") return 4 * 15 * 60;

  if (status === "halftime") {
    return 2 * 15 * 60;
  }

  if (secondsInPeriod === null) return null;

  if (period <= 4) {
    const clampedPeriod = clamp(period, 1, 4);
    return (4 - clampedPeriod) * 15 * 60 + clamp(secondsInPeriod, 0, 15 * 60);
  }

  return clamp(secondsInPeriod, 0, 15 * 60);
};

const parseCoreFromCompetition = (
  competition: Record<string, unknown> | null,
  event: Record<string, unknown> | null,
  homeTeamCode: string,
  awayTeamCode: string,
): ParsedSnapshotCore | null => {
  if (!competition) return null;

  const competitors = asArray(competition.competitors).map(asObject).filter(Boolean) as Record<
    string,
    unknown
  >[];

  const homeCompetitor = competitors.find((competitor) => {
    const team = asObject(competitor.team);
    return getString(team?.abbreviation)?.toUpperCase() === homeTeamCode;
  });

  const awayCompetitor = competitors.find((competitor) => {
    const team = asObject(competitor.team);
    return getString(team?.abbreviation)?.toUpperCase() === awayTeamCode;
  });

  if (!homeCompetitor || !awayCompetitor) return null;

  const eventId =
    getString(event?.id) ?? getString(competition.id) ?? `${homeTeamCode}-${awayTeamCode}`;

  const statusNode =
    asObject(competition.status) ?? asObject(event?.status) ?? ({ type: {} } as Record<string, unknown>);
  const statusType = asObject(statusNode.type) ?? {};

  const statusDetail =
    getString(statusType.detail) ?? getString(statusType.shortDetail) ?? "Live status unavailable";
  const status = mapStatus(getString(statusType.state), statusDetail);

  const period = Math.max(1, Math.round(getNumber(statusNode.period) ?? 1));
  const displayClock =
    getString(statusNode.displayClock) ??
    (status === "pregame" ? "15:00" : status === "final" ? "0:00" : "");

  const secondsRemainingInPeriod = parseClockToSeconds(displayClock);
  const secondsRemainingGame = calculateRemainingGameSeconds(
    status,
    period,
    secondsRemainingInPeriod,
  );

  const homeTeam = asObject(homeCompetitor.team);
  const awayTeam = asObject(awayCompetitor.team);

  return {
    eventId,
    status,
    statusDetail,
    homeScore: Math.max(0, Math.round(getNumber(homeCompetitor.score) ?? 0)),
    awayScore: Math.max(0, Math.round(getNumber(awayCompetitor.score) ?? 0)),
    homeTeamName:
      getString(homeTeam?.displayName) ?? getString(homeTeam?.shortDisplayName) ?? homeTeamCode,
    awayTeamName:
      getString(awayTeam?.displayName) ?? getString(awayTeam?.shortDisplayName) ?? awayTeamCode,
    clock: {
      period,
      displayClock: displayClock || "--:--",
      secondsRemainingInPeriod,
      secondsRemainingGame,
    },
  };
};

const parseSummaryCore = (
  payload: unknown,
  homeTeamCode: string,
  awayTeamCode: string,
): ParsedSnapshotCore | null => {
  const root = asObject(payload);
  if (!root) return null;

  const header = asObject(root.header);
  const competitions = asArray(header?.competitions).map(asObject).filter(Boolean) as Record<
    string,
    unknown
  >[];

  const eventNode = asObject(root.event) ?? asObject(header?.event) ?? null;

  for (const competition of competitions) {
    const parsed = parseCoreFromCompetition(competition, eventNode, homeTeamCode, awayTeamCode);
    if (parsed) return parsed;
  }

  return null;
};

const inferTeamCodeFromText = (
  text: string,
  homeTeamCode: string,
  awayTeamCode: string,
  homeTeamName: string,
  awayTeamName: string,
): string | null => {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  const homeTokens = [homeTeamCode, homeTeamName]
    .map(normalizeText)
    .flatMap((entry) => entry.split(" "));
  const awayTokens = [awayTeamCode, awayTeamName]
    .map(normalizeText)
    .flatMap((entry) => entry.split(" "));

  const hasHome = homeTokens.some((token) => token && normalized.includes(token));
  const hasAway = awayTokens.some((token) => token && normalized.includes(token));

  if (hasHome && !hasAway) return homeTeamCode;
  if (hasAway && !hasHome) return awayTeamCode;
  return null;
};

const parsePlayClock = (play: Record<string, unknown>): string | null => {
  const clock = asObject(play.clock);
  return (
    getString(clock?.displayValue) ??
    getString(clock?.shortDisplayValue) ??
    getString(play.clock) ??
    null
  );
};

const parsePlayPeriod = (play: Record<string, unknown>): number | null => {
  const period = asObject(play.period);
  const raw = getNumber(period?.number) ?? getNumber(period?.value) ?? getNumber(play.period);
  if (raw === null) return null;
  return Math.max(1, Math.round(raw));
};

const collectSummaryPlays = (payload: unknown): Record<string, unknown>[] => {
  const output: Record<string, unknown>[] = [];
  const root = asObject(payload);
  if (!root) return output;

  const drives = asObject(root.drives);
  const previous = asArray(drives?.previous);

  for (const driveCandidate of previous) {
    const drive = asObject(driveCandidate);
    if (!drive) continue;
    for (const playCandidate of asArray(drive.plays)) {
      const play = asObject(playCandidate);
      if (play) output.push(play);
    }
  }

  const current = asObject(drives?.current);
  for (const playCandidate of asArray(current?.plays)) {
    const play = asObject(playCandidate);
    if (play) output.push(play);
  }

  for (const playCandidate of asArray(root.plays)) {
    const play = asObject(playCandidate);
    if (play) output.push(play);
  }

  for (const playCandidate of asArray(root.scoringPlays)) {
    const play = asObject(playCandidate);
    if (play) output.push(play);
  }

  const header = asObject(root.header);
  const competitions = asArray(header?.competitions).map(asObject).filter(Boolean) as Record<
    string,
    unknown
  >[];

  const lastPlay = asObject(asObject(competitions[0]?.situation)?.lastPlay);
  if (lastPlay) output.push(lastPlay);

  const seen = new Set<string>();
  const deduped: Record<string, unknown>[] = [];

  for (let index = 0; index < output.length; index += 1) {
    const play = output[index];
    const text =
      getString(play.text) ?? getString(play.shortText) ?? getString(asObject(play.type)?.text) ?? "";
    if (!text) continue;

    const id =
      getString(play.id) ??
      getString(play.sequenceNumber) ??
      `${parsePlayPeriod(play) ?? "?"}-${parsePlayClock(play) ?? "?"}-${text}`;

    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push(play);
  }

  return deduped.slice(-MAX_PLAY_EVENTS);
};

const normalizeSummaryPlays = (
  payload: unknown,
  homeTeamCode: string,
  awayTeamCode: string,
  homeTeamName: string,
  awayTeamName: string,
): LivePlayEvent[] => {
  const rawPlays = collectSummaryPlays(payload);

  return rawPlays.map((play, index) => {
    const text =
      getString(play.text) ??
      getString(play.shortText) ??
      getString(asObject(play.type)?.text) ??
      "Play update unavailable";

    const lower = text.toLowerCase();

    const explicitTeamCode =
      getString(asObject(play.team)?.abbreviation)?.toUpperCase() ??
      getString(asObject(play.possession)?.abbreviation)?.toUpperCase() ??
      null;

    const teamCode =
      explicitTeamCode &&
      (explicitTeamCode === homeTeamCode || explicitTeamCode === awayTeamCode)
        ? explicitTeamCode
        : inferTeamCodeFromText(
            text,
            homeTeamCode,
            awayTeamCode,
            homeTeamName,
            awayTeamName,
          );

    const scoringFlag =
      typeof play.scoringPlay === "boolean"
        ? play.scoringPlay
        : /touchdown|field goal|safety|extra point|two point|2-point|pat is good/.test(lower);

    const penaltyFlag =
      /penalty|foul|encroachment|offside|holding|pass interference/.test(lower);
    const turnoverFlag =
      /intercepted|interception|fumble|turnover|picked off/.test(lower);

    const yardsMatch = /for\s(-?\d+)\syard/.exec(lower);
    const yards = yardsMatch ? Number.parseInt(yardsMatch[1], 10) : 0;
    const explosiveFlag = Number.isFinite(yards) && Math.abs(yards) >= 20;

    return {
      id:
        getString(play.id) ??
        getString(play.sequenceNumber) ??
        `${parsePlayPeriod(play) ?? "?"}-${parsePlayClock(play) ?? "?"}-${index}`,
      text,
      teamCode,
      period: parsePlayPeriod(play),
      clock: parsePlayClock(play),
      isScoringPlay: scoringFlag,
      isPenalty: penaltyFlag,
      isTurnover: turnoverFlag,
      isExplosivePlay: explosiveFlag,
      sentimentScore: scoreCommentaryText(text),
    } satisfies LivePlayEvent;
  });
};

const findEventInScoreboard = (
  payload: unknown,
  homeTeamCode: string,
  awayTeamCode: string,
  eventIdOverride?: string,
): ParsedSnapshotCore | null => {
  const root = asObject(payload);
  if (!root) return null;

  const events = asArray(root.events).map(asObject).filter(Boolean) as Record<string, unknown>[];

  for (const event of events) {
    const eventId = getString(event.id);
    if (eventIdOverride && eventId !== eventIdOverride) {
      continue;
    }

    const competitions = asArray(event.competitions).map(asObject).filter(Boolean) as Record<
      string,
      unknown
    >[];

    for (const competition of competitions) {
      const parsed = parseCoreFromCompetition(
        competition,
        event,
        homeTeamCode,
        awayTeamCode,
      );
      if (parsed) {
        return parsed;
      }
    }
  }

  return null;
};

const toScoreboardDate = (rawDate: string | undefined): string | null => {
  if (!rawDate) return null;
  const trimmed = rawDate.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  return `${match[1]}${match[2]}${match[3]}`;
};

const neutralSentiment: LiveCommentarySentiment = {
  home: 0,
  away: 0,
  neutral: 1,
};

export const getLivePollIntervalMs = (snapshot: LiveGameSnapshot | null): number => {
  if (!snapshot) return 45_000;

  if (snapshot.status === "in_progress") {
    const remaining = snapshot.clock.secondsRemainingGame;
    if (remaining !== null && remaining <= 8 * 60) return 5_000;
    if (remaining !== null && remaining <= 20 * 60) return 8_000;
    return 12_000;
  }

  if (snapshot.status === "halftime") return 20_000;
  if (snapshot.status === "pregame") return 45_000;
  return 60_000;
};

export const fetchLiveGameSnapshot = async (
  input: FetchLiveGameSnapshotInput,
): Promise<LiveGameSnapshot | null> => {
  const homeTeam = resolveTeam(input.homeTeamName);
  const awayTeam = resolveTeam(input.awayTeamName);

  const scoreboardDate = toScoreboardDate(input.gameDate);
  const scoreboardUrls = [
    scoreboardDate
      ? `${ESPN_SCOREBOARD_URL}?dates=${encodeURIComponent(scoreboardDate)}`
      : ESPN_SCOREBOARD_URL,
    ESPN_SCOREBOARD_URL,
  ];

  let core: ParsedSnapshotCore | null = null;

  for (const scoreboardUrl of scoreboardUrls) {
    try {
      const scoreboardPayload = await fetchJson<unknown>(scoreboardUrl);
      core = findEventInScoreboard(
        scoreboardPayload,
        homeTeam.code,
        awayTeam.code,
        input.eventIdOverride,
      );
      if (core) break;
    } catch {
      // Continue to fallback source below.
    }
  }

  const eventId = input.eventIdOverride ?? core?.eventId;
  if (!eventId) return null;

  let summaryPayload: unknown | null = null;

  try {
    summaryPayload = await fetchJson<unknown>(ESPN_SUMMARY_URL(eventId));
    const parsedFromSummary = parseSummaryCore(summaryPayload, homeTeam.code, awayTeam.code);
    if (parsedFromSummary) {
      core = parsedFromSummary;
    }
  } catch {
    // Continue with scoreboard-derived snapshot if summary feed fails.
  }

  if (!core) return null;

  const plays = summaryPayload
    ? normalizeSummaryPlays(
        summaryPayload,
        homeTeam.code,
        awayTeam.code,
        core.homeTeamName,
        core.awayTeamName,
      )
    : [];

  const sentiment =
    plays.length > 0
      ? analyzeCommentarySentiment(
          plays.map((play) => ({ text: play.text, teamCode: play.teamCode })),
          {
            homeTeamCode: homeTeam.code,
            awayTeamCode: awayTeam.code,
            homeTeamName: core.homeTeamName,
            awayTeamName: core.awayTeamName,
          },
        )
      : neutralSentiment;

  return {
    eventId,
    fetchedAt: new Date().toISOString(),
    status: core.status,
    statusDetail: core.statusDetail,
    homeTeamCode: homeTeam.code,
    awayTeamCode: awayTeam.code,
    homeTeamName: core.homeTeamName,
    awayTeamName: core.awayTeamName,
    homeScore: core.homeScore,
    awayScore: core.awayScore,
    clock: core.clock,
    plays,
    sentiment,
  };
};
