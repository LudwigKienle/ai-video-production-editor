
import React, { useState } from 'react';
import { AppLogoIcon, MagicWandIcon } from './icons';
import { User } from '../types';

interface AuthScreenProps {
    onLogin: (user: User) => void;
}

const AuthScreen: React.FC<AuthScreenProps> = ({ onLogin }) => {
    const [name, setName] = useState('');
    const [loading, setLoading] = useState(false);

    const handleStartSession = (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        // Simulate startup delay
        setTimeout(() => {
            const mockUser: User = {
                id: `user-${Date.now()}`,
                name: name || 'Director',
                email: 'local-session',
                plan: 'pro'
            };
            onLogin(mockUser);
            setLoading(false);
        }, 800);
    };

    return (
        <div className="auth-screen app-shell flex h-screen w-full text-white overflow-hidden">
            <div className="auth-screen__visual hidden lg:flex w-[52%] relative items-center justify-center overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-slate-950/85 via-slate-950/60 to-black/80 z-10"></div>
                <img
                    src="https://images.unsplash.com/photo-1536240478700-b869070f9279?q=80&w=2000&auto=format&fit=crop"
                    className="absolute inset-0 w-full h-full object-cover mix-blend-overlay"
                    alt="Cinematic Background"
                />
                <div className="relative z-20 w-full max-w-xl p-12">
                    <div className="inline-flex items-center gap-3 rounded-lg border border-white/10 bg-white/10 px-3 py-2 backdrop-blur-md">
                        <AppLogoIcon className="w-6 h-6 text-sky-200" />
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-200">Desktop Studio</span>
                    </div>
                    <h1 className="mt-8 text-5xl font-semibold leading-tight">
                        AI Video Production
                    </h1>
                    <p className="mt-4 max-w-md text-base leading-7 text-slate-200">
                        Lokale Projektordner, Timeline, Generierung und Review in einer ruhigen Desktop-Oberfläche.
                    </p>
                    <div className="mt-8 grid max-w-md grid-cols-3 gap-3 text-xs text-slate-200">
                        <div className="auth-screen__metric">
                            <span>Local</span>
                            <strong>Files</strong>
                        </div>
                        <div className="auth-screen__metric">
                            <span>AI</span>
                            <strong>Tools</strong>
                        </div>
                        <div className="auth-screen__metric">
                            <span>Pro</span>
                            <strong>Timeline</strong>
                        </div>
                    </div>
                </div>
            </div>

            <div className="auth-screen__form w-full lg:w-[48%] flex flex-col items-center justify-center p-8 relative">
                <div className="w-full max-w-md auth-screen__card">
                    <div className="mb-8 flex items-center gap-3 lg:hidden">
                        <div className="app-logo-mark">
                            <AppLogoIcon className="w-6 h-6 app-logo" />
                        </div>
                        <div>
                            <p className="header-brand__eyebrow">Desktop Studio</p>
                            <h1 className="text-lg font-semibold">AI Video Production</h1>
                        </div>
                    </div>
                    <div className="text-left">
                        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-sky-300/20 bg-sky-300/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-100">
                            <MagicWandIcon className="h-3.5 w-3.5" />
                            Local Session
                        </div>
                        <h2 className="text-3xl font-semibold text-white">
                            Enter Studio
                        </h2>
                        <p className="mt-2 text-sm text-gray-400">
                            Starte eine lokale Electron-Session für deine Produktion.
                        </p>
                    </div>

                    <form onSubmit={handleStartSession} className="mt-8 space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-1">Director Name</label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="app-input"
                                placeholder="Your Name"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="app-button app-primary w-full justify-center py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? (
                                <>
                                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                    Initializing...
                                </>
                            ) : (
                                'Start Creating'
                            )}
                        </button>
                    </form>
                </div>

                <div className="absolute bottom-6 text-xs text-gray-600">
                    AI Video Production Editor &copy; 2026
                </div>
            </div>
        </div>
    );
};

export default AuthScreen;
