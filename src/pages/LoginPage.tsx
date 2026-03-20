import React, { useState } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { Loader2, KeyRound, AlertCircle } from 'lucide-react';

export function LoginPage() {
  const [inputToken, setInputToken] = useState('');
  const { setToken, connect, connectionStatus } = useAppStore();
  const [error, setError] = useState('');

  const isConnecting = connectionStatus === 'connecting';

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputToken.trim()) return;
    setError('');
    setToken(inputToken.trim());
    try {
      await connect();
    } catch {
      setError('Connection failed. Please check your token and ensure the gateway is running.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #3730a3 30%, #4f46e5 60%, #0369a1 85%, #164e63 100%)' }}>
      {/* Glow orbs */}
      <div className="pointer-events-none">
        <div className="orb w-[700px] h-[700px] -top-64 -right-48" style={{ background: 'rgba(99,102,241,0.45)' }} />
        <div className="orb w-[500px] h-[500px] bottom-0 -left-32" style={{ background: 'rgba(37,99,235,0.35)' }} />
        <div className="orb w-[350px] h-[350px] top-1/3 right-1/4" style={{ background: 'rgba(6,182,212,0.28)' }} />
        <div className="orb w-[250px] h-[250px] bottom-1/4 left-1/3" style={{ background: 'rgba(14,165,233,0.20)' }} />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600/80 backdrop-blur-sm shadow-lg shadow-indigo-900/50 mb-4 text-3xl border border-indigo-400/20">
            🦞
          </div>
          <h1 className="text-2xl font-bold gradient-text tracking-tight">OpenClaw</h1>
          <p className="text-white/40 text-sm mt-1 tracking-wide uppercase font-light">Control Panel</p>
        </div>

        {/* Card */}
        <div className="glass-heavy glass-shine rounded-2xl p-6 shadow-2xl shadow-black/50 ring-1 ring-white/10">
          <h2 className="text-white font-semibold text-lg mb-1">Connect to Gateway</h2>
          <p className="text-white/50 text-sm mb-6">Enter your operator token to continue</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-white/70 mb-1.5">
                Gateway Token
              </label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <input
                  type="password"
                  className="glass-input w-full rounded-xl pl-10 pr-4 py-2.5 text-sm"
                  value={inputToken}
                  onChange={e => setInputToken(e.target.value)}
                  placeholder="Enter operator token"
                  autoComplete="current-password"
                  autoFocus
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-500/15 border border-red-400/25 rounded-lg backdrop-blur-sm">
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-red-300 text-xs leading-relaxed">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isConnecting || !inputToken.trim()}
              className="w-full flex items-center justify-center gap-2 btn-primary text-white font-medium rounded-xl py-2.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                'Connect'
              )}
            </button>
          </form>

          <p className="text-white/20 text-xs text-center mt-4">
            ws://127.0.0.1:18789
          </p>
        </div>
      </div>
    </div>
  );
}
