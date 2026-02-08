import React, { useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";
import { SquareStatus } from "../types";

interface SquareDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  squareNumber: number | null;
  playerName: string | null;
  rowDigit: number | null;
  colDigit: number | null;
  homeTeamName: string;
  awayTeamName: string;
  winPercentage: number | null;
  areDigitsRevealed: boolean;
  areOddsVisible: boolean;
  cellStatus: SquareStatus;
  isAdmin: boolean;
  onManageSquare?: () => void;
}

const getStatusLabel = (status: SquareStatus): string => {
  if (status === "approved") return "Approved";
  if (status === "pending") return "Pending";
  return "Empty";
};

export const SquareDetailsModal: React.FC<SquareDetailsModalProps> = ({
  isOpen,
  onClose,
  squareNumber,
  playerName,
  rowDigit,
  colDigit,
  homeTeamName,
  awayTeamName,
  winPercentage,
  areDigitsRevealed,
  areOddsVisible,
  cellStatus,
  isAdmin,
  onManageSquare,
}) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const playerLabel = playerName?.trim() ? playerName.trim() : "Unclaimed";
  const homeDigitLabel =
    areDigitsRevealed && rowDigit !== null ? String(rowDigit) : "?";
  const awayDigitLabel =
    areDigitsRevealed && colDigit !== null ? String(colDigit) : "?";
  const oddsLabel = areOddsVisible
    ? typeof winPercentage === "number" && Number.isFinite(winPercentage)
      ? `${winPercentage.toFixed(2)}%`
      : "--"
    : "Hidden after final score";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-500">
              Square Details
            </p>
            <h3 className="text-xl font-bold text-white mt-1">
              {squareNumber ? `Square #${squareNumber}` : "Square"}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-slate-300 hover:text-white hover:border-slate-500 transition-colors"
            aria-label="Close square details"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3">
          <div className="rounded-lg border border-slate-700/80 bg-slate-950/80 p-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">
              Player
            </p>
            <p className="mt-1 text-base font-semibold text-white break-words">
              {playerLabel}
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              Status: {getStatusLabel(cellStatus)}
            </p>
          </div>

          <div className="rounded-lg border border-slate-700/80 bg-slate-950/80 p-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">
              Digits Pair
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded border border-slate-700 bg-slate-900 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">
                  {homeTeamName}
                </p>
                <p className="text-lg font-bold text-white">{homeDigitLabel}</p>
              </div>
              <div className="rounded border border-slate-700 bg-slate-900 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">
                  {awayTeamName}
                </p>
                <p className="text-lg font-bold text-white">{awayDigitLabel}</p>
              </div>
            </div>
            {!areDigitsRevealed && (
              <p className="mt-2 text-[11px] text-slate-400">
                Digits reveal once the board is locked.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-slate-700/80 bg-slate-950/80 p-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">
              Current Win Probability
            </p>
            <p className="mt-1 text-2xl font-black text-emerald-300">{oddsLabel}</p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {isAdmin && onManageSquare && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                onManageSquare();
                onClose();
              }}
            >
              Manage Square
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};
