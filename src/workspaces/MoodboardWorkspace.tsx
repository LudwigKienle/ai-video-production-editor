import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { StoryBible } from '../types';
import {
    CategorizedMoodboard,
    MoodboardCategory,
    MoodboardConnector,
    MoodboardItem,
    createDefaultCategorizedMoodboard,
    getCategoryItemCount,
    getItemsByCategory,
} from '../data/moodboardTypes';
import { extractFramesFromVideoUrl, isLikelyVideoUrl, resolveImageFromWebUrl, searchWikimediaCommonsImages } from '../services/moodboardResearchService';
import { UploadIcon, TrashIcon, AddIcon, SearchIcon, ImageIcon, TextIcon, GridIcon, XIcon } from '../components/icons';

/**
 * Moodboard — an infinite canvas in the spirit of PureRef and Miro.
 *
 * - Pan with space+drag, middle mouse, two-finger trackpad scroll, or one-finger touch on empty space.
 * - Zoom with pinch (trackpad/touch), ⌘/ctrl+wheel, or the zoom controls.
 * - Double-click empty space to add something at that point; double-click an image to preview it.
 * - Drop files or paste images straight onto the board.
 */

interface MoodboardWorkspaceProps {
    storyBible: StoryBible;
    setStoryBible: React.Dispatch<React.SetStateAction<StoryBible>>;
}

type Tool = 'select' | 'hand' | 'note' | 'text' | 'connect';

type Viewport = { x: number; y: number; zoom: number };

type Layout = NonNullable<MoodboardItem['layout']>;

type DragMode =
    | { type: 'move'; ids: string[]; origins: Record<string, { x: number; y: number }>; startWorld: { x: number; y: number }; moved: boolean }
    | { type: 'resize'; id: string; origin: Layout; startWorld: { x: number; y: number }; aspect: number | null }
    | { type: 'pan'; startClient: { x: number; y: number }; origin: Viewport }
    | { type: 'marquee'; startWorld: { x: number; y: number }; currentWorld: { x: number; y: number }; additive: boolean };

type QuickAdd = { world: { x: number; y: number }; client: { x: number; y: number } };

const NOTE_COLORS = ['#FFE58F', '#FFC2A8', '#B8E7C8', '#BFE3FF', '#E4C9FF', '#F6F6F6'];
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const NUDGE = 10;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const buildId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const defaultSize = (kind: MoodboardItem['kind']) => {
    if (kind === 'note') return { width: 220, height: 220 };
    if (kind === 'text') return { width: 320, height: 90 };
    return { width: 320, height: 240 };
};

const createLayout = (index: number, kind: MoodboardItem['kind'], zIndex: number): Layout => {
    const size = defaultSize(kind);
    const col = index % 5;
    const row = Math.floor(index / 5);
    return { x: 80 + col * 360, y: 80 + row * 300, ...size, zIndex };
};

const layoutOf = (item: MoodboardItem, index = 0): Layout =>
    item.layout || createLayout(index, item.kind, index + 1);

const isTextLike = (item: MoodboardItem) => item.kind === 'text' || item.kind === 'note';

const rectsIntersect = (a: Layout, b: { x: number; y: number; width: number; height: number }) =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

const loadImageSize = (url: string) =>
    new Promise<{ width: number; height: number }>((resolve) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth || 320, height: image.naturalHeight || 240 });
        image.onerror = () => resolve({ width: 320, height: 240 });
        image.src = url;
    });

const fitImageSize = (width: number, height: number, maxSide = 360) => {
    const scale = Math.min(1, maxSide / Math.max(width, height));
    return { width: Math.max(80, Math.round(width * scale)), height: Math.max(60, Math.round(height * scale)) };
};

const MoodboardWorkspace: React.FC<MoodboardWorkspaceProps> = ({ storyBible, setStoryBible }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<DragMode | null>(null);
    const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
    const pinchRef = useRef<{ distance: number; center: { x: number; y: number }; origin: Viewport } | null>(null);
    const spaceHeldRef = useRef(false);
    const viewportsRef = useRef<Record<string, Viewport>>({});

    const [selectedCategoryId, setSelectedCategoryId] = useState<string>('color_palette');
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [newCategoryIcon, setNewCategoryIcon] = useState('📌');
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [tool, setTool] = useState<Tool>('select');
    const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [editingId, setEditingId] = useState<string | null>(null);
    const [previewItem, setPreviewItem] = useState<MoodboardItem | null>(null);
    const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
    const [quickAdd, setQuickAdd] = useState<QuickAdd | null>(null);
    const [quickAddUrl, setQuickAddUrl] = useState('');
    const [connectFrom, setConnectFrom] = useState<string | null>(null);
    const [isDropping, setIsDropping] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [researchOpen, setResearchOpen] = useState(false);
    const [researchQuery, setResearchQuery] = useState('');
    const [researchUrls, setResearchUrls] = useState('');
    const [isResearching, setIsResearching] = useState(false);
    const [researchStatus, setResearchStatus] = useState<string | null>(null);
    const [researchMaxResults, setResearchMaxResults] = useState(8);
    const [extractFrames, setExtractFrames] = useState(true);
    const [framesPerVideo, setFramesPerVideo] = useState(3);

    // --- Data -----------------------------------------------------------------

    const board = useMemo((): CategorizedMoodboard => {
        if (storyBible.categorizedMoodboard) return storyBible.categorizedMoodboard;
        const base = createDefaultCategorizedMoodboard();
        if (storyBible.moodboard && storyBible.moodboard.length > 0) {
            base.items = storyBible.moodboard.map((item, index) => ({
                id: item.id,
                kind: 'image',
                url: item.url,
                label: item.label,
                categoryId: 'uncategorized',
                createdAt: new Date().toISOString(),
                layout: createLayout(index, 'image', index + 1),
            }));
        }
        return base;
    }, [storyBible.categorizedMoodboard, storyBible.moodboard]);

    const updateBoard = useCallback((updater: (prev: CategorizedMoodboard) => CategorizedMoodboard) => {
        setStoryBible((prev) => ({
            ...prev,
            categorizedMoodboard: updater(prev.categorizedMoodboard || createDefaultCategorizedMoodboard()),
        }));
    }, [setStoryBible]);

    useEffect(() => {
        if (board.categories.some((cat) => cat.id === selectedCategoryId)) return;
        setSelectedCategoryId(board.categories[0]?.id || 'uncategorized');
    }, [board.categories, selectedCategoryId]);

    const selectedCategory = useMemo(
        () => board.categories.find((cat) => cat.id === selectedCategoryId),
        [board.categories, selectedCategoryId],
    );
    const items = useMemo(() => getItemsByCategory(board.items, selectedCategoryId), [board.items, selectedCategoryId]);
    const itemMap = useMemo(() => new Map(items.map((item, index) => [item.id, { item, layout: layoutOf(item, index) }])), [items]);
    const connectors = useMemo(
        () => (board.connectors || []).filter((c) => c.categoryId === selectedCategoryId && itemMap.has(c.from) && itemMap.has(c.to)),
        [board.connectors, selectedCategoryId, itemMap],
    );
    const maxZ = useMemo(() => items.reduce((max, item) => Math.max(max, item.layout?.zIndex || 0), 0), [items]);

    // Remember the viewport per category so switching boards feels stable.
    useEffect(() => {
        const stored = viewportsRef.current[selectedCategoryId];
        setViewport(stored || { x: 0, y: 0, zoom: 1 });
        setSelectedIds(new Set());
        setEditingId(null);
        setConnectFrom(null);
    }, [selectedCategoryId]);

    useEffect(() => {
        viewportsRef.current[selectedCategoryId] = viewport;
    }, [viewport, selectedCategoryId]);

    // --- Coordinate helpers ------------------------------------------------------

    const clientToWorld = useCallback((clientX: number, clientY: number, vp: Viewport = viewport) => {
        const rect = stageRef.current?.getBoundingClientRect();
        const localX = clientX - (rect?.left || 0);
        const localY = clientY - (rect?.top || 0);
        return { x: (localX - vp.x) / vp.zoom, y: (localY - vp.y) / vp.zoom };
    }, [viewport]);

    const zoomAround = useCallback((factor: number, clientX?: number, clientY?: number) => {
        setViewport((prev) => {
            const rect = stageRef.current?.getBoundingClientRect();
            const cx = clientX !== undefined ? clientX - (rect?.left || 0) : (rect?.width || 0) / 2;
            const cy = clientY !== undefined ? clientY - (rect?.top || 0) : (rect?.height || 0) / 2;
            const nextZoom = clamp(prev.zoom * factor, MIN_ZOOM, MAX_ZOOM);
            const scale = nextZoom / prev.zoom;
            return { zoom: nextZoom, x: cx - (cx - prev.x) * scale, y: cy - (cy - prev.y) * scale };
        });
    }, []);

    const fitToContent = useCallback(() => {
        const rect = stageRef.current?.getBoundingClientRect();
        if (!rect || items.length === 0) {
            setViewport({ x: 0, y: 0, zoom: 1 });
            return;
        }
        const layouts = items.map((item, index) => layoutOf(item, index));
        const minX = Math.min(...layouts.map((l) => l.x));
        const minY = Math.min(...layouts.map((l) => l.y));
        const maxX = Math.max(...layouts.map((l) => l.x + l.width));
        const maxY = Math.max(...layouts.map((l) => l.y + l.height));
        const padding = 80;
        const zoom = clamp(Math.min(rect.width / (maxX - minX + padding * 2), rect.height / (maxY - minY + padding * 2)), MIN_ZOOM, 1.5);
        setViewport({
            zoom,
            x: (rect.width - (maxX - minX) * zoom) / 2 - minX * zoom,
            y: (rect.height - (maxY - minY) * zoom) / 2 - minY * zoom,
        });
    }, [items]);

    // --- Mutations -----------------------------------------------------------------

    const updateItems = useCallback((ids: string[], updater: (item: MoodboardItem) => MoodboardItem) => {
        const idSet = new Set(ids);
        updateBoard((prev) => ({ ...prev, items: prev.items.map((item) => (idSet.has(item.id) ? updater(item) : item)) }));
    }, [updateBoard]);

    const addItems = useCallback((newItems: MoodboardItem[]) => {
        if (newItems.length === 0) return;
        updateBoard((prev) => ({ ...prev, items: [...prev.items, ...newItems] }));
        setSelectedIds(new Set(newItems.map((item) => item.id)));
    }, [updateBoard]);

    const deleteItems = useCallback((ids: string[]) => {
        if (ids.length === 0) return;
        const idSet = new Set(ids);
        updateBoard((prev) => ({
            ...prev,
            items: prev.items.filter((item) => !idSet.has(item.id)),
            connectors: (prev.connectors || []).filter((c) => !idSet.has(c.from) && !idSet.has(c.to)),
        }));
        setSelectedIds(new Set());
        setEditingId(null);
    }, [updateBoard]);

    const bringToFront = useCallback((ids: string[]) => {
        updateBoard((prev) => {
            let z = prev.items.filter((item) => item.categoryId === selectedCategoryId).reduce((max, item) => Math.max(max, item.layout?.zIndex || 0), 0);
            const idSet = new Set(ids);
            return {
                ...prev,
                items: prev.items.map((item, index) => (idSet.has(item.id) ? { ...item, layout: { ...layoutOf(item, index), zIndex: ++z } } : item)),
            };
        });
    }, [updateBoard, selectedCategoryId]);

    const sendToBack = useCallback((ids: string[]) => {
        updateBoard((prev) => {
            let z = 0;
            const idSet = new Set(ids);
            const others = prev.items.filter((item) => item.categoryId === selectedCategoryId && !idSet.has(item.id));
            const shift = idSet.size;
            return {
                ...prev,
                items: prev.items.map((item, index) => {
                    if (idSet.has(item.id)) return { ...item, layout: { ...layoutOf(item, index), zIndex: ++z } };
                    if (others.includes(item)) return { ...item, layout: { ...layoutOf(item, index), zIndex: (item.layout?.zIndex || 1) + shift } };
                    return item;
                }),
            };
        });
    }, [updateBoard, selectedCategoryId]);

    const addImagesFromFiles = useCallback(async (files: FileList | File[], world?: { x: number; y: number }) => {
        const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'));
        if (imageFiles.length === 0) return;
        const now = new Date().toISOString();
        const created: MoodboardItem[] = [];
        let cursorX = world?.x ?? clientToWorld((stageRef.current?.getBoundingClientRect().left || 0) + 120, (stageRef.current?.getBoundingClientRect().top || 0) + 120).x;
        const cursorY = world?.y ?? clientToWorld((stageRef.current?.getBoundingClientRect().left || 0) + 120, (stageRef.current?.getBoundingClientRect().top || 0) + 120).y;
        for (const [index, file] of imageFiles.entries()) {
            const url = URL.createObjectURL(file);
            const natural = await loadImageSize(url);
            const size = fitImageSize(natural.width, natural.height);
            created.push({
                id: buildId('mood'),
                kind: 'image',
                url,
                label: file.name.replace(/\.[^/.]+$/, ''),
                categoryId: selectedCategoryId,
                createdAt: now,
                sourceType: 'upload',
                layout: { x: cursorX, y: cursorY, ...size, zIndex: maxZ + index + 1 },
            });
            cursorX += size.width + 24;
        }
        addItems(created);
        setStatus(`${created.length} image${created.length === 1 ? '' : 's'} added.`);
    }, [addItems, clientToWorld, maxZ, selectedCategoryId]);

    const addImageFromUrl = useCallback(async (url: string, world: { x: number; y: number }) => {
        const trimmed = url.trim();
        if (!trimmed) return;
        setStatus('Fetching image…');
        try {
            const resolved = await resolveImageFromWebUrl(trimmed);
            const finalUrl = resolved?.url || trimmed;
            const natural = await loadImageSize(finalUrl);
            const size = fitImageSize(natural.width, natural.height);
            addItems([{
                id: buildId('mood'),
                kind: 'image',
                url: finalUrl,
                label: resolved?.title || trimmed.split('/').pop() || 'Image',
                categoryId: selectedCategoryId,
                createdAt: new Date().toISOString(),
                sourceType: 'web',
                sourceUrl: resolved?.sourcePageUrl || trimmed,
                sourceLabel: resolved?.sourceLabel,
                layout: { x: world.x, y: world.y, ...size, zIndex: maxZ + 1 },
            }]);
            setStatus('Image added.');
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Could not load that URL.');
        }
    }, [addItems, maxZ, selectedCategoryId]);

    const addNote = useCallback((world: { x: number; y: number }, kind: 'note' | 'text' = 'note') => {
        const size = defaultSize(kind);
        const id = buildId(kind === 'note' ? 'mood-note' : 'mood-text');
        addItems([{
            id,
            kind,
            text: '',
            label: kind === 'note' ? 'Note' : 'Text',
            color: kind === 'note' ? NOTE_COLORS[0] : undefined,
            categoryId: selectedCategoryId,
            createdAt: new Date().toISOString(),
            layout: { x: world.x - size.width / 2, y: world.y - size.height / 2, ...size, zIndex: maxZ + 1 },
        }]);
        setEditingId(id);
    }, [addItems, maxZ, selectedCategoryId]);

    const duplicateSelection = useCallback(() => {
        if (selectedIds.size === 0) return;
        const copies = items
            .filter((item) => selectedIds.has(item.id))
            .map((item, index) => {
                const layout = layoutOf(item);
                return { ...item, id: buildId('mood'), layout: { ...layout, x: layout.x + 32, y: layout.y + 32, zIndex: maxZ + index + 1 } };
            });
        addItems(copies);
    }, [addItems, items, maxZ, selectedIds]);

    const nudgeSelection = useCallback((dx: number, dy: number) => {
        if (selectedIds.size === 0) return;
        updateItems(Array.from(selectedIds), (item) => {
            const layout = layoutOf(item);
            return { ...item, layout: { ...layout, x: layout.x + dx, y: layout.y + dy } };
        });
    }, [selectedIds, updateItems]);

    const tidyBoard = useCallback(() => {
        // PureRef-style packing: rows of similar height, left to right.
        const sorted = [...items].sort((a, b) => (layoutOf(a).y - layoutOf(b).y) || (layoutOf(a).x - layoutOf(b).x));
        const gap = 24;
        const maxRowWidth = 1600;
        let x = 80;
        let y = 80;
        let rowHeight = 0;
        const positions: Record<string, { x: number; y: number }> = {};
        sorted.forEach((item) => {
            const layout = layoutOf(item);
            if (x + layout.width > maxRowWidth && x > 80) {
                x = 80;
                y += rowHeight + gap;
                rowHeight = 0;
            }
            positions[item.id] = { x, y };
            x += layout.width + gap;
            rowHeight = Math.max(rowHeight, layout.height);
        });
        updateItems(sorted.map((item) => item.id), (item) => ({ ...item, layout: { ...layoutOf(item), ...positions[item.id] } }));
        window.setTimeout(fitToContent, 0);
    }, [fitToContent, items, updateItems]);

    const addConnector = useCallback((from: string, to: string) => {
        if (from === to) return;
        updateBoard((prev) => {
            const existing = (prev.connectors || []).some((c) => (c.from === from && c.to === to) || (c.from === to && c.to === from));
            if (existing) return prev;
            const connector: MoodboardConnector = { id: buildId('mood-link'), from, to, categoryId: selectedCategoryId, style: 'arrow' };
            return { ...prev, connectors: [...(prev.connectors || []), connector] };
        });
    }, [selectedCategoryId, updateBoard]);

    const removeConnector = useCallback((id: string) => {
        updateBoard((prev) => ({ ...prev, connectors: (prev.connectors || []).filter((c) => c.id !== id) }));
    }, [updateBoard]);

    const moveSelectionToCategory = (targetCategoryId: string) => {
        if (selectedIds.size === 0) return;
        updateItems(Array.from(selectedIds), (item) => ({ ...item, categoryId: targetCategoryId }));
        setSelectedIds(new Set());
    };

    // --- Categories -------------------------------------------------------------------

    const handleAddCategory = () => {
        if (!newCategoryName.trim()) return;
        const category: MoodboardCategory = {
            id: `custom-${Date.now()}`,
            label: newCategoryName.trim(),
            icon: newCategoryIcon || '📌',
            description: 'Custom board',
            isCustom: true,
        };
        updateBoard((prev) => ({ ...prev, categories: [...prev.categories, category] }));
        setNewCategoryName('');
        setNewCategoryIcon('📌');
        setIsAddingCategory(false);
        setSelectedCategoryId(category.id);
    };

    const handleDeleteCategory = (categoryId: string) => {
        const category = board.categories.find((c) => c.id === categoryId);
        if (!category?.isCustom) return;
        const count = getCategoryItemCount(board.items, categoryId);
        if (count > 0 && !window.confirm(`This board holds ${count} item(s). They will move to "Uncategorized". Continue?`)) return;
        updateBoard((prev) => ({
            ...prev,
            categories: prev.categories.filter((c) => c.id !== categoryId),
            items: prev.items.map((item) => (item.categoryId === categoryId ? { ...item, categoryId: 'uncategorized' } : item)),
        }));
        if (selectedCategoryId === categoryId) setSelectedCategoryId('color_palette');
    };

    // --- Research import ---------------------------------------------------------------

    const handleResearchImport = useCallback(async () => {
        const query = researchQuery.trim();
        const urls = Array.from(new Set(researchUrls.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean)));
        if (!query && urls.length === 0) {
            setResearchStatus('Add a query or at least one URL.');
            return;
        }
        setIsResearching(true);
        setResearchStatus(null);
        try {
            const maxResults = clamp(Math.round(researchMaxResults || 8), 1, 24);
            const frameCount = clamp(Math.round(framesPerVideo || 3), 1, 6);
            const collected: Array<{ url: string; title?: string; sourceUrl?: string; sourceLabel?: string; sourceType?: 'search' | 'web' | 'video_frame'; query?: string }> = [];
            if (query) {
                const results = await searchWikimediaCommonsImages(query, maxResults);
                collected.push(...results.map((item) => ({ url: item.url, title: item.title, sourceUrl: item.sourcePageUrl || item.url, sourceLabel: item.sourceLabel, sourceType: 'search' as const, query })));
            }
            for (const sourceUrl of urls) {
                if (extractFrames && isLikelyVideoUrl(sourceUrl)) {
                    const frames = await extractFramesFromVideoUrl(sourceUrl, frameCount);
                    collected.push(...frames.map((frame) => ({ url: frame.url, title: frame.title, sourceUrl, sourceLabel: frame.sourceLabel, sourceType: 'video_frame' as const, query: query || undefined })));
                    continue;
                }
                const resolved = await resolveImageFromWebUrl(sourceUrl);
                if (!resolved) continue;
                collected.push({ url: resolved.url, title: resolved.title, sourceUrl: resolved.sourcePageUrl || sourceUrl, sourceLabel: resolved.sourceLabel, sourceType: 'web', query: query || undefined });
            }
            const unique = Array.from(new Map(collected.map((item) => [item.url, item])).values()).slice(0, maxResults);
            if (unique.length === 0) {
                setResearchStatus('No images found for this query/URL input.');
                return;
            }
            const now = new Date().toISOString();
            const origin = clientToWorld((stageRef.current?.getBoundingClientRect().left || 0) + 80, (stageRef.current?.getBoundingClientRect().top || 0) + 80);
            const imported: MoodboardItem[] = [];
            for (const [index, entry] of unique.entries()) {
                const natural = await loadImageSize(entry.url);
                const size = fitImageSize(natural.width, natural.height, 300);
                imported.push({
                    id: buildId('mood-research'),
                    kind: 'image',
                    url: entry.url,
                    label: entry.title || `Research ${index + 1}`,
                    categoryId: selectedCategoryId,
                    createdAt: now,
                    sourceUrl: entry.sourceUrl || entry.url,
                    sourceLabel: entry.sourceLabel,
                    sourceType: entry.sourceType,
                    query: entry.query,
                    layout: { x: origin.x + (index % 4) * 330, y: origin.y + Math.floor(index / 4) * 260, ...size, zIndex: maxZ + index + 1 },
                });
            }
            addItems(imported);
            setResearchStatus(`Imported ${imported.length} research image(s).`);
        } catch (error) {
            setResearchStatus(error instanceof Error ? error.message : 'Research import failed.');
        } finally {
            setIsResearching(false);
        }
    }, [addItems, clientToWorld, extractFrames, framesPerVideo, maxZ, researchMaxResults, researchQuery, researchUrls, selectedCategoryId]);

    // --- Pointer interaction ------------------------------------------------------------

    const beginPan = (clientX: number, clientY: number) => {
        dragRef.current = { type: 'pan', startClient: { x: clientX, y: clientY }, origin: viewport };
    };

    const handleStagePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (quickAdd) setQuickAdd(null);
        pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointersRef.current.size === 2) {
            const [a, b] = Array.from(pointersRef.current.values());
            pinchRef.current = {
                distance: Math.hypot(b.x - a.x, b.y - a.y),
                center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
                origin: viewport,
            };
            dragRef.current = null;
            setMarquee(null);
            return;
        }
        const isPanGesture = event.button === 1 || tool === 'hand' || spaceHeldRef.current || event.pointerType === 'touch';
        (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
        if (isPanGesture) {
            beginPan(event.clientX, event.clientY);
            return;
        }
        if (event.button !== 0) return;
        const world = clientToWorld(event.clientX, event.clientY);
        if (tool === 'note' || tool === 'text') {
            addNote(world, tool);
            setTool('select');
            return;
        }
        setConnectFrom(null);
        dragRef.current = { type: 'marquee', startWorld: world, currentWorld: world, additive: event.shiftKey || event.metaKey };
        if (!event.shiftKey && !event.metaKey) setSelectedIds(new Set());
        setEditingId(null);
    };

    const handleItemPointerDown = (event: React.PointerEvent, item: MoodboardItem) => {
        if (event.button === 1 || tool === 'hand' || spaceHeldRef.current) return;
        if (event.button !== 0) return;
        event.stopPropagation();
        if (quickAdd) setQuickAdd(null);
        if (tool === 'connect') {
            if (!connectFrom) {
                setConnectFrom(item.id);
                setStatus('Now click the item to connect to.');
            } else {
                addConnector(connectFrom, item.id);
                setConnectFrom(null);
                setTool('select');
                setStatus('Connected.');
            }
            return;
        }
        if (editingId && editingId !== item.id) setEditingId(null);
        const additive = event.shiftKey || event.metaKey;
        let nextSelection: Set<string>;
        if (additive) {
            nextSelection = new Set(selectedIds);
            if (nextSelection.has(item.id)) nextSelection.delete(item.id);
            else nextSelection.add(item.id);
        } else if (selectedIds.has(item.id)) {
            nextSelection = new Set(selectedIds);
        } else {
            nextSelection = new Set([item.id]);
        }
        setSelectedIds(nextSelection);
        if (item.locked) return;
        const ids = Array.from(nextSelection).filter((id) => !itemMap.get(id)?.item.locked);
        const origins: Record<string, { x: number; y: number }> = {};
        ids.forEach((id) => {
            const layout = itemMap.get(id)?.layout;
            if (layout) origins[id] = { x: layout.x, y: layout.y };
        });
        (stageRef.current as HTMLDivElement | null)?.setPointerCapture(event.pointerId);
        dragRef.current = { type: 'move', ids, origins, startWorld: clientToWorld(event.clientX, event.clientY), moved: false };
        bringToFront([item.id]);
    };

    const handleResizePointerDown = (event: React.PointerEvent, item: MoodboardItem) => {
        event.stopPropagation();
        event.preventDefault();
        const layout = layoutOf(item);
        (stageRef.current as HTMLDivElement | null)?.setPointerCapture(event.pointerId);
        dragRef.current = {
            type: 'resize',
            id: item.id,
            origin: layout,
            startWorld: clientToWorld(event.clientX, event.clientY),
            aspect: item.kind === 'image' ? layout.width / layout.height : null,
        };
    };

    const handleStagePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (pointersRef.current.has(event.pointerId)) {
            pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        }
        const pinch = pinchRef.current;
        if (pinch && pointersRef.current.size >= 2) {
            const [a, b] = Array.from(pointersRef.current.values());
            const distance = Math.hypot(b.x - a.x, b.y - a.y);
            const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const rect = stageRef.current?.getBoundingClientRect();
            const scale = clamp((distance / Math.max(1, pinch.distance)) * pinch.origin.zoom, MIN_ZOOM, MAX_ZOOM) / pinch.origin.zoom;
            const cx = pinch.center.x - (rect?.left || 0);
            const cy = pinch.center.y - (rect?.top || 0);
            setViewport({
                zoom: pinch.origin.zoom * scale,
                x: cx - (cx - pinch.origin.x) * scale + (center.x - pinch.center.x),
                y: cy - (cy - pinch.origin.y) * scale + (center.y - pinch.center.y),
            });
            return;
        }
        const drag = dragRef.current;
        if (!drag) return;
        if (drag.type === 'pan') {
            setViewport({
                ...drag.origin,
                x: drag.origin.x + (event.clientX - drag.startClient.x),
                y: drag.origin.y + (event.clientY - drag.startClient.y),
            });
            return;
        }
        const world = clientToWorld(event.clientX, event.clientY);
        if (drag.type === 'move') {
            const dx = world.x - drag.startWorld.x;
            const dy = world.y - drag.startWorld.y;
            if (!drag.moved && Math.hypot(dx, dy) * viewport.zoom < 3) return;
            drag.moved = true;
            updateItems(drag.ids, (item) => {
                const origin = drag.origins[item.id];
                if (!origin) return item;
                return { ...item, layout: { ...layoutOf(item), x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) } };
            });
            return;
        }
        if (drag.type === 'resize') {
            const dx = world.x - drag.startWorld.x;
            const dy = world.y - drag.startWorld.y;
            let width = Math.max(60, drag.origin.width + dx);
            let height = Math.max(40, drag.origin.height + dy);
            if (drag.aspect && !event.altKey) {
                height = width / drag.aspect;
            }
            updateItems([drag.id], (item) => ({ ...item, layout: { ...layoutOf(item), width: Math.round(width), height: Math.round(height) } }));
            return;
        }
        if (drag.type === 'marquee') {
            drag.currentWorld = world;
            const x = Math.min(drag.startWorld.x, world.x);
            const y = Math.min(drag.startWorld.y, world.y);
            const rect = { x, y, width: Math.abs(world.x - drag.startWorld.x), height: Math.abs(world.y - drag.startWorld.y) };
            setMarquee(rect);
            const hits = items.filter((item, index) => rectsIntersect(layoutOf(item, index), rect)).map((item) => item.id);
            setSelectedIds((prev) => (drag.additive ? new Set([...prev, ...hits]) : new Set(hits)));
        }
    };

    const handleStagePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
        pointersRef.current.delete(event.pointerId);
        if (pointersRef.current.size < 2) pinchRef.current = null;
        const drag = dragRef.current;
        dragRef.current = null;
        setMarquee(null);
        if (drag?.type === 'marquee' && marquee === null) {
            // Plain click on empty canvas: selection already cleared on pointer down.
        }
        try {
            (event.currentTarget as HTMLDivElement).releasePointerCapture(event.pointerId);
        } catch {
            // ignore
        }
    };

    const handleStageDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (event.target !== event.currentTarget && !(event.target as HTMLElement).classList.contains('mood-stage__world')) return;
        const world = clientToWorld(event.clientX, event.clientY);
        const rect = stageRef.current?.getBoundingClientRect();
        setQuickAdd({ world, client: { x: event.clientX - (rect?.left || 0), y: event.clientY - (rect?.top || 0) } });
        setQuickAddUrl('');
    };

    const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
        // Trackpad pinch arrives as wheel + ctrlKey; ⌘/ctrl + wheel is an explicit zoom.
        if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            const factor = Math.exp(-event.deltaY * 0.01);
            zoomAround(factor, event.clientX, event.clientY);
            return;
        }
        event.preventDefault();
        setViewport((prev) => ({ ...prev, x: prev.x - event.deltaX, y: prev.y - event.deltaY }));
    };

    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) return;
        // React's synthetic wheel listener is passive; attach a native non-passive one so preventDefault works.
        const handler = (event: WheelEvent) => {
            if (event.ctrlKey || event.metaKey) {
                event.preventDefault();
                zoomAround(Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
                return;
            }
            event.preventDefault();
            setViewport((prev) => ({ ...prev, x: prev.x - event.deltaX, y: prev.y - event.deltaY }));
        };
        stage.addEventListener('wheel', handler, { passive: false });
        return () => stage.removeEventListener('wheel', handler);
    }, [zoomAround]);

    // --- Keyboard ------------------------------------------------------------------

    useEffect(() => {
        const isTyping = (target: EventTarget | null) => {
            const el = target as HTMLElement | null;
            return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.code === 'Space' && !isTyping(event.target)) {
                spaceHeldRef.current = true;
                event.preventDefault();
                return;
            }
            if (isTyping(event.target)) return;
            const meta = event.metaKey || event.ctrlKey;
            if (event.key === 'Escape') {
                setSelectedIds(new Set());
                setEditingId(null);
                setQuickAdd(null);
                setConnectFrom(null);
                setTool('select');
                return;
            }
            if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIds.size > 0) {
                event.preventDefault();
                deleteItems(Array.from(selectedIds));
                return;
            }
            if (meta && event.key.toLowerCase() === 'a') {
                event.preventDefault();
                setSelectedIds(new Set(items.map((item) => item.id)));
                return;
            }
            if (meta && event.key.toLowerCase() === 'd') {
                event.preventDefault();
                duplicateSelection();
                return;
            }
            if (meta && (event.key === '=' || event.key === '+')) {
                event.preventDefault();
                zoomAround(1.2);
                return;
            }
            if (meta && event.key === '-') {
                event.preventDefault();
                zoomAround(1 / 1.2);
                return;
            }
            if (meta && event.key === '0') {
                event.preventDefault();
                fitToContent();
                return;
            }
            if (!meta) {
                if (event.key === 'v') setTool('select');
                if (event.key === 'h') setTool('hand');
                if (event.key === 'n') setTool('note');
                if (event.key === 't') setTool('text');
                if (event.key === 'c') setTool('connect');
                if (event.key === 'f' && selectedIds.size > 0) bringToFront(Array.from(selectedIds));
                if (event.key === 'b' && selectedIds.size > 0) sendToBack(Array.from(selectedIds));
                if (event.key === 'Enter' && selectedIds.size === 1) {
                    const only = Array.from(selectedIds)[0];
                    const entry = itemMap.get(only);
                    if (entry && isTextLike(entry.item)) setEditingId(only);
                    else if (entry) setPreviewItem(entry.item);
                }
                const step = event.shiftKey ? NUDGE * 5 : NUDGE;
                if (event.key === 'ArrowLeft') { event.preventDefault(); nudgeSelection(-step, 0); }
                if (event.key === 'ArrowRight') { event.preventDefault(); nudgeSelection(step, 0); }
                if (event.key === 'ArrowUp') { event.preventDefault(); nudgeSelection(0, -step); }
                if (event.key === 'ArrowDown') { event.preventDefault(); nudgeSelection(0, step); }
            }
        };
        const onKeyUp = (event: KeyboardEvent) => {
            if (event.code === 'Space') spaceHeldRef.current = false;
        };
        const onPaste = (event: ClipboardEvent) => {
            if (isTyping(event.target)) return;
            const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith('image/'));
            if (files.length > 0) {
                event.preventDefault();
                const rect = stageRef.current?.getBoundingClientRect();
                const world = clientToWorld((rect?.left || 0) + (rect?.width || 0) / 2, (rect?.top || 0) + (rect?.height || 0) / 2);
                void addImagesFromFiles(files, world);
                return;
            }
            const text = event.clipboardData?.getData('text/plain')?.trim();
            if (text && /^https?:\/\//i.test(text)) {
                event.preventDefault();
                const rect = stageRef.current?.getBoundingClientRect();
                const world = clientToWorld((rect?.left || 0) + (rect?.width || 0) / 2, (rect?.top || 0) + (rect?.height || 0) / 2);
                void addImageFromUrl(text, world);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        window.addEventListener('paste', onPaste);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('paste', onPaste);
        };
    }, [addImageFromUrl, addImagesFromFiles, bringToFront, clientToWorld, deleteItems, duplicateSelection, fitToContent, itemMap, items, nudgeSelection, selectedIds, sendToBack, zoomAround]);

    // --- Drag & drop from the OS -----------------------------------------------------

    const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDropping(false);
        const world = clientToWorld(event.clientX, event.clientY);
        if (event.dataTransfer.files.length > 0) {
            void addImagesFromFiles(event.dataTransfer.files, world);
            return;
        }
        const url = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain');
        if (url && /^https?:\/\//i.test(url.trim())) {
            void addImageFromUrl(url, world);
        }
    };

    // --- Render helpers -----------------------------------------------------------------

    const selectedItems = useMemo(() => items.filter((item) => selectedIds.has(item.id)), [items, selectedIds]);
    const selectionBounds = useMemo(() => {
        if (selectedItems.length === 0) return null;
        const layouts = selectedItems.map((item) => layoutOf(item));
        const minX = Math.min(...layouts.map((l) => l.x));
        const minY = Math.min(...layouts.map((l) => l.y));
        const maxX = Math.max(...layouts.map((l) => l.x + l.width));
        return { x: minX, y: minY, width: maxX - minX };
    }, [selectedItems]);
    const selectedNote = selectedItems.length === 1 && selectedItems[0].kind === 'note' ? selectedItems[0] : null;

    const connectorPath = (connector: MoodboardConnector) => {
        const from = itemMap.get(connector.from)?.layout;
        const to = itemMap.get(connector.to)?.layout;
        if (!from || !to) return null;
        const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
        const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
        const dx = toCenter.x - fromCenter.x;
        const dy = toCenter.y - fromCenter.y;
        const clip = (rect: Layout, center: { x: number; y: number }, dirX: number, dirY: number) => {
            const halfW = rect.width / 2;
            const halfH = rect.height / 2;
            const scale = Math.min(halfW / Math.max(Math.abs(dirX), 1e-6), halfH / Math.max(Math.abs(dirY), 1e-6));
            return { x: center.x + dirX * scale, y: center.y + dirY * scale };
        };
        const start = clip(from, fromCenter, dx, dy);
        const end = clip(to, toCenter, -dx, -dy);
        const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
        return { start, end, mid };
    };

    const toolButtons: Array<{ id: Tool; label: string; hint: string; icon: React.ReactNode }> = [
        { id: 'select', label: 'Select', hint: 'V · click, drag, marquee', icon: <span className="mood-tool__glyph">↖</span> },
        { id: 'hand', label: 'Pan', hint: 'H · or hold space', icon: <span className="mood-tool__glyph">✋</span> },
        { id: 'note', label: 'Note', hint: 'N · click to place a sticky note', icon: <span className="mood-tool__glyph mood-tool__glyph--note" /> },
        { id: 'text', label: 'Text', hint: 'T · click to place text', icon: <TextIcon className="w-4 h-4" /> },
        { id: 'connect', label: 'Connect', hint: 'C · click two items', icon: <span className="mood-tool__glyph">⤳</span> },
    ];

    return (
        <div className="mood-workspace">
            {sidebarOpen && (
                <aside className="mood-sidebar">
                    <div className="mood-sidebar__head">
                        <span className="mood-sidebar__title">Boards</span>
                        <button className="toolbar-button toolbar-button--icon" onClick={() => setIsAddingCategory(true)} title="New board">
                            <AddIcon className="w-4 h-4" />
                        </button>
                    </div>
                    {isAddingCategory && (
                        <div className="mood-sidebar__new">
                            <input
                                type="text"
                                placeholder="Board name"
                                className="app-input app-input--compact"
                                value={newCategoryName}
                                onChange={(e) => setNewCategoryName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleAddCategory(); if (e.key === 'Escape') setIsAddingCategory(false); }}
                                autoFocus
                            />
                            <div className="flex items-center gap-1.5">
                                <input
                                    type="text"
                                    className="app-input app-input--compact w-12 text-center"
                                    value={newCategoryIcon}
                                    onChange={(e) => setNewCategoryIcon(e.target.value)}
                                    maxLength={2}
                                    aria-label="Icon"
                                />
                                <button className="toolbar-button toolbar-button--text" onClick={handleAddCategory}>Add</button>
                                <button className="toolbar-button" onClick={() => setIsAddingCategory(false)}>Cancel</button>
                            </div>
                        </div>
                    )}
                    <ul className="mood-sidebar__list" role="list">
                        {board.categories.map((category) => {
                            const count = getCategoryItemCount(board.items, category.id);
                            const isActive = selectedCategoryId === category.id;
                            return (
                                <li key={category.id}>
                                    <button
                                        type="button"
                                        className={`mood-sidebar__item ${isActive ? 'mood-sidebar__item--active' : ''}`}
                                        onClick={() => setSelectedCategoryId(category.id)}
                                        title={category.description}
                                        onDragOver={(e) => e.preventDefault()}
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            if (selectedIds.size > 0) moveSelectionToCategory(category.id);
                                        }}
                                    >
                                        <span className="mood-sidebar__icon">{category.icon}</span>
                                        <span className="mood-sidebar__label">{category.label}</span>
                                        {count > 0 && <span className="mood-sidebar__count">{count}</span>}
                                        {category.isCustom && (
                                            <span
                                                role="button"
                                                className="mood-sidebar__delete"
                                                onClick={(e) => { e.stopPropagation(); handleDeleteCategory(category.id); }}
                                                title="Delete board"
                                            >
                                                <TrashIcon className="w-3.5 h-3.5" />
                                            </span>
                                        )}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                    <div className="mood-sidebar__section">
                        <button type="button" className="mood-sidebar__section-toggle" onClick={() => setResearchOpen((value) => !value)}>
                            <SearchIcon className="w-4 h-4" />
                            <span>Research import</span>
                            <span className="ml-auto text-[10px] app-muted">{researchOpen ? 'Hide' : 'Show'}</span>
                        </button>
                        {researchOpen && (
                            <div className="mood-sidebar__research">
                                <input value={researchQuery} onChange={(e) => setResearchQuery(e.target.value)} placeholder="Search Wikimedia Commons" className="app-input app-input--compact" />
                                <textarea value={researchUrls} onChange={(e) => setResearchUrls(e.target.value)} placeholder="Page or video URLs, one per line" className="app-textarea h-20 text-xs" />
                                <div className="grid grid-cols-2 gap-2 text-[11px] app-muted">
                                    <label>Max<input type="number" min={1} max={24} value={researchMaxResults} onChange={(e) => setResearchMaxResults(Number(e.target.value) || 8)} className="app-input app-input--compact mt-1" /></label>
                                    <label>Frames/video<input type="number" min={1} max={6} value={framesPerVideo} onChange={(e) => setFramesPerVideo(Number(e.target.value) || 3)} className="app-input app-input--compact mt-1" /></label>
                                </div>
                                <label className="flex items-center gap-2 text-[11px] app-muted">
                                    <input type="checkbox" checked={extractFrames} onChange={(e) => setExtractFrames(e.target.checked)} />
                                    Extract stills from video URLs
                                </label>
                                <button className="app-button app-primary text-xs w-full justify-center" onClick={handleResearchImport} disabled={isResearching}>
                                    {isResearching ? 'Importing…' : 'Import to board'}
                                </button>
                                {researchStatus && <p className="text-[11px] app-muted">{researchStatus}</p>}
                            </div>
                        )}
                    </div>
                </aside>
            )}

            <div className="mood-main">
                <div className="mood-topbar">
                    <div className="mood-topbar__left">
                        <button className="toolbar-button toolbar-button--icon" onClick={() => setSidebarOpen((v) => !v)} title={sidebarOpen ? 'Hide boards' : 'Show boards'}>
                            <GridIcon className="w-4 h-4" />
                        </button>
                        <div className="mood-topbar__title">
                            <span className="mood-topbar__icon">{selectedCategory?.icon}</span>
                            <span>{selectedCategory?.label || 'Moodboard'}</span>
                            <span className="mood-topbar__meta">{items.length} item{items.length === 1 ? '' : 's'}</span>
                        </div>
                    </div>
                    <div className="mood-toolbar" role="toolbar" aria-label="Board tools">
                        {toolButtons.map((button) => (
                            <button
                                key={button.id}
                                type="button"
                                className={`mood-tool ${tool === button.id ? 'mood-tool--active' : ''}`}
                                onClick={() => { setTool(button.id); setConnectFrom(null); }}
                                title={`${button.label} — ${button.hint}`}
                                aria-pressed={tool === button.id}
                            >
                                {button.icon}
                                <span className="mood-tool__label">{button.label}</span>
                            </button>
                        ))}
                        <span className="mood-toolbar__divider" />
                        <button type="button" className="mood-tool" onClick={() => fileInputRef.current?.click()} title="Upload images (or drop / paste them)">
                            <ImageIcon className="w-4 h-4" />
                            <span className="mood-tool__label">Image</span>
                        </button>
                        <button type="button" className="mood-tool" onClick={tidyBoard} title="Arrange everything into tidy rows" disabled={items.length === 0}>
                            <span className="mood-tool__glyph">▦</span>
                            <span className="mood-tool__label">Tidy</span>
                        </button>
                    </div>
                    <div className="mood-topbar__right">
                        {selectedIds.size > 0 && (
                            <select
                                className="app-select app-select--compact"
                                onChange={(e) => { if (e.target.value) { moveSelectionToCategory(e.target.value); e.target.value = ''; } }}
                                defaultValue=""
                                title="Move selection to another board"
                            >
                                <option value="" disabled>Move {selectedIds.size} to…</option>
                                {board.categories.filter((c) => c.id !== selectedCategoryId).map((c) => (
                                    <option key={c.id} value={c.id}>{c.icon} {c.label}</option>
                                ))}
                            </select>
                        )}
                        <div className="mood-zoom">
                            <button type="button" className="toolbar-button toolbar-button--icon" onClick={() => zoomAround(1 / 1.2)} title="Zoom out (⌘−)">−</button>
                            <button type="button" className="toolbar-button mood-zoom__value" onClick={fitToContent} title="Fit to content (⌘0)">{Math.round(viewport.zoom * 100)}%</button>
                            <button type="button" className="toolbar-button toolbar-button--icon" onClick={() => zoomAround(1.2)} title="Zoom in (⌘+)">+</button>
                        </div>
                    </div>
                </div>

                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { if (e.target.files) void addImagesFromFiles(e.target.files); e.target.value = ''; }} />

                <div
                    ref={stageRef}
                    className={`mood-stage mood-stage--${tool} ${isDropping ? 'mood-stage--dropping' : ''} ${spaceHeldRef.current ? 'mood-stage--panning' : ''}`}
                    style={{ backgroundPosition: `${viewport.x}px ${viewport.y}px`, backgroundSize: `${24 * viewport.zoom}px ${24 * viewport.zoom}px` }}
                    onPointerDown={handleStagePointerDown}
                    onPointerMove={handleStagePointerMove}
                    onPointerUp={handleStagePointerUp}
                    onPointerCancel={handleStagePointerUp}
                    onDoubleClick={handleStageDoubleClick}
                    onWheel={handleWheel}
                    onDragOver={(e) => { e.preventDefault(); setIsDropping(true); }}
                    onDragLeave={() => setIsDropping(false)}
                    onDrop={handleDrop}
                    tabIndex={0}
                >
                    <div
                        className="mood-stage__world"
                        style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}
                    >
                        <svg className="mood-connectors" aria-hidden="true">
                            <defs>
                                <marker id="mood-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                                    <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
                                </marker>
                            </defs>
                            {connectors.map((connector) => {
                                const path = connectorPath(connector);
                                if (!path) return null;
                                return (
                                    <g key={connector.id} className="mood-connector">
                                        <line x1={path.start.x} y1={path.start.y} x2={path.end.x} y2={path.end.y} markerEnd={connector.style === 'line' ? undefined : 'url(#mood-arrow)'} />
                                        <circle cx={path.mid.x} cy={path.mid.y} r={9 / viewport.zoom} className="mood-connector__handle" onPointerDown={(e) => { e.stopPropagation(); removeConnector(connector.id); }}>
                                            <title>Remove connection</title>
                                        </circle>
                                    </g>
                                );
                            })}
                        </svg>

                        {items.map((rawItem, index) => {
                            const layout = layoutOf(rawItem, index);
                            const isSelected = selectedIds.has(rawItem.id);
                            const isEditing = editingId === rawItem.id;
                            const isConnectSource = connectFrom === rawItem.id;
                            const kind = rawItem.kind || 'image';
                            return (
                                <div
                                    key={rawItem.id}
                                    className={`mood-item mood-item--${kind} ${isSelected ? 'mood-item--selected' : ''} ${isConnectSource ? 'mood-item--connect' : ''}`}
                                    style={{
                                        transform: `translate(${layout.x}px, ${layout.y}px)`,
                                        width: layout.width,
                                        height: layout.height,
                                        zIndex: layout.zIndex || 1,
                                        background: kind === 'note' ? rawItem.color || NOTE_COLORS[0] : undefined,
                                    }}
                                    onPointerDown={(e) => handleItemPointerDown(e, rawItem)}
                                    onDoubleClick={(e) => {
                                        e.stopPropagation();
                                        if (isTextLike(rawItem)) setEditingId(rawItem.id);
                                        else setPreviewItem(rawItem);
                                    }}
                                >
                                    {kind === 'image' && (
                                        rawItem.url
                                            ? <img src={rawItem.url} alt={rawItem.label || ''} draggable={false} className="mood-item__image" />
                                            : <div className="mood-item__missing">Image unavailable</div>
                                    )}
                                    {kind === 'image' && rawItem.label && (
                                        <div className="mood-item__caption">{rawItem.label}</div>
                                    )}
                                    {isTextLike(rawItem) && (
                                        isEditing ? (
                                            <textarea
                                                className="mood-item__editor"
                                                style={{ fontSize: rawItem.fontSize || (kind === 'note' ? 15 : 20) }}
                                                value={rawItem.text || ''}
                                                autoFocus
                                                placeholder={kind === 'note' ? 'Write a note…' : 'Type something…'}
                                                onChange={(e) => updateItems([rawItem.id], (item) => ({ ...item, text: e.target.value }))}
                                                onBlur={() => setEditingId(null)}
                                                onPointerDown={(e) => e.stopPropagation()}
                                                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditingId(null); } }}
                                            />
                                        ) : (
                                            <div className="mood-item__text" style={{ fontSize: rawItem.fontSize || (kind === 'note' ? 15 : 20) }}>
                                                {rawItem.text || <span className="mood-item__placeholder">{kind === 'note' ? 'Double-click to write' : 'Double-click to edit'}</span>}
                                            </div>
                                        )
                                    )}
                                    {isSelected && !rawItem.locked && (
                                        <span className="mood-item__resize" onPointerDown={(e) => handleResizePointerDown(e, rawItem)} title="Resize (hold ⌥ for free aspect)" />
                                    )}
                                </div>
                            );
                        })}

                        {marquee && (
                            <div className="mood-marquee" style={{ transform: `translate(${marquee.x}px, ${marquee.y}px)`, width: marquee.width, height: marquee.height }} />
                        )}

                        {selectionBounds && selectedItems.length > 0 && !editingId && (
                            <div
                                className="mood-selection-bar"
                                style={{ transform: `translate(${selectionBounds.x + selectionBounds.width / 2}px, ${selectionBounds.y}px) scale(${1 / viewport.zoom}) translate(-50%, calc(-100% - 10px))` }}
                                onPointerDown={(e) => e.stopPropagation()}
                            >
                                {selectedNote && (
                                    <div className="mood-selection-bar__colors">
                                        {NOTE_COLORS.map((color) => (
                                            <button
                                                key={color}
                                                type="button"
                                                className={`mood-color ${selectedNote.color === color ? 'mood-color--active' : ''}`}
                                                style={{ background: color }}
                                                onClick={() => updateItems([selectedNote.id], (item) => ({ ...item, color }))}
                                                title="Note colour"
                                            />
                                        ))}
                                    </div>
                                )}
                                {selectedItems.length === 1 && isTextLike(selectedItems[0]) && (
                                    <>
                                        <button type="button" className="mood-selection-bar__button" onClick={() => updateItems([selectedItems[0].id], (item) => ({ ...item, fontSize: Math.max(10, (item.fontSize || (item.kind === 'note' ? 15 : 20)) - 2) }))} title="Smaller text">A−</button>
                                        <button type="button" className="mood-selection-bar__button" onClick={() => updateItems([selectedItems[0].id], (item) => ({ ...item, fontSize: Math.min(72, (item.fontSize || (item.kind === 'note' ? 15 : 20)) + 2) }))} title="Larger text">A+</button>
                                    </>
                                )}
                                <button type="button" className="mood-selection-bar__button" onClick={() => { setTool('connect'); setConnectFrom(selectedItems[0].id); setStatus('Click the item to connect to.'); }} title="Connect to another item (C)">⤳</button>
                                <button type="button" className="mood-selection-bar__button" onClick={() => bringToFront(Array.from(selectedIds))} title="Bring to front (F)">↑</button>
                                <button type="button" className="mood-selection-bar__button" onClick={() => sendToBack(Array.from(selectedIds))} title="Send to back (B)">↓</button>
                                <button type="button" className="mood-selection-bar__button" onClick={duplicateSelection} title="Duplicate (⌘D)">⧉</button>
                                <button type="button" className="mood-selection-bar__button" onClick={() => updateItems(Array.from(selectedIds), (item) => ({ ...item, locked: !item.locked }))} title="Lock / unlock">
                                    {selectedItems.every((item) => item.locked) ? '🔒' : '🔓'}
                                </button>
                                <button type="button" className="mood-selection-bar__button mood-selection-bar__button--danger" onClick={() => deleteItems(Array.from(selectedIds))} title="Delete (⌫)">
                                    <TrashIcon className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        )}
                    </div>

                    {quickAdd && (
                        <div className="mood-quick-add" style={{ left: quickAdd.client.x, top: quickAdd.client.y }} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                            <div className="mood-quick-add__title">Add here</div>
                            <button type="button" className="mood-quick-add__item" onClick={() => { addNote(quickAdd.world, 'note'); setQuickAdd(null); }}>
                                <span className="mood-tool__glyph mood-tool__glyph--note" /> Sticky note
                            </button>
                            <button type="button" className="mood-quick-add__item" onClick={() => { addNote(quickAdd.world, 'text'); setQuickAdd(null); }}>
                                <TextIcon className="w-4 h-4" /> Text
                            </button>
                            <button type="button" className="mood-quick-add__item" onClick={() => { fileInputRef.current?.click(); setQuickAdd(null); }}>
                                <UploadIcon className="w-4 h-4" /> Upload images
                            </button>
                            <form
                                className="mood-quick-add__url"
                                onSubmit={(e) => { e.preventDefault(); void addImageFromUrl(quickAddUrl, quickAdd.world); setQuickAdd(null); }}
                            >
                                <input
                                    className="app-input app-input--compact"
                                    placeholder="Paste image or page URL"
                                    value={quickAddUrl}
                                    onChange={(e) => setQuickAddUrl(e.target.value)}
                                    autoFocus
                                    onKeyDown={(e) => { if (e.key === 'Escape') setQuickAdd(null); }}
                                />
                                <button type="submit" className="toolbar-button toolbar-button--text" disabled={!quickAddUrl.trim()}>Add</button>
                            </form>
                            <button type="button" className="mood-quick-add__close" onClick={() => setQuickAdd(null)} aria-label="Close">
                                <XIcon className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    )}

                    {items.length === 0 && (
                        <div className="mood-empty">
                            <div className="mood-empty__card">
                                <ImageIcon className="w-8 h-8 app-muted" />
                                <p className="mood-empty__title">An empty board</p>
                                <p className="mood-empty__text">Drop images here, paste from the clipboard, or double-click anywhere to add a note.</p>
                                <div className="mood-empty__actions">
                                    <button className="app-button app-primary text-xs" onClick={() => fileInputRef.current?.click()}>Upload images</button>
                                    <button className="app-button app-secondary text-xs" onClick={() => setResearchOpen(true)}>Import research</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {isDropping && <div className="mood-drop-hint">Drop to add to {selectedCategory?.label || 'the board'}</div>}
                </div>

                <div className="mood-statusbar">
                    <span>{status || (tool === 'connect' ? 'Connect: click two items.' : 'Double-click to add · Space+drag or two fingers to pan · ⌘+scroll or pinch to zoom')}</span>
                    {selectedIds.size > 0 && <span className="ml-auto">{selectedIds.size} selected</span>}
                </div>
            </div>

            {previewItem && (
                <div className="mood-preview" onClick={() => setPreviewItem(null)}>
                    <div className="mood-preview__panel" onClick={(e) => e.stopPropagation()}>
                        <div className="mood-preview__head">
                            <div className="min-w-0">
                                <div className="mood-preview__title">{previewItem.label || 'Image'}</div>
                                <div className="mood-preview__meta">{previewItem.sourceLabel || 'Local'}{previewItem.query ? ` · query: ${previewItem.query}` : ''}</div>
                            </div>
                            <div className="flex items-center gap-2">
                                {previewItem.sourceUrl && (
                                    <a href={previewItem.sourceUrl} target="_blank" rel="noopener noreferrer" className="app-button app-secondary text-xs">Open source</a>
                                )}
                                <button className="toolbar-button toolbar-button--icon" onClick={() => setPreviewItem(null)} aria-label="Close preview"><XIcon className="w-4 h-4" /></button>
                            </div>
                        </div>
                        <div className="mood-preview__body">
                            {previewItem.url ? <img src={previewItem.url} alt={previewItem.label || ''} /> : <div className="p-6 text-sm app-muted">Image unavailable</div>}
                        </div>
                        <input
                            className="mood-preview__caption"
                            value={previewItem.label || ''}
                            placeholder="Caption"
                            onChange={(e) => {
                                const value = e.target.value;
                                setPreviewItem((prev) => (prev ? { ...prev, label: value } : prev));
                                updateItems([previewItem.id], (item) => ({ ...item, label: value }));
                            }}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

export default MoodboardWorkspace;
