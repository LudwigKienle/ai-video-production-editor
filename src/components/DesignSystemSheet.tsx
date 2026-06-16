import React from 'react';
import { Theme } from '../types';

interface DesignSystemSheetProps {
  isOpen: boolean;
  onClose: () => void;
  theme?: Theme;
  onSelectTheme?: (theme: Theme) => void;
}

const DesignSystemSheet: React.FC<DesignSystemSheetProps> = ({ isOpen, onClose, theme = 'dark', onSelectTheme }) => {
  if (!isOpen) return null;

  const themeOptions: Array<{ id: Theme; label: string }> = [
    { id: 'dark', label: 'Dark' },
    { id: 'light', label: 'Light' },
    { id: 'fantasy', label: 'Fantasy' },
    { id: 'cyberpunk', label: 'Neon Racer' },
    { id: 'studio', label: 'Studio' },
    { id: 'cinematic', label: 'Cinematic Indigo' },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[90]">
      <div className="app-modal w-full max-w-4xl p-6">
        <header className="flex items-start justify-between gap-4 pb-4 app-modal-header">
          <div>
            <p className="app-menu-title">Design System</p>
            <h2 className="text-2xl font-semibold">Studio UI Utility Sheet</h2>
            <p className="text-sm app-muted mt-1">Reusable buttons, inputs, cards, and badges.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex flex-wrap gap-2">
              {themeOptions.map((option) => (
                <button
                  key={option.id}
                  onClick={() => onSelectTheme?.(option.id)}
                  className={`app-button ${theme === option.id ? 'app-primary' : 'app-secondary'} text-xs`}
                  aria-pressed={theme === option.id}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button onClick={onClose} className="app-button app-secondary">Close</button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          <section className="app-card p-4 space-y-4">
            <div>
              <p className="app-menu-title">Buttons</p>
              <div className="flex flex-wrap gap-3 mt-3">
                <button className="app-button app-primary">Primary Action</button>
                <button className="app-button app-secondary">Secondary</button>
                <button className="app-button">Ghost</button>
                <button className="app-icon-button p-2" aria-label="Icon button">★</button>
              </div>
            </div>
            <div>
              <p className="app-menu-title">Badges</p>
              <div className="flex flex-wrap gap-3 mt-3 items-center">
                <span className="app-badge">Studio</span>
                <span className="app-pill">Draft</span>
                <span className="app-pill app-pill--success">Ready</span>
                <span className="app-pill app-pill--warning">Review</span>
                <span className="app-pill app-pill--danger">Blocked</span>
              </div>
            </div>
          </section>

          <section className="app-card p-4 space-y-4">
            <div>
              <p className="app-menu-title">Inputs</p>
              <div className="space-y-3 mt-3">
                <input className="app-input" placeholder="Project title" />
                <textarea className="app-textarea" rows={3} placeholder="Short description" />
                <select className="app-select">
                  <option>Camera Preset</option>
                  <option>Orbit</option>
                  <option>Dolly In</option>
                </select>
                <input className="app-input-file" type="file" />
              </div>
            </div>
          </section>

          <section className="app-card p-4 space-y-4 lg:col-span-2">
            <p className="app-menu-title">Cards & Panels</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
              <div className="app-panel p-4">
                <h3 className="text-sm font-semibold">Panel</h3>
                <p className="text-xs app-muted mt-2">Use for dense configuration areas.</p>
                <button className="app-button app-secondary mt-3">Configure</button>
              </div>
              <div className="app-card p-4">
                <h3 className="text-sm font-semibold">Card</h3>
                <p className="text-xs app-muted mt-2">Use for content previews and summaries.</p>
                <div className="flex gap-2 mt-3">
                  <span className="app-pill">Angle Set</span>
                  <span className="app-pill app-pill--success">Ready</span>
                </div>
              </div>
              <div className="app-panel p-4">
                <h3 className="text-sm font-semibold">Status Panel</h3>
                <p className="text-xs app-muted mt-2">Highlight progress and milestones.</p>
                <div className="flex items-center gap-2 mt-3">
                  <span className="app-badge">Live</span>
                  <span className="text-xs app-muted">Saving in background</span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default DesignSystemSheet;
