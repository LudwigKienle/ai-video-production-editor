


import React from 'react';
import { TransitionType } from '../types';
import { TRANSITIONS } from '../constants';
import { MagicWandIcon } from './icons';

interface TransitionsPanelProps {
  onApplyTransition: (transitionType: TransitionType) => void;
  disabled: boolean;
}

const TransitionsPanel: React.FC<TransitionsPanelProps> = ({ onApplyTransition, disabled }) => {

  const handleTransitionClick = (transition: TransitionType) => {
    if (disabled) return;
    onApplyTransition(transition);
  };

  return (
    <div className="bg-gray-800/50 p-4 flex flex-col h-full">
      <h3 className="text-lg font-semibold mb-4 text-white">Transitions Library</h3>
      <div className="flex-grow overflow-y-auto pr-2 -mr-2 space-y-2">
        {TRANSITIONS.map(transition => (
          <div
            key={transition.id}
            onClick={() => handleTransitionClick(transition.id)}
            className={`p-3 rounded-lg border-2 transition-all duration-200 ${
              disabled
                ? 'bg-gray-800 border-gray-700 text-gray-600 cursor-not-allowed'
                : 'bg-gray-900/50 border-gray-700 hover:border-indigo-500 hover:bg-gray-800 cursor-pointer'
            }`}
          >
            <div className="flex items-center gap-3">
              <MagicWandIcon className="w-5 h-5 text-indigo-400 flex-shrink-0" />
              <div className="flex-grow">
                <p className="font-semibold text-white">{transition.name}</p>
                <p className="text-sm text-gray-400">Default duration: {transition.duration}s</p>
              </div>
            </div>
          </div>
        ))}
        {disabled && <p className="text-xs text-center text-gray-500 mt-4">Select a clip on the timeline to apply a transition.</p>}
      </div>
    </div>
  );
};

export default TransitionsPanel;