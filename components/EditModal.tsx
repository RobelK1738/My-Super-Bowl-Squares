import React, { useState, useEffect, useRef } from 'react';
import { SquareStatus } from '../types';

interface EditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
  onDelete: () => void;
  onApprove?: () => void;
  initialName: string | null;
  currentStatus: SquareStatus;
  cellCoords: { row: number; col: number } | null;
  isAdmin: boolean;
}

export const EditModal: React.FC<EditModalProps> = ({ 
  isOpen, 
  onClose, 
  onSave,
  onDelete,
  onApprove,
  initialName,
  currentStatus,
  cellCoords,
  isAdmin
}) => {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName(initialName || '');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, initialName]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(name.trim());
    onClose();
  };

  const isPending = currentStatus === 'pending';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
        <h3 className="text-xl font-bold text-white mb-1">
          {isAdmin ? 'Manage Square' : 'Request Square'}
        </h3>
        <p className="text-slate-400 text-sm mb-6">
          {cellCoords ? `Row ${cellCoords.row}, Column ${cellCoords.col}` : 'Enter player details'}
          {isPending && <span className="ml-2 text-yellow-500 font-bold">(Pending Approval)</span>}
        </p>

        <form onSubmit={handleSubmit}>
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Player Name
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isAdmin && isPending} 
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-all disabled:opacity-50"
              placeholder="e.g. John Doe"
            />
          </div>

          <div className="flex gap-3 justify-end flex-wrap">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-300 hover:text-white transition-colors"
            >
              Cancel
            </button>
            
            {isAdmin && (initialName || isPending) && (
              <button
                type="button"
                onClick={() => { onDelete(); onClose(); }}
                className="px-4 py-2 bg-red-900/50 hover:bg-red-900 text-red-200 border border-red-800 rounded-lg transition-colors"
              >
                {isPending ? 'Deny' : 'Clear Square'}
              </button>
            )}

            {isAdmin && isPending && onApprove && (
              <button
                type="button"
                onClick={() => { onApprove(); onClose(); }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg transition-colors"
              >
                Approve Request
              </button>
            )}

            {(!isPending || isAdmin) && (
               <button
                 type="submit"
                 className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors shadow-lg shadow-blue-900/20"
               >
                 {isAdmin ? 'Save Changes' : 'Submit Request'}
               </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};