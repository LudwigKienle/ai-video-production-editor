import React, { useEffect, useMemo, useState } from 'react';
import type { ProjectResearchMode, ProjectResearchReport, StoryBible } from '../types';
import {
    buildProjectResearchBriefMarkdown,
    buildProjectResearchPitchDeckMarkdown,
    buildSuggestedResearchQuery,
    getProjectResearchModeLabel,
    runProjectResearch,
} from '../services/projectResearchService';
import {
    createDefaultCategorizedMoodboard,
    DEFAULT_MOODBOARD_CATEGORIES,
} from '../data/moodboardTypes';
import {
    BrainCircuitIcon,
    CheckCircleIcon,
    ClipboardCheckIcon,
    GridIcon,
    InfoIcon,
    SearchIcon,
    SparklesIcon,
} from './icons';
import { isBraveSearchConfigured } from '../services/braveSearchService';

type ProjectResearchPanelProps = {
    storyBible: StoryBible;
    setStoryBible: React.Dispatch<React.SetStateAction<StoryBible>>;
    onOpenMoodboard?: () => void;
    onOpenSettings?: () => void;
};

const RESEARCH_MODE_OPTIONS: Array<{ id: ProjectResearchMode; label: string; hint: string }> = [
    {
        id: 'creative_development',
        label: 'Creative / Film',
        hint: 'Look, tone, references, visual direction, cinematography.',
    },
    {
        id: 'script_theme',
        label: 'Script Theme',
        hint: 'Theme research, symbolism, world building, story motifs.',
    },
    {
        id: 'brand_history',
        label: 'Brand History',
        hint: 'Company background, heritage, launch history, archive material.',
    },
    {
        id: 'market_intelligence',
        label: 'Market & Ads',
        hint: 'Audience trends, competitors, ad references, campaign signals.',
    },
    {
        id: 'technology_scan',
        label: 'Technology Scan',
        hint: 'New inventions, product launches, innovation and future scanning.',
    },
];

const CATEGORY_OPTIONS = DEFAULT_MOODBOARD_CATEGORIES.filter((category) => category.id !== 'custom');

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const createCanvasLayout = (index: number, zIndex: number) => {
    const col = index % 4;
    const row = Math.floor(index / 4);
    return {
        x: 48 + col * 290,
        y: 48 + row * 240,
        width: 250,
        height: 210,
        zIndex,
    };
};

const formatHitHost = (url: string) => {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return url;
    }
};

const ProjectResearchPanel: React.FC<ProjectResearchPanelProps> = ({
    storyBible,
    setStoryBible,
    onOpenMoodboard,
    onOpenSettings,
}) => {
    const [mode, setMode] = useState<ProjectResearchMode>('creative_development');
    const [query, setQuery] = useState('');
    const [includeWeb, setIncludeWeb] = useState(true);
    const [includeNews, setIncludeNews] = useState(true);
    const [includeImages, setIncludeImages] = useState(true);
    const [resultCount, setResultCount] = useState(8);
    const [selectedCategoryId, setSelectedCategoryId] = useState('composition');
    const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
    const [status, setStatus] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const braveReady = isBraveSearchConfigured();
    const savedReports = storyBible.researchReports || [];
    const suggestedQuery = useMemo(
        () => buildSuggestedResearchQuery(storyBible, mode),
        [mode, storyBible],
    );

    useEffect(() => {
        if (selectedReportId) {
            const stillExists = savedReports.some((report) => report.id === selectedReportId);
            if (stillExists) return;
        }
        setSelectedReportId(savedReports[0]?.id || null);
    }, [savedReports, selectedReportId]);

    const activeReport = useMemo(() => {
        if (!savedReports.length) return null;
        return savedReports.find((report) => report.id === selectedReportId) || savedReports[0] || null;
    }, [savedReports, selectedReportId]);

    const persistReport = (report: ProjectResearchReport) => {
        setStoryBible((prev) => ({
            ...prev,
            researchReports: [report, ...(prev.researchReports || [])].slice(0, 12),
        }));
        setSelectedReportId(report.id);
    };

    const handleRunResearch = async () => {
        const resolvedQuery = (query || suggestedQuery || '').trim();
        if (!resolvedQuery) {
            setError('Enter a topic or use a project with a title/logline/script so the research query can be derived.');
            return;
        }

        setIsLoading(true);
        setError(null);
        setStatus(null);
        try {
            const result = await runProjectResearch({
                query: resolvedQuery,
                mode,
                storyBible,
                kinds: {
                    web: includeWeb,
                    news: includeNews,
                    image: includeImages,
                },
                count: clamp(Math.round(resultCount || 8), 4, 12),
            });
            if (!result.ok || !result.report) {
                throw new Error(result.error || 'Research run failed.');
            }
            persistReport(result.report);
            setQuery(resolvedQuery);
            setStatus(`Saved research dossier with ${result.report.webHits.length + result.report.newsHits.length + result.report.imageHits.length} sources.`);
        } catch (researchError) {
            setError(researchError instanceof Error ? researchError.message : 'Research run failed.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleCopyBrief = async () => {
        if (!activeReport) return;
        await navigator.clipboard.writeText(buildProjectResearchBriefMarkdown(activeReport));
        setStatus('Research brief copied to clipboard.');
    };

    const handleCopyPitchDeck = async () => {
        if (!activeReport) return;
        await navigator.clipboard.writeText(buildProjectResearchPitchDeckMarkdown(activeReport));
        setStatus('Pitch deck outline copied to clipboard.');
    };

    const handleImportImages = (maxImages = 8) => {
        if (!activeReport) return;
        const sourceImages = activeReport.imageHits
            .map((hit) => ({
                url: hit.thumbnailUrl || hit.url,
                title: hit.title,
                sourceUrl: hit.url,
                sourceLabel: hit.source || formatHitHost(hit.url),
                query: activeReport.query,
            }))
            .filter((entry) => Boolean(entry.url));

        if (sourceImages.length === 0) {
            setError('This report does not have importable image references yet.');
            return;
        }

        let importedCount = 0;
        setStoryBible((prev) => {
            const categorizedMoodboard = prev.categorizedMoodboard || createDefaultCategorizedMoodboard();
            const categoryItems = categorizedMoodboard.items.filter((item) => item.categoryId === selectedCategoryId);
            const existingKeys = new Set(
                categorizedMoodboard.items.map((item) => `${item.url || ''}|${item.sourceUrl || ''}`),
            );
            let zIndex = categoryItems.reduce((max, item) => Math.max(max, item.layout?.zIndex || 0), 0) + 1;

            const newItems = sourceImages
                .filter((entry) => !existingKeys.has(`${entry.url}|${entry.sourceUrl}`))
                .slice(0, maxImages)
                .map((entry, index) => {
                    importedCount += 1;
                    return {
                        id: `research-mood-${Date.now()}-${index}`,
                        kind: 'image' as const,
                        url: entry.url,
                        thumbnailUrl: entry.url,
                        label: entry.title,
                        categoryId: selectedCategoryId,
                        createdAt: new Date().toISOString(),
                        sourceUrl: entry.sourceUrl,
                        sourceLabel: entry.sourceLabel,
                        sourceType: 'search' as const,
                        query: entry.query,
                        layout: createCanvasLayout(categoryItems.length + index, zIndex++),
                    };
                });

            return {
                ...prev,
                categorizedMoodboard: {
                    ...categorizedMoodboard,
                    items: [...categorizedMoodboard.items, ...newItems],
                },
            };
        });

        if (!importedCount) {
            setStatus('All top image references from this report are already in the moodboard.');
            return;
        }

        setStatus(`Imported ${importedCount} research image(s) to the moodboard.`);
    };

    const handleDeleteReport = (reportId: string) => {
        setStoryBible((prev) => ({
            ...prev,
            researchReports: (prev.researchReports || []).filter((report) => report.id !== reportId),
        }));
        setStatus('Research dossier removed from the project.');
    };

    const resultSections = activeReport
        ? [
            { id: 'overview', title: 'Overview', items: activeReport.overview },
            { id: 'findings', title: 'Key Findings', items: activeReport.keyFindings },
            { id: 'opportunities', title: 'Opportunities', items: activeReport.opportunities },
            { id: 'moodboard', title: 'Moodboard Queries', items: activeReport.moodboardQueries },
        ]
        : [];

    return (
        <div className="h-full overflow-hidden bg-gray-950 text-white">
            <div className="grid h-full gap-4 p-4 xl:grid-cols-[320px_minmax(0,1fr)]">
                <div className="flex min-h-0 flex-col gap-4">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="flex items-center gap-3">
                            <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 p-2 text-cyan-200">
                                <SearchIcon className="h-5 w-5" />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold">Internal Project Research</h2>
                                <p className="text-xs text-gray-400">Brave Search based. No MCP server required.</p>
                            </div>
                        </div>

                        <div className="mt-4 space-y-3">
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">Research Mode</label>
                                <select
                                    value={mode}
                                    onChange={(event) => setMode(event.target.value as ProjectResearchMode)}
                                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-cyan-400/40 focus:outline-none"
                                >
                                    {RESEARCH_MODE_OPTIONS.map((option) => (
                                        <option key={option.id} value={option.id}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                                <p className="mt-1 text-[11px] text-gray-500">
                                    {RESEARCH_MODE_OPTIONS.find((option) => option.id === mode)?.hint}
                                </p>
                            </div>

                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">Topic / Brand / Theme</label>
                                <textarea
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    rows={4}
                                    placeholder={suggestedQuery || 'Example: eco-futurist sneaker brand launch campaign'}
                                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-cyan-400/40 focus:outline-none"
                                />
                                {suggestedQuery && !query.trim() && (
                                    <button
                                        type="button"
                                        onClick={() => setQuery(suggestedQuery)}
                                        className="mt-2 text-xs text-cyan-200 hover:text-white"
                                    >
                                        Use project context: {suggestedQuery}
                                    </button>
                                )}
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                                <label className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-gray-200">
                                    <input type="checkbox" checked={includeWeb} onChange={(event) => setIncludeWeb(event.target.checked)} className="mr-2" />
                                    Web
                                </label>
                                <label className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-gray-200">
                                    <input type="checkbox" checked={includeNews} onChange={(event) => setIncludeNews(event.target.checked)} className="mr-2" />
                                    News
                                </label>
                                <label className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-gray-200">
                                    <input type="checkbox" checked={includeImages} onChange={(event) => setIncludeImages(event.target.checked)} className="mr-2" />
                                    Images
                                </label>
                            </div>

                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">Sources Per Kind</label>
                                <input
                                    type="range"
                                    min={4}
                                    max={12}
                                    step={1}
                                    value={resultCount}
                                    onChange={(event) => setResultCount(Number(event.target.value))}
                                    className="w-full"
                                />
                                <div className="text-xs text-gray-400">{resultCount} results per source lane</div>
                            </div>

                            {!braveReady && (
                                <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-xs text-amber-100">
                                    <div className="font-semibold">Brave Search API key missing.</div>
                                    <div className="mt-1">Open settings and save a Brave Search API key to use the internal research tool.</div>
                                    {onOpenSettings && (
                                        <button
                                            type="button"
                                            onClick={onOpenSettings}
                                            className="mt-2 rounded-full border border-amber-300/30 px-3 py-1 text-[11px] font-medium text-amber-100 hover:bg-amber-300/10"
                                        >
                                            Open Settings
                                        </button>
                                    )}
                                </div>
                            )}

                            <button
                                type="button"
                                disabled={isLoading || !braveReady}
                                onClick={() => void handleRunResearch()}
                                className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-2.5 text-sm font-medium text-cyan-100 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <SparklesIcon className="h-4 w-4" />
                                {isLoading ? 'Running research...' : 'Run Internet Research'}
                            </button>
                        </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 min-h-0">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-white">Saved Dossiers</h3>
                            <span className="text-[11px] text-gray-500">{savedReports.length} saved</span>
                        </div>
                        <div className="mt-3 max-h-[46vh] space-y-2 overflow-y-auto pr-1">
                            {savedReports.length === 0 && (
                                <div className="rounded-xl border border-dashed border-white/10 p-3 text-xs text-gray-500">
                                    Run your first research dossier to save sources, moodboard queries, and pitch deck notes to the project.
                                </div>
                            )}
                            {savedReports.map((report) => (
                                <div
                                    key={report.id}
                                    className={`rounded-xl border p-3 ${activeReport?.id === report.id ? 'border-cyan-400/30 bg-cyan-500/10' : 'border-white/10 bg-black/20'}`}
                                >
                                    <button
                                        type="button"
                                        onClick={() => setSelectedReportId(report.id)}
                                        className="w-full text-left"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="text-xs font-semibold text-white">{report.query}</div>
                                                <div className="mt-1 text-[11px] text-gray-400">{getProjectResearchModeLabel(report.mode)}</div>
                                                <div className="mt-1 text-[11px] text-gray-500">{new Date(report.createdAt).toLocaleString()}</div>
                                            </div>
                                            {activeReport?.id === report.id && <CheckCircleIcon className="h-4 w-4 text-cyan-200" />}
                                        </div>
                                    </button>
                                    <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-500">
                                        <span>{report.webHits.length} web</span>
                                        <span>{report.newsHits.length} news</span>
                                        <span>{report.imageHits.length} images</span>
                                        <button
                                            type="button"
                                            onClick={() => handleDeleteReport(report.id)}
                                            className="ml-auto text-rose-200 hover:text-white"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="min-h-0 overflow-y-auto rounded-2xl border border-white/10 bg-white/5 p-4">
                    {error && (
                        <div className="mb-4 rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-100">
                            {error}
                        </div>
                    )}
                    {status && (
                        <div className="mb-4 rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                            {status}
                        </div>
                    )}

                    {!activeReport ? (
                        <div className="flex h-full min-h-[480px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 p-8 text-center">
                            <BrainCircuitIcon className="h-10 w-10 text-cyan-200" />
                            <h3 className="mt-4 text-xl font-semibold text-white">Build a project research dossier</h3>
                            <p className="mt-2 max-w-2xl text-sm text-gray-400">
                                Research themes, film references, company history, latest inventions, audience trends, campaign examples, and image references directly through Brave Search.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-5">
                            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-100">
                                                {getProjectResearchModeLabel(activeReport.mode)}
                                            </span>
                                            <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-gray-300">
                                                {new Date(activeReport.createdAt).toLocaleString()}
                                            </span>
                                        </div>
                                        <h2 className="mt-3 text-2xl font-semibold text-white">{activeReport.query}</h2>
                                        {activeReport.contextSummary && (
                                            <p className="mt-2 text-sm text-gray-400">{activeReport.contextSummary}</p>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            onClick={() => void handleCopyBrief()}
                                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white hover:border-cyan-400/30 hover:bg-cyan-500/10"
                                        >
                                            Copy Brief
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void handleCopyPitchDeck()}
                                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white hover:border-cyan-400/30 hover:bg-cyan-500/10"
                                        >
                                            Copy Pitch Deck
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleImportImages(8)}
                                            className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-500/20"
                                        >
                                            Import Top Images
                                        </button>
                                        {onOpenMoodboard && (
                                            <button
                                                type="button"
                                                onClick={onOpenMoodboard}
                                                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white hover:border-cyan-400/30 hover:bg-cyan-500/10"
                                            >
                                                Open Moodboard
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-gray-400">
                                    <div className="flex items-center gap-2">
                                        <GridIcon className="h-4 w-4 text-cyan-200" />
                                        Import category
                                    </div>
                                    <select
                                        value={selectedCategoryId}
                                        onChange={(event) => setSelectedCategoryId(event.target.value)}
                                        className="rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white"
                                    >
                                        {CATEGORY_OPTIONS.map((category) => (
                                            <option key={category.id} value={category.id}>
                                                {category.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="grid gap-4 xl:grid-cols-2">
                                {resultSections.map((section) => (
                                    <div key={section.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                                        <div className="text-sm font-semibold text-white">{section.title}</div>
                                        <div className="mt-3 space-y-2">
                                            {section.items.map((item, index) => (
                                                <div key={`${section.id}-${index}`} className="rounded-xl border border-white/8 bg-white/[0.03] p-3 text-sm text-gray-200">
                                                    {item}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                                <div className="flex items-center gap-2">
                                    <ClipboardCheckIcon className="h-4 w-4 text-cyan-200" />
                                    <h3 className="text-sm font-semibold text-white">Pitch Deck Outline</h3>
                                </div>
                                <div className="mt-4 grid gap-3">
                                    {activeReport.pitchDeckSlides.map((slide, index) => (
                                        <div key={slide.id} className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
                                            <div className="text-xs uppercase tracking-[0.22em] text-gray-500">Slide {index + 1}</div>
                                            <div className="mt-1 text-base font-semibold text-white">{slide.title}</div>
                                            <div className="mt-1 text-sm text-gray-400">{slide.objective}</div>
                                            <ul className="mt-3 space-y-2 text-sm text-gray-200">
                                                {slide.bullets.map((bullet, bulletIndex) => (
                                                    <li key={`${slide.id}-${bulletIndex}`} className="rounded-lg border border-white/6 bg-black/20 px-3 py-2">
                                                        {bullet}
                                                    </li>
                                                ))}
                                            </ul>
                                            {slide.sources && slide.sources.length > 0 && (
                                                <div className="mt-3 text-xs text-gray-500">
                                                    Sources: {slide.sources.join(' | ')}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="grid gap-4 xl:grid-cols-3">
                                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                                    <div className="text-sm font-semibold text-white">Web Sources</div>
                                    <div className="mt-3 space-y-3">
                                        {activeReport.webHits.length === 0 && <div className="text-xs text-gray-500">No web sources.</div>}
                                        {activeReport.webHits.map((hit) => (
                                            <a key={hit.id} href={hit.url} target="_blank" rel="noreferrer" className="block rounded-xl border border-white/8 bg-white/[0.03] p-3 hover:border-cyan-400/20">
                                                <div className="text-sm font-medium text-white">{hit.title}</div>
                                                <div className="mt-1 text-[11px] text-gray-500">{hit.source || formatHitHost(hit.url)}</div>
                                                {hit.snippet && <div className="mt-2 text-xs text-gray-300">{hit.snippet}</div>}
                                            </a>
                                        ))}
                                    </div>
                                </div>

                                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                                    <div className="text-sm font-semibold text-white">News Sources</div>
                                    <div className="mt-3 space-y-3">
                                        {activeReport.newsHits.length === 0 && <div className="text-xs text-gray-500">No news sources.</div>}
                                        {activeReport.newsHits.map((hit) => (
                                            <a key={hit.id} href={hit.url} target="_blank" rel="noreferrer" className="block rounded-xl border border-white/8 bg-white/[0.03] p-3 hover:border-cyan-400/20">
                                                <div className="text-sm font-medium text-white">{hit.title}</div>
                                                <div className="mt-1 text-[11px] text-gray-500">
                                                    {(hit.source || formatHitHost(hit.url))}{hit.publishedAt ? ` | ${hit.publishedAt}` : ''}
                                                </div>
                                                {hit.snippet && <div className="mt-2 text-xs text-gray-300">{hit.snippet}</div>}
                                            </a>
                                        ))}
                                    </div>
                                </div>

                                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                                    <div className="flex items-center gap-2">
                                        <GridIcon className="h-4 w-4 text-cyan-200" />
                                        <div className="text-sm font-semibold text-white">Image References</div>
                                    </div>
                                    <div className="mt-3 grid grid-cols-2 gap-3">
                                        {activeReport.imageHits.length === 0 && (
                                            <div className="col-span-2 text-xs text-gray-500">No image references.</div>
                                        )}
                                        {activeReport.imageHits.map((hit) => (
                                            <a key={hit.id} href={hit.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-white/8 bg-white/[0.03] hover:border-cyan-400/20">
                                                <div className="aspect-[4/3] bg-black/30">
                                                    {hit.thumbnailUrl ? (
                                                        <img src={hit.thumbnailUrl} alt={hit.title} className="h-full w-full object-cover" />
                                                    ) : (
                                                        <div className="flex h-full items-center justify-center text-[11px] text-gray-500">No preview</div>
                                                    )}
                                                </div>
                                                <div className="p-3">
                                                    <div className="text-xs font-medium text-white line-clamp-2">{hit.title}</div>
                                                    <div className="mt-1 text-[11px] text-gray-500">{hit.source || formatHitHost(hit.url)}</div>
                                                </div>
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-gray-300">
                                <div className="flex items-start gap-3">
                                    <InfoIcon className="mt-0.5 h-4 w-4 text-cyan-200" />
                                    <div>
                                        This research tool stays fully internal to the app. It uses the saved Brave Search API key for web, news, and image lanes, and it can push selected image references straight into the project moodboard without relying on NotebookLM MCP.
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ProjectResearchPanel;
