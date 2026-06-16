import React, { useMemo } from 'react';
import { Workspace } from '../types';
import {
  UIMode,
  UI_MODE_META,
  getWorkspaceDisplayLabel,
  getWorkspaceGroupDisplayLabel,
} from '../config/uiModes';
import {
  ScriptIcon,
  BoxIcon,
  UploadIcon,
  EditIcon,
  TrimIcon,
  ColorIcon,
  ExportIcon,
  ImageIcon,
  VideoIcon,
  SparklesIcon,
  UserCircleIcon,
  BrainCircuitIcon,
  ClipboardCheckIcon,
  ListIcon,
  LayersIcon,
  MusicNoteIcon,
  MapIcon,
  GridIcon,
} from './icons';

type WorkspaceNavIcon = React.FC<{ className?: string }>;

interface WorkspaceSwitcherProps {
  activeWorkspace: Workspace;
  onSwitch: (workspace: Workspace) => void;
  uiMode: UIMode;
  allowedWorkspaces?: Workspace[];
  showReview?: boolean;
  showRequests?: boolean;
}

type WorkspaceNavItem = {
  id: Workspace;
  name: string;
  description: string;
  icon: WorkspaceNavIcon;
};

type WorkspaceNavGroup = {
  id: string;
  name: string;
  description: string;
  icon: WorkspaceNavIcon;
  items: WorkspaceNavItem[];
};

const workspaceGroups: WorkspaceNavGroup[] = [
  {
    id: 'PROJECTS',
    name: 'Project',
    description: 'Brief, assets, research',
    icon: ScriptIcon,
    items: [
      { id: 'PROJECT', name: 'Project', description: 'Story, shots, production plan', icon: ScriptIcon },
      { id: 'MICRODRAMA', name: 'Microdrama', description: 'Mobile-first 9:16 Detonation Pipeline', icon: SparklesIcon },
      { id: 'ASSET_LIBRARY', name: 'Library', description: 'Reusable media and packs', icon: BoxIcon },
      { id: 'MOODBOARD', name: 'Moodboard', description: 'Visual direction and references', icon: GridIcon },
      { id: 'NOTEBOOKLM', name: 'Research', description: 'Source notes and context', icon: BrainCircuitIcon },
    ],
  },
  {
    id: 'CREATE',
    name: 'Create',
    description: 'Generate and import media',
    icon: SparklesIcon,
    items: [
      { id: 'IMPORT', name: 'Import', description: 'Bring footage and audio in', icon: UploadIcon },
      { id: 'DESIGN', name: 'Design', description: 'Compose title cards and social assets', icon: ImageIcon },
      { id: 'IMAGE_GEN', name: 'Image Gen', description: 'Create stills and references', icon: SparklesIcon },
      { id: 'VIDEO_GEN', name: 'Video Gen', description: 'Generate motion clips', icon: VideoIcon },
      { id: 'NODES', name: 'Nodes', description: 'Build advanced AI chains', icon: LayersIcon },
      { id: 'SET_DESIGN', name: 'Set Design', description: 'Arrange props and cameras', icon: MapIcon },
      { id: 'SCENE_MAP', name: 'Scene Map', description: 'Map beats and locations', icon: GridIcon },
      { id: 'WORLD_GEN', name: 'World Gen', description: 'Develop worlds and settings', icon: MapIcon },
      { id: 'AVATAR', name: 'Avatar', description: 'Characters and presenters', icon: UserCircleIcon },
      { id: 'SOUND', name: 'Sound', description: 'Voice, music, and effects', icon: MusicNoteIcon },
    ],
  },
  {
    id: 'EDITING',
    name: 'Edit',
    description: 'Cut, enhance, finish',
    icon: EditIcon,
    items: [
      { id: 'EDIT', name: 'Edit', description: 'Assemble the main timeline', icon: EditIcon },
      { id: 'PHOTO', name: 'Photo', description: 'Retouch and prepare stills', icon: ImageIcon },
      { id: 'UPSCALE', name: 'Upscale', description: 'Improve resolution and detail', icon: SparklesIcon },
      { id: 'COMPOSITING', name: 'Composite', description: 'Layer, key, and blend shots', icon: LayersIcon },
      { id: 'TRIM', name: 'Trim', description: 'Tighten selected clips', icon: TrimIcon },
      { id: 'POST', name: 'Post', description: 'Grade and polish the look', icon: ColorIcon },
    ],
  },
  {
    id: 'REVIEW',
    name: 'Review',
    description: 'Check quality and requests',
    icon: BrainCircuitIcon,
    items: [
      { id: 'ANALYSIS', name: 'Analysis', description: 'Find pacing and quality issues', icon: BrainCircuitIcon },
      { id: 'REVIEW', name: 'Director', description: 'Approve and annotate work', icon: ClipboardCheckIcon },
      { id: 'REQUESTS', name: 'Requests', description: 'Handle change requests', icon: ListIcon },
    ],
  },
  {
    id: 'DELIVERY',
    name: 'Export',
    description: 'Render and deliver',
    icon: ExportIcon,
    items: [{ id: 'EXPORT', name: 'Export', description: 'Choose format and render', icon: ExportIcon }],
  },
];


const WorkspaceSwitcher: React.FC<WorkspaceSwitcherProps> = ({
  activeWorkspace,
  onSwitch,
  uiMode,
  allowedWorkspaces,
  showReview = true,
  showRequests = true,
}) => {
  const allowedWorkspaceSet = useMemo(
    () => (allowedWorkspaces ? new Set(allowedWorkspaces) : null),
    [allowedWorkspaces],
  );

  const visibleGroups = useMemo(() => {
    return workspaceGroups
      .map((group) => {
        const visibleItems = group.items.filter((item) => {
          if (allowedWorkspaceSet && !allowedWorkspaceSet.has(item.id)) return false;
          if (!showReview && item.id === 'REVIEW') return false;
          if (!showRequests && item.id === 'REQUESTS') return false;
          return true;
        }).map((item) => ({
          ...item,
          name: getWorkspaceDisplayLabel(item.id, item.name, uiMode),
        }));
        return {
          ...group,
          name: getWorkspaceGroupDisplayLabel(group.id, group.name, uiMode),
          items: visibleItems,
        };
      })
      .filter((group) => group.items.length > 0);
  }, [allowedWorkspaceSet, showReview, showRequests, uiMode]);

  const activeGroup =
    visibleGroups.find((group) => group.items.some((item) => item.id === activeWorkspace)) || visibleGroups[0];
  const activeItem = activeGroup?.items.find((item) => item.id === activeWorkspace) || activeGroup?.items[0];
  const visibleItems = visibleGroups.flatMap((group) => group.items);
  const activeIndex = visibleItems.findIndex((item) => item.id === activeWorkspace);
  const nextItem = activeIndex >= 0 ? visibleItems[activeIndex + 1] : undefined;
  const progressText = activeIndex >= 0 ? `${activeIndex + 1} of ${visibleItems.length}` : `${visibleItems.length} tools`;

  return (
    <div className="workspace-switcher">
      <div className="container mx-auto flex flex-col gap-3">
        <div className="workspace-switcher__topbar">
          <div className="workspace-switcher__summary">
            <span className="workspace-switcher__summary-kicker">Workspace {progressText}</span>
            <div className="workspace-switcher__summary-main">
              <span className="workspace-switcher__summary-title">{activeItem?.name || 'Workspace'}</span>
              {activeItem?.description && (
                <span className="workspace-switcher__summary-text">{activeItem.description}</span>
              )}
            </div>
          </div>
          <div className="workspace-switcher__mode">
            <span className="workspace-switcher__mode-badge">
              {UI_MODE_META[uiMode].emoji} {UI_MODE_META[uiMode].label}
            </span>
            <span className="workspace-switcher__mode-text">{UI_MODE_META[uiMode].description}</span>
          </div>
          {nextItem && (
            <button
              type="button"
              className="workspace-switcher__next"
              onClick={() => onSwitch(nextItem.id)}
              title={`Open ${nextItem.name}`}
            >
              <span>Next</span>
              <strong>{nextItem.name}</strong>
            </button>
          )}
        </div>
        <div className="workspace-switcher__scroller workspace-switcher__scroller--groups">
          <div className="workspace-switcher__row workspace-switcher__row--groups">
          {visibleGroups.map((group, index) => {
            const isActive = group.items.some((item) => item.id === activeWorkspace);
            return (
              <button
                key={group.id}
                onClick={() => {
                  if (!isActive) {
                    onSwitch(group.items[0].id);
                  }
                }}
                data-studio-action={`workspace-group:${group.id.toLowerCase()}`}
                aria-current={isActive ? 'page' : undefined}
                title={group.description}
                className={`workspace-tab workspace-tab--group ${isActive ? 'workspace-tab--active' : ''}`}
              >
                <span className="workspace-tab__step">{index + 1}</span>
                <group.icon className="w-4 h-4" />
                <span className="workspace-tab__content">
                  <span className="workspace-tab__title">{group.name}</span>
                  <span className="workspace-tab__hint">{group.description}</span>
                </span>
              </button>
            );
          })}
          </div>
        </div>
        {activeGroup && (
          <div className="workspace-switcher__scroller workspace-switcher__scroller--sub">
            <div className="workspace-switcher__row workspace-switcher__row--sub">
            {activeGroup.items.map((item) => {
              const isActive = activeWorkspace === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSwitch(item.id)}
                  data-studio-action={`workspace:${String(item.id).toLowerCase()}`}
                  aria-current={isActive ? 'page' : undefined}
                  title={item.description}
                  className={`workspace-tab ${isActive ? 'workspace-tab--active' : ''}`}
                >
                  <item.icon className="w-5 h-5" />
                  <span className="workspace-tab__content">
                    <span className="workspace-tab__title">{item.name}</span>
                    <span className="workspace-tab__hint">{item.description}</span>
                  </span>
                </button>
              );
            })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkspaceSwitcher;
