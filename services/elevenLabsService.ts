import { MediaItem } from '../types';
import { getVideoDuration } from '../utils/helpers';

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';
const DEFAULT_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';
const DEFAULT_MODEL_ID = 'eleven_multilingual_v2';
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';

const getElevenLabsKey = () => {
  const key = localStorage.getItem('elevenlabs_api_key');
  if (!key) throw new Error('ElevenLabs API Key is missing. Please add it in settings.');
  return key;
};

export type ElevenLabsVoice = {
  voice_id: string;
  name: string;
  category?: string;
  description?: string;
  labels?: Record<string, string>;
  preview_url?: string;
};

export const fetchElevenLabsVoices = async (): Promise<ElevenLabsVoice[]> => {
  const key = getElevenLabsKey();
  const response = await fetch(`${ELEVENLABS_API_BASE}/voices`, {
    headers: {
      'xi-api-key': key,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`ElevenLabs Voice List Error (${response.status}): ${body || response.statusText}`);
  }

  const data = await response.json();
  return (data?.voices || []) as ElevenLabsVoice[];
};

export const generateSpeechWithElevenLabs = async (
  text: string,
  opts?: { voiceId?: string; modelId?: string; outputFormat?: string },
): Promise<MediaItem> => {
  const key = getElevenLabsKey();
  const voiceId = opts?.voiceId || DEFAULT_VOICE_ID;
  const modelId = opts?.modelId || DEFAULT_MODEL_ID;
  const outputFormat = opts?.outputFormat || DEFAULT_OUTPUT_FORMAT;

  const response = await fetch(`${ELEVENLABS_API_BASE}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': key,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      output_format: outputFormat,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`ElevenLabs API Error (${response.status}): ${body || response.statusText}`);
  }

  const audioBlob = await response.blob();
  const audioUrl = URL.createObjectURL(audioBlob);

  let duration: number | undefined;
  try {
    duration = await getVideoDuration(audioUrl);
  } catch (e) {
    duration = 5;
  }

  return {
    id: `elevenlabs-${Date.now()}`,
    name: `elevenlabs_${text.slice(0, 15)}.mp3`,
    type: 'audio',
    url: audioUrl,
    source: 'generated',
    duration,
  };
};
