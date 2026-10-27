/**
 * UI side of the command system: runs a sound command against the current
 * props and applies the patch through the shared editor callbacks — the same
 * code path the MCP tools use (src/mcp/modules/soundTools.ts).
 */
import { useCallback, useRef, useState } from 'react';
import type { MediaItem, TimelineClip, TimelineTrack } from '../../types';
import { runSoundCommand, type SoundPatch } from './commands.ts';
import type { SoundMix } from './model.ts';

export type SoundCommandHost = {
  mix: SoundMix;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  media: MediaItem[];
  playhead: number;
  setMix: (mix: SoundMix) => void;
  setClips: (clips: TimelineClip[]) => void;
  updateTrack: (trackId: string, updates: Partial<Omit<TimelineTrack, 'id' | 'type'>>) => void;
  addTrack: (type: 'audio' | 'video') => void;
  setPlayhead: (time: number) => void;
  togglePlayback: () => void;
  isPlaying: boolean;
};

export function useSoundCommands(host: SoundCommandHost) {
  const hostRef = useRef(host);
  hostRef.current = host;
  const [lastError, setLastError] = useState<string | null>(null);

  const apply = useCallback((patch: SoundPatch) => {
    const h = hostRef.current;
    if (patch.mix) h.setMix(patch.mix);
    if (patch.clips) h.setClips(patch.clips);
    for (const u of patch.trackUpdates ?? []) h.updateTrack(u.trackId, u.updates);
    if (patch.addTrack) h.addTrack(patch.addTrack);
    if (patch.playhead !== undefined) h.setPlayhead(patch.playhead);
    if (patch.transport === 'toggle' || (patch.transport === 'play' && !h.isPlaying) || (patch.transport === 'stop' && h.isPlaying)) h.togglePlayback();
  }, []);

  const run = useCallback((id: string, params: Record<string, unknown> = {}) => {
    const h = hostRef.current;
    const outcome = runSoundCommand({ mix: h.mix, clips: h.clips, tracks: h.tracks, media: h.media, playhead: h.playhead }, id, params);
    if (outcome.ok === false) {
      setLastError('error' in outcome ? outcome.error : 'Befehl fehlgeschlagen.');
      return null;
    }
    if (!('patch' in outcome)) return null;
    setLastError(null);
    // keep the ref current so several commands in one handler chain correctly
    hostRef.current = { ...h, mix: outcome.state.mix, clips: outcome.state.clips, tracks: outcome.state.tracks, playhead: outcome.state.playhead };
    apply(outcome.patch);
    return outcome.patch.result ?? true;
  }, [apply]);

  return { run, lastError, clearError: () => setLastError(null) };
}
