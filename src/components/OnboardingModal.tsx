import React, { useEffect, useMemo, useState } from 'react';
import { StudioAgentApprovalMode, StudioAgentControlMode, Theme, Workspace } from '../types';
import { MagicWandIcon } from './icons';
import { UIMode } from '../config/uiModes';

type StartupPreferences = {
  startupWorkspace: Workspace;
  autoOpenAssistant: boolean;
  studioAgentMode: StudioAgentControlMode;
  studioAgentApprovalMode: StudioAgentApprovalMode;
};

interface OnboardingModalProps {
  isOpen: boolean;
  theme: Theme;
  onSelectTheme: (theme: Theme) => void;
  startupPreferences: StartupPreferences;
  onUpdateStartupPreferences: (next: StartupPreferences) => void;
  hasAnyApiKey: boolean;
  onOpenApiSettings: () => void;
  onOpenAssistant: () => void;
  onNavigateWorkspace: (workspace: Workspace) => void;
  onComplete: (markCompleted: boolean) => void;
  uiMode?: UIMode;
  onSelectUIMode?: (mode: UIMode) => void;
}

const THEME_OPTIONS: Array<{ id: Theme; label: string }> = [
  { id: 'dark', label: '🌑 Dark' },
  { id: 'light', label: '☀️ Light' },
  { id: 'cinematic', label: '🎬 Cinematic' },
  { id: 'cyberpunk', label: '⚡ Neon' },
  { id: 'fantasy', label: '🌿 Fantasy' },
  { id: 'studio', label: '🏢 Studio' },
];

const MODE_CARDS: Array<{
  id: UIMode;
  emoji: string;
  title: string;
  subtitle: string;
  bullets: string[];
}> = [
  {
    id: 'beginner',
    emoji: '🎬',
    title: 'Just getting started',
    subtitle: 'Simple & guided',
    bullets: [
      'Create images & videos with AI',
      'Simple timeline editor',
      'AI assistant guides you',
    ],
  },
  {
    id: 'pro',
    emoji: '⚡',
    title: "I'm a filmmaker / editor",
    subtitle: 'Full studio suite',
    bullets: [
      'All generation tools',
      'Advanced node workflows',
      'Full production pipeline',
    ],
  },
];

const BEGINNER_TOOLS: Array<{ emoji: string; label: string; description: string }> = [
  { emoji: '🖼️', label: 'Create Images', description: 'Turn text descriptions into cinematic images.' },
  { emoji: '🎥', label: 'Create Videos', description: 'Animate your images into short video clips.' },
  { emoji: '✂️', label: 'Edit Timeline', description: 'Arrange your clips and add music.' },
  { emoji: '🎵', label: 'Add Sound', description: 'Generate or upload background audio.' },
  { emoji: '📤', label: 'Export', description: 'Download your finished video.' },
];

const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  theme,
  onSelectTheme,
  startupPreferences,
  onUpdateStartupPreferences,
  hasAnyApiKey,
  onOpenApiSettings,
  onOpenAssistant,
  onNavigateWorkspace,
  onComplete,
  uiMode = 'beginner',
  onSelectUIMode,
}) => {
  const [step, setStep] = useState(0);
  const [markCompleted, setMarkCompleted] = useState(true);
  const [selectedMode, setSelectedMode] = useState<UIMode>(uiMode);
  const totalSteps = 4;

  const canBack = step > 0;
  const isLast = step === totalSteps - 1;

  const stepTitle = useMemo(() => {
    switch (step) {
      case 0: return 'Your Experience';
      case 1: return 'Your Look';
      case 2: return 'Connect AI';
      case 3: return "You're Ready!";
      default: return 'Welcome';
    }
  }, [step]);

  const next = () => setStep((prev) => Math.min(totalSteps - 1, prev + 1));
  const back = () => setStep((prev) => Math.max(0, prev - 1));

  const handleSelectMode = (mode: UIMode) => {
    setSelectedMode(mode);
    onSelectUIMode?.(mode);
  };

  useEffect(() => {
    if (isOpen) {
      setStep(0);
      setSelectedMode(uiMode);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="app-modal w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center gap-3 p-6 pb-0">
          <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-400/30 flex-shrink-0">
            <MagicWandIcon className="w-7 h-7 text-indigo-300" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold">Welcome to AI Video Production Editor</h2>
            <p className="text-xs app-muted mt-0.5">
              Step {step + 1} of {totalSteps} · {stepTitle}
            </p>
          </div>
          <button
            type="button"
            className="app-button app-secondary text-xs flex-shrink-0"
            onClick={() => onComplete(markCompleted)}
          >
            Skip
          </button>
        </div>

        {/* Progress bar */}
        <div className="mx-6 mt-4 h-1 rounded-full bg-gray-700/60">
          <div
            className="h-full rounded-full bg-indigo-500 transition-all duration-500"
            style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
          />
        </div>

        <div className="p-6 pt-5">
          {/* Step 0: Mode Selection */}
          {step === 0 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-300">
                How do you want to use this app? You can change this anytime in the header.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {MODE_CARDS.map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => handleSelectMode(card.id)}
                    className={`text-left p-5 rounded-xl border-2 transition-all duration-200 ${
                      selectedMode === card.id
                        ? 'border-indigo-400 bg-indigo-500/15 shadow-lg shadow-indigo-500/10'
                        : 'border-gray-700 bg-gray-800/40 hover:border-gray-500 hover:bg-gray-800/70'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-3xl leading-none mt-0.5">{card.emoji}</span>
                      <div>
                        <div className="font-semibold text-white text-sm">{card.title}</div>
                        <div className={`text-[11px] mt-0.5 ${selectedMode === card.id ? 'text-indigo-300' : 'app-muted'}`}>
                          {card.subtitle}
                        </div>
                        <ul className="mt-2 space-y-1">
                          {card.bullets.map((bullet) => (
                            <li key={bullet} className="text-xs app-muted flex items-center gap-1.5">
                              <span className="text-indigo-400">✓</span> {bullet}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    {selectedMode === card.id && (
                      <div className="mt-3 text-[10px] text-indigo-300 font-semibold uppercase tracking-wider">
                        ✓ Selected
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 1: Theme */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-300">Pick a visual style for your studio. You can change it anytime.</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {THEME_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => onSelectTheme(option.id)}
                    className={`p-3 rounded-xl border-2 text-sm font-medium transition-all ${
                      theme === option.id
                        ? 'border-indigo-400 bg-indigo-500/15 text-white'
                        : 'border-gray-700 bg-gray-800/40 text-gray-400 hover:border-gray-500 hover:text-gray-200'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: API Key */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-300">
                This app uses AI providers to generate images and videos. To get started, you only need one key.
              </p>

              {/* Primary recommendation */}
              <div className="app-card p-4 border-indigo-500/30 bg-indigo-500/5">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">🔑</span>
                  <div className="flex-1">
                    <div className="font-semibold text-white text-sm">Start with Google Gemini (free)</div>
                    <p className="text-xs app-muted mt-1">
                      Powers the AI assistant and basic generation. Get your key in seconds.
                    </p>
                    <a
                      href="https://aistudio.google.com/app/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block mt-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors"
                    >
                      Get Gemini Key (free) →
                    </a>
                  </div>
                </div>
              </div>

              {/* Status & settings link */}
              <div className="flex items-center justify-between">
                <span className={`text-xs font-medium ${hasAnyApiKey ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {hasAnyApiKey ? '✓ API key detected — you\'re connected!' : '○ No key yet — add one to unlock generation'}
                </span>
                <button type="button" className="text-xs app-muted hover:text-white underline underline-offset-2" onClick={onOpenApiSettings}>
                  All providers →
                </button>
              </div>

              {selectedMode === 'pro' && (
                <div className="app-card p-3">
                  <p className="text-xs app-muted">
                    <strong className="text-gray-300">Pro tip:</strong> Add Replicate or FAL for advanced video generation. You can connect them in Settings → API Keys anytime.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Ready */}
          {step === 3 && (
            <div className="space-y-5">
              <div className="text-center py-2">
                <div className="text-5xl mb-3">🚀</div>
                <h3 className="text-lg font-bold text-white">You're all set!</h3>
                <p className="text-sm app-muted mt-1">
                  {selectedMode === 'beginner'
                    ? 'Here\'s what you can do in Simple Mode:'
                    : 'Here\'s a quick overview of the studio:'}
                </p>
              </div>

              {selectedMode === 'beginner' ? (
                <div className="grid grid-cols-1 gap-2">
                  {BEGINNER_TOOLS.map((tool) => (
                    <div key={tool.label} className="app-card p-3 flex items-center gap-3">
                      <span className="text-xl">{tool.emoji}</span>
                      <div>
                        <div className="text-sm font-semibold text-white">{tool.label}</div>
                        <div className="text-xs app-muted">{tool.description}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="app-card p-4">
                  <ul className="text-xs text-gray-300 space-y-1.5">
                    <li>🖼️ <strong>Image Gen</strong> — Generate concept art and storyboard shots</li>
                    <li>🎥 <strong>Video Gen</strong> — Animate images into full clips</li>
                    <li>🗂️ <strong>Project Hub</strong> — Manage scripts, storyboards, concepts</li>
                    <li>✂️ <strong>Edit Timeline</strong> — Arrange clips and add music</li>
                    <li>🤖 <strong>Assistant</strong> — Ask for help or run full workflows</li>
                  </ul>
                </div>
              )}

              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors"
                  onClick={onOpenAssistant}
                >
                  Open Assistant
                </button>
                <button
                  type="button"
                  className="app-button app-secondary text-xs"
                  onClick={onOpenApiSettings}
                >
                  Open Settings
                </button>
              </div>

              <label className="text-xs text-gray-400 flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={markCompleted}
                  onChange={(event) => setMarkCompleted(event.target.checked)}
                  className="rounded"
                />
                Don&apos;t show this again
              </label>
            </div>
          )}

          {/* Navigation */}
          <div className="mt-6 flex items-center justify-between">
            <button
              type="button"
              className="app-button app-secondary text-xs"
              onClick={back}
              disabled={!canBack}
            >
              ← Back
            </button>
            {isLast ? (
              <button
                type="button"
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition-colors"
                onClick={() => onComplete(markCompleted)}
              >
                Start Creating →
              </button>
            ) : (
              <button
                type="button"
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition-colors"
                onClick={next}
              >
                Next →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OnboardingModal;
