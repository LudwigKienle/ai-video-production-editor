import React, { useState } from 'react';
import { MagicWandIcon, AudioIcon } from './icons';

interface FloatingActionButtonProps {
  onAssistantClick: () => void;
  onLiveClick: () => void;
}

const FloatingActionButton: React.FC<FloatingActionButtonProps> = ({ onAssistantClick, onLiveClick }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <div className="relative flex flex-col items-center gap-2">
        {isOpen && (
          <>
            <button
              onClick={() => { onAssistantClick(); setIsOpen(false); }}
              className="w-32 bg-indigo-600 text-white p-2 rounded-lg shadow-lg hover:bg-indigo-500 transition-all flex items-center justify-center gap-2"
              title="AI Assistant"
            >
              Assistant
            </button>
            <button
              onClick={() => { onLiveClick(); setIsOpen(false); }}
              className="w-32 bg-purple-600 text-white p-2 rounded-lg shadow-lg hover:bg-purple-500 transition-all flex items-center justify-center gap-2"
              title="Live Conversation"
            >
              Live Chat
            </button>
          </>
        )}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="bg-indigo-500 text-white w-16 h-16 rounded-full flex items-center justify-center shadow-2xl hover:bg-indigo-400 transition-transform transform hover:scale-110 focus:outline-none focus:ring-4 focus:ring-indigo-500/50"
          aria-label="Toggle AI Tools"
        >
          <MagicWandIcon className="w-8 h-8" />
        </button>
      </div>
    </div>
  );
};

export default FloatingActionButton;
