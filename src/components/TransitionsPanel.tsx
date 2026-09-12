import React, { useEffect, useMemo, useState } from 'react';
import { TransitionType } from '../types';
import { TRANSITIONS } from '../constants';
import { SearchIcon } from './icons';

interface TransitionsPanelProps {
  onApplyTransition: (transitionType: TransitionType) => void;
  disabled: boolean;
}

type TransitionCategory = 'core' | 'dynamic' | 'cinematic';
type Filter = 'all' | TransitionCategory;

const CATEGORY_LABEL: Record<TransitionCategory, string> = { core: 'Dissolves', dynamic: 'Motion', cinematic: 'Cinematic' };
const CATEGORY_ORDER: TransitionCategory[] = ['core', 'dynamic', 'cinematic'];
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'core', label: 'Dissolves' },
  { id: 'dynamic', label: 'Motion' },
  { id: 'cinematic', label: 'Cinematic' },
];

const DESCRIPTIONS: Record<TransitionType, string> = {
  [TransitionType.CROSS_FADE]: 'Blend the outgoing clip into the next one.',
  [TransitionType.FADE_TO_BLACK]: 'Fade out to black before the next clip.',
  [TransitionType.FADE_TO_WHITE]: 'Fade through white into the next clip.',
  [TransitionType.DIP_TO_WHITE]: 'Short white flash in the middle of the cut.',
  [TransitionType.ZOOM_IN]: 'Push in on the cut into the next clip.',
  [TransitionType.SWIPE_LEFT]: 'Slide left to reveal the next shot.',
  [TransitionType.GLITCH_CUT]: 'Digital jump cut with RGB jitter.',
  [TransitionType.WHIP_PAN]: 'Fast pan blur for high-energy continuity.',
  [TransitionType.LIGHTNING_FLASH]: 'Sharp flash cut with a strike feel.',
  [TransitionType.FILM_BURN]: 'Warm film-burn flash with analog texture.',
};

const CORE = new Set<TransitionType>([TransitionType.CROSS_FADE, TransitionType.FADE_TO_BLACK, TransitionType.FADE_TO_WHITE, TransitionType.DIP_TO_WHITE]);
const DYNAMIC = new Set<TransitionType>([TransitionType.ZOOM_IN, TransitionType.SWIPE_LEFT, TransitionType.WHIP_PAN, TransitionType.GLITCH_CUT]);
const categoryOf = (type: TransitionType): TransitionCategory => (CORE.has(type) ? 'core' : DYNAMIC.has(type) ? 'dynamic' : 'cinematic');

/** Frame of a transition at `progress` (0→1): styles for the outgoing / incoming plates plus overlays. */
const frameFor = (type: TransitionType, progress: number, tick: number) => {
  const outgoing: React.CSSProperties = {};
  const incoming: React.CSSProperties = { opacity: 0 };
  const overlays: React.ReactNode[] = [];
  switch (type) {
    case TransitionType.CROSS_FADE:
      outgoing.opacity = 1 - progress; incoming.opacity = progress; break;
    case TransitionType.FADE_TO_BLACK:
      outgoing.opacity = 1 - progress;
      overlays.push(<div key="black" className="tr-tile__overlay" style={{ background: '#000', opacity: Math.min(1, progress) }} />);
      break;
    case TransitionType.FADE_TO_WHITE:
      outgoing.opacity = 1 - progress; incoming.opacity = progress;
      overlays.push(<div key="white" className="tr-tile__overlay" style={{ background: '#fff', opacity: progress * 0.75 }} />);
      break;
    case TransitionType.DIP_TO_WHITE:
      outgoing.opacity = progress < 0.5 ? 1 - progress * 2 : 0;
      incoming.opacity = progress > 0.5 ? (progress - 0.5) * 2 : 0;
      overlays.push(<div key="dip" className="tr-tile__overlay" style={{ background: '#fff', opacity: Math.max(0, 1 - Math.abs(progress * 2 - 1)) * 0.85 }} />);
      break;
    case TransitionType.ZOOM_IN:
      outgoing.transform = `scale(${1 + progress * 0.15})`; incoming.opacity = progress; incoming.transform = `scale(${1.08 - progress * 0.08})`; break;
    case TransitionType.SWIPE_LEFT:
      outgoing.transform = `translateX(${-progress * 100}%)`; incoming.transform = `translateX(${(1 - progress) * 100}%)`; incoming.opacity = 1; break;
    case TransitionType.GLITCH_CUT:
      outgoing.transform = `translateX(${Math.sin(tick * 50) * 6}px)`; outgoing.opacity = 1 - progress;
      incoming.transform = `translateX(${Math.cos(tick * 56) * 5}px)`; incoming.opacity = progress;
      overlays.push(<div key="g1" className="tr-tile__overlay" style={{ background: 'rgba(103,232,249,0.12)', mixBlendMode: 'screen' }} />);
      overlays.push(<div key="g2" className="tr-tile__overlay" style={{ top: `${10 + progress * 70}%`, height: 3, background: 'rgba(249,168,212,0.5)' }} />);
      break;
    case TransitionType.WHIP_PAN:
      outgoing.transform = `translateX(${-progress * 130}%)`; outgoing.filter = 'blur(2px)';
      incoming.transform = `translateX(${(1 - progress) * 130}%)`; incoming.filter = 'blur(2px)'; incoming.opacity = 1; break;
    case TransitionType.LIGHTNING_FLASH:
      outgoing.opacity = progress < 0.58 ? 1 - progress * 1.3 : 0;
      incoming.opacity = progress > 0.36 ? (progress - 0.36) / 0.64 : 0;
      overlays.push(<div key="strike" className="tr-tile__overlay" style={{ background: '#fff', opacity: Math.sin(progress * Math.PI) * 0.9 }} />);
      break;
    case TransitionType.FILM_BURN:
      outgoing.opacity = 1 - progress * 0.92;
      incoming.opacity = progress > 0.18 ? (progress - 0.18) / 0.82 : 0;
      overlays.push(<div key="burn" className="tr-tile__overlay" style={{ opacity: Math.sin(progress * Math.PI) * 0.9, background: 'linear-gradient(110deg, rgba(255,245,180,0.95) 0%, rgba(255,163,82,0.78) 40%, rgba(255,72,10,0.52) 74%, rgba(20,4,0,0.2) 100%)' }} />);
      break;
    default:
      break;
  }
  return { outgoing, incoming, overlays };
};

const TransitionsPanel: React.FC<TransitionsPanelProps> = ({ onApplyTransition, disabled }) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [hovered, setHovered] = useState<TransitionType | null>(null);
  const [tick, setTick] = useState(0);

  // Only the hovered tile animates; everything else shows the mid-point frame.
  useEffect(() => {
    if (!hovered) return;
    const interval = window.setInterval(() => setTick((prev) => (prev + 0.02) % 1), 40);
    return () => window.clearInterval(interval);
  }, [hovered]);

  const term = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      TRANSITIONS.filter((transition) => {
        const category = categoryOf(transition.id);
        if (filter !== 'all' && category !== filter) return false;
        if (!term) return true;
        return (
          transition.name.toLowerCase().includes(term) ||
          DESCRIPTIONS[transition.id]?.toLowerCase().includes(term) ||
          CATEGORY_LABEL[category].toLowerCase().includes(term)
        );
      }),
    [term, filter]
  );

  const grouped = useMemo(() => {
    const groups = new Map<TransitionCategory, typeof TRANSITIONS>();
    for (const transition of filtered) {
      const category = categoryOf(transition.id);
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category)!.push(transition);
    }
    return CATEGORY_ORDER.filter((c) => groups.has(c)).map((c) => ({ category: c, items: groups.get(c)! }));
  }, [filtered]);

  const renderTile = (transition: (typeof TRANSITIONS)[number]) => {
    const isHovered = hovered === transition.id;
    const progress = isHovered ? (Math.sin(tick * Math.PI * 2) + 1) / 2 : 0.5;
    const { outgoing, incoming, overlays } = frameFor(transition.id, progress, tick);
    return (
      <button
        key={transition.id}
        type="button"
        disabled={disabled}
        title={`${transition.name}\n${DESCRIPTIONS[transition.id]}`}
        aria-label={transition.name}
        className={`fx-tile ${disabled ? 'fx-tile--disabled' : ''}`}
        onClick={() => { if (!disabled) onApplyTransition(transition.id); }}
        onMouseEnter={() => setHovered(transition.id)}
        onMouseLeave={() => setHovered((current) => (current === transition.id ? null : current))}
        onFocus={() => setHovered(transition.id)}
        onBlur={() => setHovered((current) => (current === transition.id ? null : current))}
      >
        <div className="fx-tile__thumb tr-tile">
          <div className="tr-tile__plate tr-tile__plate--out" style={outgoing} />
          <div className="tr-tile__plate tr-tile__plate--in" style={incoming} />
          {overlays}
          {isHovered && <div className="tr-tile__progress" style={{ width: `${progress * 100}%` }} />}
        </div>
        <span className="fx-tile__badge">{transition.duration.toFixed(1)}s</span>
        <span className="fx-tile__name">{transition.name}</span>
      </button>
    );
  };

  return (
    <div className="fx-browser">
      <div className="fx-browser__header">
        <h3 className="fx-browser__title">Transitions</h3>
        <span className="edit-chip">{TRANSITIONS.length}</span>
      </div>

      <label className="fx-search">
        <SearchIcon className="fx-search__icon" />
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search transitions" aria-label="Search transitions" />
      </label>

      <div className="fx-filters" role="tablist" aria-label="Category">
        {FILTERS.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={filter === entry.id} onClick={() => setFilter(entry.id)} className={`fx-filters__item ${filter === entry.id ? 'fx-filters__item--active' : ''}`}>
            {entry.label}
          </button>
        ))}
      </div>

      <div className="fx-browser__scroll">
        {filter === 'all' && !term ? (
          grouped.map((group) => (
            <section key={group.category} className="fx-section">
              <header className="fx-section__title">{CATEGORY_LABEL[group.category]}</header>
              <div className="fx-grid">{group.items.map(renderTile)}</div>
            </section>
          ))
        ) : (
          <div className="fx-grid">{filtered.map(renderTile)}</div>
        )}
        {filtered.length === 0 && <p className="fx-empty">No results for “{search.trim()}”</p>}
      </div>

      <footer className="fx-browser__footer">
        {disabled ? <span>Select a clip on the timeline — the transition is added at its end.</span> : <span>Hover to preview · click to add at the end of the selected clip</span>}
      </footer>
    </div>
  );
};

export default TransitionsPanel;
