import { MediaItem } from '../types';
import { getVideoDuration } from '../utils/helpers';
import { recordUsage } from '../utils/usageTracker';
import { byokProxyBinaryUrl, byokProxyJson, shouldUseByokProxy } from './byokProxyClient';

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';
const DEFAULT_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';
const DEFAULT_MODEL_ID = 'eleven_multilingual_v2';
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';

const getElevenLabsKeyOptional = () => localStorage.getItem('elevenlabs_api_key');

export type ElevenLabsVoice = {
  voice_id: string;
  name: string;
  category?: string;
  description?: string;
  labels?: Record<string, string>;
  preview_url?: string;
};

export const fetchElevenLabsVoices = async (): Promise<ElevenLabsVoice[]> => {
  const key = getElevenLabsKeyOptional();
  if (!key && shouldUseByokProxy('elevenlabs')) {
    const data = await byokProxyJson<{ voices?: ElevenLabsVoice[] }>({
      provider: 'elevenlabs',
      url: `${ELEVENLABS_API_BASE}/voices`,
      method: 'GET',
      usage: {
        kind: 'other',
        model: 'elevenlabs/voices',
        units: 1,
      },
      meta: {
        billable: false,
        note: 'ElevenLabs voice list',
      },
    });
    return (data?.voices || []) as ElevenLabsVoice[];
  }
  if (!key) {
    throw new Error('ElevenLabs API Key is missing. Please add it in settings.');
  }

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
  const key = getElevenLabsKeyOptional();
  const voiceId = opts?.voiceId || DEFAULT_VOICE_ID;
  const modelId = opts?.modelId || DEFAULT_MODEL_ID;
  const outputFormat = opts?.outputFormat || DEFAULT_OUTPUT_FORMAT;
  const requestBody = {
    text,
    model_id: modelId,
    output_format: outputFormat,
  };

  if (!key && shouldUseByokProxy('elevenlabs')) {
    const audioUrl = await byokProxyBinaryUrl({
      provider: 'elevenlabs',
      url: `${ELEVENLABS_API_BASE}/text-to-speech/${voiceId}`,
      method: 'POST',
      headers: {
        Accept: 'audio/mpeg',
      },
      body: requestBody,
      usage: {
        kind: 'audio',
        model: modelId,
        units: Math.max(1, Math.ceil(text.length / 900)),
      },
      meta: {
        billable: true,
        note: 'ElevenLabs TTS generation',
      },
    });

    let duration: number | undefined;
    try {
      duration = await getVideoDuration(audioUrl);
    } catch (e) {
      duration = 5;
    }

    recordUsage({
      provider: 'elevenlabs',
      model: modelId,
      kind: 'audio',
      units: Math.max(0.01, (duration || 0) / 60),
      unitLabel: 'minute',
      note: 'ElevenLabs TTS',
    });

    return {
      id: `elevenlabs-${Date.now()}`,
      name: `elevenlabs_${text.slice(0, 15)}.mp3`,
      type: 'audio',
      url: audioUrl,
      source: 'generated',
      duration,
    };
  }
  if (!key) {
    throw new Error('ElevenLabs API Key is missing. Please add it in settings.');
  }

  const response = await fetch(`${ELEVENLABS_API_BASE}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': key,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify(requestBody),
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

  recordUsage({
    provider: 'elevenlabs',
    model: modelId,
    kind: 'audio',
    units: Math.max(0.01, (duration || 0) / 60),
    unitLabel: 'minute',
    note: 'ElevenLabs TTS',
  });

  return {
    id: `elevenlabs-${Date.now()}`,
    name: `elevenlabs_${text.slice(0, 15)}.mp3`,
    type: 'audio',
    url: audioUrl,
    source: 'generated',
    duration,
  };
};
