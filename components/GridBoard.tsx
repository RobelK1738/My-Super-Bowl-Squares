import React from "react";
import { AlertCircle, CheckCircle2, HelpCircle, Trophy } from "lucide-react";
import { GridCell } from "../types";
import { getTeamLogo } from "../constants";

interface GridBoardProps {
  rowLabels: number[];
  colLabels: number[];
  grid: GridCell[][];
  onSquareClick: (row: number, col: number) => void;
  homeTeamName: string;
  awayTeamName: string;
  isAdmin: boolean;
  isLocked: boolean;
  winningCell?: { row: number; col: number } | null;
}

export const GridBoard: React.FC<GridBoardProps> = ({
  rowLabels,
  colLabels,
  grid,
  onSquareClick,
  homeTeamName,
  awayTeamName,
  isAdmin,
  isLocked,
  winningCell = null,
}) => {
  const homeLogo = getTeamLogo(homeTeamName);
  const awayLogo = getTeamLogo(awayTeamName);

  const renderSquare = (
    cell: GridCell,
    rIndex: number,
    cIndex: number,
    compact: boolean,
  ) => {
    const isPending = cell.status === "pending";
    const isApproved = cell.status === "approved";
    const hasPlayer = Boolean(cell.player);
    const squareNumber = rIndex * 10 + cIndex + 1;
    const isWinner = winningCell?.row === rIndex && winningCell?.col === cIndex;

    return (
      <button
        key={`${rIndex}-${cIndex}`}
        onClick={() => onSquareClick(rIndex, cIndex)}
        disabled={!isAdmin && !hasPlayer}
        className={`
          w-full aspect-square relative group transition-all duration-200 rounded-lg
          flex flex-col items-center justify-center p-1 border shadow-sm
          ${
            hasPlayer
              ? isPending
                ? "bg-yellow-900/20 border-yellow-700/50 hover:bg-yellow-900/30"
                : "bg-emerald-900/20 border-emerald-700/50 hover:bg-emerald-900/30"
              : "bg-slate-800 border-slate-700 hover:bg-slate-750 hover:border-slate-500"
          }
          ${!isAdmin && !hasPlayer ? "cursor-default" : "cursor-pointer"}
          ${isWinner ? "ring-2 ring-amber-400 ring-offset-1 ring-offset-slate-900" : ""}
        `}
      >
        {hasPlayer ? (
          <>
            <div className="w-full h-full flex items-center justify-center">
              <span
                className={`
                  font-semibold text-center break-words leading-tight w-full px-1
                  ${compact ? "text-[10px]" : "text-sm"}
                  ${isPending ? "text-yellow-200" : "text-emerald-200"}
                `}
              >
                {cell.player}
              </span>
            </div>

            {isAdmin && isPending && (
              <div className="absolute top-1 right-1">
                <AlertCircle className={compact ? "w-2.5 h-2.5 text-yellow-500" : "w-3 h-3 text-yellow-500"} />
              </div>
            )}
            {isAdmin && isApproved && (
              <div className="absolute top-1 right-1 opacity-20">
                <CheckCircle2 className={compact ? "w-2.5 h-2.5 text-emerald-500" : "w-3 h-3 text-emerald-500"} />
              </div>
            )}
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span
              className={`font-bold text-slate-700/50 select-none group-hover:text-slate-600 transition-colors ${
                compact ? "text-lg" : "text-3xl"
              }`}
            >
              {squareNumber}
            </span>
          </div>
        )}

        {isWinner && (
          <div className="pointer-events-none absolute left-1 top-1 rounded-full bg-amber-400/90 p-0.5 text-slate-950">
            <Trophy className={compact ? "h-2.5 w-2.5" : "h-3 w-3"} />
          </div>
        )}
      </button>
    );
  };

  return (
    <div className="w-full">
      {/* Mobile / Small screens */}
      <div className="md:hidden w-full overflow-x-auto grid-scroll pb-4">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 p-2 flex items-center gap-2">
              <img
                src={homeLogo}
                alt={homeTeamName}
                className="h-8 w-8 object-contain"
              />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Rows</div>
                <div className="text-xs font-bold text-slate-200 uppercase">{homeTeamName}</div>
              </div>
            </div>
            <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 p-2 flex items-center gap-2">
              <img
                src={awayLogo}
                alt={awayTeamName}
                className="h-8 w-8 object-contain"
              />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Columns</div>
                <div className="text-xs font-bold text-slate-200 uppercase">{awayTeamName}</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-11 gap-1.5">
            <div className="bg-slate-900/80 rounded-lg border border-slate-700 flex items-center justify-center w-full aspect-square">
              <span className="text-[10px] font-mono text-slate-600">QTR</span>
            </div>

            {colLabels.map((num, i) => (
              <div
                key={`mobile-col-${i}`}
                className="bg-slate-900/80 rounded-lg border border-red-900/30 flex items-center justify-center w-full aspect-square shadow-lg"
              >
                {isLocked || isAdmin ? (
                  <span className={`text-xl font-bold ${isLocked ? "text-white" : "text-slate-500"}`}>
                    {num}
                  </span>
                ) : (
                  <div
                    className="flex items-center justify-center w-full h-full"
                    title="Numbers revealed when locked"
                  >
                    <HelpCircle className="w-4 h-4 text-slate-600" />
                  </div>
                )}
              </div>
            ))}

            {rowLabels.map((rowNum, rIndex) => (
              <React.Fragment key={`mobile-row-${rIndex}`}>
                <div className="bg-slate-900 rounded-lg border border-blue-900/30 flex items-center justify-center w-full aspect-square shadow-lg">
                  {isLocked || isAdmin ? (
                    <span className={`text-xl font-bold ${isLocked ? "text-white" : "text-slate-500"}`}>
                      {rowNum}
                    </span>
                  ) : (
                    <div
                      className="flex items-center justify-center w-full h-full"
                      title="Numbers revealed when locked"
                    >
                      <HelpCircle className="w-4 h-4 text-slate-600" />
                    </div>
                  )}
                </div>

                {grid[rIndex].map((cell, cIndex) =>
                  renderSquare(cell, rIndex, cIndex, true),
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* Desktop / Larger screens */}
      <div className="hidden md:block w-full overflow-x-auto grid-scroll pb-4">
        <div className="min-w-[1000px] flex flex-col">
          {/* AWAY TEAM HEADER (Horizontal) */}
          <div className="flex mb-4">
            <div className="w-[180px] shrink-0" />
            <div className="flex-1 flex flex-col items-center justify-center bg-slate-800/50 rounded-xl border border-slate-700/50 p-4 mb-2 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-b from-red-900/10 to-transparent pointer-events-none" />
              <img
                src={awayLogo}
                alt={awayTeamName}
                className="h-16 w-16 object-contain mb-2 drop-shadow-lg"
              />
              <h2 className="text-4xl font-black text-slate-100 uppercase tracking-tighter drop-shadow-md">
                {awayTeamName}
              </h2>
            </div>
          </div>

          <div className="flex">
            {/* HOME TEAM HEADER (Vertical) */}
            <div className="w-[180px] shrink-0 flex flex-col items-center justify-center bg-slate-800/50 rounded-xl border border-slate-700/50 p-4 mr-4 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-blue-900/10 to-transparent pointer-events-none" />
              <div className="flex flex-col items-center sticky top-4">
                <img
                  src={homeLogo}
                  alt={homeTeamName}
                  className="h-16 w-16 object-contain mb-6 drop-shadow-lg"
                />
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
                <div className="bg-slate-900/80 rounded-lg border border-slate-700 flex items-center justify-center w-full aspect-square">
                  <span className="text-xs font-mono text-slate-600">QTR</span>
                </div>

                {colLabels.map((num, i) => (
                  <div
                    key={`desktop-col-${i}`}
                    className="bg-slate-900/80 rounded-lg border border-red-900/30 flex items-center justify-center w-full aspect-square shadow-lg relative overflow-hidden"
                  >
                    {isLocked || isAdmin ? (
                      <span className={`text-3xl font-bold ${isLocked ? "text-white" : "text-slate-500"}`}>
                        {num}
                      </span>
                    ) : (
                      <div
                        className="flex items-center justify-center w-full h-full"
                        title="Numbers revealed when locked"
                      >
                        <HelpCircle className="w-6 h-6 text-slate-600" />
                      </div>
                    )}
                  </div>
                ))}

                {rowLabels.map((rowNum, rIndex) => (
                  <React.Fragment key={`desktop-row-${rIndex}`}>
                    <div className="bg-slate-900 rounded-lg border border-blue-900/30 flex items-center justify-center w-full aspect-square shadow-lg relative overflow-hidden">
                      {isLocked || isAdmin ? (
                        <span className={`text-3xl font-bold ${isLocked ? "text-white" : "text-slate-500"}`}>
                          {rowNum}
                        </span>
                      ) : (
                        <div
                          className="flex items-center justify-center w-full h-full"
                          title="Numbers revealed when locked"
                        >
                          <HelpCircle className="w-6 h-6 text-slate-600" />
                        </div>
                      )}
                    </div>

                    {grid[rIndex].map((cell, cIndex) =>
                      renderSquare(cell, rIndex, cIndex, false),
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
