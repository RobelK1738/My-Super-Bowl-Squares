import { Team } from './types';

export const NFL_TEAMS: Team[] = [
  { id: 'ARI', name: 'Cardinals', color: '#97233F' },
  { id: 'ATL', name: 'Falcons', color: '#A71930' },
  { id: 'BAL', name: 'Ravens', color: '#241773' },
  { id: 'BUF', name: 'Bills', color: '#00338D' },
  { id: 'CAR', name: 'Panthers', color: '#0085CA' },
  { id: 'CHI', name: 'Bears', color: '#0B162A' },
  { id: 'CIN', name: 'Bengals', color: '#FB4F14' },
  { id: 'CLE', name: 'Browns', color: '#311D00' },
  { id: 'DAL', name: 'Cowboys', color: '#003594' },
  { id: 'DEN', name: 'Broncos', color: '#FB4F14' },
  { id: 'DET', name: 'Lions', color: '#0076B6' },
  { id: 'GB', name: 'Packers', color: '#203731' },
  { id: 'HOU', name: 'Texans', color: '#03202F' },
  { id: 'IND', name: 'Colts', color: '#002C5F' },
  { id: 'JAX', name: 'Jaguars', color: '#006778' },
  { id: 'KC', name: 'Chiefs', color: '#E31837' },
  { id: 'LV', name: 'Raiders', color: '#000000' },
  { id: 'LAC', name: 'Chargers', color: '#0080C6' },
  { id: 'LAR', name: 'Rams', color: '#003594' },
  { id: 'MIA', name: 'Dolphins', color: '#008E97' },
  { id: 'MIN', name: 'Vikings', color: '#4F2683' },
  { id: 'NE', name: 'Patriots', color: '#002244' },
  { id: 'NO', name: 'Saints', color: '#D3BC8D' },
  { id: 'NYG', name: 'Giants', color: '#0B2265' },
  { id: 'NYJ', name: 'Jets', color: '#125740' },
  { id: 'PHI', name: 'Eagles', color: '#004C54' },
  { id: 'PIT', name: 'Steelers', color: '#FFB612' },
  { id: 'SF', name: '49ers', color: '#AA0000' },
  { id: 'SEA', name: 'Seahawks', color: '#002244' },
  { id: 'TB', name: 'Buccaneers', color: '#D50A0A' },
  { id: 'TEN', name: 'Titans', color: '#0C2340' },
  { id: 'WAS', name: 'Commanders', color: '#5A1414' },
];

export const getTeamLogo = (teamNameOrId: string): string => {
  const team = NFL_TEAMS.find(t => 
    t.name.toLowerCase() === teamNameOrId.toLowerCase() || 
    t.id.toLowerCase() === teamNameOrId.toLowerCase()
  );
  if (!team) return 'https://a.espncdn.com/i/teamlogos/nfl/500/nfl.png';
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${team.id.toLowerCase()}.png`;
};

export const INITIAL_ROWS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
export const INITIAL_COLS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
