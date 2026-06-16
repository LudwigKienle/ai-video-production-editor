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
      <div className="app-modal w-full max-w-md flex flex-col overflow-hidden">
        <header className="flex justify-between items-center p-6 app-modal-header">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-sky-500/20 rounded-lg">
              <InfoIcon className="w-6 h-6 text-sky-300" />
            </div>
            <div>
              <h2 className="text-xl font-bold">About Software</h2>
              <p className="text-xs app-muted">AI Video Production Editor</p>
            </div>
          </div>
          <button onClick={onClose} className="app-muted hover:text-white">
            &times;
          </button>
        </header>

        <div className="p-6 space-y-6">
          <div className="app-card p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-bold app-muted uppercase">Version</span>
              <span className="text-sm font-mono bg-black/20 px-2 py-1 rounded">v1.0.0 (Retail)</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold app-muted uppercase">License</span>
              <span className="text-sm text-emerald-300 font-bold flex items-center gap-1">
                <CheckCircleIcon className="w-4 h-4" /> Activated
              </span>
            </div>
          </div>

          <div className="bg-sky-500/10 rounded-lg p-4 border border-sky-400/30">
            <h3 className="text-sm font-bold mb-2 flex items-center gap-2">
              <DownloadIcon className="w-4 h-4 text-sky-300" /> Updates
            </h3>
            <p className="text-xs app-muted mb-4">
              Check for the latest features and bug fixes on the official product page.
            </p>
            <a
              href="https://gumroad.com"
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full app-button app-primary text-center text-xs"
            >
              Check for Updates
            </a>
          </div>

          <div className="flex items-center gap-3 pt-4 border-t app-divider">
            <UserCircleIcon className="w-8 h-8 text-gray-500" />
            <div>
              <p className="text-sm font-bold">Registered to</p>
              <p className="text-xs app-muted">
                {user.name} ({user.email})
              </p>
            </div>
          </div>
        </div>

        <div className="bg-black/20 p-4 text-center text-[10px] app-muted">
          &copy; 2025 AI Video Production Editor. All rights reserved.
        </div>
      </div>
    </div>
  );
};

export default AboutModal;
