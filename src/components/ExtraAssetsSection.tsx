import React, { useState, useRef, useCallback } from 'react';
import type { ExtraAsset, ExtraAssetCategory, ExtraAssetsState, ReferenceItem, ShotPrompt } from '../types';
import {
    EXTRA_ASSET_CATEGORIES,
    ASPECT_RATIO_PRESETS,
    createExtraAsset,
    getCategoryInfo,
    getAspectRatioPreset,
    getAspectRatioForCategory,
} from '../data/extraAssetTypes';
import { SparklesIcon, TrashIcon, DownloadIcon, LandscapeIcon } from './icons';

interface ExtraAssetsSectionProps {
    extraAssets: ExtraAssetsState | null;
    onChange: (next: ExtraAssetsState) => void;
    references?: ReferenceItem[];
    shotPrompts?: ShotPrompt[];
    storyTitle?: string;
    onGenerateAsset?: (asset: ExtraAsset) => Promise<string | null>;
    apiKeyReady?: boolean;
}

const ExtraAssetsSection: React.FC<ExtraAssetsSectionProps> = ({
    extraAssets,
    onChange,
    references = [],
    shotPrompts = [],
    storyTitle = 'Untitled Project',
    onGenerateAsset,
    apiKeyReady = false,
}) => {
    const state = extraAssets || { assets: [] };
    const [activeCategory, setActiveCategory] = useState<ExtraAssetCategory>('poster');
    const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const selectedAsset = state.assets.find((a) => a.id === selectedAssetId);
    const categoryAssets = state.assets.filter((a) => a.category === activeCategory);

    const updateAssets = useCallback(
        (update: (prev: ExtraAsset[]) => ExtraAsset[]) => {
            onChange({ ...state, assets: update(state.assets) });
        },
        [state, onChange]
    );

    const addAsset = useCallback(
        (category: ExtraAssetCategory) => {
            const categoryInfo = getCategoryInfo(category);
            const defaultAspect = getAspectRatioForCategory(category);
            const assetName = `${categoryInfo?.label || 'Asset'} ${state.assets.filter((a) => a.category === category).length + 1}`;
            const newAsset = createExtraAsset(category, assetName, {
                aspectRatio: defaultAspect,
            });
            updateAssets((prev) => [...prev, newAsset]);
            setSelectedAssetId(newAsset.id);
            setIsCreating(false);
        },
        [state, updateAssets]
    );

    const updateAsset = useCallback(
        (assetId: string, updates: Partial<ExtraAsset>) => {
            updateAssets((prev) =>
                prev.map((a) => (a.id === assetId ? { ...a, ...updates } : a))
            );
        },
        [updateAssets]
    );

    const removeAsset = useCallback(
        (assetId: string) => {
            updateAssets((prev) => prev.filter((a) => a.id !== assetId));
            if (selectedAssetId === assetId) {
                setSelectedAssetId(null);
            }
        },
        [selectedAssetId, updateAssets]
    );

    const handleFileUpload = useCallback(
        (assetId: string, file: File) => {
            const reader = new FileReader();
            reader.onload = () => {
                const url = reader.result as string;
                updateAsset(assetId, {
                    imageUrl: url,
                    imageVersions: [url],
                    selectedVersionIndex: 0,
                });
            };
            reader.readAsDataURL(file);
        },
        [updateAsset]
    );

    const handleGenerate = useCallback(
        async (assetId: string) => {
            if (!onGenerateAsset) return;
            const asset = state.assets.find((a) => a.id === assetId);
            if (!asset) return;

            updateAsset(assetId, { isGenerating: true });

            try {
                const newUrl = await onGenerateAsset(asset);
                if (newUrl) {
                    const versions = [...(asset.imageVersions || []), newUrl];
                    updateAsset(assetId, {
                        imageUrl: newUrl,
                        imageVersions: versions,
                        selectedVersionIndex: versions.length - 1,
                        isGenerating: false,
                    });
                } else {
                    updateAsset(assetId, { isGenerating: false });
                }
            } catch (error) {
                console.error('Failed to generate asset:', error);
                updateAsset(assetId, { isGenerating: false });
            }
        },
        [state, onGenerateAsset, updateAsset]
    );

    const selectVersion = useCallback(
        (assetId: string, index: number) => {
            const asset = state.assets.find((a) => a.id === assetId);
            if (!asset?.imageVersions) return;
            updateAsset(assetId, {
                selectedVersionIndex: index,
                imageUrl: asset.imageVersions[index] || asset.imageUrl,
            });
        },
        [state, updateAsset]
    );

    return (
        <div className="extra-assets-section">
            <div className="extra-assets-header">
                <h3>Marketing Assets</h3>
                <p className="subtitle">Create posters, thumbnails, and promo materials for your project</p>
            </div>

            {/* Category Tabs */}
            <div className="category-tabs">
                {EXTRA_ASSET_CATEGORIES.map((cat) => (
                    <button
                        key={cat.id}
                        className={`category-tab ${activeCategory === cat.id ? 'active' : ''}`}
                        onClick={() => setActiveCategory(cat.id)}
                    >
                        <span className="category-icon">{cat.icon}</span>
                        <span>{cat.label}</span>
                        <span className="count">
                            {state.assets.filter((a) => a.category === cat.id).length}
                        </span>
                    </button>
                ))}
            </div>

            <div className="extra-assets-content">
                {/* Asset Grid */}
                <div className="assets-grid">
                    {categoryAssets.map((asset) => {
                        const aspectPreset = getAspectRatioPreset(asset.aspectRatio || '');
                        return (
                            <div
                                key={asset.id}
                                className={`asset-card ${selectedAssetId === asset.id ? 'selected' : ''}`}
                                onClick={() => setSelectedAssetId(asset.id)}
                            >
                                <div
                                    className="asset-preview"
                                    style={{
                                        aspectRatio: aspectPreset
                                            ? `${aspectPreset.width} / ${aspectPreset.height}`
                                            : '16 / 9',
                                    }}
                                >
                                    {asset.imageUrl ? (
                                        <img src={asset.imageUrl} alt={asset.name} />
                                    ) : (
                                        <div className="placeholder">
                                            <LandscapeIcon className="w-8 h-8" />
                                            <span>No image</span>
                                        </div>
                                    )}
                                    {asset.isGenerating && (
                                        <div className="generating-overlay">
                                            <div className="spinner" />
                                            <span>Generating...</span>
                                        </div>
                                    )}
                                </div>
                                <div className="asset-info">
                                    <span className="asset-name">{asset.name}</span>
                                    {asset.aspectRatio && (
                                        <span className="asset-ratio">{asset.aspectRatio}</span>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {/* Add New Button */}
                    <button
                        className="add-asset-card"
                        onClick={() => addAsset(activeCategory)}
                    >
                        <span className="plus-icon">+</span>
                        <span>Add {getCategoryInfo(activeCategory).label}</span>
                    </button>
                </div>

                {/* Asset Details Panel */}
                {selectedAsset && (
                    <div className="asset-details-panel">
                        <div className="panel-header">
                            <h4>Asset Details</h4>
                            <button
                                className="close-btn"
                                onClick={() => setSelectedAssetId(null)}
                            >
                                ×
                            </button>
                        </div>

                        <div className="panel-content">
                            {/* Name */}
                            <div className="field-group">
                                <label>Name</label>
                                <input
                                    type="text"
                                    value={selectedAsset.name}
                                    onChange={(e) =>
                                        updateAsset(selectedAsset.id, { name: e.target.value })
                                    }
                                />
                            </div>

                            {/* Description */}
                            <div className="field-group">
                                <label>Description / Prompt</label>
                                <textarea
                                    rows={3}
                                    value={selectedAsset.description || ''}
                                    onChange={(e) =>
                                        updateAsset(selectedAsset.id, {
                                            description: e.target.value,
                                        })
                                    }
                                    placeholder="Describe what this asset should show..."
                                />
                            </div>

                            {/* Aspect Ratio */}
                            <div className="field-group">
                                <label>Aspect Ratio</label>
                                <div className="aspect-buttons">
                                    {ASPECT_RATIO_PRESETS.map((preset) => (
                                        <button
                                            key={preset.id}
                                            className={`aspect-btn ${selectedAsset.aspectRatio === preset.id
                                                ? 'active'
                                                : ''
                                                }`}
                                            onClick={() =>
                                                updateAsset(selectedAsset.id, {
                                                    aspectRatio: preset.id,
                                                })
                                            }
                                        >
                                            {preset.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Script Excerpt */}
                            <div className="field-group">
                                <label>Script Excerpt (Context)</label>
                                <textarea
                                    rows={2}
                                    value={selectedAsset.linkedScriptExcerpt || ''}
                                    onChange={(e) =>
                                        updateAsset(selectedAsset.id, {
                                            linkedScriptExcerpt: e.target.value,
                                        })
                                    }
                                    placeholder="Paste relevant script text for context..."
                                />
                            </div>

                            {/* Linked Concepts */}
                            {references.length > 0 && (
                                <div className="field-group">
                                    <label>Linked Concepts</label>
                                    <div className="concept-chips">
                                        {references.slice(0, 8).map((ref) => {
                                            const isLinked =
                                                selectedAsset.linkedConceptIds?.includes(ref.id);
                                            return (
                                                <button
                                                    key={ref.id}
                                                    className={`concept-chip ${isLinked ? 'linked' : ''
                                                        }`}
                                                    onClick={() => {
                                                        const current =
                                                            selectedAsset.linkedConceptIds || [];
                                                        const next = isLinked
                                                            ? current.filter((id) => id !== ref.id)
                                                            : [...current, ref.id];
                                                        updateAsset(selectedAsset.id, {
                                                            linkedConceptIds: next,
                                                        });
                                                    }}
                                                >
                                                    {ref.name}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Linked Shots */}
                            {shotPrompts.length > 0 && (
                                <div className="field-group">
                                    <label>Linked Shots</label>
                                    <div className="shot-chips">
                                        {shotPrompts.slice(0, 12).map((shot) => {
                                            const isLinked =
                                                selectedAsset.linkedShotNumbers?.includes(
                                                    shot.shot
                                                );
                                            return (
                                                <button
                                                    key={shot.shot}
                                                    className={`shot-chip ${isLinked ? 'linked' : ''
                                                        }`}
                                                    onClick={() => {
                                                        const current =
                                                            selectedAsset.linkedShotNumbers || [];
                                                        const next = isLinked
                                                            ? current.filter(
                                                                (n) => n !== shot.shot
                                                            )
                                                            : [...current, shot.shot];
                                                        updateAsset(selectedAsset.id, {
                                                            linkedShotNumbers: next,
                                                        });
                                                    }}
                                                >
                                                    {shot.shot}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Version History */}
                            {selectedAsset.imageVersions &&
                                selectedAsset.imageVersions.length > 1 && (
                                    <div className="field-group">
                                        <label>Versions</label>
                                        <div className="version-strip">
                                            {selectedAsset.imageVersions.map((url, idx) => (
                                                <button
                                                    key={idx}
                                                    className={`version-thumb ${selectedAsset.selectedVersionIndex ===
                                                        idx
                                                        ? 'active'
                                                        : ''
                                                        }`}
                                                    onClick={() =>
                                                        selectVersion(selectedAsset.id, idx)
                                                    }
                                                >
                                                    <img src={url} alt={`v${idx + 1}`} />
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                            {/* Actions */}
                            <div className="action-buttons">
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) {
                                            handleFileUpload(selectedAsset.id, file);
                                        }
                                        e.target.value = '';
                                    }}
                                    style={{ display: 'none' }}
                                />
                                <button
                                    className="action-btn upload"
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <DownloadIcon className="w-4 h-4" />
                                    Upload
                                </button>

                                {onGenerateAsset && apiKeyReady && (
                                    <button
                                        className="action-btn generate"
                                        onClick={() => handleGenerate(selectedAsset.id)}
                                        disabled={selectedAsset.isGenerating}
                                    >
                                        <SparklesIcon className="w-4 h-4" />
                                        {selectedAsset.isGenerating
                                            ? 'Generating...'
                                            : 'Generate with AI'}
                                    </button>
                                )}

                                <button
                                    className="action-btn delete"
                                    onClick={() => removeAsset(selectedAsset.id)}
                                >
                                    <TrashIcon className="w-4 h-4" />
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <style>{`
                .extra-assets-section {
                    padding: 16px;
                    background: linear-gradient(135deg, rgba(18,22,32,0.9), rgba(12,14,20,0.95));
                    border-radius: 16px;
                    border: 1px solid rgba(255,255,255,0.06);
                    box-shadow: 0 16px 48px rgba(0,0,0,0.35);
                }

                .extra-assets-header {
                    margin-bottom: 16px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                }

                .extra-assets-header h3 {
                    font-size: 16px;
                    font-weight: 600;
                    margin: 0 0 4px;
                    color: var(--text-primary, #fff);
                }

                .extra-assets-header .subtitle {
                    font-size: 12px;
                    color: var(--text-secondary, #888);
                    margin: 0;
                }

                .category-tabs {
                    display: flex;
                    gap: 8px;
                    margin-bottom: 16px;
                    flex-wrap: wrap;
                }

                .category-tab {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 8px 12px;
                    background: rgba(28,32,44,0.8);
                    border: 1px solid rgba(255,255,255,0.08);
                    border-radius: 999px;
                    color: var(--text-secondary, #888);
                    cursor: pointer;
                    font-size: 13px;
                    transition: all 0.2s;
                }

                .category-tab:hover {
                    background: var(--background-hover, #2a2f3e);
                    color: var(--text-primary, #fff);
                }

                .category-tab.active {
                    background: var(--accent-primary, #6366f1);
                    color: #fff;
                    border-color: var(--accent-primary, #6366f1);
                    box-shadow: 0 8px 18px rgba(99,102,241,0.35);
                }

                .category-icon {
                    font-size: 16px;
                }

                .count {
                    padding: 2px 6px;
                    background: rgba(255,255,255,0.1);
                    border-radius: 10px;
                    font-size: 11px;
                }

                .extra-assets-content {
                    display: flex;
                    gap: 16px;
                    align-items: stretch;
                }

                .assets-grid {
                    flex: 1;
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
                    gap: 12px;
                }

                .asset-card {
                    background: rgba(24,28,40,0.8);
                    border: 1px solid rgba(255,255,255,0.08);
                    border-radius: 14px;
                    overflow: hidden;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .asset-card:hover {
                    border-color: var(--accent-primary, #6366f1);
                }

                .asset-card.selected {
                    border-color: var(--accent-primary, #6366f1);
                    box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.4), 0 16px 40px rgba(0,0,0,0.4);
                }

                .asset-preview {
                    position: relative;
                    background: var(--background-primary, #0b0f19);
                    overflow: hidden;
                }

                .asset-preview img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }

                .asset-preview .placeholder {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    color: var(--text-secondary, #888);
                    gap: 4px;
                    font-size: 11px;
                }

                .generating-overlay {
                    position: absolute;
                    inset: 0;
                    background: rgba(0,0,0,0.7);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    color: var(--text-primary, #fff);
                    font-size: 12px;
                }

                .spinner {
                    width: 24px;
                    height: 24px;
                    border: 2px solid rgba(255,255,255,0.2);
                    border-top-color: var(--accent-primary, #6366f1);
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                }

                @keyframes spin {
                    to { transform: rotate(360deg); }
                }

                .asset-info {
                    padding: 8px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .asset-name {
                    font-size: 12px;
                    font-weight: 500;
                    color: var(--text-primary, #fff);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .asset-ratio {
                    font-size: 10px;
                    padding: 2px 6px;
                    background: var(--background-primary, #0b0f19);
                    border-radius: 4px;
                    color: var(--text-secondary, #888);
                }

                .add-asset-card {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    min-height: 140px;
                    background: transparent;
                    border: 2px dashed rgba(255,255,255,0.12);
                    border-radius: 14px;
                    color: var(--text-secondary, #888);
                    cursor: pointer;
                    transition: all 0.2s;
                    font-size: 13px;
                }

                .add-asset-card:hover {
                    border-color: var(--accent-primary, #6366f1);
                    color: var(--accent-primary, #6366f1);
                }

                .plus-icon {
                    font-size: 24px;
                    font-weight: 300;
                }

                .asset-details-panel {
                    width: 300px;
                    background: rgba(22,26,38,0.95);
                    border: 1px solid rgba(255,255,255,0.08);
                    border-radius: 16px;
                    overflow: hidden;
                    flex-shrink: 0;
                    box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 20px 48px rgba(0,0,0,0.35);
                }

                .panel-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 12px;
                    border-bottom: 1px solid var(--border-color, #2a2f3e);
                }

                .panel-header h4 {
                    margin: 0;
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--text-primary, #fff);
                }

                .close-btn {
                    background: none;
                    border: none;
                    color: var(--text-secondary, #888);
                    font-size: 20px;
                    cursor: pointer;
                    line-height: 1;
                }

                .panel-content {
                    padding: 12px;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    max-height: 500px;
                    overflow-y: auto;
                }

                .field-group {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .field-group label {
                    font-size: 10px;
                    text-transform: uppercase;
                    color: var(--text-secondary, #888);
                }

                .field-group input,
                .field-group textarea {
                    padding: 8px;
                    background: rgba(10,12,18,0.9);
                    border: 1px solid rgba(255,255,255,0.08);
                    border-radius: 8px;
                    color: var(--text-primary, #fff);
                    font-size: 13px;
                    resize: vertical;
                }

                .aspect-buttons {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 4px;
                }

                .aspect-btn {
                    padding: 4px 8px;
                    background: rgba(31,36,51,0.8);
                    border: 1px solid rgba(255,255,255,0.08);
                    border-radius: 999px;
                    color: var(--text-secondary, #888);
                    font-size: 11px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .aspect-btn:hover {
                    border-color: var(--accent-primary, #6366f1);
                }

                .aspect-btn.active {
                    background: var(--accent-primary, #6366f1);
                    border-color: var(--accent-primary, #6366f1);
                    color: #fff;
                }

                .concept-chips,
                .shot-chips {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 4px;
                }

                .concept-chip,
                .shot-chip {
                    padding: 4px 8px;
                    background: rgba(31,36,51,0.8);
                    border: 1px solid rgba(255,255,255,0.08);
                    border-radius: 999px;
                    color: var(--text-secondary, #888);
                    font-size: 11px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .concept-chip:hover,
                .shot-chip:hover {
                    border-color: var(--accent-primary, #6366f1);
                }

                .concept-chip.linked,
                .shot-chip.linked {
                    background: var(--accent-primary, #6366f1);
                    border-color: var(--accent-primary, #6366f1);
                    color: #fff;
                }

                .version-strip {
                    display: flex;
                    gap: 6px;
                    overflow-x: auto;
                    padding: 4px 0;
                }

                .version-thumb {
                    width: 40px;
                    height: 40px;
                    border-radius: 4px;
                    overflow: hidden;
                    border: 2px solid transparent;
                    cursor: pointer;
                    flex-shrink: 0;
                    padding: 0;
                    background: none;
                }

                .version-thumb.active {
                    border-color: var(--accent-primary, #6366f1);
                }

                .version-thumb img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }

                .action-buttons {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    margin-top: 8px;
                }

                .action-btn {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    padding: 8px 12px;
                    border-radius: 8px;
                    font-size: 12px;
                    cursor: pointer;
                    transition: all 0.2s;
                    border: 1px solid rgba(255,255,255,0.08);
                }

                .action-btn.upload {
                    background: rgba(10,12,18,0.9);
                    color: var(--text-primary, #fff);
                }

                .action-btn.generate {
                    background: var(--accent-primary, #6366f1);
                    color: #fff;
                    flex: 1;
                }

                .action-btn.generate:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }

                .action-btn.delete {
                    background: #ef4444;
                    color: #fff;
                }

                .action-btn:hover:not(:disabled) {
                    filter: brightness(1.1);
                }
            `}</style>
        </div>
    );
};

export default ExtraAssetsSection;
