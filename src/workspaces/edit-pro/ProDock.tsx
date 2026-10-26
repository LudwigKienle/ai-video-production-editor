/**
 * Renders a ProLayoutState dock tree: resizable splits and tabbed panel
 * groups. Tabs can be dragged onto another group's tab strip to re-dock them,
 * double-clicked (or `) to maximise, and closed / reopened via the window menu.
 */
import React, { useRef, useState } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import {
    canResizeAt,
    findGroup,
    PRO_PANELS,
    resizeSizes,
    splitFlexibility,
    type DockGroup,
    type DockNode,
    type DockSplit,
    type ProLayoutAction,
    type ProLayoutState,
    type ProPanelId,
} from './proLayout';

const PANEL_DRAG_TYPE = 'application/x-pp-panel';
const DIVIDER_PX = 4;

type DockContext = {
    state: ProLayoutState;
    dispatch: (action: ProLayoutAction) => void;
    renderPanel: (panel: ProPanelId) => React.ReactNode;
    /** Optional per-panel header extras (right side of the tab strip). */
    renderHeaderExtras?: (panel: ProPanelId) => React.ReactNode;
};

const Divider: React.FC<{ dir: 'row' | 'col'; enabled: boolean; onDragStart: (event: React.MouseEvent) => void; automationId: string }> = ({ dir, enabled, onDragStart, automationId }) => (
    <div
        className={`ppx-divider ppx-divider--${dir} ${enabled ? '' : 'ppx-divider--static'}`}
        onMouseDown={enabled ? onDragStart : undefined}
        data-automation-id={automationId}
        role={enabled ? 'separator' : undefined}
        aria-orientation={dir === 'row' ? 'vertical' : 'horizontal'}
        style={{ flex: `0 0 ${DIVIDER_PX}px` }}
    />
);

const SplitView: React.FC<{ node: DockSplit; ctx: DockContext }> = ({ node, ctx }) => {
    const ref = useRef<HTMLDivElement>(null);
    const flexible = splitFlexibility(node);

    const startResize = (index: number) => (event: React.MouseEvent) => {
        event.preventDefault();
        const element = ref.current;
        if (!element) return;
        const horizontal = node.dir === 'row';
        const total = horizontal ? element.clientWidth : element.clientHeight;
        const fixedPx = node.children.reduce((sum, child, i) => sum + (flexible[i] ? 0 : (child.kind === 'group' ? child.fixedPx ?? 0 : 0)), 0);
        const flexPx = Math.max(1, total - fixedPx - DIVIDER_PX * (node.children.length - 1));
        const startSizes = [...node.sizes];
        const flexSum = startSizes.reduce((sum, size, i) => sum + (flexible[i] ? size : 0), 0) || 1;
        const start = horizontal ? event.clientX : event.clientY;
        document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none';
        const move = (ev: MouseEvent) => {
            const delta = ((horizontal ? ev.clientX : ev.clientY) - start) / flexPx * flexSum;
            ctx.dispatch({ type: 'resize', splitId: node.id, sizes: resizeSizes(startSizes, flexible, index, delta, flexSum * Math.min(0.45, 90 / flexPx)) });
        };
        const up = () => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };

    return (
        <div ref={ref} className={`ppx-split ppx-split--${node.dir}`} data-automation-id={`pp.split.${node.id}`}>
            {node.children.map((child, index) => {
                const fixed = child.kind === 'group' && child.fixedPx ? child.fixedPx : null;
                return (
                    <React.Fragment key={child.id}>
                        {index > 0 && (
                            <Divider
                                dir={node.dir}
                                enabled={canResizeAt(flexible, index - 1)}
                                onDragStart={startResize(index - 1)}
                                automationId={`pp.divider.${node.id}.${index - 1}`}
                            />
                        )}
                        <div
                            className="ppx-split__cell"
                            style={fixed ? { flex: `0 0 ${fixed}px` } : { flex: `${Math.max(0.0001, node.sizes[index] ?? 1)} 1 0px` }}
                        >
                            <NodeView node={child} ctx={ctx} />
                        </div>
                    </React.Fragment>
                );
            })}
        </div>
    );
};

const GroupView: React.FC<{ node: DockGroup; ctx: DockContext }> = ({ node, ctx }) => {
    const { state, dispatch } = ctx;
    const [dropActive, setDropActive] = useState(false);
    const focused = state.focusedPanel !== null && node.tabs.includes(state.focusedPanel);
    const maximized = state.maximizedGroupId === node.id;

    const acceptsDrop = (event: React.DragEvent) => !node.compact && Array.from(event.dataTransfer.types).includes(PANEL_DRAG_TYPE);
    const onDragOver = (event: React.DragEvent) => {
        if (!acceptsDrop(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        if (!dropActive) setDropActive(true);
    };
    const onDrop = (event: React.DragEvent) => {
        setDropActive(false);
        if (!acceptsDrop(event)) return;
        event.preventDefault();
        const panel = event.dataTransfer.getData(PANEL_DRAG_TYPE) as ProPanelId;
        if (panel) dispatch({ type: 'moveTab', panel, toGroupId: node.id });
    };

    return (
        <section
            className={`ppx-group ${focused ? 'ppx-group--focused' : ''} ${node.compact ? 'ppx-group--compact' : ''} ${dropActive ? 'ppx-group--drop' : ''}`}
            data-automation-id={`pp.group.${node.id}`}
            data-active-panel={node.active}
            onMouseDownCapture={() => dispatch({ type: 'focusPanel', panel: node.active })}
            onDragOver={onDragOver}
            onDragLeave={() => setDropActive(false)}
            onDrop={onDrop}
        >
            {!node.compact && (
                <header className="ppx-group__head">
                    <div className="ppx-tabs" role="tablist">
                        {node.tabs.map((panel) => (
                            <button
                                key={panel}
                                type="button"
                                role="tab"
                                aria-selected={node.active === panel}
                                className={`ppx-tab ${node.active === panel ? 'ppx-tab--active' : ''}`}
                                draggable
                                onDragStart={(event) => {
                                    event.dataTransfer.setData(PANEL_DRAG_TYPE, panel);
                                    event.dataTransfer.effectAllowed = 'move';
                                }}
                                onClick={() => {
                                    dispatch({ type: 'activateTab', groupId: node.id, panel });
                                    dispatch({ type: 'focusPanel', panel });
                                }}
                                onDoubleClick={() => dispatch({ type: 'toggleMaximize', groupId: node.id })}
                                title={`${PRO_PANELS[panel].hint} · ziehen zum Andocken, Doppelklick maximiert`}
                                data-automation-id={`pp.tab.${panel}`}
                            >
                                {PRO_PANELS[panel].label}
                            </button>
                        ))}
                    </div>
                    <div className="ppx-group__tools">
                        {ctx.renderHeaderExtras?.(node.active)}
                        <button
                            type="button"
                            className="ppx-icon"
                            onClick={() => dispatch({ type: 'toggleMaximize', groupId: node.id })}
                            title={maximized ? 'Wiederherstellen (`)' : 'Maximieren (`)'}
                            data-automation-id={`pp.group.${node.id}.maximize`}
                        >
                            {maximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                        </button>
                        <button
                            type="button"
                            className="ppx-icon"
                            onClick={() => dispatch({ type: 'closePanel', panel: node.active })}
                            title={`${PRO_PANELS[node.active].label} schließen (über „Fenster“ wieder öffnen)`}
                            data-automation-id={`pp.panel.${node.active}.close`}
                        >
                            <X size={12} />
                        </button>
                    </div>
                </header>
            )}
            <div className="ppx-group__body" data-automation-id={`pp.panel.${node.active}`}>
                {ctx.renderPanel(node.active)}
            </div>
        </section>
    );
};

const NodeView: React.FC<{ node: DockNode; ctx: DockContext }> = ({ node, ctx }) => (
    node.kind === 'split' ? <SplitView node={node} ctx={ctx} /> : <GroupView node={node} ctx={ctx} />
);

const ProDock: React.FC<DockContext & { layout: DockNode }> = ({ layout, ...ctx }) => {
    const maximized = ctx.state.maximizedGroupId ? findGroup(layout, ctx.state.maximizedGroupId) : null;
    return (
        <div className="ppx-dock" data-automation-id="pp.dock">
            {maximized ? <GroupView node={maximized} ctx={ctx} /> : <NodeView node={layout} ctx={ctx} />}
        </div>
    );
};

export default ProDock;
