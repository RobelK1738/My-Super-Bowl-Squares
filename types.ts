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

export interface GameSettings {
  costPerSquare: number;
  homeTeamName: string;
  awayTeamName: string;
}
