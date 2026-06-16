
export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const parts = reader.result.split(',');
        if (parts.length === 2) {
          resolve(parts[1]);
        } else {
          resolve(""); // Resolve empty if no comma found, let caller handle
        }
      } else {
        reject(new Error('Failed to read file as Base64 string.Result was not a string.'));
      }
    };
    reader.onerror = (error) => reject(error);
  });
};

export const getVideoDuration = (fileOrUrl: File | string): Promise<number> => {
  return new Promise((resolve, reject) => {
    const isFile = fileOrUrl instanceof File;
    const url = isFile ? URL.createObjectURL(fileOrUrl) : (fileOrUrl as string);

    const video = document.createElement('video');
    video.preload = 'metadata';

    video.onloadedmetadata = () => {
      if (isFile) {
        window.URL.revokeObjectURL(url);
      }
      resolve(video.duration);
    };

    video.onerror = () => {
      if (isFile) {
        window.URL.revokeObjectURL(url);
      }
      reject(new Error("Failed to load video metadata. The file may be invalid or unsupported."));
    };

    video.src = url;
  });
};

// Audio helpers for Live API
export const decode = (base64: string): Uint8Array => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export const encode = (bytes: Uint8Array): string => {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export const getBase64FromUrl = async (url: string): Promise<{ base64: string; mimeType: string; }> => {
  const response = await fetch(url);
  const blob = await response.blob();
  // Use the existing fileToBase64 helper
  const base64 = await fileToBase64(new File([blob], "reference", { type: blob.type }));
  return { base64, mimeType: blob.type };
};

export const generateWaveformData = async (audioUrl: string): Promise<number[]> => {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const response = await fetch(audioUrl);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const rawData = audioBuffer.getChannelData(0); // Get data from the first channel
    const samples = 200; // Number of data points for the waveform
    const blockSize = Math.floor(rawData.length / samples);
    const filteredData = [];
    for (let i = 0; i < samples; i++) {
      const blockStart = blockSize * i;
      let sum = 0;
      for (let j = 0; j < blockSize; j++) {
        sum += Math.abs(rawData[blockStart + j]);
      }
      filteredData.push(sum / blockSize);
    }

    // Normalize the data
    const multiplier = Math.pow(Math.max(...filteredData), -1);
    return filteredData.map(n => n * multiplier);
  } catch (e) {
    console.error("Error generating waveform data:", e);
    return []; // Return empty array on error
  }
};

export const extractFrameFromVideo = (
  videoUrl: string,
  time: number,
  options?: { maxWidth?: number; quality?: number }
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return reject(new Error('Canvas 2D context is not available.'));
    }

    // Configure video element for frame extraction
    video.crossOrigin = 'anonymous';
    video.muted = true;

    // Timeout to prevent hanging indefinetely
    const timeoutId = setTimeout(() => {
      reject(new Error('Frame extraction timed out'));
    }, 10000);

    const cleanup = () => {
      clearTimeout(timeoutId);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('error', onError);
      if (video.src.startsWith('blob:') && video.src !== videoUrl) {
        URL.revokeObjectURL(video.src);
      }
      video.removeAttribute('src'); // Stop loading
      video.load();
    };

    const onSeeked = () => {
      try {
        const rawWidth = video.videoWidth;
        const rawHeight = video.videoHeight;
        let targetWidth = rawWidth;
        let targetHeight = rawHeight;
        if (options?.maxWidth && rawWidth > options.maxWidth) {
          const ratio = options.maxWidth / rawWidth;
          targetWidth = options.maxWidth;
          targetHeight = Math.max(1, Math.round(rawHeight * ratio));
        }
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
        const quality = options?.quality ?? 0.85;
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        cleanup();
        resolve(dataUrl);
      } catch (e) {
        cleanup();
        reject(e);
      }
    };

    const onLoadedMetadata = () => {
      // Ensure seek time is within video duration
      let seekTime = time;
      if (Number.isFinite(video.duration)) {
        seekTime = Math.min(time, video.duration);
      }
      video.currentTime = seekTime;
    };

    const onError = (e: Event) => {
      cleanup();
      const err = (e.target as HTMLVideoElement).error;
      reject(new Error(`Failed to load video for frame extraction: ${err?.message || 'Unknown error'} (Code: ${err?.code})`));
    };

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('error', onError);

    // Directly set src.
    // Previous version used fetch() which causes issues with blob URLs and unnecessary network requests.
    video.src = videoUrl;
  });
};
