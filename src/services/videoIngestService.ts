import { MediaItem } from '../types';

const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', 'mxf', 'mts', 'm2ts']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'tif', 'tiff']);
const PROXY_PREFERRED_VIDEO_EXTENSIONS = new Set(['mov', 'mxf', 'mkv', 'avi', 'mts', 'm2ts']);
const LARGE_VIDEO_PROXY_THRESHOLD_BYTES = 1024 * 1024 * 1024;

const getFileExtension = (name: string) => {
    const idx = name.lastIndexOf('.');
    return idx >= 0 ? name.slice(idx + 1).toLowerCase() : '';
};

export const inferImportedMediaType = (file: File): MediaItem['type'] => {
    const ext = getFileExtension(file.name);

    if (file.type.startsWith('video/') || VIDEO_EXTENSIONS.has(ext)) {
        return 'video';
    }
    if (file.type.startsWith('audio/') || AUDIO_EXTENSIONS.has(ext)) {
        return 'audio';
    }
    if (file.type.startsWith('image/') || IMAGE_EXTENSIONS.has(ext)) {
        return 'image';
    }

    return 'image';
};

export const shouldCreateDesktopVideoProxy = (file: File) => {
    const desktopPath = (file as File & { path?: string }).path;
    if (!desktopPath || !window.electron?.project?.prepareVideoForEditing) {
        return false;
    }

    const ext = getFileExtension(file.name);
    return (
        file.type === 'video/quicktime'
        || PROXY_PREFERRED_VIDEO_EXTENSIONS.has(ext)
        || (!file.type && VIDEO_EXTENSIONS.has(ext))
        || file.size >= LARGE_VIDEO_PROXY_THRESHOLD_BYTES
    );
};

export const prepareDesktopVideoForEditing = async (file: File) => {
    const filePath = (file as File & { path?: string }).path;
    if (!filePath || !window.electron?.project?.prepareVideoForEditing) {
        return null;
    }

    const result = await window.electron.project.prepareVideoForEditing({
        filePath,
        fileName: file.name,
    });

    return {
        previewUrl: result.proxyUrl || result.sourceUrl,
        sourceUrl: result.sourceUrl,
        durationSeconds: typeof result.durationSeconds === 'number' ? result.durationSeconds : null,
    };
};
