import React from 'react';
import { User } from '../types';
import { CheckCircleIcon, UserCircleIcon, InfoIcon, DownloadIcon } from './icons';

interface AboutModalProps {
    user: User;
    onClose: () => void;
}

const AboutModal: React.FC<AboutModalProps> = ({ user, onClose }) => {
    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[80]">
            <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden">
                <header className="flex justify-between items-center p-6 border-b border-gray-800">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-500/20 rounded-lg">
                            <InfoIcon className="w-6 h-6 text-indigo-400" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white">About Software</h2>
                            <p className="text-xs text-gray-400">AI Video Production Editor</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">&times;</button>
                </header>

                <div className="p-6 space-y-6">
                    {/* Version Info */}
                    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-sm font-bold text-gray-400 uppercase">Version</span>
                            <span className="text-sm text-white font-mono bg-gray-900 px-2 py-1 rounded">v1.0.0 (Retail)</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm font-bold text-gray-400 uppercase">License</span>
                            <span className="text-sm text-green-400 font-bold flex items-center gap-1"><CheckCircleIcon className="w-4 h-4"/> Activated</span>
                        </div>
                    </div>

                    {/* Updates */}
                    <div className="bg-indigo-900/20 rounded-lg p-4 border border-indigo-500/30">
                        <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                            <DownloadIcon className="w-4 h-4 text-indigo-400"/> Updates
                        </h3>
                        <p className="text-xs text-gray-400 mb-4">
                            Check for the latest features and bug fixes on the official product page.
                        </p>
                        <a
                            href="https://gumroad.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block w-full bg-indigo-600 hover:bg-indigo-500 text-white text-center font-bold py-2 rounded-lg text-xs transition-colors"
                        >
                            Check for Updates
                        </a>
                    </div>

                    {/* User Info */}
                    <div className="flex items-center gap-3 pt-4 border-t border-gray-800">
                        <UserCircleIcon className="w-8 h-8 text-gray-600"/>
                        <div>
                            <p className="text-sm font-bold text-white">Registered to</p>
                            <p className="text-xs text-gray-400">{user.name} ({user.email})</p>
                        </div>
                    </div>
                </div>

                <div className="bg-gray-950 p-4 text-center text-[10px] text-gray-600">
                    &copy; 2025 AI Video Production Editor. All rights reserved.
                </div>
            </div>
        </div>
    );
};

export default AboutModal;