import React, { useState } from 'react';
import { AudioIcon, MagicWandIcon, MessageIcon, XIcon } from './icons';

interface FloatingActionButtonProps {
  onAssistantClick: () => void;
  onLiveClick: () => void;
  showLiveAction?: boolean;
}

const FloatingActionButton: React.FC<FloatingActionButtonProps> = ({
  onAssistantClick,
  onLiveClick,
  showLiveAction = true,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={`ai-tool-dock ${isOpen ? 'ai-tool-dock--open' : ''}`}>
      <div className="ai-tool-dock__panel">
        {isOpen && (
          <div className="ai-tool-dock__menu" role="menu" aria-label="AI tools">
            <button
              type="button"
              onClick={() => { onAssistantClick(); setIsOpen(false); }}
              className="ai-tool-dock__item"
              title="AI Assistant"
            >
              <MessageIcon className="ai-tool-dock__item-icon" />
              <span>
                <strong>Ask AI</strong>
                <small>Text assistant</small>
              </span>
            </button>
            {showLiveAction && (
              <button
                type="button"
                onClick={() => { onLiveClick(); setIsOpen(false); }}
                className="ai-tool-dock__item"
                title="Live Conversation"
              >
                <AudioIcon className="ai-tool-dock__item-icon" />
                <span>
                  <strong>Live</strong>
                  <small>Voice session</small>
                </span>
              </button>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="ai-tool-dock__trigger"
          aria-label={isOpen ? 'Close AI tools' : 'Open AI tools'}
          aria-expanded={isOpen}
        >
          {isOpen ? <XIcon className="ai-tool-dock__trigger-icon" /> : <MagicWandIcon className="ai-tool-dock__trigger-icon" />}
          <span>
            <strong>AI Tools</strong>
            <small>{isOpen ? 'Close menu' : 'Assistant and live'}</small>
          </span>
        </button>
      </div>
    </div>
  );
};

export default FloatingActionButton;
