import React from 'react';
import { GridCell } from '../types';
import { getTeamLogo } from '../constants';
import { AlertCircle, CheckCircle2, HelpCircle } from 'lucide-react';

interface GridBoardProps {
  rowLabels: number[];
  colLabels: number[];
  grid: GridCell[][];
  onSquareClick: (row: number, col: number) => void;
  homeTeamName: string;
  awayTeamName: string;
  isAdmin: boolean;
  isLocked: boolean;
}

export const GridBoard: React.FC<GridBoardProps> = ({
  rowLabels,
  colLabels,
  grid,
  onSquareClick,
  homeTeamName,
  awayTeamName,
  isAdmin,
  isLocked
}) => {
  const homeLogo = getTeamLogo(homeTeamName);
  const awayLogo = getTeamLogo(awayTeamName);

  return (
    <div className="w-full overflow-x-auto grid-scroll pb-4">
      <div className="min-w-[1000px] flex flex-col">
        
        {/* AWAY TEAM HEADER (Horizontal) */}
        <div className="flex mb-4">
           <div className="w-[180px] shrink-0"></div> {/* Spacer for Left Header */}
           <div className="flex-1 flex flex-col items-center justify-center bg-slate-800/50 rounded-xl border border-slate-700/50 p-4 mb-2 relative overflow-hidden">
               <div className="absolute inset-0 bg-gradient-to-b from-red-900/10 to-transparent pointer-events-none"></div>
               <img src={awayLogo} alt={awayTeamName} className="h-16 w-16 object-contain mb-2 drop-shadow-lg" />
               <h2 className="text-4xl font-black text-slate-100 uppercase tracking-tighter drop-shadow-md">
                 {awayTeamName}
               </h2>
           </div>
        </div>

        <div className="flex">
          {/* HOME TEAM HEADER (Vertical) */}
          <div className="w-[180px] shrink-0 flex flex-col items-center justify-center bg-slate-800/50 rounded-xl border border-slate-700/50 p-4 mr-4 relative overflow-hidden">
             <div className="absolute inset-0 bg-gradient-to-r from-blue-900/10 to-transparent pointer-events-none"></div>
             <div className="flex flex-col items-center sticky top-4">
               <img src={homeLogo} alt={homeTeamName} className="h-16 w-16 object-contain mb-6 drop-shadow-lg" />
               <div className="flex flex-row-reverse items-center gap-4">
                  <h2 className="text-4xl font-black text-slate-100 uppercase tracking-tighter [writing-mode:vertical-rl] rotate-180 drop-shadow-md">
                    {homeTeamName}
                  </h2>
               </div>
             </div>
          </div>

          {/* THE GRID */}
          <div className="flex-1">
             <div className="grid grid-cols-11 gap-2">
                
                {/* Corner Spacer */}
                <div className="bg-slate-900/80 rounded-lg border border-slate-700 flex items-center justify-center w-full aspect-square">
                   <span className="text-xs font-mono text-slate-600">QTR</span>
                </div>

                {/* Column Labels */}
                {colLabels.map((num, i) => (
                  <div key={`col-${i}`} className="bg-slate-900/80 rounded-lg border border-red-900/30 flex items-center justify-center w-full aspect-square shadow-lg relative overflow-hidden">
                    {isLocked || isAdmin ? (
                      <span className={`text-3xl font-bold ${isLocked ? 'text-white' : 'text-slate-500'}`}>{num}</span>
                    ) : (
                      <div className="flex items-center justify-center w-full h-full bg-slate-00" title="Numbers revealed when locked">
                        <HelpCircle className="w-6 h-6 text-slate-600" />
                      </div>
                    )}
                  </div>
                ))}

                {/* Rows */}
                {rowLabels.map((rowNum, rIndex) => (
                   <React.Fragment key={`row-${rIndex}`}>
                      {/* Row Label */}
                      <div className="bg-slate-900 rounded-lg border border-blue-900/30 flex items-center justify-center w-full aspect-square shadow-lg relative overflow-hidden">
                         {isLocked || isAdmin ? (
                           <span className={`text-3xl font-bold ${isLocked ? 'text-white' : 'text-slate-500'}`}>{rowNum}</span>
                         ) : (
                           <div className="flex items-center justify-center w-full h-full bg-slate-800" title="Numbers revealed when locked">
                             <HelpCircle className="w-6 h-6 text-slate-600" />
                           </div>
                         )}
                      </div>

                      {/* Cells */}
                      {grid[rIndex].map((cell, cIndex) => {
                         const isPending = cell.status === 'pending';
                         const isApproved = cell.status === 'approved';
                         const hasPlayer = !!cell.player;
                         const squareNumber = (rIndex * 10) + cIndex + 1;

                         return (
                           <button
                             key={`${rIndex}-${cIndex}`}
                             onClick={() => onSquareClick(rIndex, cIndex)}
                             disabled={!isAdmin && !hasPlayer} // Disable click for non-admins on empty squares (view only)
                             className={`
                                w-full aspect-square relative group transition-all duration-200 rounded-lg
                                flex flex-col items-center justify-center p-1 border shadow-sm
                                ${hasPlayer
                                   ? isPending 
                                      ? 'bg-yellow-900/20 border-yellow-700/50 hover:bg-yellow-900/30' 
                                      : 'bg-emerald-900/20 border-emerald-700/50 hover:bg-emerald-900/30'
                                   : 'bg-slate-800 border-slate-700 hover:bg-slate-750 hover:border-slate-500'
                                }
                                ${!isAdmin && !hasPlayer ? 'cursor-default' : 'cursor-pointer'}
                             `}
                           >
                             {hasPlayer ? (
                               <>
                                 <div className="w-full h-full flex items-center justify-center">
                                   <span className={`
                                     text-sm font-semibold text-center break-words leading-tight w-full px-1
                                     ${isPending ? 'text-yellow-200' : 'text-emerald-200'}
                                   `}>
                                     {cell.player}
                                   </span>
                                 </div>
                                 {/* Status Icon Indicator for Admin */}
                                 {isAdmin && isPending && (
                                   <div className="absolute top-1 right-1">
                                      <AlertCircle className="w-3 h-3 text-yellow-500" />
                                   </div>
                                 )}
                                 {isAdmin && isApproved && (
                                   <div className="absolute top-1 right-1 opacity-20">
                                      <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                   </div>
                                 )}
                               </>
                             ) : (
                               <div className="w-full h-full flex items-center justify-center">
                                  <span className="text-3xl font-bold text-slate-700/50 select-none group-hover:text-slate-600 transition-colors">
                                    {squareNumber}
                                  </span>
                               </div>
                             )}
                           </button>
                         );
                      })}
                   </React.Fragment>
                ))}
             </div>
          </div>

        </div>
      </div>
    </div>
  );
};
