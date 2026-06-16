

import React, { useState } from 'react';
import { MagicWandIcon } from './icons';
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
        <div className="flex h-screen w-full bg-gray-900 text-white overflow-hidden">
            {/* Left Side - Visual */}
            <div className="hidden lg:flex w-1/2 relative bg-indigo-900 items-center justify-center overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-indigo-900 via-purple-900 to-black opacity-90 z-10"></div>
                <img
                    src="https://images.unsplash.com/photo-1536240478700-b869070f9279?q=80&w=2000&auto=format&fit=crop"
                    className="absolute inset-0 w-full h-full object-cover mix-blend-overlay"
                    alt="Cinematic Background"
                />
                <div className="relative z-20 p-12 text-center">
                    <div className="inline-flex p-4 bg-white/10 backdrop-blur-md rounded-full mb-6 border border-white/20 shadow-2xl">
                        <MagicWandIcon className="w-16 h-16 text-indigo-400" />
                    </div>
                    <h1 className="text-5xl font-black mb-4 tracking-tighter">
                        AI Video Production
                    </h1>
                    <p className="text-xl text-indigo-200 max-w-md mx-auto leading-relaxed">
                        Standalone Studio Environment. Powered by Gemini 3 & Veo.
                    </p>
                </div>
            </div>

            {/* Right Side - Form */}
            <div className="w-full lg:w-1/2 flex flex-col items-center justify-center p-8 bg-gray-900 relative">
                <div className="w-full max-w-md space-y-8">
                    <div className="text-center lg:text-left">
                        <h2 className="text-3xl font-bold tracking-tight text-white">
                            Initialize Session
                        </h2>
                        <p className="mt-2 text-sm text-gray-400">
                            Enter your name to start the local studio.
                        </p>
                    </div>

                    <form onSubmit={handleStartSession} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-1">Director Name</label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                                placeholder="Your Name"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-4 rounded-lg transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                    Loading Workspace...
                                </>
                            ) : (
                                'Launch Studio'
                            )}
                        </button>
                    </form>
                </div>

                <div className="absolute bottom-6 text-xs text-gray-600">
                    AI Video Production Editor v1.0 &copy; 2025
                </div>
            </div>
        </div>
    );
};

export default AuthScreen;