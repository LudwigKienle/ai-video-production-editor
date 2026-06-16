export type SupportVideo = {
  id: string;
  title: string;
  url: string;
  thumbnailUrl: string;
  durationLabel: string;
  focus: string;
  supportUse: string;
};

export type SupportChannel = {
  label: string;
  href: string;
  description: string;
};

export const YOUTUBE_CHANNEL_URL = 'https://www.youtube.com/@AIVideoProductionEditor';

export const SUPPORT_VIDEO_LIBRARY: SupportVideo[] = [
  {
    id: 'cxKKoNJgkgA',
    title: "I Tested the New AI Editor v2.5 (And It's Mind-Blowing) Pro-Tip for YouTube",
    url: 'https://www.youtube.com/watch?v=cxKKoNJgkgA',
    thumbnailUrl: 'https://i.ytimg.com/vi/cxKKoNJgkgA/hqdefault.jpg',
    durationLabel: '2:39',
    focus: 'Version 2.5 release, Scene Wall, workflow scale, and YouTube-oriented production tips.',
    supportUse: 'Use this first when users ask what changed recently or whether the editor is still actively maintained.',
  },
  {
    id: '9ELjrnzvpd4',
    title: 'AI Video Production v1.5 Launch',
    url: 'https://www.youtube.com/watch?v=9ELjrnzvpd4',
    thumbnailUrl: 'https://i.ytimg.com/vi/9ELjrnzvpd4/hqdefault.jpg',
    durationLabel: '14:32',
    focus: 'AI Director, Node Graph Workspace, Sound tab, and 3D set design improvements.',
    supportUse: 'Use this for users asking about advanced workspaces, node pipelines, sound, or set design.',
  },
  {
    id: 'JrgvWCB-EAE',
    title: 'AI Video Production Editor: The Future of Filmmaking on Mac',
    url: 'https://www.youtube.com/watch?v=JrgvWCB-EAE',
    thumbnailUrl: 'https://i.ytimg.com/vi/JrgvWCB-EAE/hqdefault.jpg',
    durationLabel: '17:46',
    focus: 'Full walkthrough: API keys, AI script writing, storyboards, video generation, editing, grading, and export.',
    supportUse: 'Use this as the primary onboarding video for first-time users who want the whole workflow.',
  },
  {
    id: '-6jo636vRSw',
    title: 'The Ai Video Production Editor',
    url: 'https://www.youtube.com/watch?v=-6jo636vRSw',
    thumbnailUrl: 'https://i.ytimg.com/vi/-6jo636vRSw/hqdefault.jpg',
    durationLabel: '0:32',
    focus: 'Short overview of the app value proposition and script-to-movie workflow.',
    supportUse: 'Use this as the fastest product preview before sending a longer tutorial.',
  },
];

export const SUPPORT_CHANNELS: SupportChannel[] = [
  {
    label: 'Video tutorials',
    href: YOUTUBE_CHANNEL_URL,
    description: 'Watch release tours, workflow walkthroughs, and short product demos.',
  },
  {
    label: 'GitHub issues',
    href: 'https://github.com/LudwigKienle/ai-video-production-editor/issues',
    description: 'Report bugs, missing provider behavior, broken setup steps, and documentation gaps.',
  },
  {
    label: 'Security reports',
    href: 'https://github.com/LudwigKienle/ai-video-production-editor/security/advisories/new',
    description: 'Report credential, local file, billing, or hosted API vulnerabilities privately.',
  },
];
