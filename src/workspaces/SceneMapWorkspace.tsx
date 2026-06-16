import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type {
    SceneMapState,
    SceneMapScene,
    SceneMapElement,
    SceneMapElementType,
    ReferenceItem,
    ShotPrompt,
} from '../types';
import {
    ELEMENT_TEMPLATES,
    createSceneMapElement,
    createDefaultScene,
    createDefaultSceneMapState,
    getTemplateByType,
    snapToGrid,
    DEFAULT_GRID_SIZE,
} from '../data/sceneMapTypes';

interface SceneMapWorkspaceProps {
    sceneMap: SceneMapState | null;
    onChange: (next: SceneMapState) => void;
    references?: ReferenceItem[];
    shotPrompts?: ShotPrompt[];
}

const SceneMapWorkspace: React.FC<SceneMapWorkspaceProps> = ({
    sceneMap,
    onChange,
    references = [],
    shotPrompts = [],
}) => {
    const state = sceneMap || createDefaultSceneMapState();
    const activeScene = state.scenes.find((s) => s.id === state.activeSceneId) || state.scenes[0];
    const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [panStart, setPanStart] = useState({ x: 0, y: 0 });
    const canvasRef = useRef<HTMLDivElement>(null);

    const selectedElement = activeScene?.elements.find((e) => e.id === selectedElementId);

    // Ensure we have at least one scene
    useEffect(() => {
        if (!sceneMap || sceneMap.scenes.length === 0) {
            onChange(createDefaultSceneMapState());
        }
    }, [sceneMap, onChange]);

    const updateScene = useCallback(
        (sceneId: string, update: Partial<SceneMapScene>) => {
            onChange({
                ...state,
                scenes: state.scenes.map((s) => (s.id === sceneId ? { ...s, ...update } : s)),
            });
        },
        [state, onChange]
    );

    const updateElement = useCallback(
        (elementId: string, update: Partial<SceneMapElement>) => {
            if (!activeScene) return;
            updateScene(activeScene.id, {
                elements: activeScene.elements.map((e) =>
                    e.id === elementId ? { ...e, ...update } : e
                ),
            });
        },
        [activeScene, updateScene]
    );

    const addElement = useCallback(
        (type: SceneMapElementType, referenceId?: string) => {
            if (!activeScene) return;
            const reference = referenceId
                ? references.find((r) => r.id === referenceId)
                : undefined;
            const newElement = createSceneMapElement(type, { x: 200, y: 200 }, {
                referenceId,
                label: reference?.name || getTemplateByType(type)?.label || type,
                imageUrl: reference?.imageUrl || undefined,
            });
            updateScene(activeScene.id, {
                elements: [...activeScene.elements, newElement],
            });
            setSelectedElementId(newElement.id);
        },
        [activeScene, references, updateScene]
    );

    const removeElement = useCallback(
        (elementId: string) => {
            if (!activeScene) return;
            updateScene(activeScene.id, {
                elements: activeScene.elements.filter((e) => e.id !== elementId),
            });
            if (selectedElementId === elementId) {
                setSelectedElementId(null);
            }
        },
        [activeScene, selectedElementId, updateScene]
    );

    const addScene = useCallback(() => {
        const newScene = createDefaultScene(`Scene ${state.scenes.length + 1}`);
        onChange({
            ...state,
            scenes: [...state.scenes, newScene],
            activeSceneId: newScene.id,
        });
    }, [state, onChange]);

    const selectScene = useCallback(
        (sceneId: string) => {
            onChange({ ...state, activeSceneId: sceneId });
            setSelectedElementId(null);
        },
        [state, onChange]
    );

    const handleCanvasMouseDown = useCallback(
        (e: React.MouseEvent) => {
            if (e.button === 1 || (e.button === 0 && e.altKey)) {
                // Middle mouse or alt+click for panning
                setIsPanning(true);
                setPanStart({ x: e.clientX - state.viewport.x, y: e.clientY - state.viewport.y });
                e.preventDefault();
            } else if (e.target === canvasRef.current) {
                setSelectedElementId(null);
            }
        },
        [state.viewport]
    );

    const handleCanvasMouseMove = useCallback(
        (e: React.MouseEvent) => {
            if (isPanning) {
                onChange({
                    ...state,
                    viewport: {
                        ...state.viewport,
                        x: e.clientX - panStart.x,
                        y: e.clientY - panStart.y,
                    },
                });
            } else if (isDragging && selectedElementId && activeScene) {
                const rect = canvasRef.current?.getBoundingClientRect();
                if (!rect) return;
                const x = (e.clientX - rect.left - state.viewport.x) / state.viewport.zoom - dragOffset.x;
                const y = (e.clientY - rect.top - state.viewport.y) / state.viewport.zoom - dragOffset.y;
                const snappedX = snapToGrid(x, activeScene.gridSize);
                const snappedY = snapToGrid(y, activeScene.gridSize);
                updateElement(selectedElementId, { position: { x: snappedX, y: snappedY } });
            }
        },
        [isPanning, isDragging, selectedElementId, activeScene, state, panStart, dragOffset, onChange, updateElement]
    );

    const handleCanvasMouseUp = useCallback(() => {
        setIsPanning(false);
        setIsDragging(false);
    }, []);

    const handleWheel = useCallback(
        (e: React.WheelEvent) => {
            const scale = e.deltaY > 0 ? 0.9 : 1.1;
            const newZoom = Math.min(Math.max(state.viewport.zoom * scale, 0.25), 3);
            onChange({
                ...state,
                viewport: { ...state.viewport, zoom: newZoom },
            });
        },
        [state, onChange]
    );

    const handleElementMouseDown = useCallback(
        (e: React.MouseEvent, element: SceneMapElement) => {
            e.stopPropagation();
            setSelectedElementId(element.id);
            setIsDragging(true);
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) return;
            const mouseX = (e.clientX - rect.left - state.viewport.x) / state.viewport.zoom;
            const mouseY = (e.clientY - rect.top - state.viewport.y) / state.viewport.zoom;
            setDragOffset({ x: mouseX - element.position.x, y: mouseY - element.position.y });
        },
        [state.viewport]
    );

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            const data = e.dataTransfer.getData('application/json');
            if (!data) return;
            try {
                const { type, referenceId } = JSON.parse(data);
                const rect = canvasRef.current?.getBoundingClientRect();
                if (!rect || !activeScene) return;
                const x = (e.clientX - rect.left - state.viewport.x) / state.viewport.zoom;
                const y = (e.clientY - rect.top - state.viewport.y) / state.viewport.zoom;
                const reference = referenceId
                    ? references.find((r) => r.id === referenceId)
                    : undefined;
                const newElement = createSceneMapElement(type, {
                    x: snapToGrid(x, activeScene.gridSize),
                    y: snapToGrid(y, activeScene.gridSize),
                }, {
                    referenceId,
                    label: reference?.name || getTemplateByType(type)?.label || type,
                    imageUrl: reference?.imageUrl || undefined,
                });
                updateScene(activeScene.id, {
                    elements: [...activeScene.elements, newElement],
                });
                setSelectedElementId(newElement.id);
            } catch {
                // ignore invalid drag data
            }
        },
        [activeScene, references, state.viewport, updateScene]
    );

    const gridSize = activeScene?.gridSize || DEFAULT_GRID_SIZE;
    const zoomedGridSize = gridSize * state.viewport.zoom;

    // Group references by type
    const characterRefs = references.filter((r) => r.type === 'character');
    const propRefs = references.filter((r) => r.type === 'prop');
    const environmentRefs = references.filter((r) => r.type === 'environment');

    return (
        <div className="scene-map-workspace">
            {/* Scene Tabs */}
            <div className="scene-tabs">
                {state.scenes.map((scene) => (
                    <button
                        key={scene.id}
                        className={`scene-tab ${scene.id === activeScene?.id ? 'active' : ''}`}
                        onClick={() => selectScene(scene.id)}
                    >
                        {scene.name}
                    </button>
                ))}
                <button className="scene-tab add-tab" onClick={addScene}>
                    + New Scene
                </button>
            </div>

            <div className="scene-map-content">
                {/* Left Sidebar: Element Palette */}
                <div className="element-palette">
                    <h3>Elements</h3>
                    <div className="palette-section">
                        <h4>Add Elements</h4>
                        {ELEMENT_TEMPLATES.map((template) => (
                            <div
                                key={template.type}
                                className="palette-item"
                                draggable
                                onDragStart={(e) => {
                                    e.dataTransfer.setData(
                                        'application/json',
                                        JSON.stringify({ type: template.type })
                                    );
                                }}
                                onClick={() => addElement(template.type)}
                            >
                                <span className="palette-icon">{template.icon}</span>
                                <span>{template.label}</span>
                            </div>
                        ))}
                    </div>

                    {characterRefs.length > 0 && (
                        <div className="palette-section">
                            <h4>Characters</h4>
                            {characterRefs.map((ref) => (
                                <div
                                    key={ref.id}
                                    className="palette-item reference-item"
                                    draggable
                                    onDragStart={(e) => {
                                        e.dataTransfer.setData(
                                            'application/json',
                                            JSON.stringify({ type: 'character', referenceId: ref.id })
                                        );
                                    }}
                                    onClick={() => addElement('character', ref.id)}
                                >
                                    {ref.imageUrl && (
                                        <img src={ref.imageUrl} alt={ref.name} className="palette-thumb" />
                                    )}
                                    <span>{ref.name}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {propRefs.length > 0 && (
                        <div className="palette-section">
                            <h4>Props</h4>
                            {propRefs.map((ref) => (
                                <div
                                    key={ref.id}
                                    className="palette-item reference-item"
                                    draggable
                                    onDragStart={(e) => {
                                        e.dataTransfer.setData(
                                            'application/json',
                                            JSON.stringify({ type: 'prop', referenceId: ref.id })
                                        );
                                    }}
                                    onClick={() => addElement('prop', ref.id)}
                                >
                                    {ref.imageUrl && (
                                        <img src={ref.imageUrl} alt={ref.name} className="palette-thumb" />
                                    )}
                                    <span>{ref.name}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {environmentRefs.length > 0 && (
                        <div className="palette-section">
                            <h4>Environments</h4>
                            {environmentRefs.map((ref) => (
                                <div
                                    key={ref.id}
                                    className="palette-item reference-item"
                                    draggable
                                    onDragStart={(e) => {
                                        e.dataTransfer.setData(
                                            'application/json',
                                            JSON.stringify({ type: 'environment', referenceId: ref.id })
                                        );
                                    }}
                                    onClick={() => addElement('environment', ref.id)}
                                >
                                    {ref.imageUrl && (
                                        <img src={ref.imageUrl} alt={ref.name} className="palette-thumb" />
                                    )}
                                    <span>{ref.name}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Canvas Area */}
                <div
                    ref={canvasRef}
                    className="scene-canvas"
                    onMouseDown={handleCanvasMouseDown}
                    onMouseMove={handleCanvasMouseMove}
                    onMouseUp={handleCanvasMouseUp}
                    onMouseLeave={handleCanvasMouseUp}
                    onWheel={handleWheel}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                    style={{
                        backgroundImage: `
                            linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)
                        `,
                        backgroundSize: `${zoomedGridSize}px ${zoomedGridSize}px`,
                        backgroundPosition: `${state.viewport.x}px ${state.viewport.y}px`,
                    }}
                >
                    <div
                        className="canvas-transform"
                        style={{
                            transform: `translate(${state.viewport.x}px, ${state.viewport.y}px) scale(${state.viewport.zoom})`,
                            transformOrigin: '0 0',
                        }}
                    >
                        {activeScene?.elements.map((element) => {
                            const template = getTemplateByType(element.type);
                            const isSelected = element.id === selectedElementId;
                            return (
                                <div
                                    key={element.id}
                                    className={`scene-element ${isSelected ? 'selected' : ''}`}
                                    style={{
                                        left: element.position.x,
                                        top: element.position.y,
                                        width: element.size.width,
                                        height: element.size.height,
                                        transform: `rotate(${element.rotation}deg)`,
                                        backgroundColor: element.color || template?.defaultColor,
                                        borderColor: isSelected ? '#fff' : 'transparent',
                                    }}
                                    onMouseDown={(e) => handleElementMouseDown(e, element)}
                                >
                                    {element.imageUrl ? (
                                        <img
                                            src={element.imageUrl}
                                            alt={element.label}
                                            className="element-image"
                                            draggable={false}
                                        />
                                    ) : (
                                        <span className="element-icon">{template?.icon}</span>
                                    )}
                                    <span className="element-label">{element.label}</span>
                                </div>
                            );
                        })}
                    </div>

                    {/* Zoom indicator */}
                    <div className="zoom-indicator">
                        {Math.round(state.viewport.zoom * 100)}%
                    </div>
                </div>

                {/* Right Sidebar: Properties Panel */}
                <div className="properties-panel">
                    <h3>Properties</h3>
                    {selectedElement ? (
                        <div className="property-fields">
                            <div className="property-group">
                                <label>Label</label>
                                <input
                                    type="text"
                                    value={selectedElement.label}
                                    onChange={(e) => updateElement(selectedElement.id, { label: e.target.value })}
                                />
                            </div>

                            <div className="property-group">
                                <label>Position</label>
                                <div className="property-row">
                                    <input
                                        type="number"
                                        value={selectedElement.position.x}
                                        onChange={(e) =>
                                            updateElement(selectedElement.id, {
                                                position: { ...selectedElement.position, x: Number(e.target.value) },
                                            })
                                        }
                                    />
                                    <input
                                        type="number"
                                        value={selectedElement.position.y}
                                        onChange={(e) =>
                                            updateElement(selectedElement.id, {
                                                position: { ...selectedElement.position, y: Number(e.target.value) },
                                            })
                                        }
                                    />
                                </div>
                            </div>

                            <div className="property-group">
                                <label>Size</label>
                                <div className="property-row">
                                    <input
                                        type="number"
                                        value={selectedElement.size.width}
                                        onChange={(e) =>
                                            updateElement(selectedElement.id, {
                                                size: { ...selectedElement.size, width: Number(e.target.value) },
                                            })
                                        }
                                    />
                                    <input
                                        type="number"
                                        value={selectedElement.size.height}
                                        onChange={(e) =>
                                            updateElement(selectedElement.id, {
                                                size: { ...selectedElement.size, height: Number(e.target.value) },
                                            })
                                        }
                                    />
                                </div>
                            </div>

                            <div className="property-group">
                                <label>Rotation</label>
                                <input
                                    type="number"
                                    value={selectedElement.rotation}
                                    onChange={(e) =>
                                        updateElement(selectedElement.id, { rotation: Number(e.target.value) })
                                    }
                                />
                            </div>

                            <div className="property-group">
                                <label>Color</label>
                                <input
                                    type="color"
                                    value={selectedElement.color || '#6366f1'}
                                    onChange={(e) => updateElement(selectedElement.id, { color: e.target.value })}
                                />
                            </div>

                            <div className="property-group">
                                <label>Linked Shots</label>
                                <div className="linked-shots">
                                    {shotPrompts.map((shot) => {
                                        const isLinked = selectedElement.linkedShotNumbers?.includes(shot.shot);
                                        return (
                                            <button
                                                key={shot.shot}
                                                className={`shot-chip ${isLinked ? 'linked' : ''}`}
                                                onClick={() => {
                                                    const current = selectedElement.linkedShotNumbers || [];
                                                    const next = isLinked
                                                        ? current.filter((n) => n !== shot.shot)
                                                        : [...current, shot.shot];
                                                    updateElement(selectedElement.id, { linkedShotNumbers: next });
                                                }}
                                            >
                                                {shot.shot}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <button className="delete-btn" onClick={() => removeElement(selectedElement.id)}>
                                Delete Element
                            </button>
                        </div>
                    ) : (
                        <p className="no-selection">Select an element to edit its properties</p>
                    )}
                </div>
            </div>

            <style>{`
                .scene-map-workspace {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    background: var(--background-primary, #0b0f19);
                    color: var(--text-primary, #fff);
                }

                .scene-tabs {
                    display: flex;
                    gap: 4px;
                    padding: 8px 12px;
                    background: var(--background-secondary, #1a1f2e);
                    border-bottom: 1px solid var(--border-color, #2a2f3e);
                    overflow-x: auto;
                }

                .scene-tab {
                    padding: 8px 16px;
                    background: var(--background-tertiary, #252a3a);
                    border: 1px solid var(--border-color, #2a2f3e);
                    border-radius: 6px;
                    color: var(--text-secondary, #888);
                    cursor: pointer;
                    transition: all 0.2s;
                    font-size: 13px;
                }

                .scene-tab:hover {
                    background: var(--background-hover, #2a2f3e);
                    color: var(--text-primary, #fff);
                }

                .scene-tab.active {
                    background: var(--accent-primary, #6366f1);
                    color: #fff;
                    border-color: var(--accent-primary, #6366f1);
                }

                .scene-tab.add-tab {
                    background: transparent;
                    border-style: dashed;
                }

                .scene-map-content {
                    display: flex;
                    flex: 1;
                    overflow: hidden;
                }

                .element-palette {
                    width: 220px;
                    padding: 12px;
                    background: var(--background-secondary, #1a1f2e);
                    border-right: 1px solid var(--border-color, #2a2f3e);
                    overflow-y: auto;
                }

                .element-palette h3 {
                    margin: 0 0 12px;
                    font-size: 14px;
                    font-weight: 600;
                }

                .palette-section {
                    margin-bottom: 16px;
                }

                .palette-section h4 {
                    margin: 0 0 8px;
                    font-size: 11px;
                    text-transform: uppercase;
                    color: var(--text-secondary, #888);
                }

                .palette-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px;
                    background: var(--background-tertiary, #252a3a);
                    border-radius: 6px;
                    margin-bottom: 4px;
                    cursor: grab;
                    transition: background 0.2s;
                    font-size: 13px;
                }

                .palette-item:hover {
                    background: var(--background-hover, #2a2f3e);
                }

                .palette-icon {
                    font-size: 18px;
                }

                .palette-thumb {
                    width: 28px;
                    height: 28px;
                    border-radius: 4px;
                    object-fit: cover;
                }

                .scene-canvas {
                    flex: 1;
                    position: relative;
                    overflow: hidden;
                    cursor: crosshair;
                    background: var(--background-primary, #0b0f19);
                }

                .canvas-transform {
                    position: absolute;
                    top: 0;
                    left: 0;
                }

                .scene-element {
                    position: absolute;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    border-radius: 6px;
                    border: 2px solid transparent;
                    cursor: move;
                    transition: border-color 0.15s, box-shadow 0.15s;
                    overflow: hidden;
                }

                .scene-element.selected {
                    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.5);
                }

                .element-image {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    border-radius: 4px;
                }

                .element-icon {
                    font-size: 20px;
                }

                .element-label {
                    position: absolute;
                    bottom: -18px;
                    font-size: 10px;
                    white-space: nowrap;
                    color: var(--text-secondary, #888);
                    text-shadow: 0 1px 2px rgba(0,0,0,0.5);
                }

                .zoom-indicator {
                    position: absolute;
                    bottom: 12px;
                    right: 12px;
                    padding: 4px 8px;
                    background: rgba(0,0,0,0.6);
                    border-radius: 4px;
                    font-size: 11px;
                    color: var(--text-secondary, #888);
                }

                .properties-panel {
                    width: 260px;
                    padding: 12px;
                    background: var(--background-secondary, #1a1f2e);
                    border-left: 1px solid var(--border-color, #2a2f3e);
                    overflow-y: auto;
                }

                .properties-panel h3 {
                    margin: 0 0 16px;
                    font-size: 14px;
                    font-weight: 600;
                }

                .property-fields {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }

                .property-group {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .property-group label {
                    font-size: 11px;
                    text-transform: uppercase;
                    color: var(--text-secondary, #888);
                }

                .property-group input {
                    padding: 8px;
                    background: var(--background-tertiary, #252a3a);
                    border: 1px solid var(--border-color, #2a2f3e);
                    border-radius: 4px;
                    color: var(--text-primary, #fff);
                    font-size: 13px;
                }

                .property-group input[type="color"] {
                    height: 36px;
                    padding: 4px;
                    cursor: pointer;
                }

                .property-row {
                    display: flex;
                    gap: 8px;
                }

                .property-row input {
                    flex: 1;
                    min-width: 0;
                }

                .linked-shots {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 4px;
                }

                .shot-chip {
                    padding: 4px 10px;
                    background: var(--background-tertiary, #252a3a);
                    border: 1px solid var(--border-color, #2a2f3e);
                    border-radius: 12px;
                    font-size: 11px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .shot-chip:hover {
                    background: var(--background-hover, #2a2f3e);
                }

                .shot-chip.linked {
                    background: var(--accent-primary, #6366f1);
                    border-color: var(--accent-primary, #6366f1);
                    color: #fff;
                }

                .delete-btn {
                    margin-top: 12px;
                    padding: 10px;
                    background: #ef4444;
                    border: none;
                    border-radius: 6px;
                    color: #fff;
                    font-size: 13px;
                    cursor: pointer;
                    transition: background 0.2s;
                }

                .delete-btn:hover {
                    background: #dc2626;
                }

                .no-selection {
                    color: var(--text-secondary, #888);
                    font-size: 13px;
                    text-align: center;
                    padding: 20px;
                }
            `}</style>
        </div>
    );
};

export default SceneMapWorkspace;
