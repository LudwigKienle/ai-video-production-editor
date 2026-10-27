/** Image or video from a URL / data URL / MIME type (Upscale inputs added by URL or path). */
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi)(\?|#|$)/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|tiff?|bmp|exr)(\?|#|$)/i;

export function kindFromUrl(url: string, mime?: string): 'image' | 'video' | null {
  if (mime?.startsWith('video/') || /^data:video\//.test(url) || VIDEO_EXT.test(url)) return 'video';
  if (mime?.startsWith('image/') || /^data:image\//.test(url) || IMAGE_EXT.test(url)) return 'image';
  return null;
}
