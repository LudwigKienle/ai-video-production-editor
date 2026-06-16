const mediaFileRegistry = new Map<string, File>();

export const registerMediaFile = (mediaId: string, file: File) => {
    mediaFileRegistry.set(mediaId, file);
};

export const getRegisteredMediaFile = (mediaId: string) => {
    return mediaFileRegistry.get(mediaId) || null;
};

export const unregisterMediaFile = (mediaId: string) => {
    mediaFileRegistry.delete(mediaId);
};
