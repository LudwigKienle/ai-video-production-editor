/**
 * Header mode bar of the editor (Importieren · Bearbeiten · Exportieren),
 * switching between the app's IMPORT, EDIT and EXPORT workspaces through the
 * existing workspace navigation. Project name sits in the centre.
 */
import React from 'react';
import { Home } from 'lucide-react';
import type { Workspace } from '../../types';

export const MODE_TABS: Array<{ id: Workspace; label: string; hint: string }> = [
    { id: 'IMPORT', label: 'Importieren', hint: 'Medien sichten und importieren' },
    { id: 'EDIT', label: 'Bearbeiten', hint: 'Schnitt, Farbe, Effekte und Audio' },
    { id: 'EXPORT', label: 'Exportieren', hint: 'Sequenz ausgeben' },
];

type Props = {
    active: Workspace;
    projectName?: string | null;
    onSwitch?: (workspace: Workspace) => void;
    canAccess?: (workspace: Workspace) => boolean;
    trailing?: React.ReactNode;
};

const ModeBar: React.FC<Props> = ({ active, projectName, onSwitch, canAccess, trailing }) => (
    <header className="ppx-modebar" data-automation-id="pp.modebar">
        <button
            type="button"
            className="ppx-modebar__home"
            onClick={() => onSwitch?.('PROJECT' as Workspace)}
            disabled={!onSwitch || (canAccess ? !canAccess('PROJECT' as Workspace) : false)}
            title="Projektübersicht"
            data-automation-id="pp.modebar.home"
        >
            <Home size={15} />
        </button>
        <nav className="ppx-modebar__tabs" aria-label="Arbeitsbereich">
            {MODE_TABS.map((tab) => {
                const allowed = Boolean(onSwitch) && (canAccess ? canAccess(tab.id) : true);
                return (
                    <button
                        key={tab.id}
                        type="button"
                        className={`ppx-modebar__tab ${active === tab.id ? 'ppx-modebar__tab--active' : ''}`}
                        aria-current={active === tab.id ? 'page' : undefined}
                        disabled={!allowed}
                        onClick={() => { if (active !== tab.id) onSwitch?.(tab.id); }}
                        title={tab.hint}
                        data-automation-id={`pp.modebar.${tab.id.toLowerCase()}`}
                    >
                        {tab.label}
                    </button>
                );
            })}
        </nav>
        <div className="ppx-modebar__title" title={projectName || 'Unbenanntes Projekt'}>{projectName || 'Unbenanntes Projekt'}</div>
        <div className="ppx-modebar__trailing">{trailing}</div>
    </header>
);

export default ModeBar;
