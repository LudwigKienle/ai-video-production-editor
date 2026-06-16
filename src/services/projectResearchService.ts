import type {
  ProjectPitchDeckSlide,
  ProjectResearchMode,
  ProjectResearchReport,
  ResearchHit,
  StoryBible,
} from '../types';
import { searchBrave } from './braveSearchService';

type ResearchKinds = {
  web?: boolean;
  news?: boolean;
  image?: boolean;
};

type RunProjectResearchOptions = {
  query: string;
  mode: ProjectResearchMode;
  storyBible?: Pick<StoryBible, 'title' | 'logline' | 'script' | 'targetAudience' | 'projectType'>;
  kinds?: ResearchKinds;
  count?: number;
};

type ProjectResearchResult = {
  ok: boolean;
  report?: ProjectResearchReport;
  error?: string;
};

const MAX_SCRIPT_EXCERPT = 420;

const MODE_LABELS: Record<ProjectResearchMode, string> = {
  creative_development: 'Creative Development',
  script_theme: 'Script Theme',
  brand_history: 'Brand History',
  market_intelligence: 'Market & Ads',
  technology_scan: 'Technology Scan',
};

const createEmptySearchResult = (query: string, kind: 'web' | 'news' | 'image') => ({
  ok: true,
  hits: [] as ResearchHit[],
  provider: 'brave' as const,
  query,
  kind,
  error: undefined as string | undefined,
});

const unique = (items: string[]) =>
  Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));

const truncate = (value: string, max = 180) =>
  value.length > max ? `${value.slice(0, max - 1).trim()}…` : value;

const buildId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const normalizeQuery = (value: string) => value.trim().replace(/\s+/g, ' ');

const buildStoryContext = (
  storyBible?: Pick<StoryBible, 'title' | 'logline' | 'script' | 'targetAudience' | 'projectType'>,
) => {
  if (!storyBible) return '';
  const scriptExcerpt = (storyBible.script || '').trim().slice(0, MAX_SCRIPT_EXCERPT);
  return [
    storyBible.title ? `Project: ${storyBible.title}` : null,
    storyBible.projectType ? `Format: ${storyBible.projectType}` : null,
    storyBible.targetAudience ? `Audience: ${storyBible.targetAudience}` : null,
    storyBible.logline ? `Logline: ${storyBible.logline}` : null,
    scriptExcerpt ? `Script excerpt: ${scriptExcerpt}` : null,
  ].filter(Boolean).join(' | ');
};

const buildSearchQueries = (
  query: string,
  mode: ProjectResearchMode,
): Partial<Record<'web' | 'news' | 'image', string>> => {
  const base = normalizeQuery(query);
  switch (mode) {
    case 'creative_development':
      return {
        web: `${base} film references visual style cinematography production design`,
        news: `${base} film adaptation trend cultural conversation`,
        image: `${base} cinematic moodboard references`,
      };
    case 'script_theme':
      return {
        web: `${base} theme analysis symbolism film references`,
        news: `${base} cultural trend audience discussion`,
        image: `${base} visual motifs storyboard moodboard`,
      };
    case 'brand_history':
      return {
        web: `${base} company history brand evolution campaign archive`,
        news: `${base} latest brand news launches innovations`,
        image: `${base} brand campaign visuals product design`,
      };
    case 'market_intelligence':
      return {
        web: `${base} competitor analysis audience trend advertising campaign`,
        news: `${base} ad campaign market news trend`,
        image: `${base} advertising visual references campaign moodboard`,
      };
    case 'technology_scan':
      return {
        web: `${base} technology innovation product features industrial design`,
        news: `${base} latest invention product launch research`,
        image: `${base} future tech concept design references`,
      };
    default:
      return { web: base, news: base, image: base };
  }
};

const summarizeHit = (hit: ResearchHit) => {
  const source = hit.source ? ` (${hit.source})` : '';
  if (hit.snippet) return `${hit.title}${source}: ${truncate(hit.snippet, 160)}`;
  return `${hit.title}${source}`;
};

const buildOverview = (
  query: string,
  mode: ProjectResearchMode,
  contextSummary: string,
  hits: ResearchHit[],
  newsHits: ResearchHit[],
) => {
  const topSourceLabels = unique(
    [...newsHits, ...hits]
      .slice(0, 4)
      .map((hit) => hit.source || hit.title),
  );
  return unique([
    `${getProjectResearchModeLabel(mode)} run for "${query}".`,
    contextSummary ? `Project context: ${contextSummary}.` : '',
    hits[0] ? `Primary signal: ${summarizeHit(hits[0])}.` : '',
    newsHits[0] ? `Latest signal: ${summarizeHit(newsHits[0])}.` : '',
    topSourceLabels.length > 0 ? `Most useful source cluster: ${topSourceLabels.join(', ')}.` : '',
  ]).slice(0, 4);
};

const buildKeyFindings = (hits: ResearchHit[]) =>
  unique(hits.slice(0, 6).map((hit) => summarizeHit(hit))).slice(0, 6);

const buildOpportunities = (
  query: string,
  mode: ProjectResearchMode,
  hits: ResearchHit[],
  imageHits: ResearchHit[],
) => {
  const imageAngle = imageHits[0]?.title
    ? `Push the visual language toward "${truncate(imageHits[0].title, 80)}".`
    : 'Pull a tighter image board around lighting, composition, and texture.';

  const topHit = hits[0]?.title ? `Anchor the narrative around the strongest signal: "${truncate(hits[0].title, 90)}".` : '';

  const modeSpecific: Record<ProjectResearchMode, string[]> = {
    creative_development: [
      topHit,
      'Translate the strongest references into camera grammar, wardrobe, and production design notes.',
      imageAngle,
      'Turn the research into a director treatment and a tighter concept prompt pack.',
    ],
    script_theme: [
      topHit,
      'Use the research to sharpen subtext, symbolism, and character motivation.',
      imageAngle,
      'Promote recurring motifs into storyboard beats and marketing hooks.',
    ],
    brand_history: [
      topHit,
      'Use the archive/history layer to define what must feel authentic in the campaign.',
      imageAngle,
      'Separate heritage cues from future-facing cues before generating ads or decks.',
    ],
    market_intelligence: [
      topHit,
      'Turn the strongest campaign patterns into a competitor matrix and audience promise.',
      imageAngle,
      'Use the findings to shape claim language, CTA structure, and launch timing.',
    ],
    technology_scan: [
      topHit,
      'Promote the newest invention/features into hero proof points for the story or ad.',
      imageAngle,
      'Separate shipping reality from speculative future concepts before decking or rendering.',
    ],
  };

  return unique(modeSpecific[mode]).slice(0, 4);
};

const buildMoodboardQueries = (
  query: string,
  mode: ProjectResearchMode,
) => {
  const base = normalizeQuery(query);
  const defaults: Record<ProjectResearchMode, string[]> = {
    creative_development: [
      `${base} cinematic lighting references`,
      `${base} production design moodboard`,
      `${base} wardrobe styling references`,
      `${base} film still color palette`,
      `${base} location and environment references`,
      `${base} camera composition storyboard`,
    ],
    script_theme: [
      `${base} symbolic imagery references`,
      `${base} emotional color palette`,
      `${base} atmosphere and world building`,
      `${base} character blocking references`,
      `${base} visual motif close ups`,
      `${base} tone and texture film stills`,
    ],
    brand_history: [
      `${base} vintage brand campaigns`,
      `${base} archive product photography`,
      `${base} flagship retail experience`,
      `${base} brand identity details`,
      `${base} founder era references`,
      `${base} future-facing brand visuals`,
    ],
    market_intelligence: [
      `${base} ad campaign references`,
      `${base} premium product hero shots`,
      `${base} audience lifestyle imagery`,
      `${base} competitor launch visuals`,
      `${base} social ad composition references`,
      `${base} brand world moodboard`,
    ],
    technology_scan: [
      `${base} industrial design references`,
      `${base} future tech concept visuals`,
      `${base} material and surface references`,
      `${base} innovation keynote stage visuals`,
      `${base} lab and prototyping imagery`,
      `${base} next generation product hero shots`,
    ],
  };

  return unique(defaults[mode]).slice(0, 6);
};

const buildPitchDeckSlides = (
  query: string,
  mode: ProjectResearchMode,
  report: {
    contextSummary: string;
    keyFindings: string[];
    opportunities: string[];
    moodboardQueries: string[];
    webHits: ResearchHit[];
    newsHits: ResearchHit[];
  },
): ProjectPitchDeckSlide[] => {
  const topSources = unique(
    [...report.webHits, ...report.newsHits]
      .slice(0, 5)
      .map((hit) => hit.source || hit.title),
  );

  const slides: Array<Omit<ProjectPitchDeckSlide, 'id'>> = [
    {
      title: 'Why This Project Now',
      objective: 'Frame the opportunity or creative reason for the project.',
      bullets: unique([
        `${getProjectResearchModeLabel(mode)} research built around "${query}".`,
        report.contextSummary || `Use the strongest current signals to justify the direction.`,
        report.keyFindings[0] || 'Lead with the clearest source-backed signal.',
      ]).slice(0, 3),
      sources: topSources.slice(0, 3),
    },
    {
      title: 'Audience and Cultural Signal',
      objective: 'Show what people, the market, or culture are responding to.',
      bullets: report.keyFindings.slice(0, 3),
      sources: unique(report.newsHits.slice(0, 3).map((hit) => hit.source || hit.title)),
    },
    {
      title: 'Visual Territory',
      objective: 'Define how the project should look and feel.',
      bullets: [
        report.moodboardQueries[0] || `${query} moodboard references`,
        report.moodboardQueries[1] || `${query} lighting references`,
        report.moodboardQueries[2] || `${query} composition references`,
      ],
      sources: unique(report.webHits.slice(0, 3).map((hit) => hit.source || hit.title)),
    },
    {
      title: 'Strategic Opportunities',
      objective: 'Turn the research into concrete production or campaign moves.',
      bullets: report.opportunities.slice(0, 4),
      sources: topSources.slice(0, 3),
    },
    {
      title: 'Production Next Steps',
      objective: 'Translate research into immediate project actions.',
      bullets: unique([
        'Convert the top references into moodboard imports and prompt packs.',
        'Move the strongest insights into script, director treatment, and storyboard.',
        'Use the saved source list as backup material for a full pitch deck or treatment.',
      ]),
      sources: topSources.slice(0, 3),
    },
  ];

  return slides.map((slide, index) => ({
    id: `pitch-slide-${index + 1}`,
    ...slide,
  }));
};

export const getProjectResearchModeLabel = (mode: ProjectResearchMode) =>
  MODE_LABELS[mode] || mode;

export const buildSuggestedResearchQuery = (
  storyBible: Pick<StoryBible, 'title' | 'logline' | 'script'>,
  mode: ProjectResearchMode,
) => {
  const title = (storyBible.title || '').trim();
  const logline = (storyBible.logline || '').trim();
  const script = (storyBible.script || '').trim();

  const base =
    title
    || logline
    || (script ? truncate(script, 120) : '');

  if (!base) return '';

  if (mode === 'brand_history') return `${base} brand history and campaign references`;
  if (mode === 'market_intelligence') return `${base} audience trend and competitor campaigns`;
  if (mode === 'technology_scan') return `${base} latest inventions and technology trends`;
  if (mode === 'script_theme') return `${base} theme symbolism and visual motifs`;
  return `${base} cinematic references and visual development`;
};

export const runProjectResearch = async ({
  query,
  mode,
  storyBible,
  kinds,
  count = 8,
}: RunProjectResearchOptions): Promise<ProjectResearchResult> => {
  const trimmedQuery = normalizeQuery(query);
  if (!trimmedQuery) {
    return { ok: false, error: 'A research query is required.' };
  }

  const searchQueries = buildSearchQueries(trimmedQuery, mode);
  const enabledKinds: Required<ResearchKinds> = {
    web: kinds?.web !== false,
    news: kinds?.news !== false,
    image: kinds?.image !== false,
  };

  const [webResult, newsResult, imageResult] = await Promise.all([
    enabledKinds.web && searchQueries.web
      ? searchBrave(searchQueries.web, 'web', { count: Math.min(Math.max(count, 4), 10) })
      : Promise.resolve(createEmptySearchResult(trimmedQuery, 'web')),
    enabledKinds.news && searchQueries.news
      ? searchBrave(searchQueries.news, 'news', { count: Math.min(Math.max(count, 4), 10) })
      : Promise.resolve(createEmptySearchResult(trimmedQuery, 'news')),
    enabledKinds.image && searchQueries.image
      ? searchBrave(searchQueries.image, 'image', { count: Math.min(Math.max(count, 6), 12), safesearch: 'moderate' })
      : Promise.resolve(createEmptySearchResult(trimmedQuery, 'image')),
  ]);

  const firstError = [webResult, newsResult, imageResult].find((result) => !result.ok)?.error;
  if (firstError) {
    return { ok: false, error: firstError };
  }

  const contextSummary = buildStoryContext(storyBible);
  const allTextHits = [...newsResult.hits, ...webResult.hits];
  const overview = buildOverview(trimmedQuery, mode, contextSummary, webResult.hits, newsResult.hits);
  const keyFindings = buildKeyFindings(allTextHits);
  const opportunities = buildOpportunities(trimmedQuery, mode, allTextHits, imageResult.hits);
  const moodboardQueries = buildMoodboardQueries(trimmedQuery, mode);

  const report: ProjectResearchReport = {
    id: buildId('research-report'),
    query: trimmedQuery,
    mode,
    createdAt: new Date().toISOString(),
    contextSummary,
    overview,
    keyFindings,
    opportunities,
    moodboardQueries,
    searchQueries,
    webHits: webResult.hits,
    newsHits: newsResult.hits,
    imageHits: imageResult.hits,
    pitchDeckSlides: buildPitchDeckSlides(trimmedQuery, mode, {
      contextSummary,
      keyFindings,
      opportunities,
      moodboardQueries,
      webHits: webResult.hits,
      newsHits: newsResult.hits,
    }),
  };

  return { ok: true, report };
};

export const buildProjectResearchBriefMarkdown = (
  report: ProjectResearchReport,
) => {
  const lines = [
    `# ${report.query}`,
    '',
    `Mode: ${getProjectResearchModeLabel(report.mode)}`,
    `Created: ${report.createdAt}`,
    report.contextSummary ? `Context: ${report.contextSummary}` : '',
    '',
    '## Overview',
    ...report.overview.map((item) => `- ${item}`),
    '',
    '## Key Findings',
    ...report.keyFindings.map((item) => `- ${item}`),
    '',
    '## Opportunities',
    ...report.opportunities.map((item) => `- ${item}`),
    '',
    '## Moodboard Queries',
    ...report.moodboardQueries.map((item) => `- ${item}`),
    '',
    '## Sources',
    ...[...report.newsHits, ...report.webHits]
      .slice(0, 10)
      .map((hit) => `- ${hit.title} | ${hit.url}`),
  ].filter(Boolean);
  return lines.join('\n');
};

export const buildProjectResearchPitchDeckMarkdown = (
  report: ProjectResearchReport,
) => {
  const lines = [
    `# Pitch Deck Outline: ${report.query}`,
    '',
    ...report.pitchDeckSlides.flatMap((slide, index) => [
      `## ${index + 1}. ${slide.title}`,
      `${slide.objective}`,
      ...slide.bullets.map((bullet) => `- ${bullet}`),
      ...(slide.sources && slide.sources.length > 0
        ? [`Sources: ${slide.sources.join(' | ')}`]
        : []),
      '',
    ]),
  ].filter(Boolean);
  return lines.join('\n');
};
