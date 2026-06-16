import React, { useEffect, useMemo, useState } from 'react';
import { TransitionType } from '../types';
import { TRANSITIONS } from '../constants';
import { MagicWandIcon } from './icons';

interface TransitionsPanelProps {
  onApplyTransition: (transitionType: TransitionType) => void;
  disabled: boolean;
}

const TransitionsPanel: React.FC<TransitionsPanelProps> = ({ onApplyTransition, disabled }) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'core' | 'dynamic' | 'cinematic'>('all');
  const [hoveredTransition, setHoveredTransition] = useState<TransitionType | null>(null);
  const [previewTick, setPreviewTick] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setPreviewTick((prev) => (prev + 0.02) % 1);
    }, 40);
    return () => window.clearInterval(interval);
  }, []);

  const handleTransitionClick = (transition: TransitionType) => {
    if (disabled) return;
    onApplyTransition(transition);
  };

  const transitionDescriptions: Record<TransitionType, string> = {
    [TransitionType.CROSS_FADE]: 'Blend current clip into the next one.',
    [TransitionType.FADE_TO_BLACK]: 'Fade out smoothly to black before next clip.',
    [TransitionType.FADE_TO_WHITE]: 'Fade through bright white to the next clip.',
    [TransitionType.DIP_TO_WHITE]: 'Short white flash in the middle of the cut.',
    [TransitionType.ZOOM_IN]: 'Push-in style transition into the next clip.',
    [TransitionType.SWIPE_LEFT]: 'Slide to the left to reveal the next shot.',
    [TransitionType.GLITCH_CUT]: 'Digital jump cut with RGB jitter and stutter.',
    [TransitionType.WHIP_PAN]: 'Fast pan blur feel for high-energy continuity.',
    [TransitionType.LIGHTNING_FLASH]: 'Sharp flash cut with high-impact strike feel.',
    [TransitionType.FILM_BURN]: 'Warm film-burn flash with analog texture feel.',
  };

  const getTransitionCategory = (transitionType: TransitionType): 'core' | 'dynamic' | 'cinematic' => {
    if (
      transitionType === TransitionType.CROSS_FADE ||
      transitionType === TransitionType.FADE_TO_BLACK ||
      transitionType === TransitionType.FADE_TO_WHITE ||
      transitionType === TransitionType.DIP_TO_WHITE
    ) {
      return 'core';
    }
    if (
      transitionType === TransitionType.ZOOM_IN ||
      transitionType === TransitionType.SWIPE_LEFT ||
      transitionType === TransitionType.WHIP_PAN ||
      transitionType === TransitionType.GLITCH_CUT
    ) {
      return 'dynamic';
    }
    return 'cinematic';
  };

  const filteredTransitions = useMemo(() => {
    const term = search.trim().toLowerCase();
    return TRANSITIONS.filter((transition) => {
      if (filter !== 'all' && getTransitionCategory(transition.id) !== filter) return false;
      if (!term) return true;
      return (
        transition.name.toLowerCase().includes(term) ||
        transitionDescriptions[transition.id]?.toLowerCase().includes(term)
      );
    });
  }, [search, filter]);

  const activePreviewTransition = hoveredTransition || filteredTransitions[0]?.id || null;

  const renderTransitionPreview = () => {
    if (!activePreviewTransition) {
      return (
        <div className="mb-3 rounded-lg border border-gray-700 bg-gray-900/60 p-3 text-[11px] text-gray-500">
          Hover a transition card to preview the behavior.
        </div>
      );
    }

    const progress = (Math.sin(previewTick * Math.PI * 2) + 1) / 2;
    const outgoing: React.CSSProperties = {};
    const incoming: React.CSSProperties = {};
    const overlays: React.ReactNode[] = [];

    switch (activePreviewTransition) {
      case TransitionType.CROSS_FADE:
        outgoing.opacity = 1 - progress;
        incoming.opacity = progress;
        break;
      case TransitionType.FADE_TO_BLACK:
        outgoing.opacity = 1 - progress;
        overlays.push(<div key="black" className="absolute inset-0 bg-black" style={{ opacity: Math.min(1, progress) }} />);
        incoming.opacity = 0;
        break;
      case TransitionType.FADE_TO_WHITE:
        outgoing.opacity = 1 - progress;
        incoming.opacity = progress;
        overlays.push(<div key="white" className="absolute inset-0 bg-white" style={{ opacity: progress * 0.75 }} />);
        break;
      case TransitionType.DIP_TO_WHITE:
        outgoing.opacity = progress < 0.5 ? 1 - progress * 2 : 0;
        incoming.opacity = progress > 0.5 ? (progress - 0.5) * 2 : 0;
        overlays.push(<div key="dip" className="absolute inset-0 bg-white" style={{ opacity: Math.max(0, 1 - Math.abs(progress * 2 - 1)) * 0.85 }} />);
        break;
      case TransitionType.ZOOM_IN:
        outgoing.transform = `scale(${1 + progress * 0.15})`;
        incoming.opacity = progress;
        incoming.transform = `scale(${1.08 - progress * 0.08})`;
        break;
      case TransitionType.SWIPE_LEFT:
        outgoing.transform = `translateX(${-progress * 100}%)`;
        incoming.transform = `translateX(${(1 - progress) * 100}%)`;
        incoming.opacity = 1;
        break;
      case TransitionType.GLITCH_CUT:
        outgoing.transform = `translateX(${Math.sin(previewTick * 50) * 8}px)`;
        outgoing.opacity = 1 - progress;
        incoming.transform = `translateX(${Math.cos(previewTick * 56) * 6}px)`;
        incoming.opacity = progress;
        overlays.push(<div key="glitch" className="absolute inset-0 bg-cyan-300/10 mix-blend-screen" />);
        overlays.push(<div key="glitch-2" className="absolute inset-x-0 h-1 bg-pink-300/40" style={{ top: `${10 + progress * 70}%` }} />);
        break;
      case TransitionType.WHIP_PAN:
        outgoing.transform = `translateX(${-progress * 130}%)`;
        outgoing.filter = 'blur(2px)';
        incoming.transform = `translateX(${(1 - progress) * 130}%)`;
        incoming.filter = 'blur(2px)';
        incoming.opacity = 1;
        break;
      case TransitionType.LIGHTNING_FLASH:
        outgoing.opacity = progress < 0.58 ? 1 - progress * 1.3 : 0;
        incoming.opacity = progress > 0.36 ? (progress - 0.36) / 0.64 : 0;
        overlays.push(<div key="strike" className="absolute inset-0 bg-white" style={{ opacity: Math.sin(progress * Math.PI) * 0.9 }} />);
        break;
      case TransitionType.FILM_BURN:
        outgoing.opacity = 1 - progress * 0.92;
        incoming.opacity = progress > 0.18 ? (progress - 0.18) / 0.82 : 0;
        overlays.push(
          <div
            key="burn"
            className="absolute inset-0"
            style={{
              opacity: Math.sin(progress * Math.PI) * 0.9,
              background: 'linear-gradient(110deg, rgba(255,245,180,0.95) 0%, rgba(255,163,82,0.78) 40%, rgba(255,72,10,0.52) 74%, rgba(20,4,0,0.2) 100%)',
            }}
          />
        );
        break;
      default:
        break;
    }

    return (
      <div className="mb-3 rounded-lg border border-gray-700 bg-gray-900/60 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-widest text-gray-500">Hover Preview</div>
          <div className="text-[11px] text-indigo-300">{activePreviewTransition}</div>
        </div>
        <div className="relative h-24 overflow-hidden rounded-md border border-gray-700 bg-black">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/45 to-fuchsia-600/25" style={outgoing} />
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/45 to-cyan-500/25" style={incoming} />
          {overlays}
          <div className="absolute bottom-0 left-0 h-0.5 bg-indigo-400" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
    );
  };

  return (
    <div className="bg-gray-800/50 p-4 flex flex-col h-full">
      <h3 className="text-lg font-semibold mb-3 text-white">Transitions Library</h3>
      {renderTransitionPreview()}
      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search transitions..."
        className="mb-3 w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200"
      />
      <div className="mb-3 flex items-center gap-2">
        {([
          { id: 'all', label: 'All' },
          { id: 'core', label: 'Core' },
          { id: 'dynamic', label: 'Dynamic' },
          { id: 'cinematic', label: 'Cinematic' },
        ] as const).map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setFilter(entry.id)}
            className={`px-2.5 py-1 rounded text-[10px] border ${filter === entry.id ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-gray-900 text-gray-400 border-gray-700 hover:text-gray-200'}`}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div className="flex-grow overflow-y-auto pr-2 -mr-2 space-y-2">
        {filteredTransitions.map(transition => (
          <div
            key={transition.id}
            onClick={() => handleTransitionClick(transition.id)}
            onMouseEnter={() => setHoveredTransition(transition.id)}
            onMouseLeave={() => setHoveredTransition((current) => (current === transition.id ? null : current))}
            className={`p-3 rounded-lg border-2 transition-all duration-200 ${
              disabled
                ? 'bg-gray-800 border-gray-700 text-gray-600 cursor-not-allowed'
                : 'bg-gray-900/50 border-gray-700 hover:border-indigo-500 hover:bg-gray-800 cursor-pointer'
            }`}
          >
            <div className="flex items-center gap-3">
              <MagicWandIcon className="w-5 h-5 text-indigo-400 flex-shrink-0" />
              <div className="flex-grow">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-white">{transition.name}</p>
                  <span className="text-[10px] text-indigo-300">{transition.duration.toFixed(1)}s</span>
                </div>
                <p className="text-xs text-gray-400">{transitionDescriptions[transition.id]}</p>
                <p className="text-[10px] uppercase tracking-wide text-gray-500 mt-1">{getTransitionCategory(transition.id)}</p>
              </div>
            </div>
          </div>
        ))}
        {filteredTransitions.length === 0 && (
          <p className="text-xs text-center text-gray-500 mt-4">No matching transitions found.</p>
        )}
        {disabled && <p className="text-xs text-center text-gray-500 mt-4">Select a clip on the timeline to apply a transition.</p>}
      </div>
    </div>
  );
};

export default TransitionsPanel;
