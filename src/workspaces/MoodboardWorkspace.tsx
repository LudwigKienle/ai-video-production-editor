import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { StoryBible } from '../types';
import {
    MoodboardCategory,
    MoodboardItem,
    CategorizedMoodboard,
    createDefaultCategorizedMoodboard,
    getCategoryItemCount,
    getItemsByCategory,
} from '../data/moodboardTypes';
import { extractFramesFromVideoUrl, isLikelyVideoUrl, resolveImageFromWebUrl, searchWikimediaCommonsImages } from '../services/moodboardResearchService';
import { UploadIcon, TrashIcon, AddIcon } from '../components/icons';

interface MoodboardWorkspaceProps {
    storyBible: StoryBible;
    setStoryBible: React.Dispatch<React.SetStateAction<StoryBible>>;
}

type ViewMode = 'grid' | 'canvas';

type DragState = {
    itemId: string;
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
    width: number;
    height: number;
};

const CANVAS_WIDTH = 2600;
const CANVAS_HEIGHT = 1600;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const createCanvasLayout = (
    index: number,
    kind: 'image' | 'text',
    zIndex: number
) => {
    const col = index % 5;
    const row = Math.floor(index / 5);
    const width = kind === 'text' ? 280 : 260;
    const height = kind === 'text' ? 200 : 220;
    return {
        x: 40 + col * 300,
        y: 40 + row * 250,
        width,
        height,
        zIndex,
    };
};

const toImageItem = (entry: {
    id: string;
    url?: string;
    label?: string;
    categoryId: string;
    sourceUrl?: string;
    sourceLabel?: string;
    sourceType?: 'upload' | 'search' | 'web' | 'video_frame' | 'library';
    query?: string;
}, index: number, zIndex: number): MoodboardItem => ({
    id: entry.id,
    kind: 'image',
    url: entry.url,
    label: entry.label,
    categoryId: entry.categoryId,
    createdAt: new Date().toISOString(),
    sourceUrl: entry.sourceUrl,
    sourceLabel: entry.sourceLabel,
    sourceType: entry.sourceType,
    query: entry.query,
    layout: createCanvasLayout(index, 'image', zIndex),
});

const MoodboardWorkspace: React.FC<MoodboardWorkspaceProps> = ({
    storyBible,
    setStoryBible,
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const canvasRef = useRef<HTMLDivElement>(null);
    const [selectedCategoryId, setSelectedCategoryId] = useState<string>('color_palette');
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [newCategoryIcon, setNewCategoryIcon] = useState('📌');
    const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);
    const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
    const [previewItem, setPreviewItem] = useState<MoodboardItem | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>('grid');
    const [dragState, setDragState] = useState<DragState | null>(null);
    const [researchQuery, setResearchQuery] = useState('');
    const [researchUrls, setResearchUrls] = useState('');
    const [isResearching, setIsResearching] = useState(false);
    const [researchStatus, setResearchStatus] = useState<string | null>(null);
    const [researchMaxResults, setResearchMaxResults] = useState(8);
    const [extractFrames, setExtractFrames] = useState(true);
    const [framesPerVideo, setFramesPerVideo] = useState(3);

    const categorizedMoodboard = useMemo((): CategorizedMoodboard => {
        if (storyBible.categorizedMoodboard) {
            return storyBible.categorizedMoodboard;
        }
        const base = createDefaultCategorizedMoodboard();
        if (storyBible.moodboard && storyBible.moodboard.length > 0) {
            base.items = storyBible.moodboard.map((item, index) => ({
                id: item.id,
                kind: 'image',
                url: item.url,
                label: item.label,
                categoryId: 'uncategorized',
                createdAt: new Date().toISOString(),
                layout: createCanvasLayout(index, 'image', index + 1),
            }));
        }
        return base;
    }, [storyBible.categorizedMoodboard, storyBible.moodboard]);

    const updateCategorizedMoodboard = useCallback(
        (updater: (prev: CategorizedMoodboard) => CategorizedMoodboard) => {
            setStoryBible((prev) => ({
                ...prev,
                categorizedMoodboard: updater(prev.categorizedMoodboard || createDefaultCategorizedMoodboard()),
            }));
        },
        [setStoryBible]
    );

    useEffect(() => {
        if (categorizedMoodboard.categories.some((cat) => cat.id === selectedCategoryId)) return;
        setSelectedCategoryId(categorizedMoodboard.categories[0]?.id || 'uncategorized');
    }, [categorizedMoodboard.categories, selectedCategoryId]);

    const selectedCategory = useMemo(() => {
        return categorizedMoodboard.categories.find((cat) => cat.id === selectedCategoryId);
    }, [categorizedMoodboard.categories, selectedCategoryId]);

    const categoryItems = useMemo(() => {
        return getItemsByCategory(categorizedMoodboard.items, selectedCategoryId);
    }, [categorizedMoodboard.items, selectedCategoryId]);

    const maxCategoryZIndex = useMemo(() => {
        return categoryItems.reduce((max, item) => Math.max(max, item.layout?.zIndex || 0), 0);
    }, [categoryItems]);

    const ensureItemLayout = useCallback((item: MoodboardItem, fallbackIndex: number): MoodboardItem => {
        if (item.layout) return item;
        return {
            ...item,
            layout: createCanvasLayout(fallbackIndex, item.kind === 'text' ? 'text' : 'image', maxCategoryZIndex + fallbackIndex + 1),
        };
    }, [maxCategoryZIndex]);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        const now = new Date().toISOString();
        const startZ = maxCategoryZIndex + 1;
        const newItems: MoodboardItem[] = Array.from(files)
            .filter((file) => file.type.startsWith('image/'))
            .map((file, index) =>
                toImageItem({
                    id: `mood-${Date.now()}-${index}`,
                    url: URL.createObjectURL(file),
                    label: file.name.replace(/\.[^/.]+$/, ''),
                    categoryId: selectedCategoryId,
                    sourceType: 'upload',
                }, categoryItems.length + index, startZ + index)
            )
            .map((item) => ({ ...item, createdAt: now }));

        if (newItems.length > 0) {
            updateCategorizedMoodboard((prev) => ({
                ...prev,
                items: [...prev.items, ...newItems],
            }));
        }

        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const updateItem = useCallback((itemId: string, updater: (item: MoodboardItem) => MoodboardItem) => {
        updateCategorizedMoodboard((prev) => ({
            ...prev,
            items: prev.items.map((item) => (item.id === itemId ? updater(item) : item)),
        }));
    }, [updateCategorizedMoodboard]);

    const bringItemToFront = useCallback((itemId: string) => {
        updateCategorizedMoodboard((prev) => {
            const item = prev.items.find((entry) => entry.id === itemId);
            if (!item) return prev;
            const relevant = prev.items.filter((entry) => entry.categoryId === item.categoryId);
            const nextZ = relevant.reduce((max, entry) => Math.max(max, entry.layout?.zIndex || 0), 0) + 1;
            return {
                ...prev,
                items: prev.items.map((entry) => (
                    entry.id === itemId
                        ? { ...entry, layout: { ...(entry.layout || createCanvasLayout(0, entry.kind === 'text' ? 'text' : 'image', nextZ)), zIndex: nextZ } }
                        : entry
                )),
            };
        });
    }, [updateCategorizedMoodboard]);

    const handleDeleteItem = (itemId: string) => {
        updateCategorizedMoodboard((prev) => ({
            ...prev,
            items: prev.items.filter((item) => item.id !== itemId),
        }));
        setSelectedItemIds((prev) => {
            const next = new Set(prev);
            next.delete(itemId);
            return next;
        });
    };

    const handleDeleteSelected = () => {
        if (selectedItemIds.size === 0) return;
        updateCategorizedMoodboard((prev) => ({
            ...prev,
            items: prev.items.filter((item) => !selectedItemIds.has(item.id)),
        }));
        setSelectedItemIds(new Set());
    };

    const handleMoveToCategory = (targetCategoryId: string) => {
        if (selectedItemIds.size === 0) return;
        updateCategorizedMoodboard((prev) => {
            const existingTargetItems = prev.items.filter((item) => item.categoryId === targetCategoryId);
            let zIndex = existingTargetItems.reduce((max, item) => Math.max(max, item.layout?.zIndex || 0), 0) + 1;
            return {
                ...prev,
                items: prev.items.map((item) => {
                    if (!selectedItemIds.has(item.id)) return item;
                    const nextItem = { ...item, categoryId: targetCategoryId };
                    if (!nextItem.layout) {
                        nextItem.layout = createCanvasLayout(existingTargetItems.length, nextItem.kind === 'text' ? 'text' : 'image', zIndex++);
                    } else {
                        nextItem.layout = { ...nextItem.layout, zIndex: zIndex++ };
                    }
                    return nextItem;
                }),
            };
        });
        setSelectedItemIds(new Set());
    };

    const handleAddCategory = () => {
        if (!newCategoryName.trim()) return;
        const newCategory: MoodboardCategory = {
            id: `custom-${Date.now()}`,
            label: newCategoryName.trim(),
            icon: newCategoryIcon || '📌',
            description: 'Custom category',
            isCustom: true,
        };
        updateCategorizedMoodboard((prev) => ({
            ...prev,
            categories: [...prev.categories, newCategory],
        }));
        setNewCategoryName('');
        setNewCategoryIcon('📌');
        setIsAddingCategory(false);
        setSelectedCategoryId(newCategory.id);
    };

    const handleDeleteCategory = (categoryId: string) => {
        const category = categorizedMoodboard.categories.find((c) => c.id === categoryId);
        if (!category?.isCustom) return;

        const itemCount = getCategoryItemCount(categorizedMoodboard.items, categoryId);
        if (itemCount > 0) {
            const confirmDelete = window.confirm(
                `This category contains ${itemCount} item(s). They will be moved to "Uncategorized". Continue?`
            );
            if (!confirmDelete) return;
        }

        updateCategorizedMoodboard((prev) => ({
            categories: prev.categories.filter((c) => c.id !== categoryId),
            items: prev.items.map((item) =>
                item.categoryId === categoryId ? { ...item, categoryId: 'uncategorized' } : item
            ),
        }));

        if (selectedCategoryId === categoryId) {
            setSelectedCategoryId('color_palette');
        }
    };

    const handleAddTextCard = () => {
        const id = `mood-text-${Date.now()}`;
        const textItem: MoodboardItem = {
            id,
            kind: 'text',
            text: 'Notes...',
            label: 'Text Card',
            categoryId: selectedCategoryId,
            createdAt: new Date().toISOString(),
            layout: createCanvasLayout(categoryItems.length, 'text', maxCategoryZIndex + 1),
        };
        updateCategorizedMoodboard((prev) => ({
            ...prev,
            items: [...prev.items, textItem],
        }));
        setSelectedItemIds(new Set([id]));
        setViewMode('canvas');
    };

    const toggleSelectItem = (itemId: string, multi = false) => {
        setSelectedItemIds((prev) => {
            const next = multi ? new Set(prev) : new Set<string>();
            if (next.has(itemId)) {
                next.delete(itemId);
            } else {
                next.add(itemId);
            }
            return next;
        });
    };

    const handleDragOver = (e: React.DragEvent, categoryId: string) => {
        e.preventDefault();
        setDragOverCategory(categoryId);
    };

    const handleDragLeave = () => {
        setDragOverCategory(null);
    };

    const handleDropOnCategory = (e: React.DragEvent, categoryId: string) => {
        e.preventDefault();
        setDragOverCategory(null);

        if (e.dataTransfer.files.length > 0) {
            const files = e.dataTransfer.files;
            const now = new Date().toISOString();
            const targetItems = categorizedMoodboard.items.filter((item) => item.categoryId === categoryId);
            let zIndex = targetItems.reduce((max, item) => Math.max(max, item.layout?.zIndex || 0), 0) + 1;
            const newItems: MoodboardItem[] = Array.from(files)
                .filter((file) => file.type.startsWith('image/'))
                .map((file, index) =>
                    toImageItem({
                        id: `mood-${Date.now()}-${index}`,
                        url: URL.createObjectURL(file),
                        label: file.name.replace(/\.[^/.]+$/, ''),
                        categoryId,
                        sourceType: 'upload',
                    }, targetItems.length + index, zIndex++)
                )
                .map((item) => ({ ...item, createdAt: now }));

            if (newItems.length > 0) {
                updateCategorizedMoodboard((prev) => ({
                    ...prev,
                    items: [...prev.items, ...newItems],
                }));
            }
            return;
        }

        if (selectedItemIds.size > 0) {
            handleMoveToCategory(categoryId);
        }
    };

    const handleResearchImport = useCallback(async () => {
        const query = researchQuery.trim();
        const urls = Array.from(new Set(
            researchUrls
                .split(/\r?\n|,/)
                .map((entry) => entry.trim())
                .filter(Boolean)
        ));
        if (!query && urls.length === 0) {
            setResearchStatus('Add a query or at least one URL.');
            return;
        }

        setIsResearching(true);
        setResearchStatus(null);
        try {
            const maxResults = clamp(Math.round(researchMaxResults || 8), 1, 24);
            const frameCount = clamp(Math.round(framesPerVideo || 3), 1, 6);
            const collected: Array<{
                url: string;
                title?: string;
                sourceUrl?: string;
                sourceLabel?: string;
                sourceType?: 'search' | 'web' | 'video_frame';
                query?: string;
            }> = [];

            if (query) {
                const searchResults = await searchWikimediaCommonsImages(query, maxResults);
                collected.push(...searchResults.map((item) => ({
                    url: item.url,
                    title: item.title,
                    sourceUrl: item.sourcePageUrl || item.url,
                    sourceLabel: item.sourceLabel,
                    sourceType: 'search' as const,
                    query,
                })));
            }

            for (const sourceUrl of urls) {
                if (extractFrames && isLikelyVideoUrl(sourceUrl)) {
                    const frames = await extractFramesFromVideoUrl(sourceUrl, frameCount);
                    collected.push(...frames.map((frame) => ({
                        url: frame.url,
                        title: frame.title,
                        sourceUrl: sourceUrl,
                        sourceLabel: frame.sourceLabel,
                        sourceType: 'video_frame' as const,
                        query: query || undefined,
                    })));
                    continue;
                }
                const resolved = await resolveImageFromWebUrl(sourceUrl);
                if (!resolved) continue;
                collected.push({
                    url: resolved.url,
                    title: resolved.title,
                    sourceUrl: resolved.sourcePageUrl || sourceUrl,
                    sourceLabel: resolved.sourceLabel,
                    sourceType: 'web',
                    query: query || undefined,
                });
            }

            const unique = Array.from(new Map(collected.map((item) => [item.url, item])).values()).slice(0, maxResults);
            if (unique.length === 0) {
                setResearchStatus('No images found for this query/URL input.');
                return;
            }

            const now = new Date().toISOString();
            const startZ = maxCategoryZIndex + 1;
            const imported = unique.map((item, index) => (
                toImageItem({
                    id: `mood-research-${Date.now()}-${index}`,
                    url: item.url,
                    label: item.title || `Research ${index + 1}`,
                    categoryId: selectedCategoryId,
                    sourceUrl: item.sourceUrl || item.url,
                    sourceLabel: item.sourceLabel,
                    sourceType: item.sourceType,
                    query: item.query,
                }, categoryItems.length + index, startZ + index)
            )).map((item) => ({ ...item, createdAt: now }));

            updateCategorizedMoodboard((prev) => ({
                ...prev,
                items: [...prev.items, ...imported],
            }));

            setViewMode('canvas');
            setResearchStatus(`Imported ${imported.length} research image(s).`);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Research import failed.';
            setResearchStatus(message);
        } finally {
            setIsResearching(false);
        }
    }, [
        categoryItems.length,
        extractFrames,
        framesPerVideo,
        maxCategoryZIndex,
        researchMaxResults,
        researchQuery,
        researchUrls,
        selectedCategoryId,
        updateCategorizedMoodboard,
    ]);

    const startCanvasDrag = useCallback((event: React.MouseEvent, item: MoodboardItem) => {
        event.preventDefault();
        event.stopPropagation();
        const hydrated = ensureItemLayout(item, 0);
        const layout = hydrated.layout!;
        bringItemToFront(item.id);
        setSelectedItemIds(new Set([item.id]));
        setDragState({
            itemId: item.id,
            startClientX: event.clientX,
            startClientY: event.clientY,
            originX: layout.x,
            originY: layout.y,
            width: layout.width,
            height: layout.height,
        });
    }, [bringItemToFront, ensureItemLayout]);

    useEffect(() => {
        if (!dragState) return;
        const handleMouseMove = (event: MouseEvent) => {
            const nextX = clamp(dragState.originX + (event.clientX - dragState.startClientX), 0, CANVAS_WIDTH - dragState.width);
            const nextY = clamp(dragState.originY + (event.clientY - dragState.startClientY), 0, CANVAS_HEIGHT - dragState.height);
            updateItem(dragState.itemId, (item) => ({
                ...item,
                layout: {
                    ...(item.layout || createCanvasLayout(0, item.kind === 'text' ? 'text' : 'image', 1)),
                    x: nextX,
                    y: nextY,
                },
            }));
        };
        const handleMouseUp = () => setDragState(null);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [dragState, updateItem]);

    return (
        <div className="studio-workspace p-6 h-full overflow-hidden flex">
            <div className="w-72 flex-shrink-0 border-r border-gray-700 pr-4 overflow-y-auto space-y-4">
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-lg font-bold text-gray-100">Categories</h2>
                        <button
                            className="app-button p-2"
                            onClick={() => setIsAddingCategory(true)}
                            title="Add custom category"
                        >
                            <AddIcon />
                        </button>
                    </div>

                    {isAddingCategory && (
                        <div className="mb-4 p-3 bg-gray-800 rounded-lg space-y-2">
                            <input
                                type="text"
                                placeholder="Category name..."
                                className="app-input w-full text-sm"
                                value={newCategoryName}
                                onChange={(e) => setNewCategoryName(e.target.value)}
                                autoFocus
                            />
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    placeholder="Icon"
                                    className="app-input w-16 text-center text-lg"
                                    value={newCategoryIcon}
                                    onChange={(e) => setNewCategoryIcon(e.target.value)}
                                    maxLength={2}
                                />
                                <button className="app-button flex-1" onClick={handleAddCategory}>
                                    Add
                                </button>
                                <button
                                    className="app-button app-secondary"
                                    onClick={() => setIsAddingCategory(false)}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="space-y-1">
                        {categorizedMoodboard.categories.map((category) => {
                            const count = getCategoryItemCount(categorizedMoodboard.items, category.id);
                            const isActive = selectedCategoryId === category.id;
                            const isDragOver = dragOverCategory === category.id;

                            return (
                                <div
                                    key={category.id}
                                    className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all ${isActive ? 'bg-indigo-600 text-white' : 'hover:bg-gray-800 text-gray-300'
                                        } ${isDragOver ? 'ring-2 ring-indigo-400' : ''}`}
                                    onClick={() => setSelectedCategoryId(category.id)}
                                    onDragOver={(e) => handleDragOver(e, category.id)}
                                    onDragLeave={handleDragLeave}
                                    onDrop={(e) => handleDropOnCategory(e, category.id)}
                                >
                                    <span className="text-xl" title={category.description}>
                                        {category.icon}
                                    </span>
                                    <span className="flex-1 text-sm font-medium truncate">{category.label}</span>
                                    <span
                                        className={`text-xs px-2 py-0.5 rounded-full ${isActive ? 'bg-indigo-500/50' : 'bg-gray-700'
                                            }`}
                                    >
                                        {count}
                                    </span>
                                    {category.isCustom && (
                                        <button
                                            className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-opacity"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteCategory(category.id);
                                            }}
                                            title="Delete category"
                                        >
                                            <TrashIcon />
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                <section className="app-card p-3 space-y-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Research Import</div>
                    <input
                        value={researchQuery}
                        onChange={(e) => setResearchQuery(e.target.value)}
                        placeholder="Search query (optional)"
                        className="app-input text-sm"
                    />
                    <textarea
                        value={researchUrls}
                        onChange={(e) => setResearchUrls(e.target.value)}
                        placeholder="URL(s), one per line. Video URLs can be frame-extracted."
                        className="app-textarea h-24 text-xs"
                    />
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <label className="text-gray-400">
                            Max
                            <input
                                type="number"
                                min={1}
                                max={24}
                                value={researchMaxResults}
                                onChange={(e) => setResearchMaxResults(Number(e.target.value) || 8)}
                                className="app-input mt-1"
                            />
                        </label>
                        <label className="text-gray-400">
                            Frames/Video
                            <input
                                type="number"
                                min={1}
                                max={6}
                                value={framesPerVideo}
                                onChange={(e) => setFramesPerVideo(Number(e.target.value) || 3)}
                                className="app-input mt-1"
                            />
                        </label>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-gray-300">
                        <input
                            type="checkbox"
                            checked={extractFrames}
                            onChange={(e) => setExtractFrames(e.target.checked)}
                        />
                        Extract still frames from video URLs
                    </label>
                    <button
                        className="app-button w-full"
                        onClick={handleResearchImport}
                        disabled={isResearching}
                    >
                        {isResearching ? 'Importing...' : 'Import Research'}
                    </button>
                    {researchStatus && <div className="text-[10px] text-gray-400">{researchStatus}</div>}
                </section>
            </div>

            <div className="flex-1 pl-6 overflow-hidden flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-6 gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-3">
                            <span className="text-3xl">{selectedCategory?.icon}</span>
                            {selectedCategory?.label || 'Moodboard'}
                        </h1>
                        <p className="text-sm text-gray-400 mt-1">{selectedCategory?.description}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                        <div className="inline-flex rounded-lg overflow-hidden border border-gray-700">
                            <button
                                className={`px-3 py-2 text-xs ${viewMode === 'grid' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-300'}`}
                                onClick={() => setViewMode('grid')}
                            >
                                Grid
                            </button>
                            <button
                                className={`px-3 py-2 text-xs ${viewMode === 'canvas' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-300'}`}
                                onClick={() => setViewMode('canvas')}
                            >
                                Canvas
                            </button>
                        </div>
                        {selectedItemIds.size > 0 && (
                            <>
                                <select
                                    className="app-input text-sm"
                                    onChange={(e) => {
                                        if (e.target.value) {
                                            handleMoveToCategory(e.target.value);
                                            e.target.value = '';
                                        }
                                    }}
                                    defaultValue=""
                                >
                                    <option value="" disabled>
                                        Move to...
                                    </option>
                                    {categorizedMoodboard.categories
                                        .filter((c) => c.id !== selectedCategoryId)
                                        .map((c) => (
                                            <option key={c.id} value={c.id}>
                                                {c.icon} {c.label}
                                            </option>
                                        ))}
                                </select>
                                <button className="app-button app-secondary text-red-400" onClick={handleDeleteSelected}>
                                    <TrashIcon /> Delete ({selectedItemIds.size})
                                </button>
                            </>
                        )}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={handleFileUpload}
                        />
                        <button className="app-button app-secondary" onClick={handleAddTextCard}>
                            <AddIcon /> Add Text
                        </button>
                        <button className="app-button" onClick={() => fileInputRef.current?.click()}>
                            <UploadIcon /> Upload Images
                        </button>
                    </div>
                </div>

                {viewMode === 'grid' ? (
                    categoryItems.length === 0 ? (
                        <div
                            className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-gray-700 rounded-xl text-gray-500"
                            onDragOver={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                            }}
                            onDrop={(e) => handleDropOnCategory(e, selectedCategoryId)}
                        >
                            <UploadIcon className="w-12 h-12 mb-4 opacity-50" />
                            <p className="text-lg font-medium">No items in this category</p>
                            <p className="text-sm mt-2">Drag & drop images, add text cards, or import research</p>
                        </div>
                    ) : (
                        <div className="overflow-y-auto pr-1">
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                {categoryItems.map((rawItem, index) => {
                                    const item = ensureItemLayout(rawItem, index);
                                    const isSelected = selectedItemIds.has(item.id);
                                    const isText = item.kind === 'text';
                                    return (
                                        <div
                                            key={item.id}
                                            className={`group relative rounded-xl overflow-hidden cursor-pointer transition-all ${isSelected ? 'ring-4 ring-indigo-500 scale-[0.98]' : 'hover:ring-2 hover:ring-gray-500'
                                                } ${isText ? 'bg-gray-800 border border-gray-700 p-3 min-h-[180px]' : 'aspect-square'}`}
                                            onClick={(e) => toggleSelectItem(item.id, e.shiftKey || e.metaKey)}
                                            onDoubleClick={() => !isText && setPreviewItem(item)}
                                            draggable={!isText}
                                            onDragStart={() => {
                                                if (!selectedItemIds.has(item.id)) {
                                                    setSelectedItemIds(new Set([item.id]));
                                                }
                                            }}
                                        >
                                            {isText ? (
                                                <div className="h-full flex flex-col">
                                                    <input
                                                        value={item.label || ''}
                                                        onChange={(e) => updateItem(item.id, (prev) => ({ ...prev, label: e.target.value }))}
                                                        className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 mb-2"
                                                        placeholder="Card title"
                                                    />
                                                    <textarea
                                                        value={item.text || ''}
                                                        onChange={(e) => updateItem(item.id, (prev) => ({ ...prev, text: e.target.value }))}
                                                        className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-2 text-xs text-gray-200 resize-none"
                                                        placeholder="Notes..."
                                                    />
                                                </div>
                                            ) : (
                                                <>
                                                    {item.url ? (
                                                        <img
                                                            src={item.url}
                                                            alt={item.label || 'Moodboard image'}
                                                            className="w-full h-full object-cover"
                                                        />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                                                            Image unavailable
                                                        </div>
                                                    )}
                                                    <div
                                                        className={`absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                                            } transition-opacity`}
                                                    >
                                                        <div className="absolute bottom-0 left-0 right-0 p-3">
                                                            <p className="text-sm font-medium text-white truncate">{item.label}</p>
                                                            {(item.sourceLabel || item.query) && (
                                                                <p className="text-[10px] text-gray-300 truncate mt-1">
                                                                    {item.sourceLabel ? `${item.sourceLabel}` : ''}
                                                                    {item.sourceLabel && item.query ? ' · ' : ''}
                                                                    {item.query ? `query: ${item.query}` : ''}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                </>
                                            )}
                                            <button
                                                className="absolute top-3 right-3 p-1.5 rounded-full bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteItem(item.id);
                                                }}
                                            >
                                                <TrashIcon className="w-4 h-4" />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )
                ) : (
                    <div className="flex-1 min-h-0 border border-gray-700 rounded-xl bg-gray-950 overflow-auto">
                        <div
                            ref={canvasRef}
                            className="relative"
                            style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
                            onClick={() => setSelectedItemIds(new Set())}
                        >
                            {categoryItems.map((rawItem, index) => {
                                const item = ensureItemLayout(rawItem, index);
                                const isSelected = selectedItemIds.has(item.id);
                                const isText = item.kind === 'text';
                                const layout = item.layout!;
                                return (
                                    <div
                                        key={item.id}
                                        className={`absolute rounded-xl border ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-500/40' : 'border-gray-700'} shadow-xl overflow-hidden bg-gray-900`}
                                        style={{
                                            left: layout.x,
                                            top: layout.y,
                                            width: layout.width,
                                            height: layout.height,
                                            zIndex: layout.zIndex || 1,
                                        }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            toggleSelectItem(item.id, e.shiftKey || e.metaKey);
                                            bringItemToFront(item.id);
                                        }}
                                    >
                                        <div
                                            className="h-8 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-2 cursor-move"
                                            onMouseDown={(e) => startCanvasDrag(e, item)}
                                        >
                                            <span className="text-[10px] text-gray-300 truncate">
                                                {item.label || (isText ? 'Text Card' : 'Image')}
                                            </span>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    className="text-[10px] text-gray-400 hover:text-white"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        updateItem(item.id, (prev) => ({
                                                            ...prev,
                                                            layout: {
                                                                ...(prev.layout || createCanvasLayout(0, prev.kind === 'text' ? 'text' : 'image', 1)),
                                                                width: clamp((prev.layout?.width || 260) - 30, 180, 720),
                                                                height: clamp((prev.layout?.height || 220) - 30, 120, 720),
                                                            },
                                                        }));
                                                    }}
                                                >
                                                    -
                                                </button>
                                                <button
                                                    className="text-[10px] text-gray-400 hover:text-white"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        updateItem(item.id, (prev) => ({
                                                            ...prev,
                                                            layout: {
                                                                ...(prev.layout || createCanvasLayout(0, prev.kind === 'text' ? 'text' : 'image', 1)),
                                                                width: clamp((prev.layout?.width || 260) + 30, 180, 720),
                                                                height: clamp((prev.layout?.height || 220) + 30, 120, 720),
                                                            },
                                                        }));
                                                    }}
                                                >
                                                    +
                                                </button>
                                                <button
                                                    className="text-[10px] text-red-300 hover:text-red-100"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDeleteItem(item.id);
                                                    }}
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        </div>
                                        <div className="h-[calc(100%-2rem)]">
                                            {isText ? (
                                                <div className="p-2 h-full flex flex-col gap-2">
                                                    <input
                                                        value={item.label || ''}
                                                        onChange={(e) => updateItem(item.id, (prev) => ({ ...prev, label: e.target.value }))}
                                                        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100"
                                                        placeholder="Card title"
                                                    />
                                                    <textarea
                                                        value={item.text || ''}
                                                        onChange={(e) => updateItem(item.id, (prev) => ({ ...prev, text: e.target.value }))}
                                                        className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-2 text-xs text-gray-200 resize-none"
                                                        placeholder="Notes..."
                                                    />
                                                </div>
                                            ) : (
                                                <div className="h-full flex flex-col">
                                                    {item.url ? (
                                                        <img
                                                            src={item.url}
                                                            alt={item.label || 'Moodboard image'}
                                                            className="w-full flex-1 object-cover"
                                                            onDoubleClick={() => setPreviewItem(item)}
                                                        />
                                                    ) : (
                                                        <div className="flex-1 flex items-center justify-center text-xs text-gray-500 bg-black/30">
                                                            Image unavailable
                                                        </div>
                                                    )}
                                                    <input
                                                        value={item.label || ''}
                                                        onChange={(e) => updateItem(item.id, (prev) => ({ ...prev, label: e.target.value }))}
                                                        className="bg-gray-800 border-t border-gray-700 px-2 py-1 text-[11px] text-gray-100"
                                                        placeholder="Image label"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                            {categoryItems.length === 0 && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
                                    <p className="text-lg font-medium">Empty Canvas</p>
                                    <p className="text-sm mt-1">Add images or text cards to arrange freely.</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {previewItem && (
                <div
                    className="fixed inset-0 z-[70] bg-black/85 backdrop-blur-sm flex items-center justify-center p-6"
                    onClick={() => setPreviewItem(null)}
                >
                    <div
                        className="max-w-6xl w-full max-h-full bg-gray-900 border border-gray-700 rounded-xl overflow-hidden"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-gray-700">
                            <div className="min-w-0">
                                <h3 className="text-sm font-semibold text-gray-100 truncate">{previewItem.label || 'Moodboard image'}</h3>
                                <p className="text-xs text-gray-400 truncate">
                                    {previewItem.sourceLabel || 'Local'}{previewItem.query ? ` · query: ${previewItem.query}` : ''}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                {previewItem.sourceUrl && (
                                    <a
                                        href={previewItem.sourceUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="app-button app-secondary text-xs"
                                    >
                                        Open Source
                                    </a>
                                )}
                                <button className="app-button text-xs" onClick={() => setPreviewItem(null)}>
                                    Close
                                </button>
                            </div>
                        </div>
                        <div className="bg-black max-h-[80vh] overflow-auto flex items-center justify-center">
                            {previewItem.url ? (
                                <img
                                    src={previewItem.url}
                                    alt={previewItem.label || 'Moodboard preview'}
                                    className="max-w-full max-h-[80vh] object-contain"
                                />
                            ) : (
                                <div className="p-6 text-sm text-gray-400">Image unavailable</div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MoodboardWorkspace;
