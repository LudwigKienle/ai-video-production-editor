import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ALL_PANEL_IDS,
    canResizeAt,
    createDefaultLayout,
    createDefaultProLayoutState,
    deserializeProLayoutState,
    findGroup,
    findGroupOfPanel,
    listPanels,
    loadProLayoutState,
    proLayoutReducer,
    PRO_LAYOUT_STORAGE_KEY,
    resizeSizes,
    resolveProShortcut,
    saveProLayoutState,
    serializeProLayoutState,
    textPositionForPoint,
    toolForTrimMode,
    trimModeForTool,
    validateNode,
} from './proLayout.ts';
import type { DockSplit, DockWorkspaceId } from './proLayout.ts';

const WORKSPACES: DockWorkspaceId[] = ['editing', 'color', 'effects', 'audio'];

test('default layouts contain every core panel exactly once', () => {
    for (const workspace of WORKSPACES) {
        const panels = listPanels(createDefaultLayout(workspace));
        assert.equal(new Set(panels).size, panels.length, `${workspace} has duplicate panels`);
        for (const core of ['source', 'program', 'timeline', 'tools', 'meters', 'project', 'effects', 'effectControls', 'audioMixer', 'markers', 'history', 'info'] as const) {
            assert.ok(panels.includes(core), `${workspace} misses ${core}`);
        }
        assert.ok(validateNode(createDefaultLayout(workspace)), `${workspace} does not validate`);
    }
});

test('editing layout puts source/program on top and tools, timeline, meters at the bottom', () => {
    const root = createDefaultLayout('editing') as DockSplit;
    assert.equal(root.dir, 'col');
    const [top, bottom] = root.children as DockSplit[];
    assert.deepEqual(listPanels(top).slice(0, 1), ['source']);
    assert.ok(listPanels(top).includes('program'));
    assert.deepEqual(bottom.children.map((child) => (child.kind === 'group' ? child.tabs[0] : null)), ['project', 'tools', 'timeline', 'meters']);
});

test('serialisation round-trips and survives garbage', () => {
    const state = proLayoutReducer(proLayoutReducer(createDefaultProLayoutState(), { type: 'setWorkspace', workspace: 'audio' }), { type: 'setTool', tool: 'razor' });
    const restored = deserializeProLayoutState(serializeProLayoutState(state));
    assert.deepEqual(restored, state);
    assert.deepEqual(deserializeProLayoutState('{nope'), createDefaultProLayoutState());
    assert.deepEqual(deserializeProLayoutState(null), createDefaultProLayoutState());
    const partial = deserializeProLayoutState(JSON.stringify({ version: 1, workspace: 'color', tool: 'laser', layouts: { editing: { kind: 'group', id: 'x', tabs: ['nope'] } } }));
    assert.equal(partial.workspace, 'color');
    assert.equal(partial.tool, 'selection');
    assert.deepEqual(partial.layouts.editing, createDefaultLayout('editing'));
});

test('validateNode rejects duplicate panels and ids', () => {
    assert.equal(validateNode({ kind: 'split', id: 'r', dir: 'row', sizes: [1, 1], children: [
        { kind: 'group', id: 'a', tabs: ['program'], active: 'program' },
        { kind: 'group', id: 'b', tabs: ['program'], active: 'program' },
    ] }), null);
    assert.equal(validateNode({ kind: 'split', id: 'r', dir: 'row', sizes: [1, 1], children: [
        { kind: 'group', id: 'a', tabs: ['program'], active: 'program' },
        { kind: 'group', id: 'a', tabs: ['source'], active: 'source' },
    ] }), null);
});

test('storage helpers tolerate throwing storage', () => {
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
    assert.deepEqual(loadProLayoutState(throwing), createDefaultProLayoutState());
    assert.doesNotThrow(() => saveProLayoutState(throwing, createDefaultProLayoutState()));
    const store = new Map<string, string>();
    const memory = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
    const state = proLayoutReducer(createDefaultProLayoutState(), { type: 'setSafeMargins', value: true });
    saveProLayoutState(memory, state);
    assert.ok(store.has(PRO_LAYOUT_STORAGE_KEY));
    assert.equal(loadProLayoutState(memory).safeMargins, true);
});

test('moveTab moves a panel between groups and removes emptied groups', () => {
    let state = createDefaultProLayoutState();
    state = proLayoutReducer(state, { type: 'moveTab', panel: 'effects', toGroupId: 'g-controls' });
    const layout = state.layouts.editing;
    assert.equal(findGroupOfPanel(layout, 'effects')?.id, 'g-controls');
    assert.equal(findGroup(layout, 'g-controls')?.active, 'effects');
    assert.ok(!findGroup(layout, 'g-project')?.tabs.includes('effects'));
    // Program group has one tab: moving it away removes the group and collapses the split.
    state = proLayoutReducer(state, { type: 'moveTab', panel: 'program', toGroupId: 'g-controls' });
    assert.equal(findGroup(state.layouts.editing, 'g-program'), null);
    assert.ok(validateNode(state.layouts.editing));
    // Compact groups do not accept tabs.
    const before = state;
    state = proLayoutReducer(state, { type: 'moveTab', panel: 'info', toGroupId: 'g-tools' });
    assert.equal(state, before);
});

test('close and reopen a panel', () => {
    let state = createDefaultProLayoutState();
    state = proLayoutReducer(state, { type: 'closePanel', panel: 'history' });
    assert.ok(!listPanels(state.layouts.editing).includes('history'));
    state = proLayoutReducer(state, { type: 'openPanel', panel: 'history' });
    assert.equal(findGroupOfPanel(state.layouts.editing, 'history')?.id, 'g-project');
    assert.equal(state.focusedPanel, 'history');
    state = proLayoutReducer(state, { type: 'openPanel', panel: 'transitions' });
    assert.ok(listPanels(state.layouts.editing).includes('transitions'));
    for (const panel of ALL_PANEL_IDS) state = proLayoutReducer(state, { type: 'openPanel', panel });
    assert.equal(new Set(listPanels(state.layouts.editing)).size, ALL_PANEL_IDS.length);
});

test('layout actions are no-ops in the classic workspace and maximize toggles', () => {
    let state = proLayoutReducer(createDefaultProLayoutState(), { type: 'setWorkspace', workspace: 'classic' });
    assert.equal(proLayoutReducer(state, { type: 'closePanel', panel: 'program' }), state);
    state = proLayoutReducer(state, { type: 'setWorkspace', workspace: 'editing' });
    state = proLayoutReducer(state, { type: 'focusPanel', panel: 'program' });
    state = proLayoutReducer(state, { type: 'toggleMaximize' });
    assert.equal(state.maximizedGroupId, 'g-program');
    state = proLayoutReducer(state, { type: 'toggleMaximize' });
    assert.equal(state.maximizedGroupId, null);
});

test('resize keeps totals and skips fixed children', () => {
    const flexible = [true, false, true, false];
    const next = resizeSizes([0.3, 0, 0.7, 0], flexible, 0, 0.1);
    assert.deepEqual(next.map((value) => Math.round(value * 100) / 100), [0.4, 0, 0.6, 0]);
    // Divider between tools (fixed) and timeline still moves project/timeline boundary.
    assert.deepEqual(resizeSizes([0.3, 0, 0.7, 0], flexible, 1, -0.1).map((value) => Math.round(value * 100) / 100), [0.2, 0, 0.8, 0]);
    // Clamped to the minimum.
    assert.ok(resizeSizes([0.3, 0, 0.7, 0], flexible, 0, -5)[0] >= 0.06 - 1e-9);
    assert.equal(canResizeAt(flexible, 2), false);
    assert.equal(canResizeAt(flexible, 0), true);
    let state = createDefaultProLayoutState();
    state = proLayoutReducer(state, { type: 'resize', splitId: 'top', sizes: [0.4, 0.6] });
    assert.deepEqual(((state.layouts.editing as DockSplit).children[0] as DockSplit).sizes, [0.4, 0.6]);
    const same = proLayoutReducer(state, { type: 'resize', splitId: 'top', sizes: [1] });
    assert.deepEqual(((same.layouts.editing as DockSplit).children[0] as DockSplit).sizes, [0.4, 0.6]);
});

test('tool and trim mode stay in sync', () => {
    assert.equal(trimModeForTool('selection'), 'normal');
    assert.equal(trimModeForTool('ripple'), 'ripple');
    assert.equal(trimModeForTool('slip'), 'slip');
    assert.equal(trimModeForTool('razor'), null);
    assert.equal(toolForTrimMode('ripple', 'selection'), 'ripple');
    assert.equal(toolForTrimMode('roll', 'ripple'), 'selection');
    assert.equal(toolForTrimMode('ripple', 'razor'), 'razor');
});

test('shortcut mapping', () => {
    assert.deepEqual(resolveProShortcut({ key: 'c' }, 'timeline'), { kind: 'tool', tool: 'razor' });
    assert.deepEqual(resolveProShortcut({ key: 'A' }, null), { kind: 'tool', tool: 'trackForward' });
    assert.deepEqual(resolveProShortcut({ key: 't' }, 'program'), { kind: 'tool', tool: 'type' });
    assert.deepEqual(resolveProShortcut({ key: 'k', metaKey: true }, 'timeline'), { kind: 'splitAtPlayhead' });
    assert.deepEqual(resolveProShortcut({ key: 'k', ctrlKey: true }, 'timeline'), { kind: 'splitAtPlayhead' });
    assert.equal(resolveProShortcut({ key: 'k' }, 'timeline'), null, 'plain K stays with the App transport');
    assert.equal(resolveProShortcut({ key: ' ' }, 'timeline'), null, 'Space stays with the App');
    assert.deepEqual(resolveProShortcut({ key: ' ' }, 'source'), { kind: 'toggleSourcePlayback' });
    assert.deepEqual(resolveProShortcut({ key: 'i' }, 'program'), { kind: 'mark', edge: 'in', target: 'program' });
    assert.equal(resolveProShortcut({ key: 'i' }, 'source'), null, 'source marks use the source hotkeys');
    assert.equal(resolveProShortcut({ key: 'c', metaKey: true }, 'timeline'), null, 'copy stays with the Timeline');
    assert.equal(resolveProShortcut({ key: 'v', altKey: true }, 'timeline'), null, 'Alt+V stays with the App');
    assert.equal(resolveProShortcut({ key: 'z', metaKey: true }, 'timeline'), null);
    assert.deepEqual(resolveProShortcut({ key: '`' }, 'program'), { kind: 'toggleMaximize' });
});

test('type tool click maps to a text anchor', () => {
    assert.equal(textPositionForPoint(0.1, 0.1), 'top-left');
    assert.equal(textPositionForPoint(0.5, 0.9), 'bottom-center');
    assert.equal(textPositionForPoint(0.9, 0.5), 'center');
    assert.equal(textPositionForPoint(0.9, 0.95), 'bottom-right');
});
