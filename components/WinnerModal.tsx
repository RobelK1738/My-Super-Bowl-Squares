import React from "react";
import { Trophy, X } from "lucide-react";
import { GameResult } from "../types";

interface WinnerModalProps {
  isOpen: boolean;
  onClose: () => void;
  result: GameResult | null;
  homeTeam: string;
  awayTeam: string;
}

export const WinnerModal: React.FC<WinnerModalProps> = ({
  isOpen,
  onClose,
  result,
  homeTeam,
  awayTeam,
}) => {
  if (!isOpen || !result) return null;

  const hasWinner = Boolean(result.winnerName);
  const scoreline = `${homeTeam} ${result.homeScore} - ${awayTeam} ${result.awayScore}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-xl rounded-2xl border border-emerald-700/40 bg-slate-900 p-6 shadow-2xl shadow-emerald-950/50">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          aria-label="Close winner announcement"
        >
          <X size={18} />
        </button>

        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-700/50 bg-emerald-900/40 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-200">
          <Trophy size={14} />
          Final Result
        </div>

        <h3 className="text-xl font-black text-white sm:text-2xl">
          {hasWinner ? `Winner: ${result.winnerName}` : "Winning Square Unclaimed"}
        </h3>

        <p className="mt-3 text-slate-200">
          The game ended <span className="font-semibold text-white">{scoreline}</span>
          {hasWinner
            ? "."
            : `, and nobody claimed square #${result.winnerSquareNumber}.`}
        </p>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-700 bg-slate-950/70 p-3">
            <p className="text-xs uppercase tracking-wider text-slate-500">
              Winning Digits
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-100">
              {homeTeam}: {result.homeLastDigit} | {awayTeam}:{" "}
              {result.awayLastDigit}
            </p>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-950/70 p-3">
            <p className="text-xs uppercase tracking-wider text-slate-500">
              Winning Square
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-100">
              #{result.winnerSquareNumber} (row {result.winnerRow + 1}, col{" "}
              {result.winnerCol + 1})
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
