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
