import React from 'react';
import type { Workspace } from '../types';
import type { UIMode } from '../config/uiModes';
import type { ResolvedWorkspaceNav } from '../config/workspaceNav';
import { FolderIcon, SettingsIcon } from './icons';

export type SidebarProjectStatus = {
  label: string;
  tone: 'ready' | 'busy' | 'attention';
};

interface AppSidebarProps {
  nav: ResolvedWorkspaceNav;
  activeWorkspace: Workspace;
  onSwitch: (workspace: Workspace) => void;
  uiMode: UIMode;
  collapsed: boolean;
  projectName?: string | null;
  projectStatus: SidebarProjectStatus;
  onOpenProject?: () => void;
  onOpenSettings?: () => void;
}

/**
 * macOS-style source list: grouped rows, quiet section labels, a single
 * tinted selection. Collapses to an icon rail so the canvas gets the room.
 */
const AppSidebar: React.FC<AppSidebarProps> = ({
  nav,
  activeWorkspace,
  onSwitch,
  collapsed,
  projectName,
  projectStatus,
  onOpenProject,
  onOpenSettings,
}) => {
  return (
    <nav
      className={`app-sidebar ${collapsed ? 'app-sidebar--collapsed' : ''}`}
      aria-label="Workspaces"
    >
      <div className="app-sidebar__scroll">
        {nav.groups.map((group) => {
          const groupActive = group.items.some((item) => item.id === activeWorkspace);
          return (
            <section
              key={group.id}
              className={`app-sidebar__group ${groupActive ? 'app-sidebar__group--active' : ''}`}
              aria-label={group.name}
            >
              <div className="app-sidebar__label" title={group.description}>
                <span>{group.name}</span>
              </div>
              <ul className="app-sidebar__list" role="list">
                {group.items.map((item) => {
                  const isActive = item.id === activeWorkspace;
                  const Icon = item.icon;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => onSwitch(item.id)}
                        data-studio-action={`workspace:${String(item.id).toLowerCase()}`}
                        aria-current={isActive ? 'page' : undefined}
                        title={collapsed ? `${item.name} · ${item.description}` : item.description}
                        className={`app-sidebar__item ${isActive ? 'app-sidebar__item--active' : ''}`}
                      >
                        <Icon className="app-sidebar__icon" />
                        <span className="app-sidebar__text">{item.name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {/* Keep a group-level hook for the Studio Agent automation. */}
              <button
                type="button"
                className="app-sidebar__group-hook"
                tabIndex={-1}
                aria-hidden="true"
                data-studio-action={`workspace-group:${group.id.toLowerCase()}`}
                onClick={() => onSwitch(group.items[0].id)}
              />
            </section>
          );
        })}
      </div>

      <div className="app-sidebar__footer">
        <button
          type="button"
          className="app-sidebar__project"
          onClick={onOpenProject}
          title={projectName ? `${projectName} · ${projectStatus.label}` : 'Choose a project folder'}
        >
          <span className="app-sidebar__project-icon">
            <FolderIcon className="w-4 h-4" />
          </span>
          <span className="app-sidebar__project-text">
            <span className="app-sidebar__project-name">{projectName || 'No project folder'}</span>
            <span className={`app-sidebar__project-status app-sidebar__project-status--${projectStatus.tone}`}>
              <span className="app-sidebar__project-dot" />
              {projectStatus.label}
            </span>
          </span>
        </button>
        <button
          type="button"
          className="app-sidebar__item app-sidebar__item--utility"
          onClick={onOpenSettings}
          title="Settings & API keys"
        >
          <SettingsIcon className="app-sidebar__icon" />
          <span className="app-sidebar__text">Settings</span>
        </button>
      </div>
    </nav>
  );
};

export default AppSidebar;
