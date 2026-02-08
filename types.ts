export interface Team {
  id: string;
  name: string;
  color: string;
}

export interface Player {
  name: string;
}

export type SquareStatus = 'empty' | 'pending' | 'approved';

export interface GridCell {
  row: number;
  col: number;
  player: string | null;
  status: SquareStatus;
}

export interface GameResult {
  homeScore: number;
  awayScore: number;
  homeLastDigit: number;
  awayLastDigit: number;
  winnerRow: number;
  winnerCol: number;
  winnerSquareNumber: number;
  winnerName: string | null;
  winnerStatus: SquareStatus;
  submittedAt: string;
}

export interface GameSettings {
  costPerSquare: number;
  homeTeamName: string;
  awayTeamName: string;
}

export type DigitProbabilityMatrix = number[][];

export type SquareOddsSourceMode = "full" | "baseline";

export type SquareOddsComputationSource =
  | "nflverse_games"
  | "nflverse_closing_lines"
  | "espn_team_stats"
  | "thesportsdb_recent_form"
  | "espn_live_scoreboard"
  | "espn_live_summary"
  | "live_commentary_sentiment"
  | "fallback_model";

export interface SquareOddsComputationResult {
  boardPercentages: number[][];
  digitProbabilities: DigitProbabilityMatrix;
  generatedAt: string;
  sourceMode: SquareOddsSourceMode;
  sourcesUsed: SquareOddsComputationSource[];
  warnings: string[];
  expectedHomePoints: number;
  expectedAwayPoints: number;
}

export type LiveGameStatus =
  | "pregame"
  | "in_progress"
  | "halftime"
  | "final"
  | "postponed"
  | "unknown";

export interface LiveGameClock {
  period: number;
  displayClock: string;
  secondsRemainingInPeriod: number | null;
  secondsRemainingGame: number | null;
}

export interface LivePlayEvent {
  id: string;
  text: string;
  teamCode: string | null;
  period: number | null;
  clock: string | null;
  isScoringPlay: boolean;
  isPenalty: boolean;
  isTurnover: boolean;
  isExplosivePlay: boolean;
  sentimentScore: number;
}

export interface LiveCommentarySentiment {
  home: number;
  away: number;
  neutral: number;
}

export interface LiveGameSnapshot {
  eventId: string;
  fetchedAt: string;
  status: LiveGameStatus;
  statusDetail: string;
  homeTeamCode: string;
  awayTeamCode: string;
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  clock: LiveGameClock;
  plays: LivePlayEvent[];
  sentiment: LiveCommentarySentiment;
}

export interface LiveFeatureVector {
  remainingGameSeconds: number;
  elapsedGameSeconds: number;
  homeMomentum: number;
  awayMomentum: number;
  homePenaltyPressure: number;
  awayPenaltyPressure: number;
  homeTurnoverPressure: number;
  awayTurnoverPressure: number;
  homeRecentScoringRate: number;
  awayRecentScoringRate: number;
  playPacePerMinute: number;
}

export interface RealtimeSquareOddsComputationResult
  extends SquareOddsComputationResult {
  engineMode: "realtime";
  liveEventId: string;
  liveStatus: LiveGameStatus;
  liveStatusDetail: string;
  liveClock: string;
  liveSnapshotAt: string;
  featureVector: LiveFeatureVector;
}
