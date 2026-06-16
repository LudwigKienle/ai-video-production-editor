export type MoodboardResearchImage = {
  url: string;
  title?: string;
  sourcePageUrl?: string;
  sourceLabel?: string;
  query?: string;
  extractedFromVideo?: boolean;
};

const COMMONS_API_URL = 'https://commons.wikimedia.org/w/api.php';

const isElectronRuntime = () =>
  typeof navigator !== 'undefined' &&
  navigator.userAgent.toLowerCase().includes(' electron/');

const proxyUrl = (url: string) => {
  if (isElectronRuntime()) return url;
  return `https://corsproxy.io/?${encodeURIComponent(url)}`;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const isLikelyImageUrl = (url: string) =>
  /\.(png|jpe?g|webp|gif|bmp|avif|svg)(\?|#|$)/i.test(url);

export const isLikelyVideoUrl = (url: string) =>
  /\.(mp4|mov|m4v|webm|ogg|ogv)(\?|#|$)/i.test(url);

const toAbsoluteUrl = (value: string | null | undefined, baseUrl: string): string | null => {
  if (!value) return null;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
};

export const searchWikimediaCommonsImages = async (
  query: string,
  maxResults = 8
): Promise<MoodboardResearchImage[]> => {
  const trimmedQuery = (query || '').trim();
  if (!trimmedQuery) return [];

  const limit = clamp(Math.floor(maxResults || 8), 1, 20);
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrnamespace: '6',
    gsrlimit: String(limit),
    gsrsearch: `${trimmedQuery} filetype:bitmap`,
    prop: 'imageinfo|info',
    iiprop: 'url',
    iiurlwidth: '1536',
    inprop: 'url',
  });

  const response = await fetch(`${COMMONS_API_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Wikimedia search failed (${response.status}).`);
  }
  const payload = await response.json();
  const pages = payload?.query?.pages ? Object.values(payload.query.pages) : [];
  if (!Array.isArray(pages) || pages.length === 0) return [];

  return (pages as any[])
    .sort((a, b) => Number(a.index || 0) - Number(b.index || 0))
    .map((page) => {
      const imageInfo = Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
      const imageUrl = imageInfo?.thumburl || imageInfo?.url || null;
      if (!imageUrl) return null;
      const title = String(page.title || '').replace(/^File:/i, '').replace(/_/g, ' ').trim();
      const sourcePageUrl = page.canonicalurl || page.fullurl || undefined;
      return {
        url: imageUrl,
        title: title || 'Wikimedia image',
        sourcePageUrl,
        sourceLabel: 'Wikimedia Commons',
        query: trimmedQuery,
      } as MoodboardResearchImage;
    })
    .filter((item) => Boolean(item)) as MoodboardResearchImage[];
};

export const resolveImageFromWebUrl = async (inputUrl: string): Promise<MoodboardResearchImage | null> => {
  const raw = (inputUrl || '').trim();
  if (!raw) return null;
  let url: string;
  try {
    url = new URL(raw).toString();
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }

  if (isLikelyImageUrl(url)) {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return {
      url,
      title: host,
      sourcePageUrl: url,
      sourceLabel: host,
    };
  }

  const response = await fetch(proxyUrl(url), {
    headers: { Accept: 'text/html,application/xhtml+xml' },
  });
  if (!response.ok) {
    throw new Error(`Could not load page (${response.status}): ${url}`);
  }
  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const candidates: Array<string | null> = [
    doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || null,
    doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content') || null,
    doc.querySelector('link[rel="image_src"]')?.getAttribute('href') || null,
    doc.querySelector('img')?.getAttribute('src') || null,
  ];

  const imageUrl = candidates
    .map((candidate) => toAbsoluteUrl(candidate, url))
    .find((candidate) => Boolean(candidate));

  if (!imageUrl) return null;

  const title =
    doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
    doc.title ||
    new URL(url).hostname;

  const host = new URL(url).hostname.replace(/^www\./, '');
  return {
    url: imageUrl,
    title: title.trim(),
    sourcePageUrl: url,
    sourceLabel: host,
  };
};

const waitForEvent = <T extends Event>(target: EventTarget, eventName: string) =>
  new Promise<T>((resolve, reject) => {
    const onError = () => {
      target.removeEventListener(eventName, onLoad as EventListener);
      reject(new Error('Media loading failed.'));
    };
    const onLoad = (event: Event) => {
      target.removeEventListener('error', onError as EventListener);
      resolve(event as T);
    };
    target.addEventListener(eventName, onLoad as EventListener, { once: true });
    target.addEventListener('error', onError as EventListener, { once: true });
  });

const seekVideo = (video: HTMLVideoElement, timeInSeconds: number) =>
  new Promise<void>((resolve, reject) => {
    const onSeeked = () => resolve();
    const onError = () => reject(new Error('Video seek failed.'));
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = timeInSeconds;
  });

export const extractFramesFromVideoUrl = async (
  inputUrl: string,
  frameCount = 3
): Promise<MoodboardResearchImage[]> => {
  const raw = (inputUrl || '').trim();
  if (!raw) return [];
  let url: string;
  try {
    url = new URL(raw).toString();
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }

  const count = clamp(Math.floor(frameCount || 3), 1, 6);
  const response = await fetch(proxyUrl(url));
  if (!response.ok) {
    throw new Error(`Could not fetch video (${response.status}): ${url}`);
  }
  const blob = await response.blob();
  if (!blob.type.startsWith('video/')) {
    throw new Error('Provided URL is not a supported video resource.');
  }

  const objectUrl = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.src = objectUrl;
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';

  try {
    await waitForEvent(video, 'loadedmetadata');
    const duration = Number(video.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('Video duration could not be determined.');
    }

    const width = Math.max(1, video.videoWidth || 1280);
    const height = Math.max(1, video.videoHeight || 720);
    const maxWidth = 1280;
    const scale = width > maxWidth ? maxWidth / width : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable.');

    const frames: MoodboardResearchImage[] = [];
    const host = new URL(url).hostname.replace(/^www\./, '');
    for (let i = 0; i < count; i++) {
      const t = duration * ((i + 1) / (count + 1));
      await seekVideo(video, t);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      frames.push({
        url: dataUrl,
        title: `${host} frame ${i + 1}`,
        sourcePageUrl: url,
        sourceLabel: host,
        extractedFromVideo: true,
      });
    }
    return frames;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};
