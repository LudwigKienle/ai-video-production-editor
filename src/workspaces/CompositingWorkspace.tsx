import React, { useEffect, useMemo, useState } from 'react';
import { MediaItem } from '../types';
import { fileToBase64, getBase64FromUrl } from '../utils/helpers';
import { generateOpenPose, generateVideoWithWanAnimateReplace } from '../services/replicateService';
import {
  generateVideoWithFalKlingO3,
  generateVideoWithFalLumaRay2Reframe,
  type FalLumaRay2ReframeAspectRatio,
} from '../services/falAiService';
import {
  getCorridorKeyStatus,
  runCorridorKey,
  setupCorridorKeyEnvironment,
  type CorridorKeyOptions,
  type CorridorKeyResult,
  type CorridorKeyStatus,
} from '../services/corridorKeyService';
import { LayersIcon, UploadIcon } from '../components/icons';
import NatronCompositorPanel from '../components/NatronCompositorPanel';
import ArtRelightPanel from '../components/ArtRelightPanel';
import CompositingNodeStudioView from '../components/CompositingNodeStudioView';
import { COMPOSITING_WORKSPACE_VIEWS, type CompositingWorkspaceView } from '../utils/compositingNodeStudio';

interface CompositingWorkspaceProps {
  mediaItems: MediaItem[];
  onAddGeneratedMedia: (item: MediaItem) => void;
  apiKeyReady?: boolean;
  seedVideoUrl?: string | null;
  onConsumeSeed?: () => void;
  currentProjectPath?: string | null;
}

type BlendMode = 'source-over' | 'screen' | 'multiply' | 'overlay' | 'soft-light';
type ReframeVideoSource = 'none' | 'file' | 'media' | 'seed';
type ReframeGuideFrame = 'none' | 'background' | 'overlay';
type CorridorKeyVideoSource = 'none' | 'file' | 'media';
type CorridorKeySourceRole = 'source' | 'alpha';

const CORRIDOR_KEY_REPO_STORAGE_KEY = 'ai-video-studio:corridor-key-repo-path';

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = url;
  });

const parseOptionalInteger = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed) : undefined;
};

const CompositingWorkspace: React.FC<CompositingWorkspaceProps> = ({
  mediaItems,
  onAddGeneratedMedia,
  apiKeyReady,
  seedVideoUrl,
  onConsumeSeed,
  currentProjectPath,
}) => {
  const [openPoseFile, setOpenPoseFile] = useState<File | null>(null);
  const [openPoseStatus, setOpenPoseStatus] = useState<string | null>(null);
  const [openPoseResult, setOpenPoseResult] = useState<MediaItem | null>(null);
  const [openPoseOptions, setOpenPoseOptions] = useState({ includeFace: true, includeHands: true, useOpenpose: true });
  const [isOpenPoseRunning, setIsOpenPoseRunning] = useState(false);

  const [motionVideo, setMotionVideo] = useState<File | null>(null);
  const [motionVideoUrl, setMotionVideoUrl] = useState<string | null>(null);
  const [characterImage, setCharacterImage] = useState<File | null>(null);
  const [animateStatus, setAnimateStatus] = useState<string | null>(null);
  const [animateResult, setAnimateResult] = useState<MediaItem | null>(null);
  const [animateSettings, setAnimateSettings] = useState({
    resolution: '720' as '480' | '720',
    fps: 24,
    refertNum: 1 as 1 | 5,
    mergeAudio: true,
    goFast: true,
  });
  const [isAnimateRunning, setIsAnimateRunning] = useState(false);

  const [reframeVideoFile, setReframeVideoFile] = useState<File | null>(null);
  const [reframeVideoUrl, setReframeVideoUrl] = useState<string | null>(null);
  const [reframeVideoMediaId, setReframeVideoMediaId] = useState('');
  const [reframeVideoSource, setReframeVideoSource] = useState<ReframeVideoSource>('none');
  const [reframePrompt, setReframePrompt] = useState('');
  const [reframeAspect, setReframeAspect] = useState<FalLumaRay2ReframeAspectRatio>('9:16');
  const [reframeGuideFrame, setReframeGuideFrame] = useState<ReframeGuideFrame>('none');
  const [reframeUseManualWindow, setReframeUseManualWindow] = useState(false);
  const [reframeWindow, setReframeWindow] = useState({
    gridPositionX: '',
    gridPositionY: '',
    xStart: '',
    xEnd: '',
    yStart: '',
    yEnd: '',
  });
  const [reframeStatus, setReframeStatus] = useState<string | null>(null);
  const [reframeResult, setReframeResult] = useState<MediaItem | null>(null);
  const [isReframing, setIsReframing] = useState(false);

  const [corridorKeyRepoPath, setCorridorKeyRepoPath] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(CORRIDOR_KEY_REPO_STORAGE_KEY) || '';
  });
  const [corridorKeyEnvStatus, setCorridorKeyEnvStatus] = useState<CorridorKeyStatus | null>(null);
  const [corridorKeySourceFile, setCorridorKeySourceFile] = useState<File | null>(null);
  const [corridorKeyAlphaFile, setCorridorKeyAlphaFile] = useState<File | null>(null);
  const [corridorKeySourceMediaId, setCorridorKeySourceMediaId] = useState('');
  const [corridorKeyAlphaMediaId, setCorridorKeyAlphaMediaId] = useState('');
  const [corridorKeySourceKind, setCorridorKeySourceKind] = useState<CorridorKeyVideoSource>('none');
  const [corridorKeyAlphaKind, setCorridorKeyAlphaKind] = useState<CorridorKeyVideoSource>('none');
  const [corridorKeyOptions, setCorridorKeyOptions] = useState<CorridorKeyOptions>({
    device: 'auto',
    backend: 'auto',
    inputColorSpace: 'srgb',
    despill: 5,
    autoDespeckle: true,
    despeckleSize: 400,
    refiner: 1,
    imageSize: 2048,
    generateComp: true,
    gpuPost: false,
    tiledInference: false,
  });
  const [corridorKeyMaxFrames, setCorridorKeyMaxFrames] = useState('');
  const [corridorKeyStatus, setCorridorKeyStatus] = useState<string | null>(null);
  const [corridorKeyResult, setCorridorKeyResult] = useState<CorridorKeyResult | null>(null);
  const [isCorridorKeyPreparing, setIsCorridorKeyPreparing] = useState(false);
  const [isCorridorKeyRunning, setIsCorridorKeyRunning] = useState(false);

  const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
  const [overlayFile, setOverlayFile] = useState<File | null>(null);
  const [backgroundMediaId, setBackgroundMediaId] = useState('');
  const [overlayMediaId, setOverlayMediaId] = useState('');
  const [backgroundSource, setBackgroundSource] = useState<'none' | 'file' | 'media'>('none');
  const [overlaySource, setOverlaySource] = useState<'none' | 'file' | 'media'>('none');
  const [blendMode, setBlendMode] = useState<BlendMode>('source-over');
  const [overlayOpacity, setOverlayOpacity] = useState(80);
  const [compositeStatus, setCompositeStatus] = useState<string | null>(null);
  const [compositeResult, setCompositeResult] = useState<MediaItem | null>(null);
  const [isCompositing, setIsCompositing] = useState(false);
  const [klingBridgePrompt, setKlingBridgePrompt] = useState('');
  const [klingBridgeDuration, setKlingBridgeDuration] = useState(5);
  const [klingBridgeAspect, setKlingBridgeAspect] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [klingBridgeStatus, setKlingBridgeStatus] = useState<string | null>(null);
  const [klingBridgeResult, setKlingBridgeResult] = useState<MediaItem | null>(null);
  const [isKlingBridgeRunning, setIsKlingBridgeRunning] = useState(false);
  const [compositingView, setCompositingView] = useState<CompositingWorkspaceView>('tools');

  const readyForGeneration = apiKeyReady !== false;
  const hasDesktopCorridorKey = typeof window !== 'undefined' && Boolean(window.electron?.corridorKey);

  const imageMediaItems = useMemo(() => mediaItems.filter((item) => item.type === 'image'), [mediaItems]);
  const videoMediaItems = useMemo(() => mediaItems.filter((item) => item.type === 'video'), [mediaItems]);

  useEffect(() => {
    if (!hasDesktopCorridorKey) {
      setCorridorKeyEnvStatus({
        ready: false,
        available: false,
        error: 'CorridorKey is available in the desktop app.',
      });
      return;
    }

    let isActive = true;
    getCorridorKeyStatus(corridorKeyRepoPath || null)
      .then((nextStatus) => {
        if (isActive) {
          setCorridorKeyEnvStatus(nextStatus);
        }
      })
      .catch((error) => {
        if (isActive) {
          setCorridorKeyEnvStatus({
            ready: false,
            available: false,
            error: error instanceof Error ? error.message : 'Failed to inspect CorridorKey.',
          });
        }
      });

    return () => {
      isActive = false;
    };
  }, [corridorKeyRepoPath, hasDesktopCorridorKey]);

  useEffect(() => {
    if (!seedVideoUrl) return;
    setMotionVideoUrl(seedVideoUrl);
    setMotionVideo(null);
    setReframeVideoUrl(seedVideoUrl);
    setReframeVideoFile(null);
    setReframeVideoMediaId('');
    setReframeVideoSource('seed');
    onConsumeSeed?.();
  }, [seedVideoUrl, onConsumeSeed]);

  const motionVideoObjectUrl = useMemo(() => {
    if (motionVideo) {
      return URL.createObjectURL(motionVideo);
    }
    return null;
  }, [motionVideo]);

  useEffect(() => {
    return () => {
      if (motionVideoObjectUrl) {
        URL.revokeObjectURL(motionVideoObjectUrl);
      }
    };
  }, [motionVideoObjectUrl]);

  const motionPreviewUrl = motionVideoObjectUrl || motionVideoUrl;

  const reframeVideoObjectUrl = useMemo(() => {
    if (reframeVideoSource === 'file' && reframeVideoFile) {
      return URL.createObjectURL(reframeVideoFile);
    }
    return null;
  }, [reframeVideoSource, reframeVideoFile]);

  useEffect(() => {
    return () => {
      if (reframeVideoObjectUrl) {
        URL.revokeObjectURL(reframeVideoObjectUrl);
      }
    };
  }, [reframeVideoObjectUrl]);

  const corridorKeySourceObjectUrl = useMemo(() => {
    if (corridorKeySourceKind === 'file' && corridorKeySourceFile) {
      return URL.createObjectURL(corridorKeySourceFile);
    }
    return null;
  }, [corridorKeySourceFile, corridorKeySourceKind]);

  useEffect(() => {
    return () => {
      if (corridorKeySourceObjectUrl) {
        URL.revokeObjectURL(corridorKeySourceObjectUrl);
      }
    };
  }, [corridorKeySourceObjectUrl]);

  const corridorKeyAlphaObjectUrl = useMemo(() => {
    if (corridorKeyAlphaKind === 'file' && corridorKeyAlphaFile) {
      return URL.createObjectURL(corridorKeyAlphaFile);
    }
    return null;
  }, [corridorKeyAlphaFile, corridorKeyAlphaKind]);

  useEffect(() => {
    return () => {
      if (corridorKeyAlphaObjectUrl) {
        URL.revokeObjectURL(corridorKeyAlphaObjectUrl);
      }
    };
  }, [corridorKeyAlphaObjectUrl]);

  const backgroundObjectUrl = useMemo(() => {
    if (backgroundSource === 'file' && backgroundFile) {
      return URL.createObjectURL(backgroundFile);
    }
    return null;
  }, [backgroundSource, backgroundFile]);

  useEffect(() => {
    return () => {
      if (backgroundObjectUrl) {
        URL.revokeObjectURL(backgroundObjectUrl);
      }
    };
  }, [backgroundObjectUrl]);

  const overlayObjectUrl = useMemo(() => {
    if (overlaySource === 'file' && overlayFile) {
      return URL.createObjectURL(overlayFile);
    }
    return null;
  }, [overlaySource, overlayFile]);

  useEffect(() => {
    return () => {
      if (overlayObjectUrl) {
        URL.revokeObjectURL(overlayObjectUrl);
      }
    };
  }, [overlayObjectUrl]);

  const backgroundPreviewUrl =
    backgroundSource === 'media'
      ? imageMediaItems.find((item) => item.id === backgroundMediaId)?.url || null
      : backgroundObjectUrl;

  const overlayPreviewUrl =
    overlaySource === 'media'
      ? imageMediaItems.find((item) => item.id === overlayMediaId)?.url || null
      : overlayObjectUrl;

  const reframePreviewUrl =
    reframeVideoSource === 'media'
      ? videoMediaItems.find((item) => item.id === reframeVideoMediaId)?.url || null
      : reframeVideoSource === 'file'
        ? reframeVideoObjectUrl
        : reframeVideoUrl;

  const corridorKeySelectedSourceMedia = videoMediaItems.find((item) => item.id === corridorKeySourceMediaId) || null;
  const corridorKeySelectedAlphaMedia = videoMediaItems.find((item) => item.id === corridorKeyAlphaMediaId) || null;

  const corridorKeySourcePreviewUrl =
    corridorKeySourceKind === 'media'
      ? corridorKeySelectedSourceMedia?.url || null
      : corridorKeySourceKind === 'file'
        ? corridorKeySourceObjectUrl
        : null;

  const corridorKeyAlphaPreviewUrl =
    corridorKeyAlphaKind === 'media'
      ? corridorKeySelectedAlphaMedia?.url || null
      : corridorKeyAlphaKind === 'file'
        ? corridorKeyAlphaObjectUrl
        : null;

  const selectedReframeGuideUrl =
    reframeGuideFrame === 'background'
      ? backgroundPreviewUrl
      : reframeGuideFrame === 'overlay'
        ? overlayPreviewUrl
        : null;

  const handleSelectCorridorKeyRepo = async () => {
    const folderPath = await window.electron?.project?.selectFolder?.();
    if (!folderPath) return;
    setCorridorKeyRepoPath(folderPath);
    window.localStorage.setItem(CORRIDOR_KEY_REPO_STORAGE_KEY, folderPath);
    setCorridorKeyStatus('CorridorKey checkout selected.');
  };

  const handlePrepareCorridorKey = async () => {
    if (!hasDesktopCorridorKey) {
      setCorridorKeyStatus('CorridorKey is available in the desktop app.');
      return;
    }
    if (!corridorKeyRepoPath.trim()) {
      setCorridorKeyStatus('Select a local CorridorKey checkout first.');
      return;
    }

    setIsCorridorKeyPreparing(true);
    setCorridorKeyStatus('Preparing CorridorKey environment...');
    try {
      const nextStatus = await setupCorridorKeyEnvironment(corridorKeyRepoPath.trim());
      setCorridorKeyEnvStatus(nextStatus);
      setCorridorKeyStatus(nextStatus.ready ? 'CorridorKey environment is ready.' : nextStatus.error || 'CorridorKey setup needs attention.');
    } catch (error) {
      setCorridorKeyStatus(error instanceof Error ? error.message : 'Failed to prepare CorridorKey.');
    } finally {
      setIsCorridorKeyPreparing(false);
    }
  };

  const resolveCorridorKeyPayload = async (role: CorridorKeySourceRole) => {
    const file = role === 'source' ? corridorKeySourceFile : corridorKeyAlphaFile;
    const selectedMedia = role === 'source' ? corridorKeySelectedSourceMedia : corridorKeySelectedAlphaMedia;
    const previewUrl = role === 'source' ? corridorKeySourcePreviewUrl : corridorKeyAlphaPreviewUrl;
    const label = role === 'source' ? 'source plate' : 'alpha hint';

    if (file) {
      return {
        base64: await fileToBase64(file),
        mimeType: file.type || 'video/mp4',
        name: file.name,
      };
    }

    if (selectedMedia && previewUrl) {
      const payload = await getBase64FromUrl(previewUrl);
      return {
        ...payload,
        mimeType: payload.mimeType || 'video/mp4',
        name: selectedMedia.name,
      };
    }

    throw new Error(`Choose a ${label} video first.`);
  };

  const handleRunCorridorKey = async () => {
    if (!hasDesktopCorridorKey) {
      setCorridorKeyStatus('CorridorKey is available in the desktop app.');
      return;
    }
    const repoPath = corridorKeyRepoPath.trim();
    if (!repoPath) {
      setCorridorKeyStatus('Select a local CorridorKey checkout first.');
      return;
    }
    if (!corridorKeySourcePreviewUrl || !corridorKeyAlphaPreviewUrl) {
      setCorridorKeyStatus('Choose a source plate and alpha hint video.');
      return;
    }

    setIsCorridorKeyRunning(true);
    setCorridorKeyResult(null);
    setCorridorKeyStatus('Running CorridorKey locally...');
    try {
      const [source, alpha] = await Promise.all([
        resolveCorridorKeyPayload('source'),
        resolveCorridorKeyPayload('alpha'),
      ]);
      const maxFrames = parseOptionalInteger(corridorKeyMaxFrames);
      const result = await runCorridorKey({
        repoPath,
        projectPath: currentProjectPath || null,
        source,
        alpha,
        options: {
          ...corridorKeyOptions,
          maxFrames: maxFrames && maxFrames > 0 ? maxFrames : null,
          generateComp: true,
        },
      });
      setCorridorKeyResult(result);

      if (result.url && result.mediaType !== 'folder') {
        const item: MediaItem = {
          id: `corridor-key-${Date.now()}`,
          name: result.outputName,
          type: result.mediaType === 'image' ? 'image' : 'video',
          url: result.url,
          source: 'generated',
          generatedBy: 'CorridorKey',
          prompt: `Source: ${source.name || 'source'}; Alpha hint: ${alpha.name || 'alpha'}; Despill ${corridorKeyOptions.despill}; ${corridorKeyOptions.inputColorSpace || 'srgb'}`,
          originProjectPath: currentProjectPath || null,
        };
        onAddGeneratedMedia(item);
        setCorridorKeyStatus(`CorridorKey result added to your project. EXR outputs are in ${result.outputFolder}.`);
      } else {
        setCorridorKeyStatus(`CorridorKey finished. Outputs are in ${result.outputFolder}.`);
      }
    } catch (error) {
      setCorridorKeyStatus(error instanceof Error ? error.message : 'CorridorKey failed.');
    } finally {
      setIsCorridorKeyRunning(false);
    }
  };

  const handleGenerateOpenPose = async () => {
    if (!openPoseFile) {
      setOpenPoseStatus('Upload an image to extract OpenPose.');
      return;
    }
    setIsOpenPoseRunning(true);
    setOpenPoseStatus('Generating OpenPose...');
    try {
      const base64 = await fileToBase64(openPoseFile);
      const item = await generateOpenPose(
        { base64, mimeType: openPoseFile.type },
        {
          includeFace: openPoseOptions.includeFace,
          includeHands: openPoseOptions.includeHands,
          useOpenpose: openPoseOptions.useOpenpose,
        }
      );
      const itemWithMeta = { ...item, generatedBy: 'OpenPose' };
      setOpenPoseResult(itemWithMeta);
      onAddGeneratedMedia(itemWithMeta);
      setOpenPoseStatus('OpenPose ready and added to your project.');
    } catch (error) {
      setOpenPoseStatus(error instanceof Error ? error.message : 'OpenPose generation failed.');
    } finally {
      setIsOpenPoseRunning(false);
    }
  };

  const handleAnimateReplace = async () => {
    if ((!motionVideo && !motionVideoUrl) || !characterImage) {
      setAnimateStatus('Upload a motion clip and a character image.');
      return;
    }
    setIsAnimateRunning(true);
    setAnimateStatus('Animating replacement...');
    try {
      const [videoPayload, imageBase64] = await Promise.all([
        motionVideo
          ? fileToBase64(motionVideo).then((base64) => ({ base64, mimeType: motionVideo.type }))
          : getBase64FromUrl(motionVideoUrl!),
        fileToBase64(characterImage),
      ]);
      const item = await generateVideoWithWanAnimateReplace(
        { base64: videoPayload.base64, mimeType: videoPayload.mimeType },
        { base64: imageBase64, mimeType: characterImage.type },
        {
          resolution: animateSettings.resolution,
          fps: animateSettings.fps,
          refertNum: animateSettings.refertNum,
          mergeAudio: animateSettings.mergeAudio,
          goFast: animateSettings.goFast,
        }
      );
      const itemWithMeta = { ...item, generatedBy: 'Wan Animate Replace' };
      setAnimateResult(itemWithMeta);
      onAddGeneratedMedia(itemWithMeta);
      setAnimateStatus('Composite video added to your project.');
    } catch (error) {
      setAnimateStatus(error instanceof Error ? error.message : 'Animate replace failed.');
    } finally {
      setIsAnimateRunning(false);
    }
  };

  const handleLumaReframe = async () => {
    if (!readyForGeneration) {
      setReframeStatus('Connect your API keys to run Luma Reframe.');
      return;
    }
    if (!reframePreviewUrl) {
      setReframeStatus('Upload or select a source video to reframe.');
      return;
    }

    setIsReframing(true);
    setReframeStatus('Reframing video with Luma Ray 2...');
    try {
      const sourceVideo = reframeVideoFile
        ? { base64: await fileToBase64(reframeVideoFile), mimeType: reframeVideoFile.type }
        : await getBase64FromUrl(reframePreviewUrl);

      const guideImage = selectedReframeGuideUrl ? await getBase64FromUrl(selectedReframeGuideUrl) : undefined;
      const item = await generateVideoWithFalLumaRay2Reframe(sourceVideo, {
        aspectRatio: reframeAspect,
        prompt: reframePrompt.trim() || undefined,
        image: guideImage,
        gridPositionX: reframeUseManualWindow ? parseOptionalInteger(reframeWindow.gridPositionX) : undefined,
        gridPositionY: reframeUseManualWindow ? parseOptionalInteger(reframeWindow.gridPositionY) : undefined,
        xStart: reframeUseManualWindow ? parseOptionalInteger(reframeWindow.xStart) : undefined,
        xEnd: reframeUseManualWindow ? parseOptionalInteger(reframeWindow.xEnd) : undefined,
        yStart: reframeUseManualWindow ? parseOptionalInteger(reframeWindow.yStart) : undefined,
        yEnd: reframeUseManualWindow ? parseOptionalInteger(reframeWindow.yEnd) : undefined,
      });

      const itemWithMeta = { ...item, generatedBy: 'Luma Ray 2 Reframe' };
      setReframeResult(itemWithMeta);
      onAddGeneratedMedia(itemWithMeta);
      setReframeStatus('Reframed clip added to your project.');
    } catch (error) {
      setReframeStatus(error instanceof Error ? error.message : 'Luma Reframe failed.');
    } finally {
      setIsReframing(false);
    }
  };

  const handleComposite = async () => {
    if (!backgroundPreviewUrl) {
      setCompositeStatus('Select a background image.');
      return;
    }
    setIsCompositing(true);
    setCompositeStatus('Building composite...');
    try {
      const background = await loadImage(backgroundPreviewUrl);
      const overlay = overlayPreviewUrl ? await loadImage(overlayPreviewUrl) : null;
      const canvas = document.createElement('canvas');
      canvas.width = background.width;
      canvas.height = background.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas not available.');

      ctx.drawImage(background, 0, 0);
      if (overlay) {
        ctx.globalCompositeOperation = blendMode;
        ctx.globalAlpha = overlayOpacity / 100;
        ctx.drawImage(overlay, 0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }

      const url = canvas.toDataURL('image/png');
      const item: MediaItem = {
        id: `composite-${Date.now()}`,
        name: `composite_${Date.now()}.png`,
        type: 'image',
        url,
        source: 'generated',
        generatedBy: 'Composite',
      };
      setCompositeResult(item);
      onAddGeneratedMedia(item);
      setCompositeStatus('Composite image added to your project.');
    } catch (error) {
      setCompositeStatus(error instanceof Error ? error.message : 'Composite failed.');
    } finally {
      setIsCompositing(false);
    }
  };

  const handleKlingBridge = async () => {
    if (!readyForGeneration) {
      setKlingBridgeStatus('Connect your API keys to run Kling O3.');
      return;
    }
    if (!backgroundPreviewUrl) {
      setKlingBridgeStatus('Select a background/start frame first.');
      return;
    }
    setIsKlingBridgeRunning(true);
    setKlingBridgeStatus('Generating Kling O3 bridge clip...');
    try {
      const startImage = await getBase64FromUrl(backgroundPreviewUrl);
      const endImage = overlayPreviewUrl ? await getBase64FromUrl(overlayPreviewUrl) : undefined;
      const referenceVideo = motionPreviewUrl ? await getBase64FromUrl(motionPreviewUrl) : undefined;
      const prompt = klingBridgePrompt.trim() || 'Create a smooth cinematic bridge shot between start and end frames.';
      const item = await generateVideoWithFalKlingO3(prompt, startImage, {
        endImage,
        duration: klingBridgeDuration,
        aspectRatio: klingBridgeAspect,
        generateAudio: true,
        referenceVideo,
      });
      const itemWithMeta = { ...item, generatedBy: 'Kling O3 Bridge' };
      setKlingBridgeResult(itemWithMeta);
      onAddGeneratedMedia(itemWithMeta);
      setKlingBridgeStatus('Kling O3 bridge clip added to your project.');
    } catch (error) {
      setKlingBridgeStatus(error instanceof Error ? error.message : 'Kling O3 bridge failed.');
    } finally {
      setIsKlingBridgeRunning(false);
    }
  };

  return (
    <div className="studio-workspace p-6 h-full overflow-auto">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold">Video Compositing</h2>
            <p className="text-gray-400">Combine OpenPose, reframe, animate replace, and layer compositing.</p>
          </div>
          <LayersIcon className="w-8 h-8 text-indigo-300" />
        </div>

        {apiKeyReady === false && (
          <div className="app-panel p-3 text-sm text-amber-200 border border-amber-400/40 bg-amber-400/10">
            Add API keys in Settings to enable compositing tools.
          </div>
        )}

        <div className="app-panel p-2 flex flex-wrap items-center gap-2">
          {COMPOSITING_WORKSPACE_VIEWS.map((view) => (
            <button
              key={view.id}
              type="button"
              onClick={() => setCompositingView(view.id)}
              className={`rounded-lg px-4 py-2 text-left transition ${
                compositingView === view.id
                  ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                  : 'bg-white/5 text-gray-300 hover:bg-white/10'
              }`}
            >
              <div className="text-sm font-semibold">{view.label}</div>
              <div className={`text-[11px] ${compositingView === view.id ? 'text-indigo-100' : 'text-gray-500'}`}>
                {view.description}
              </div>
            </button>
          ))}
        </div>

        {compositingView === 'nodeStudio' ? (
          <CompositingNodeStudioView mediaItems={mediaItems} onAddGeneratedMedia={onAddGeneratedMedia} />
        ) : (
          <>
        <ArtRelightPanel
          mediaItems={mediaItems}
          onAddGeneratedMedia={onAddGeneratedMedia}
          currentProjectPath={currentProjectPath}
        />

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="app-panel p-5 space-y-4">
            <div className="text-xs uppercase tracking-[0.2em] text-gray-400">OpenPose Extract</div>
            <input
              type="file"
              accept="image/*"
              className="app-input-file"
              onChange={(event) => setOpenPoseFile(event.target.files?.[0] || null)}
            />
            <div className="grid gap-3 grid-cols-3 text-xs text-gray-300">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={openPoseOptions.includeFace}
                  onChange={(event) => setOpenPoseOptions((prev) => ({ ...prev, includeFace: event.target.checked }))}
                />
                Face
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={openPoseOptions.includeHands}
                  onChange={(event) => setOpenPoseOptions((prev) => ({ ...prev, includeHands: event.target.checked }))}
                />
                Hands
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={openPoseOptions.useOpenpose}
                  onChange={(event) => setOpenPoseOptions((prev) => ({ ...prev, useOpenpose: event.target.checked }))}
                />
                Body
              </label>
            </div>
            <button
              className="app-button app-primary disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleGenerateOpenPose}
              disabled={isOpenPoseRunning || !readyForGeneration}
            >
              {isOpenPoseRunning ? 'Extracting...' : 'Generate OpenPose'}
            </button>
            {openPoseStatus && <p className="text-sm text-gray-300">{openPoseStatus}</p>}
            {openPoseResult && (
              <div className="app-card p-2">
                <img src={openPoseResult.url} alt="OpenPose result" className="w-full rounded-lg" />
              </div>
            )}
          </section>

          <section className="app-panel p-5 space-y-4">
            <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Animate Replace</div>
            <label className="text-sm text-gray-300 flex items-center gap-2">
              <UploadIcon className="w-4 h-4" /> Motion video
            </label>
            <input
              type="file"
              accept="video/*"
              className="app-input-file"
              onChange={(event) => {
                const nextFile = event.target.files?.[0] || null;
                setMotionVideo(nextFile);
                if (nextFile) {
                  setMotionVideoUrl(null);
                }
              }}
            />
            {motionPreviewUrl && (
              <div className="app-card p-2">
                <video src={motionPreviewUrl} controls className="w-full rounded-lg bg-black" />
                <button
                  type="button"
                  onClick={() => {
                    setMotionVideo(null);
                    setMotionVideoUrl(null);
                  }}
                  className="mt-2 text-xs text-gray-400 hover:text-gray-200"
                >
                  Clear motion clip
                </button>
              </div>
            )}
            <label className="text-sm text-gray-300 flex items-center gap-2">
              <UploadIcon className="w-4 h-4" /> Character image
            </label>
            <input
              type="file"
              accept="image/*"
              className="app-input-file"
              onChange={(event) => setCharacterImage(event.target.files?.[0] || null)}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Resolution</label>
                <select
                  value={animateSettings.resolution}
                  onChange={(event) =>
                    setAnimateSettings((prev) => ({ ...prev, resolution: event.target.value as '480' | '720' }))
                  }
                  className="app-select mt-1"
                >
                  <option value="480">480p</option>
                  <option value="720">720p</option>
                </select>
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.2em] text-gray-400">FPS</label>
                <input
                  type="number"
                  min={8}
                  max={30}
                  value={animateSettings.fps}
                  onChange={(event) =>
                    setAnimateSettings((prev) => ({ ...prev, fps: Number(event.target.value) || 24 }))
                  }
                  className="app-input mt-1"
                />
              </div>
            </div>
            <div className="grid gap-3 grid-cols-2 text-xs text-gray-300">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={animateSettings.mergeAudio}
                  onChange={(event) => setAnimateSettings((prev) => ({ ...prev, mergeAudio: event.target.checked }))}
                />
                Keep audio
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={animateSettings.goFast}
                  onChange={(event) => setAnimateSettings((prev) => ({ ...prev, goFast: event.target.checked }))}
                />
                Fast mode
              </label>
            </div>
            <button
              className="app-button app-primary disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleAnimateReplace}
              disabled={isAnimateRunning || !readyForGeneration}
            >
              {isAnimateRunning ? 'Processing...' : 'Generate Composite Video'}
            </button>
            {animateStatus && <p className="text-sm text-gray-300">{animateStatus}</p>}
            {animateResult && (
              <div className="app-card p-2">
                <video src={animateResult.url} controls className="w-full rounded-lg bg-black" />
              </div>
            )}
          </section>
        </div>

        <section className="app-panel p-5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-gray-400">CorridorKey Local Key</div>
              <p className="text-xs text-gray-500 mt-1">
                Runs your local CorridorKey checkout with a source plate and matching alpha hint; no hosted inference is used.
              </p>
            </div>
            <div
              className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.18em] ${
                corridorKeyEnvStatus?.ready
                  ? 'bg-emerald-500/15 text-emerald-200'
                  : corridorKeyEnvStatus?.available
                    ? 'bg-amber-500/15 text-amber-200'
                    : 'bg-white/5 text-gray-400'
              }`}
            >
              {corridorKeyEnvStatus?.ready ? 'Ready' : corridorKeyEnvStatus?.available ? 'Setup Required' : 'Local'}
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto]">
            <input
              value={corridorKeyRepoPath}
              onChange={(event) => {
                setCorridorKeyRepoPath(event.target.value);
                window.localStorage.setItem(CORRIDOR_KEY_REPO_STORAGE_KEY, event.target.value);
              }}
              placeholder="/path/to/CorridorKey"
              className="app-input"
            />
            <button type="button" className="app-button" onClick={handleSelectCorridorKeyRepo} disabled={!hasDesktopCorridorKey}>
              Select Checkout
            </button>
            <button type="button" className="app-button" onClick={handlePrepareCorridorKey} disabled={isCorridorKeyPreparing || !hasDesktopCorridorKey}>
              {isCorridorKeyPreparing ? 'Preparing...' : 'Prepare Engine'}
            </button>
          </div>
          {corridorKeyEnvStatus?.error && <p className="text-[11px] text-amber-300">{corridorKeyEnvStatus.error}</p>}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <label className="text-sm text-gray-300 flex items-center gap-2">
                <UploadIcon className="w-4 h-4" /> Source plate
              </label>
              <input
                type="file"
                accept="video/*"
                className="app-input-file"
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] || null;
                  setCorridorKeySourceFile(nextFile);
                  setCorridorKeySourceMediaId('');
                  setCorridorKeySourceKind(nextFile ? 'file' : 'none');
                }}
              />
              <select
                value={corridorKeySourceMediaId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setCorridorKeySourceMediaId(nextId);
                  setCorridorKeySourceFile(null);
                  setCorridorKeySourceKind(nextId ? 'media' : 'none');
                }}
                className="app-select"
              >
                <option value="">Select from project videos...</option>
                {videoMediaItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              {corridorKeySourcePreviewUrl && (
                <div className="app-card p-2">
                  <video src={corridorKeySourcePreviewUrl} controls className="w-full rounded-lg bg-black" />
                  <button
                    type="button"
                    onClick={() => {
                      setCorridorKeySourceFile(null);
                      setCorridorKeySourceMediaId('');
                      setCorridorKeySourceKind('none');
                    }}
                    className="mt-2 text-xs text-gray-400 hover:text-gray-200"
                  >
                    Clear source plate
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <label className="text-sm text-gray-300 flex items-center gap-2">
                <UploadIcon className="w-4 h-4" /> Alpha hint
              </label>
              <input
                type="file"
                accept="video/*"
                className="app-input-file"
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] || null;
                  setCorridorKeyAlphaFile(nextFile);
                  setCorridorKeyAlphaMediaId('');
                  setCorridorKeyAlphaKind(nextFile ? 'file' : 'none');
                }}
              />
              <select
                value={corridorKeyAlphaMediaId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setCorridorKeyAlphaMediaId(nextId);
                  setCorridorKeyAlphaFile(null);
                  setCorridorKeyAlphaKind(nextId ? 'media' : 'none');
                }}
                className="app-select"
              >
                <option value="">Select from project videos...</option>
                {videoMediaItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              {corridorKeyAlphaPreviewUrl && (
                <div className="app-card p-2">
                  <video src={corridorKeyAlphaPreviewUrl} controls className="w-full rounded-lg bg-black" />
                  <button
                    type="button"
                    onClick={() => {
                      setCorridorKeyAlphaFile(null);
                      setCorridorKeyAlphaMediaId('');
                      setCorridorKeyAlphaKind('none');
                    }}
                    className="mt-2 text-xs text-gray-400 hover:text-gray-200"
                  >
                    Clear alpha hint
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <div>
              <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Device</label>
              <select
                value={corridorKeyOptions.device}
                onChange={(event) => setCorridorKeyOptions((prev) => ({ ...prev, device: event.target.value as CorridorKeyOptions['device'] }))}
                className="app-select mt-1"
              >
                <option value="auto">Auto</option>
                <option value="mps">Apple MPS</option>
                <option value="cuda">CUDA</option>
                <option value="cpu">CPU</option>
              </select>
            </div>
            <div>
              <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Backend</label>
              <select
                value={corridorKeyOptions.backend}
                onChange={(event) => setCorridorKeyOptions((prev) => ({ ...prev, backend: event.target.value as CorridorKeyOptions['backend'] }))}
                className="app-select mt-1"
              >
                <option value="auto">Auto</option>
                <option value="torch">Torch</option>
                <option value="mlx">MLX</option>
              </select>
            </div>
            <div>
              <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Color</label>
              <select
                value={corridorKeyOptions.inputColorSpace}
                onChange={(event) =>
                  setCorridorKeyOptions((prev) => ({ ...prev, inputColorSpace: event.target.value as 'srgb' | 'linear' }))
                }
                className="app-select mt-1"
              >
                <option value="srgb">sRGB / Rec.709</option>
                <option value="linear">Linear</option>
              </select>
            </div>
            <div>
              <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Image Size</label>
              <select
                value={corridorKeyOptions.imageSize}
                onChange={(event) =>
                  setCorridorKeyOptions((prev) => ({ ...prev, imageSize: Number(event.target.value) as 512 | 1024 | 2048 }))
                }
                className="app-select mt-1"
              >
                <option value={512}>512</option>
                <option value={1024}>1024</option>
                <option value={2048}>2048</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <label className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-gray-300">
                <span>Despill</span>
                <span>{corridorKeyOptions.despill}</span>
              </div>
              <input
                type="range"
                min={0}
                max={10}
                step={1}
                value={corridorKeyOptions.despill}
                onChange={(event) => setCorridorKeyOptions((prev) => ({ ...prev, despill: Number(event.target.value) }))}
                className="w-full"
              />
            </label>
            <label className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-gray-300">
                <span>Refiner</span>
                <span>{Number(corridorKeyOptions.refiner || 1).toFixed(1)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={4}
                step={0.1}
                value={corridorKeyOptions.refiner}
                onChange={(event) => setCorridorKeyOptions((prev) => ({ ...prev, refiner: Number(event.target.value) }))}
                className="w-full"
              />
            </label>
            <div>
              <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Despeckle Size</label>
              <input
                type="number"
                min={0}
                value={corridorKeyOptions.despeckleSize}
                onChange={(event) => setCorridorKeyOptions((prev) => ({ ...prev, despeckleSize: Number(event.target.value) || 0 }))}
                className="app-input mt-1"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Max Frames</label>
              <input
                type="number"
                min={1}
                value={corridorKeyMaxFrames}
                onChange={(event) => setCorridorKeyMaxFrames(event.target.value)}
                placeholder="All"
                className="app-input mt-1"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-gray-300">
              <input
                type="checkbox"
                checked={corridorKeyOptions.autoDespeckle !== false}
                onChange={(event) => setCorridorKeyOptions((prev) => ({ ...prev, autoDespeckle: event.target.checked }))}
              />
              Auto-despeckle
            </label>
            <button
              className="app-button app-primary disabled:opacity-50 disabled:cursor-not-allowed min-w-[220px]"
              onClick={handleRunCorridorKey}
              disabled={isCorridorKeyRunning || isCorridorKeyPreparing || !corridorKeySourcePreviewUrl || !corridorKeyAlphaPreviewUrl}
            >
              {isCorridorKeyRunning ? 'Keying...' : 'Run CorridorKey'}
            </button>
          </div>

          {corridorKeyStatus && <p className="text-sm text-gray-300">{corridorKeyStatus}</p>}
          {corridorKeyResult?.url && corridorKeyResult.mediaType === 'video' && (
            <div className="app-card p-2">
              <video src={corridorKeyResult.url} controls className="w-full rounded-lg bg-black" />
            </div>
          )}
          {corridorKeyResult?.url && corridorKeyResult.mediaType === 'image' && (
            <div className="app-card p-2">
              <img src={corridorKeyResult.url} alt="CorridorKey result" className="w-full rounded-lg" />
            </div>
          )}
        </section>

        <section className="app-panel p-5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Reframe Tools</div>
              <p className="text-xs text-gray-500 mt-1">
                Use Luma Ray 2 Reframe to adapt widescreen shots for vertical, square, or alternate delivery formats.
              </p>
            </div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-indigo-300">Luma Ray 2</div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <label className="text-sm text-gray-300 flex items-center gap-2">
                <UploadIcon className="w-4 h-4" /> Source video
              </label>
              <input
                type="file"
                accept="video/*"
                className="app-input-file"
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] || null;
                  setReframeVideoFile(nextFile);
                  setReframeVideoMediaId('');
                  setReframeVideoUrl(null);
                  setReframeVideoSource(nextFile ? 'file' : 'none');
                }}
              />
              <select
                value={reframeVideoMediaId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setReframeVideoMediaId(nextId);
                  setReframeVideoFile(null);
                  setReframeVideoUrl(null);
                  setReframeVideoSource(nextId ? 'media' : 'none');
                }}
                className="app-select"
              >
                <option value="">Select from project videos...</option>
                {videoMediaItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              {reframePreviewUrl && (
                <div className="app-card p-2">
                  <video src={reframePreviewUrl} controls className="w-full rounded-lg bg-black" />
                  <button
                    type="button"
                    onClick={() => {
                      setReframeVideoFile(null);
                      setReframeVideoUrl(null);
                      setReframeVideoMediaId('');
                      setReframeVideoSource('none');
                    }}
                    className="mt-2 text-xs text-gray-400 hover:text-gray-200"
                  >
                    Clear source video
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Prompt</label>
                <textarea
                  value={reframePrompt}
                  onChange={(event) => setReframePrompt(event.target.value)}
                  placeholder="Optional framing guidance, e.g. keep talent centered, preserve headroom, extend skyline for 9:16."
                  className="app-textarea h-24 mt-1"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Aspect Ratio</label>
                  <select
                    value={reframeAspect}
                    onChange={(event) => setReframeAspect(event.target.value as FalLumaRay2ReframeAspectRatio)}
                    className="app-select mt-1"
                  >
                    <option value="9:16">9:16</option>
                    <option value="16:9">16:9</option>
                    <option value="1:1">1:1</option>
                    <option value="4:3">4:3</option>
                    <option value="3:4">3:4</option>
                    <option value="21:9">21:9</option>
                    <option value="9:21">9:21</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Guide Frame</label>
                  <select
                    value={reframeGuideFrame}
                    onChange={(event) => setReframeGuideFrame(event.target.value as ReframeGuideFrame)}
                    className="app-select mt-1"
                  >
                    <option value="none">None</option>
                    <option value="background">Use Background image</option>
                    <option value="overlay">Use Overlay image</option>
                  </select>
                </div>
              </div>

              <div className="app-card p-3 space-y-3">
                <label className="flex items-center gap-2 text-xs text-gray-300">
                  <input
                    type="checkbox"
                    checked={reframeUseManualWindow}
                    onChange={(event) => setReframeUseManualWindow(event.target.checked)}
                  />
                  Enable manual window coordinates
                </label>
                {reframeUseManualWindow && (
                  <div className="grid gap-3 md:grid-cols-3">
                    <div>
                      <label className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Grid X</label>
                      <input
                        type="number"
                        value={reframeWindow.gridPositionX}
                        onChange={(event) => setReframeWindow((prev) => ({ ...prev, gridPositionX: event.target.value }))}
                        className="app-input mt-1"
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Grid Y</label>
                      <input
                        type="number"
                        value={reframeWindow.gridPositionY}
                        onChange={(event) => setReframeWindow((prev) => ({ ...prev, gridPositionY: event.target.value }))}
                        className="app-input mt-1"
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-[0.2em] text-gray-500">X Start</label>
                      <input
                        type="number"
                        value={reframeWindow.xStart}
                        onChange={(event) => setReframeWindow((prev) => ({ ...prev, xStart: event.target.value }))}
                        className="app-input mt-1"
                        placeholder="Optional"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-[0.2em] text-gray-500">X End</label>
                      <input
                        type="number"
                        value={reframeWindow.xEnd}
                        onChange={(event) => setReframeWindow((prev) => ({ ...prev, xEnd: event.target.value }))}
                        className="app-input mt-1"
                        placeholder="Optional"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Y Start</label>
                      <input
                        type="number"
                        value={reframeWindow.yStart}
                        onChange={(event) => setReframeWindow((prev) => ({ ...prev, yStart: event.target.value }))}
                        className="app-input mt-1"
                        placeholder="Optional"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Y End</label>
                      <input
                        type="number"
                        value={reframeWindow.yEnd}
                        onChange={(event) => setReframeWindow((prev) => ({ ...prev, yEnd: event.target.value }))}
                        className="app-input mt-1"
                        placeholder="Optional"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-end">
                <button
                  className="app-button app-primary disabled:opacity-50 disabled:cursor-not-allowed w-full"
                  onClick={handleLumaReframe}
                  disabled={isReframing || !reframePreviewUrl}
                >
                  {isReframing ? 'Reframing...' : 'Generate Reframed Clip'}
                </button>
              </div>
            </div>
          </div>

          {reframeStatus && <p className="text-sm text-gray-300">{reframeStatus}</p>}
          {reframeResult && (
            <div className="app-card p-2">
              <video src={reframeResult.url} controls className="w-full rounded-lg bg-black" />
            </div>
          )}
        </section>

        <NatronCompositorPanel mediaItems={mediaItems} onAddGeneratedMedia={onAddGeneratedMedia} />

        <section className="app-panel p-5 space-y-4">
          <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Layer Composite</div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <label className="text-sm text-gray-300">Background</label>
              <input
                type="file"
                accept="image/*"
                className="app-input-file"
                onChange={(event) => {
                  setBackgroundFile(event.target.files?.[0] || null);
                  setBackgroundSource(event.target.files?.[0] ? 'file' : 'none');
                }}
              />
              <select
                value={backgroundMediaId}
                onChange={(event) => {
                  setBackgroundMediaId(event.target.value);
                  setBackgroundSource(event.target.value ? 'media' : 'none');
                }}
                className="app-select"
              >
                <option value="">Select from project images...</option>
                {imageMediaItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              {backgroundPreviewUrl && (
                <div className="aspect-video bg-black/60 rounded-lg overflow-hidden">
                  <img src={backgroundPreviewUrl} alt="Background preview" className="w-full h-full object-cover" />
                </div>
              )}
            </div>
            <div className="space-y-3">
              <label className="text-sm text-gray-300">Overlay</label>
              <input
                type="file"
                accept="image/*"
                className="app-input-file"
                onChange={(event) => {
                  setOverlayFile(event.target.files?.[0] || null);
                  setOverlaySource(event.target.files?.[0] ? 'file' : 'none');
                }}
              />
              <select
                value={overlayMediaId}
                onChange={(event) => {
                  setOverlayMediaId(event.target.value);
                  setOverlaySource(event.target.value ? 'media' : 'none');
                }}
                className="app-select"
              >
                <option value="">Select from project images...</option>
                {imageMediaItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              {overlayPreviewUrl && (
                <div className="aspect-video bg-black/60 rounded-lg overflow-hidden">
                  <img src={overlayPreviewUrl} alt="Overlay preview" className="w-full h-full object-cover" />
                </div>
              )}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Blend Mode</label>
              <select
                value={blendMode}
                onChange={(event) => setBlendMode(event.target.value as BlendMode)}
                className="app-select mt-1"
              >
                <option value="source-over">Normal</option>
                <option value="screen">Screen</option>
                <option value="multiply">Multiply</option>
                <option value="overlay">Overlay</option>
                <option value="soft-light">Soft Light</option>
              </select>
            </div>
            <div>
              <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Opacity</label>
              <input
                type="range"
                min={10}
                max={100}
                value={overlayOpacity}
                onChange={(event) => setOverlayOpacity(Number(event.target.value))}
                className="w-full mt-3"
              />
            </div>
            <div className="flex items-end">
              <button
                className="app-button app-primary disabled:opacity-50 disabled:cursor-not-allowed w-full"
                onClick={handleComposite}
                disabled={isCompositing || !backgroundPreviewUrl}
              >
                {isCompositing ? 'Compositing...' : 'Build Composite'}
              </button>
            </div>
          </div>
          {compositeStatus && <p className="text-sm text-gray-300">{compositeStatus}</p>}
          {compositeResult && (
            <div className="app-card p-2">
              <img src={compositeResult.url} alt="Composite result" className="w-full rounded-lg" />
            </div>
          )}
        </section>

        <section className="app-panel p-5 space-y-4">
          <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Kling O3 Compositing Bridge</div>
          <p className="text-xs text-gray-500">
            Uses your selected Background as start frame, Overlay as end frame, and optional Motion Video as temporal reference.
          </p>
          <textarea
            value={klingBridgePrompt}
            onChange={(event) => setKlingBridgePrompt(event.target.value)}
            placeholder="Describe camera move, pacing, and transition style..."
            className="app-textarea h-20"
          />
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Duration</label>
              <select
                value={klingBridgeDuration}
                onChange={(event) => setKlingBridgeDuration(Math.max(3, Math.min(15, Number(event.target.value) || 5)))}
                className="app-select mt-1"
              >
                <option value={3}>3s</option>
                <option value={5}>5s</option>
                <option value={8}>8s</option>
                <option value={10}>10s</option>
                <option value={12}>12s</option>
                <option value={15}>15s</option>
              </select>
            </div>
            <div>
              <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Aspect Ratio</label>
              <select
                value={klingBridgeAspect}
                onChange={(event) => setKlingBridgeAspect(event.target.value as '16:9' | '9:16' | '1:1')}
                className="app-select mt-1"
              >
                <option value="16:9">16:9</option>
                <option value="9:16">9:16</option>
                <option value="1:1">1:1</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                className="app-button app-primary disabled:opacity-50 disabled:cursor-not-allowed w-full"
                onClick={handleKlingBridge}
                disabled={isKlingBridgeRunning || !backgroundPreviewUrl}
              >
                {isKlingBridgeRunning ? 'Generating...' : 'Generate O3 Bridge Clip'}
              </button>
            </div>
          </div>
          {klingBridgeStatus && <p className="text-sm text-gray-300">{klingBridgeStatus}</p>}
          {klingBridgeResult && (
            <div className="app-card p-2">
              <video src={klingBridgeResult.url} controls className="w-full rounded-lg bg-black" />
            </div>
          )}
        </section>
          </>
        )}
      </div>
    </div>
  );
};

export default CompositingWorkspace;
