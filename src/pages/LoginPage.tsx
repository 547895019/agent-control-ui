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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 flex items-center justify-center p-4">
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: 'linear-gradient(rgba(99,102,241,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.3) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600 shadow-lg shadow-indigo-900/50 mb-4 text-3xl">
            🦞
          </div>
          <h1 className="text-2xl font-bold text-white">OpenClaw</h1>
          <p className="text-slate-400 text-sm mt-1">Control Panel</p>
        </div>

        {/* Card */}
        <div className="bg-slate-800/80 backdrop-blur border border-slate-700/50 rounded-2xl p-6 shadow-xl">
          <h2 className="text-white font-semibold text-lg mb-1">Connect to Gateway</h2>
          <p className="text-slate-400 text-sm mb-6">Enter your operator token to continue</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Gateway Token
              </label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="password"
                  className="w-full bg-slate-900/80 border border-slate-700 text-white placeholder-slate-500 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                  value={inputToken}
                  onChange={e => setInputToken(e.target.value)}
                  placeholder="Enter operator token"
                  autoComplete="current-password"
                  autoFocus
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-900/30 border border-red-800/50 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-red-300 text-xs leading-relaxed">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isConnecting || !inputToken.trim()}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 disabled:cursor-not-allowed text-white font-medium rounded-lg py-2.5 text-sm transition-colors"
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

          <p className="text-slate-600 text-xs text-center mt-4">
            ws://127.0.0.1:18789
          </p>
        </div>
      </div>
    </div>
  );
}
