import { NFL_TEAMS } from "../constants";
import type { LiveCommentarySentiment } from "../types";

type TeamSide = "home" | "away";

type TeamSentimentContext = {
  homeTeamCode: string;
  awayTeamCode: string;
  homeTeamName: string;
  awayTeamName: string;
};

type TeamAliasLookup = {
  home: Set<string>;
  away: Set<string>;
};

const POSITIVE_TERMS = new Set([
  "touchdown",
  "scores",
  "scored",
  "good",
  "great",
  "huge",
  "explosive",
  "interception",
  "sack",
  "forced",
  "stops",
  "stop",
  "efficient",
  "conversion",
  "converted",
  "first",
  "down",
  "win",
  "winning",
  "momentum",
  "dominant",
  "clutch",
  "redzone",
  "red",
  "zone",
]);

const NEGATIVE_TERMS = new Set([
  "penalty",
  "foul",
  "flags",
  "flag",
  "missed",
  "miss",
  "intercepted",
  "fumble",
  "turnover",
  "safety",
  "stuffed",
  "stalled",
  "punt",
  "sacked",
  "loss",
  "losing",
  "injury",
  "slow",
  "struggling",
  "struggle",
  "incomplete",
  "delay",
]);

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (value: string): string[] => {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized.split(" ").filter(Boolean);
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const toAliasSet = (teamCode: string, teamName: string): Set<string> => {
  const aliases = new Set<string>();
  const upperCode = teamCode.toUpperCase();
  aliases.add(upperCode.toLowerCase());

  const teamMatch = NFL_TEAMS.find((team) => team.id.toUpperCase() === upperCode);
  const baseName = teamMatch?.name ?? teamName;

  for (const name of [teamName, baseName]) {
    const normalized = normalizeText(name);
    if (!normalized) continue;

    aliases.add(normalized);
    for (const token of normalized.split(" ")) {
      if (token.length >= 3) aliases.add(token);
    }
  }

  return aliases;
};

const buildAliasLookup = (
  context: TeamSentimentContext,
): TeamAliasLookup => ({
  home: toAliasSet(context.homeTeamCode, context.homeTeamName),
  away: toAliasSet(context.awayTeamCode, context.awayTeamName),
});

const detectTeamSideFromText = (
  text: string,
  aliases: TeamAliasLookup,
): TeamSide | null => {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  let homeMatch = false;
  let awayMatch = false;

  for (const alias of aliases.home) {
    if (alias && normalized.includes(alias)) {
      homeMatch = true;
      break;
    }
  }

  for (const alias of aliases.away) {
    if (alias && normalized.includes(alias)) {
      awayMatch = true;
      break;
    }
  }

  if (homeMatch && !awayMatch) return "home";
  if (awayMatch && !homeMatch) return "away";
  return null;
};

export const scoreCommentaryText = (text: string): number => {
  const tokens = tokenize(text);
  if (tokens.length === 0) return 0;

  let score = 0;
  for (const token of tokens) {
    if (POSITIVE_TERMS.has(token)) score += 1;
    if (NEGATIVE_TERMS.has(token)) score -= 1;
  }

  const normalized = score / Math.max(tokens.length, 4);
  return clamp(normalized * 2.4, -1, 1);
};

export type SentimentEntry = {
  text: string;
  teamCode?: string | null;
};

export const analyzeCommentarySentiment = (
  entries: SentimentEntry[],
  context: TeamSentimentContext,
): LiveCommentarySentiment => {
  if (entries.length === 0) {
    return { home: 0, away: 0, neutral: 1 };
  }

  const aliases = buildAliasLookup(context);

  let homeWeighted = 0;
  let awayWeighted = 0;
  let neutralWeighted = 0;
  let homeWeight = 0;
  let awayWeight = 0;
  let neutralWeight = 0;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const recencyWeight = Math.exp(-(entries.length - 1 - index) / 14);
    const baseScore = scoreCommentaryText(entry.text);

    let side: TeamSide | null = null;
    if (entry.teamCode) {
      const normalizedCode = entry.teamCode.toUpperCase();
      if (normalizedCode === context.homeTeamCode.toUpperCase()) side = "home";
      if (normalizedCode === context.awayTeamCode.toUpperCase()) side = "away";
    }

    if (!side) {
      side = detectTeamSideFromText(entry.text, aliases);
    }

    if (side === "home") {
      homeWeighted += baseScore * recencyWeight;
      homeWeight += recencyWeight;
      continue;
    }

    if (side === "away") {
      awayWeighted += baseScore * recencyWeight;
      awayWeight += recencyWeight;
      continue;
    }

    neutralWeighted += baseScore * recencyWeight;
    neutralWeight += recencyWeight;
  }

  const home = homeWeight > 0 ? clamp(homeWeighted / homeWeight, -1, 1) : 0;
  const away = awayWeight > 0 ? clamp(awayWeighted / awayWeight, -1, 1) : 0;
  const neutral =
    neutralWeight > 0 ? clamp((neutralWeighted / neutralWeight + 1) / 2, 0, 1) : 1;

  return { home, away, neutral };
};
