
export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        // result is "data:mime/type;base64,..." - we only want the base64 part
        resolve(reader.result.split(',')[1]);
      } else {
        reject(new Error('Failed to read file as Base64 string.'));
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

export const extractFrameFromVideo = (videoUrl: string, time: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return reject(new Error('Canvas 2D context is not available.'));
    }

    video.src = videoUrl;
    video.crossOrigin = 'anonymous';
    video.muted = true;

    // Create a new source URL for each video to avoid caching issues
    fetch(videoUrl)
      .then(res => res.blob())
      .then(blob => {
        video.src = URL.createObjectURL(blob);
      });

    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg');
      resolve(dataUrl); // Return the full data URL
      URL.revokeObjectURL(video.src); // Clean up
    };

    const onLoadedMetadata = () => {
        video.removeEventListener('loadedmetadata', onLoadedMetadata);
        // Ensure seek time is within video duration
        video.currentTime = Math.min(time, video.duration);
    };

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('loadedmetadata', onLoadedMetadata);

    video.onerror = (e) => {
        reject(new Error('Failed to load video for frame extraction.'));
        if (video.src.startsWith('blob:')) {
            URL.revokeObjectURL(video.src);
        }
    };
  });
};
