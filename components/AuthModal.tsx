import React, { useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "./Button";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogin: (passcode: string) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onLogin,
}) => {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const adminPasscodeEnv = import.meta.env.VITE_ADMIN_PASSCODE;
    if (adminPasscodeEnv && passcode === adminPasscodeEnv) {
      onLogin(passcode);
      onClose();
      setError("");
    } else {
      setError("Unauthorized passcode.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex flex-col items-center mb-6">
          <div className="bg-slate-700 p-3 rounded-full mb-3">
            <Lock className="w-6 h-6 text-emerald-400" />
          </div>
          <h3 className="text-xl font-bold text-white">Admin Login</h3>
          <p className="text-slate-400 text-sm">
            Enter the passcode to manage the board
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Passcode
            </label>
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:border-emerald-500 focus:outline-none"
              placeholder="donteventry"
              autoFocus
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              className="flex-1"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1">
              Login
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
