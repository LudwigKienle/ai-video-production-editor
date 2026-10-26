/**
 * Pro editing layout (NLE-style dockable panel groups) for the EDIT workspace.
 *
 * Pure, serialisable state + reducer. No React / DOM imports so it can be
 * unit-tested with `node --test` and driven by agents through plain JSON.
 * Layout and behaviour are modelled on common professional NLE editing
 * workspaces; all labels, icons and styling are our own.
 */

export type ProPanelId =
    | 'source'
    | 'program'
    | 'timeline'
    | 'tools'
    | 'meters'
    | 'project'
    | 'effects'
    | 'markers'
    | 'history'
    | 'info'
    | 'effectControls'
    | 'audioMixer'
    | 'inspector'
    | 'titles'
    | 'transitions'
    | 'lookbook'
    | 'music'
    | 'autocut'
    | 'agent';

export type ProWorkspaceId = 'editing' | 'color' | 'effects' | 'audio' | 'classic';
export type DockWorkspaceId = Exclude<ProWorkspaceId, 'classic'>;

export type EditorToolId = 'selection' | 'trackForward' | 'ripple' | 'razor' | 'slip' | 'pen' | 'hand' | 'type';
export type TrimModeId = 'normal' | 'ripple' | 'roll' | 'slip' | 'slide';

export type DockGroup = {
    kind: 'group';
    id: string;
    tabs: ProPanelId[];
    active: ProPanelId;
    /** Fixed pixel size along the parent split's axis (tool strip, meters). */
    fixedPx?: number;
    /** Compact groups render without a tab strip and do not accept dropped tabs. */
    compact?: boolean;
};

export type DockSplit = {
    kind: 'split';
    id: string;
    dir: 'row' | 'col';
    /** Relative sizes of the children (fixed children keep a placeholder value). */
    sizes: number[];
    children: DockNode[];
};

export type DockNode = DockGroup | DockSplit;

export type MonitorZoom = 'fit' | 25 | 50 | 75 | 100 | 150 | 200;

export type ProLayoutState = {
    version: 1;
    workspace: ProWorkspaceId;
    layouts: Record<DockWorkspaceId, DockNode>;
    tool: EditorToolId;
    maximizedGroupId: string | null;
    focusedPanel: ProPanelId | null;
    /** Track ids hidden in the program monitor (eye toggle). UI-only, not exported. */
    hiddenTrackIds: string[];
    safeMargins: boolean;
    monitorZoom: MonitorZoom;
    projectView: 'icon' | 'list';
};

export const PRO_LAYOUT_STORAGE_KEY = 'edit_workspace_pro_layout_v1';

export const PRO_PANELS: Record<ProPanelId, { label: string; hint: string }> = {
    source: { label: 'Quelle', hint: 'Quellmonitor: Medium sichten, In/Out setzen, einfügen' },
    program: { label: 'Programm', hint: 'Programmmonitor der Sequenz' },
    timeline: { label: 'Timeline', hint: 'Sequenz mit Video- und Audiospuren' },
    tools: { label: 'Werkzeuge', hint: 'Werkzeugleiste' },
    meters: { label: 'Pegel', hint: 'Audiopegel der Sequenz' },
    project: { label: 'Projekt', hint: 'Projektmedien' },
    effects: { label: 'Effekte', hint: 'Effekte, Übergänge und Titel' },
    markers: { label: 'Marken', hint: 'In/Out-Marken und Schnittpunkte' },
    history: { label: 'Verlauf', hint: 'Änderungen in dieser Sitzung' },
    info: { label: 'Info', hint: 'Details zur Auswahl' },
    effectControls: { label: 'Effekteinstellungen', hint: 'Bewegung, Deckkraft und GPU-Effekte des Clips' },
    audioMixer: { label: 'Audio-Mixer', hint: 'Clip-Lautstärke pro Spur an der Abspielposition' },
    inspector: { label: 'Eigenschaften', hint: 'Vollständiger Clip-Inspektor' },
    titles: { label: 'Titel', hint: 'Titel, Bauchbinden, Untertitel' },
    transitions: { label: 'Übergänge', hint: 'Übergangsbibliothek' },
    lookbook: { label: 'Lookbook', hint: 'Referenzen, Figuren, Umgebungen' },
    music: { label: 'Musik', hint: 'Musik-Assistent' },
    autocut: { label: 'Auto-Cut', hint: 'KI-Segmentauswahl' },
    agent: { label: 'Agent', hint: 'KI-Schnittvorschläge planen und anwenden' },
};

export const ALL_PANEL_IDS = Object.keys(PRO_PANELS) as ProPanelId[];

/** Panels that are not docked as normal tabs. */
export const COMPACT_PANELS: ProPanelId[] = ['tools', 'meters'];

export const PRO_WORKSPACES: Array<{ id: ProWorkspaceId; label: string; hint: string }> = [
    { id: 'editing', label: 'Schnitt', hint: 'Quelle, Programm, Projekt und Timeline' },
    { id: 'color', label: 'Farbe', hint: 'Großer Programmmonitor mit Effekteinstellungen' },
    { id: 'effects', label: 'Effekte', hint: 'Effektbrowser und Effekteinstellungen im Vordergrund' },
    { id: 'audio', label: 'Audio', hint: 'Audio-Mixer und Pegel im Vordergrund' },
    { id: 'classic', label: 'Klassisch', hint: 'Bisheriges Layout mit Browser, Monitor und Inspektor' },
];

export const EDITOR_TOOLS: Array<{ id: EditorToolId; key: string; label: string; hint: string; status: 'ready' | 'partial' | 'planned' }> = [
    { id: 'selection', key: 'V', label: 'Auswahl', hint: 'Clips auswählen, verschieben und trimmen', status: 'ready' },
    { id: 'trackForward', key: 'A', label: 'Spur vorwärts auswählen', hint: 'Klicken und ziehen verschiebt alle Clips der Spur ab dem Klickpunkt', status: 'ready' },
    { id: 'ripple', key: 'B', label: 'Löschen und Lücke schließen (Ripple)', hint: 'Clipkante trimmen, nachfolgende Clips rücken nach', status: 'ready' },
    { id: 'razor', key: 'C', label: 'Rasierklinge', hint: 'Klick auf einen Clip teilt ihn an dieser Stelle', status: 'ready' },
    { id: 'slip', key: 'Y', label: 'Unterschieben (Slip)', hint: 'Clip ziehen verschiebt den Quellausschnitt, Position und Länge bleiben', status: 'ready' },
    { id: 'pen', key: 'P', label: 'Zeichenstift', hint: 'Keyframes auf Spuren zeichnen – noch nicht verfügbar', status: 'planned' },
    { id: 'hand', key: 'H', label: 'Hand', hint: 'Timeline durch Ziehen verschieben', status: 'ready' },
    { id: 'type', key: 'T', label: 'Text', hint: 'In den Programmmonitor klicken legt einen Textclip an der Abspielposition an', status: 'ready' },
];

const TOOL_IDS = EDITOR_TOOLS.map((tool) => tool.id);
const MONITOR_ZOOMS: MonitorZoom[] = ['fit', 25, 50, 75, 100, 150, 200];

/* ─── Default layouts ─── */

const group = (id: string, tabs: ProPanelId[], extra: Partial<DockGroup> = {}): DockGroup => ({ kind: 'group', id, tabs, active: tabs[0], ...extra });
const split = (id: string, dir: 'row' | 'col', sizes: number[], children: DockNode[]): DockSplit => ({ kind: 'split', id, dir, sizes, children });

const bottomRow = (projectTabs: ProPanelId[], projectSize: number, metersPx: number): DockSplit =>
    split('bottom', 'row', [projectSize, 0, 1 - projectSize, 0], [
        group('g-project', projectTabs),
        group('g-tools', ['tools'], { fixedPx: 38, compact: true }),
        group('g-timeline', ['timeline']),
        group('g-meters', ['meters'], { fixedPx: metersPx, compact: true }),
    ]);

export function createDefaultLayout(workspace: DockWorkspaceId): DockNode {
    switch (workspace) {
        case 'color':
            return split('root', 'col', [0.6, 0.4], [
                split('top', 'row', [0.32, 0.68], [
                    group('g-controls', ['effectControls', 'inspector', 'source', 'audioMixer']),
                    group('g-program', ['program']),
                ]),
                bottomRow(['project', 'effects', 'info', 'markers', 'history', 'titles', 'lookbook', 'music', 'autocut', 'agent'], 0.26, 64),
            ]);
        case 'effects':
            return split('root', 'col', [0.58, 0.42], [
                split('top', 'row', [0.3, 0.45, 0.25], [
                    group('g-controls', ['effectControls', 'source', 'inspector', 'audioMixer']),
                    group('g-program', ['program']),
                    group('g-effects', ['effects', 'titles', 'info']),
                ]),
                bottomRow(['project', 'markers', 'history', 'lookbook', 'music', 'autocut', 'agent'], 0.26, 64),
            ]);
        case 'audio':
            return split('root', 'col', [0.55, 0.45], [
                split('top', 'row', [0.45, 0.55], [
                    group('g-controls', ['audioMixer', 'effectControls', 'source', 'inspector']),
                    group('g-program', ['program']),
                ]),
                bottomRow(['project', 'music', 'effects', 'markers', 'history', 'info', 'titles', 'lookbook', 'autocut', 'agent'], 0.24, 96),
            ]);
        case 'editing':
        default:
            return split('root', 'col', [0.55, 0.45], [
                split('top', 'row', [0.5, 0.5], [
                    group('g-controls', ['source', 'effectControls', 'audioMixer', 'inspector']),
                    group('g-program', ['program']),
                ]),
                bottomRow(['project', 'effects', 'markers', 'history', 'info', 'titles', 'lookbook', 'music', 'autocut', 'agent'], 0.3, 64),
            ]);
    }
}

export function createDefaultProLayoutState(): ProLayoutState {
    return {
        version: 1,
        workspace: 'editing',
        layouts: {
            editing: createDefaultLayout('editing'),
            color: createDefaultLayout('color'),
            effects: createDefaultLayout('effects'),
            audio: createDefaultLayout('audio'),
        },
        tool: 'selection',
        maximizedGroupId: null,
        focusedPanel: 'timeline',
        hiddenTrackIds: [],
        safeMargins: false,
        monitorZoom: 'fit',
        projectView: 'icon',
    };
}

/** Where a closed panel goes when it is opened again from the window menu. */
const PANEL_HOME: Partial<Record<ProPanelId, ProPanelId[]>> = {
    source: ['effectControls', 'audioMixer', 'inspector'],
    effectControls: ['source', 'inspector', 'audioMixer'],
    audioMixer: ['source', 'effectControls'],
    inspector: ['effectControls', 'source'],
    transitions: ['effects', 'project'],
};
const DEFAULT_HOME: ProPanelId[] = ['project', 'effects'];

/* ─── Tree helpers ─── */

export function listPanels(node: DockNode): ProPanelId[] {
    if (node.kind === 'group') return [...node.tabs];
    return node.children.flatMap(listPanels);
}

export function listGroups(node: DockNode): DockGroup[] {
    if (node.kind === 'group') return [node];
    return node.children.flatMap(listGroups);
}

export function findGroup(node: DockNode, groupId: string): DockGroup | null {
    return listGroups(node).find((entry) => entry.id === groupId) ?? null;
}

export function findGroupOfPanel(node: DockNode, panel: ProPanelId): DockGroup | null {
    return listGroups(node).find((entry) => entry.tabs.includes(panel)) ?? null;
}

const mapGroups = (node: DockNode, fn: (entry: DockGroup) => DockGroup | null): DockNode | null => {
    if (node.kind === 'group') return fn(node);
    const children: DockNode[] = [];
    const sizes: number[] = [];
    node.children.forEach((child, index) => {
        const next = mapGroups(child, fn);
        if (next) {
            children.push(next);
            sizes.push(node.sizes[index] ?? 1);
        }
    });
    if (children.length === 0) return null;
    if (children.length === 1) return children[0];
    return { ...node, children, sizes };
};

const mapSplit = (node: DockNode, splitId: string, fn: (entry: DockSplit) => DockSplit): DockNode => {
    if (node.kind === 'group') return node;
    if (node.id === splitId) return fn(node);
    return { ...node, children: node.children.map((child) => mapSplit(child, splitId, fn)) };
};

const isFlexible = (node: DockNode) => node.kind === 'split' || !node.fixedPx;

/**
 * Moves the boundary at divider `index` (between child index and index+1).
 * Fixed children are skipped: the nearest flexible neighbours on each side
 * share the delta. `delta` is in the same units as `sizes`.
 */
export function resizeSizes(sizes: number[], flexible: boolean[], index: number, delta: number, minSize = 0.06): number[] {
    let left = -1;
    for (let i = Math.min(index, sizes.length - 1); i >= 0; i -= 1) if (flexible[i]) { left = i; break; }
    let right = -1;
    for (let i = index + 1; i < sizes.length; i += 1) if (flexible[i]) { right = i; break; }
    if (left < 0 || right < 0 || !Number.isFinite(delta)) return sizes;
    const total = sizes[left] + sizes[right];
    const min = Math.min(minSize, total / 2);
    const nextLeft = Math.max(min, Math.min(total - min, sizes[left] + delta));
    const next = [...sizes];
    next[left] = nextLeft;
    next[right] = total - nextLeft;
    return next;
}

/** Whether the divider between child `index` and `index + 1` can resize anything. */
export function canResizeAt(flexible: boolean[], index: number): boolean {
    return flexible.slice(0, index + 1).some(Boolean) && flexible.slice(index + 1).some(Boolean);
}

export function splitFlexibility(node: DockSplit): boolean[] {
    return node.children.map(isFlexible);
}

/* ─── Reducer ─── */

export type ProLayoutAction =
    | { type: 'setWorkspace'; workspace: ProWorkspaceId }
    | { type: 'resetWorkspace'; workspace?: DockWorkspaceId }
    | { type: 'resize'; splitId: string; sizes: number[] }
    | { type: 'activateTab'; groupId: string; panel: ProPanelId }
    | { type: 'moveTab'; panel: ProPanelId; toGroupId: string; index?: number }
    | { type: 'closePanel'; panel: ProPanelId }
    | { type: 'openPanel'; panel: ProPanelId; groupId?: string }
    | { type: 'toggleMaximize'; groupId?: string }
    | { type: 'setTool'; tool: EditorToolId }
    | { type: 'focusPanel'; panel: ProPanelId | null }
    | { type: 'toggleTrackHidden'; trackId: string }
    | { type: 'setSafeMargins'; value: boolean }
    | { type: 'setMonitorZoom'; zoom: MonitorZoom }
    | { type: 'setProjectView'; view: 'icon' | 'list' };

const withLayout = (state: ProLayoutState, fn: (layout: DockNode) => DockNode): ProLayoutState => {
    if (state.workspace === 'classic') return state;
    const current = state.layouts[state.workspace];
    const next = fn(current);
    if (next === current) return state;
    return { ...state, layouts: { ...state.layouts, [state.workspace]: next } };
};

export function proLayoutReducer(state: ProLayoutState, action: ProLayoutAction): ProLayoutState {
    switch (action.type) {
        case 'setWorkspace':
            if (state.workspace === action.workspace) return state;
            return { ...state, workspace: action.workspace, maximizedGroupId: null };
        case 'resetWorkspace': {
            const target = action.workspace ?? (state.workspace === 'classic' ? null : state.workspace);
            if (!target) return state;
            return { ...state, layouts: { ...state.layouts, [target]: createDefaultLayout(target) }, maximizedGroupId: null };
        }
        case 'resize':
            return withLayout(state, (layout) => mapSplit(layout, action.splitId, (entry) => {
                if (action.sizes.length !== entry.children.length || action.sizes.some((value) => !Number.isFinite(value) || value < 0)) return entry;
                return { ...entry, sizes: [...action.sizes] };
            }));
        case 'activateTab':
            return withLayout(state, (layout) => mapGroups(layout, (entry) => (
                entry.id === action.groupId && entry.tabs.includes(action.panel) ? { ...entry, active: action.panel } : entry
            )) ?? layout);
        case 'moveTab':
            return withLayout(state, (layout) => {
                const target = findGroup(layout, action.toGroupId);
                const source = findGroupOfPanel(layout, action.panel);
                if (!target || !source || target.compact || source.compact) return layout;
                if (source.id === target.id) {
                    if (action.index === undefined) return layout;
                    return mapGroups(layout, (entry) => {
                        if (entry.id !== target.id) return entry;
                        const tabs = entry.tabs.filter((tab) => tab !== action.panel);
                        tabs.splice(Math.max(0, Math.min(tabs.length, action.index ?? tabs.length)), 0, action.panel);
                        return { ...entry, tabs };
                    }) ?? layout;
                }
                return mapGroups(layout, (entry) => {
                    if (entry.id === source.id) {
                        const tabs = entry.tabs.filter((tab) => tab !== action.panel);
                        if (tabs.length === 0) return null;
                        return { ...entry, tabs, active: entry.active === action.panel ? tabs[0] : entry.active };
                    }
                    if (entry.id === target.id) {
                        const tabs = [...entry.tabs];
                        tabs.splice(Math.max(0, Math.min(tabs.length, action.index ?? tabs.length)), 0, action.panel);
                        return { ...entry, tabs, active: action.panel };
                    }
                    return entry;
                }) ?? layout;
            });
        case 'closePanel': {
            const next = withLayout(state, (layout) => {
                if (!findGroupOfPanel(layout, action.panel)) return layout;
                return mapGroups(layout, (entry) => {
                    if (!entry.tabs.includes(action.panel)) return entry;
                    const tabs = entry.tabs.filter((tab) => tab !== action.panel);
                    if (tabs.length === 0) return null;
                    return { ...entry, tabs, active: entry.active === action.panel ? tabs[0] : entry.active };
                }) ?? layout;
            });
            if (next === state) return state;
            const layout = next.workspace === 'classic' ? null : next.layouts[next.workspace];
            return {
                ...next,
                focusedPanel: next.focusedPanel === action.panel ? null : next.focusedPanel,
                maximizedGroupId: layout && next.maximizedGroupId && !findGroup(layout, next.maximizedGroupId) ? null : next.maximizedGroupId,
            };
        }
        case 'openPanel': {
            const next = withLayout(state, (layout) => {
                const existing = findGroupOfPanel(layout, action.panel);
                if (existing) {
                    return existing.active === action.panel ? layout : (mapGroups(layout, (entry) => (entry.id === existing.id ? { ...entry, active: action.panel } : entry)) ?? layout);
                }
                const groups = listGroups(layout).filter((entry) => !entry.compact);
                const explicit = action.groupId ? groups.find((entry) => entry.id === action.groupId) : undefined;
                const homes = PANEL_HOME[action.panel] ?? DEFAULT_HOME;
                const home = explicit
                    ?? homes.map((panel) => groups.find((entry) => entry.tabs.includes(panel))).find(Boolean)
                    ?? DEFAULT_HOME.map((panel) => groups.find((entry) => entry.tabs.includes(panel))).find(Boolean)
                    ?? groups[0];
                if (!home) return layout;
                return mapGroups(layout, (entry) => (entry.id === home.id ? { ...entry, tabs: [...entry.tabs, action.panel], active: action.panel } : entry)) ?? layout;
            });
            return next === state ? state : { ...next, focusedPanel: action.panel };
        }
        case 'toggleMaximize': {
            if (state.workspace === 'classic') return state;
            if (state.maximizedGroupId) return { ...state, maximizedGroupId: null };
            const layout = state.layouts[state.workspace];
            const targetId = action.groupId ?? (state.focusedPanel ? findGroupOfPanel(layout, state.focusedPanel)?.id : undefined);
            if (!targetId || !findGroup(layout, targetId)) return state;
            return { ...state, maximizedGroupId: targetId };
        }
        case 'setTool':
            return TOOL_IDS.includes(action.tool) && state.tool !== action.tool ? { ...state, tool: action.tool } : state;
        case 'focusPanel':
            return state.focusedPanel === action.panel ? state : { ...state, focusedPanel: action.panel };
        case 'toggleTrackHidden': {
            const hidden = state.hiddenTrackIds.includes(action.trackId)
                ? state.hiddenTrackIds.filter((id) => id !== action.trackId)
                : [...state.hiddenTrackIds, action.trackId];
            return { ...state, hiddenTrackIds: hidden };
        }
        case 'setSafeMargins':
            return state.safeMargins === action.value ? state : { ...state, safeMargins: action.value };
        case 'setMonitorZoom':
            return MONITOR_ZOOMS.includes(action.zoom) ? { ...state, monitorZoom: action.zoom } : state;
        case 'setProjectView':
            return { ...state, projectView: action.view === 'list' ? 'list' : 'icon' };
        default:
            return state;
    }
}

/* ─── Serialisation ─── */

const isPanelId = (value: unknown): value is ProPanelId => typeof value === 'string' && (ALL_PANEL_IDS as string[]).includes(value);

/** Validates a stored node; returns null when anything is off (caller falls back to the default). */
export function validateNode(raw: unknown, seenPanels = new Set<ProPanelId>(), seenIds = new Set<string>()): DockNode | null {
    if (!raw || typeof raw !== 'object') return null;
    const node = raw as Record<string, unknown>;
    if (typeof node.id !== 'string' || !node.id || seenIds.has(node.id)) return null;
    seenIds.add(node.id);
    if (node.kind === 'group') {
        if (!Array.isArray(node.tabs) || node.tabs.length === 0) return null;
        const tabs: ProPanelId[] = [];
        for (const tab of node.tabs) {
            if (!isPanelId(tab) || seenPanels.has(tab)) return null;
            seenPanels.add(tab);
            tabs.push(tab);
        }
        const active = isPanelId(node.active) && tabs.includes(node.active) ? node.active : tabs[0];
        const result: DockGroup = { kind: 'group', id: node.id, tabs, active };
        if (typeof node.fixedPx === 'number' && Number.isFinite(node.fixedPx) && node.fixedPx > 0) result.fixedPx = Math.round(Math.min(400, node.fixedPx));
        if (node.compact === true) result.compact = true;
        return result;
    }
    if (node.kind === 'split') {
        if (node.dir !== 'row' && node.dir !== 'col') return null;
        if (!Array.isArray(node.children) || node.children.length < 2) return null;
        if (!Array.isArray(node.sizes) || node.sizes.length !== node.children.length) return null;
        const children: DockNode[] = [];
        for (const child of node.children) {
            const parsed = validateNode(child, seenPanels, seenIds);
            if (!parsed) return null;
            children.push(parsed);
        }
        const sizes = node.sizes.map((value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 1));
        return { kind: 'split', id: node.id, dir: node.dir, sizes, children };
    }
    return null;
}

export function serializeProLayoutState(state: ProLayoutState): string {
    return JSON.stringify(state);
}

export function deserializeProLayoutState(raw: string | null | undefined): ProLayoutState {
    const fallback = createDefaultProLayoutState();
    if (!raw) return fallback;
    let parsed: Record<string, unknown>;
    try {
        const value = JSON.parse(raw);
        if (!value || typeof value !== 'object') return fallback;
        parsed = value as Record<string, unknown>;
    } catch {
        return fallback;
    }
    if (parsed.version !== 1) return fallback;
    const rawLayouts = (parsed.layouts && typeof parsed.layouts === 'object' ? parsed.layouts : {}) as Record<string, unknown>;
    const layouts = { ...fallback.layouts };
    (Object.keys(layouts) as DockWorkspaceId[]).forEach((workspace) => {
        const node = validateNode(rawLayouts[workspace]);
        if (node) layouts[workspace] = node;
    });
    const workspace = PRO_WORKSPACES.some((entry) => entry.id === parsed.workspace) ? parsed.workspace as ProWorkspaceId : fallback.workspace;
    const tool = TOOL_IDS.includes(parsed.tool as EditorToolId) ? parsed.tool as EditorToolId : fallback.tool;
    const zoom = MONITOR_ZOOMS.includes(parsed.monitorZoom as MonitorZoom) ? parsed.monitorZoom as MonitorZoom : fallback.monitorZoom;
    const maximized = typeof parsed.maximizedGroupId === 'string' && workspace !== 'classic' && findGroup(layouts[workspace], parsed.maximizedGroupId)
        ? parsed.maximizedGroupId
        : null;
    return {
        version: 1,
        workspace,
        layouts,
        tool,
        maximizedGroupId: maximized,
        focusedPanel: isPanelId(parsed.focusedPanel) ? parsed.focusedPanel : fallback.focusedPanel,
        hiddenTrackIds: Array.isArray(parsed.hiddenTrackIds) ? parsed.hiddenTrackIds.filter((id): id is string => typeof id === 'string').slice(0, 64) : [],
        safeMargins: parsed.safeMargins === true,
        monitorZoom: zoom,
        projectView: parsed.projectView === 'list' ? 'list' : 'icon',
    };
}

export function loadProLayoutState(storage: Pick<Storage, 'getItem'> | null | undefined): ProLayoutState {
    try {
        return deserializeProLayoutState(storage?.getItem(PRO_LAYOUT_STORAGE_KEY));
    } catch {
        return createDefaultProLayoutState();
    }
}

export function saveProLayoutState(storage: Pick<Storage, 'setItem'> | null | undefined, state: ProLayoutState): void {
    try {
        storage?.setItem(PRO_LAYOUT_STORAGE_KEY, serializeProLayoutState(state));
    } catch {
        /* storage full or blocked */
    }
}

/* ─── Tools ↔ trim modes ─── */

/** Trim mode a tool implies, or null when the tool leaves the trim mode alone. */
export function trimModeForTool(tool: EditorToolId): TrimModeId | null {
    if (tool === 'selection') return 'normal';
    if (tool === 'ripple') return 'ripple';
    if (tool === 'slip') return 'slip';
    return null;
}

/** Keeps the tool strip in sync when the trim mode changes elsewhere (R/O/U keys, Trim page). */
export function toolForTrimMode(trimMode: TrimModeId, current: EditorToolId): EditorToolId {
    if (current !== 'selection' && current !== 'ripple' && current !== 'slip') return current;
    if (trimMode === 'ripple') return 'ripple';
    if (trimMode === 'slip') return 'slip';
    return 'selection';
}

/* ─── Keyboard ─── */

export type ProShortcutAction =
    | { kind: 'tool'; tool: EditorToolId }
    | { kind: 'splitAtPlayhead' }
    | { kind: 'toggleMaximize' }
    | { kind: 'mark'; edge: 'in' | 'out'; target: 'program' }
    | { kind: 'toggleSourcePlayback' };

export type ShortcutKeyEvent = { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean };

const TOOL_KEYS: Record<string, EditorToolId> = Object.fromEntries(EDITOR_TOOLS.map((tool) => [tool.key.toLowerCase(), tool.id]));

/**
 * Keys owned by the pro layout. Everything else (Space, J/K/L, arrows,
 * Delete, undo, …) stays with the existing App/Timeline handlers.
 * Source-monitor transport keys are handled by the existing source hotkeys
 * while the source panel has focus.
 */
export function resolveProShortcut(event: ShortcutKeyEvent, focusedPanel: ProPanelId | null): ProShortcutAction | null {
    const key = (event.key || '').toLowerCase();
    const mod = Boolean(event.metaKey || event.ctrlKey);
    if (mod) {
        if (key === 'k' && !event.altKey && !event.shiftKey) return { kind: 'splitAtPlayhead' };
        return null;
    }
    if (event.altKey) return null;
    if (key === '`') return { kind: 'toggleMaximize' };
    if (event.shiftKey) return null;
    if (key === ' ' && focusedPanel === 'source') return { kind: 'toggleSourcePlayback' };
    if ((key === 'i' || key === 'o') && focusedPanel !== 'source') return { kind: 'mark', edge: key === 'i' ? 'in' : 'out', target: 'program' };
    const tool = TOOL_KEYS[key];
    if (tool) return { kind: 'tool', tool };
    return null;
}

/* ─── Type tool ─── */

export type TextAnchor = 'center' | 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';

/** Maps a click in the program monitor (0..1 fractions) to the nearest text anchor the renderer supports. */
export function textPositionForPoint(xFraction: number, yFraction: number): TextAnchor {
    const col = xFraction < 1 / 3 ? 'left' : xFraction > 2 / 3 ? 'right' : 'center';
    if (yFraction < 1 / 3) return `top-${col}` as TextAnchor;
    if (yFraction > 2 / 3) return `bottom-${col}` as TextAnchor;
    return 'center';
}
