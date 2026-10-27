/**
 * Builds the text of one interchange file (FCPXML, OTIO, Nuke, Natron, VFX
 * handoff manifest, OCIO manifest) from delivery settings and the timeline,
 * the same way the Export page's interchange job does, but returns the text
 * instead of downloading it (MCP: export_ai_interchange).
 */
import type { MediaItem, TimelineClip, TimelineTrack } from '../../types';
import type { ExportColorProfile, ExportContainer, ExportVideoCodec } from '../../utils/exportSettings';
import { buildFcpxmlFromTimeline } from '../../utils/fcpxmlExport';
import { buildOpenTimelineIOFromTimeline } from '../../utils/openTimelineIOExport';
import { buildOpenColorIOManifest, type OpenColorIOConfigId } from '../../utils/openColorIO';
import { buildVfxHandoffManifest } from '../../utils/vfxHandoffManifest';
import { buildNatronPythonScriptFromVfxHandoffManifest, buildNukeScriptFromVfxHandoffManifest } from '../../utils/vfxScriptExport';
import { constrainVideo, sanitizeStem, INTERCHANGE_FORMATS, type DeliverySettings, type InterchangeFormat } from './deliveryModel';

export type InterchangeFile = { format: InterchangeFormat; fileName: string; mimeType: string; text: string; note: string };

export function buildInterchangeFile(
  format: InterchangeFormat,
  settings: DeliverySettings,
  project: { mediaItems: MediaItem[]; timelineClips: TimelineClip[]; timelineTracks: TimelineTrack[] },
): InterchangeFile {
  const meta = INTERCHANGE_FORMATS.find((entry) => entry.id === format);
  if (!meta) throw new Error(`Unknown interchange format ${format}.`);
  const { mediaItems: media, timelineClips: clips, timelineTracks: tracks } = project;
  const video = constrainVideo(settings.video);
  const projectName = sanitizeStem(settings.filename);
  const fileName = `${projectName}.${meta.ext}`;
  const base = {
    projectName,
    filename: `${projectName}.${video.codec === 'prores' ? 'mov' : video.container}`,
    fps: video.fps,
    width: video.width,
    height: video.height,
    colorProfile: video.colorProfile as ExportColorProfile,
    bitDepth: video.bitDepth,
    videoCodec: video.codec as ExportVideoCodec,
    container: (video.codec === 'prores' ? 'mov' : video.container) as ExportContainer,
    ocioConfigId: settings.interchange.ocioConfigId as OpenColorIOConfigId,
    ocioConfigPath: settings.interchange.ocioConfigPath,
  };
  if (format !== 'ocio-manifest' && clips.length === 0) throw new Error('The timeline is empty.');
  const timeline = { projectName, fps: video.fps, width: video.width, height: video.height, mediaItems: media, timelineClips: clips, timelineTracks: tracks };
  const vfx = () => buildVfxHandoffManifest({ ...base, handleFrames: settings.interchange.vfxHandleFrames, mediaItems: media, timelineClips: clips, timelineTracks: tracks });
  switch (format) {
    case 'otio':
      return { format, fileName, mimeType: 'application/vnd.opentimelineio+json', text: buildOpenTimelineIOFromTimeline(timeline), note: 'OpenTimelineIO for editorial and VFX handoff.' };
    case 'nuke':
      return { format, fileName, mimeType: 'text/plain', text: buildNukeScriptFromVfxHandoffManifest(vfx()), note: 'Nuke script with Read nodes, handles and OCIO notes.' };
    case 'natron':
      return { format, fileName, mimeType: 'text/x-python', text: buildNatronPythonScriptFromVfxHandoffManifest(vfx()), note: 'Natron Python script with project settings and Read nodes.' };
    case 'vfx-manifest':
      return { format, fileName, mimeType: 'application/json', text: vfx(), note: 'VFX handoff manifest (Resolve, Nuke, Natron, OpenRV, Blender).' };
    case 'ocio-manifest':
      return { format, fileName, mimeType: 'application/json', text: buildOpenColorIOManifest(base), note: 'OCIO / ACES colour manifest.' };
    case 'fcpxml':
    default:
      return { format, fileName, mimeType: 'application/xml', text: buildFcpxmlFromTimeline(timeline), note: 'FCPXML for Premiere and Resolve.' };
  }
}
