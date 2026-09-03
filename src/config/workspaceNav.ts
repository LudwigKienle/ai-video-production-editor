import type React from 'react';
import type { Workspace } from '../types';
import { UIMode, getWorkspaceDisplayLabel, getWorkspaceGroupDisplayLabel } from './uiModes';
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
  ClapperboardIcon,
  BrainIcon,
  WandSparklesIcon,
  LandscapeIcon,
  CameraIcon,
  FilmIcon,
  PaletteIcon,
  ApertureIcon,
} from '../components/icons';

export type WorkspaceNavIcon = React.FC<{ className?: string }>;

export type WorkspaceNavItem = {
  id: Workspace;
  name: string;
  description: string;
  icon: WorkspaceNavIcon;
};

export type WorkspaceNavGroup = {
  id: string;
  name: string;
  description: string;
  icon: WorkspaceNavIcon;
  items: WorkspaceNavItem[];
};

export const WORKSPACE_NAV_GROUPS: WorkspaceNavGroup[] = [
  {
    id: 'PROJECTS',
    name: 'Project',
    description: 'Brief, assets, research',
    icon: ScriptIcon,
    items: [
      { id: 'PROJECT', name: 'Project', description: 'Story, shots, production plan', icon: ClapperboardIcon },
      { id: 'MICRODRAMA', name: 'Microdrama', description: 'Mobile-first 9:16 series pipeline', icon: FilmIcon },
      { id: 'ASSET_LIBRARY', name: 'Library', description: 'Reusable media and packs', icon: BoxIcon },
      { id: 'MOODBOARD', name: 'Moodboard', description: 'Visual direction and references', icon: PaletteIcon },
      { id: 'NOTEBOOKLM', name: 'Research', description: 'Source notes and context', icon: BrainIcon },
      { id: 'TEAM', name: 'Team', description: 'Collaboration, shared spaces, chat', icon: UserCircleIcon },
      { id: 'PLUGINS', name: 'Plugins', description: 'Install packs, LUTs and host plugins', icon: LayersIcon },
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
      { id: 'IMAGE_GEN', name: 'Images', description: 'Create stills and references', icon: WandSparklesIcon },
      { id: 'VIDEO_GEN', name: 'Video', description: 'Generate motion clips', icon: VideoIcon },
      { id: 'NODES', name: 'Nodes', description: 'Build advanced AI chains', icon: LayersIcon },
      { id: 'SET_DESIGN', name: 'Set Design', description: 'Arrange props and cameras', icon: CameraIcon },
      { id: 'SCENE_MAP', name: 'Scene Map', description: 'Map beats and locations', icon: GridIcon },
      { id: 'WORLD_GEN', name: 'World', description: 'Develop worlds and settings', icon: LandscapeIcon },
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
      { id: 'EDIT', name: 'Timeline', description: 'Assemble the main timeline', icon: EditIcon },
      { id: 'PHOTO', name: 'Photo', description: 'Retouch and prepare stills', icon: ApertureIcon },
      { id: 'UPSCALE', name: 'Upscale', description: 'Improve resolution and detail', icon: SparklesIcon },
      { id: 'COMPOSITING', name: 'Composite', description: 'Layer, key, and blend shots', icon: LayersIcon },
      { id: 'TRIM', name: 'Trim', description: 'Tighten selected clips', icon: TrimIcon },
      { id: 'POST', name: 'Color', description: 'Grade and polish the look', icon: ColorIcon },
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
    name: 'Deliver',
    description: 'Render and deliver',
    icon: ExportIcon,
    items: [{ id: 'EXPORT', name: 'Export', description: 'Choose format and render', icon: ExportIcon }],
  },
];

export type ResolveWorkspaceNavParams = {
  activeWorkspace: Workspace;
  uiMode: UIMode;
  allowedWorkspaces?: Workspace[];
  showReview?: boolean;
  showRequests?: boolean;
};

export type ResolvedWorkspaceNav = {
  groups: WorkspaceNavGroup[];
  items: WorkspaceNavItem[];
  activeGroup: WorkspaceNavGroup | undefined;
  activeItem: WorkspaceNavItem | undefined;
  activeIndex: number;
  nextItem: WorkspaceNavItem | undefined;
  previousItem: WorkspaceNavItem | undefined;
};

/**
 * Filters the static nav tree to what the current mode/role can see and
 * resolves the active + neighbouring entries. Shared by the sidebar and the
 * toolbar breadcrumb so both always agree.
 */
export const resolveWorkspaceNav = ({
  activeWorkspace,
  uiMode,
  allowedWorkspaces,
  showReview = true,
  showRequests = true,
}: ResolveWorkspaceNavParams): ResolvedWorkspaceNav => {
  const allowed = allowedWorkspaces ? new Set(allowedWorkspaces) : null;

  const groups = WORKSPACE_NAV_GROUPS
    .map((group) => {
      const items = group.items
        .filter((item) => {
          if (allowed && !allowed.has(item.id)) return false;
          if (!showReview && item.id === 'REVIEW') return false;
          if (!showRequests && item.id === 'REQUESTS') return false;
          return true;
        })
        .map((item) => ({
          ...item,
          name: getWorkspaceDisplayLabel(item.id, item.name, uiMode),
        }));
      return {
        ...group,
        name: getWorkspaceGroupDisplayLabel(group.id, group.name, uiMode),
        items,
      };
    })
    .filter((group) => group.items.length > 0);

  const items = groups.flatMap((group) => group.items);
  const activeGroup = groups.find((group) => group.items.some((item) => item.id === activeWorkspace));
  const activeItem = activeGroup?.items.find((item) => item.id === activeWorkspace);
  const activeIndex = items.findIndex((item) => item.id === activeWorkspace);

  return {
    groups,
    items,
    activeGroup,
    activeItem,
    activeIndex,
    nextItem: activeIndex >= 0 ? items[activeIndex + 1] : undefined,
    previousItem: activeIndex > 0 ? items[activeIndex - 1] : undefined,
  };
};
