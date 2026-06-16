import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MediaItem } from '../types';
import { inpaintWithNanoBanana, inpaintWithFlux2Pro, inpaintWithZTurboInpaint } from '../services/replicateService';
import { editImageWithFalNanoBanana2 } from '../services/falAiService';
import { gradeImageFromPrompt, matchReferenceGrade } from '../services/geminiService';
import { BrushIcon, TextIcon, LayersIcon, MagicWandIcon } from '../components/icons';
import { fileToBase64 } from '../utils/helpers';

interface PhotoWorkspaceProps {
  onAddGeneratedMedia?: (item: MediaItem) => void;
  seedImageUrl?: string | null;
  onConsumeSeed?: () => void;
}

type ToolMode = 'brush' | 'lasso' | 'stamp' | 'clone' | 'text';

type TextLayer = {
  id: string;
  text: string;
  x: number; // 0-1
  y: number; // 0-1
  fontSize: number;
  color: string;
  opacity: number;
  visible: boolean;
};

const DEFAULT_ADJUSTMENTS = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  hue: 0,
  blur: 0,
};

const ADJUSTMENT_CONFIG: Record<string, { label: string; min: number; max: number }> = {
  brightness: { label: 'Brightness', min: 50, max: 150 },
  contrast: { label: 'Contrast', min: 50, max: 150 },
  saturate: { label: 'Saturation', min: 50, max: 150 },
  hue: { label: 'Hue', min: -180, max: 180 },
  blur: { label: 'Depth Blur', min: 0, max: 20 },
};

const TOOL_HINTS: Record<ToolMode, string> = {
  brush: 'Paint areas to inpaint or heal.',
  lasso: 'Drag to outline a region.',
  stamp: 'Alt-click to set source, then paint to stamp/clone.',
  clone: 'Alt-click to set source, then paint to stamp/clone.',
  text: 'Click on the canvas to add a text layer.',
};

type NeuralPreset = {
  id: 'harmonize' | 'portrait_balance' | 'cinematic_pop' | 'dehaze' | 'soft_skin' | 'custom_prompt';
  label: string;
  description: string;
  requiresReference?: boolean;
  aiPrompt?: string;
  fallback?: Partial<typeof DEFAULT_ADJUSTMENTS>;
};

const NEURAL_PRESETS: NeuralPreset[] = [
  {
    id: 'harmonize',
    label: 'Harmonize',
    description: 'Match color and mood of a reference still.',
    requiresReference: true,
  },
  {
    id: 'portrait_balance',
    label: 'Portrait Balance',
    description: 'Natural skin tones, soft contrast, cleaner midtones.',
    aiPrompt: 'Create a portrait-balanced grade: natural skin tones, gentle contrast, subtle warmth, clean highlights, avoid oversaturation.',
  },
  {
    id: 'cinematic_pop',
    label: 'Cinematic Pop',
    description: 'Modern blockbuster contrast with controlled saturation.',
    aiPrompt: 'Create a cinematic blockbuster grade with punchy contrast, slightly cool shadows, warm skin highlights, and controlled saturation.',
  },
  {
    id: 'dehaze',
    label: 'Dehaze',
    description: 'Increase local contrast and clarity.',
    fallback: { brightness: 103, contrast: 122, saturate: 108, hue: 0, blur: 0 },
  },
  {
    id: 'soft_skin',
    label: 'Soft Skin',
    description: 'Subtle softening for portraits without heavy blur.',
    fallback: { brightness: 102, contrast: 95, saturate: 96, hue: 2, blur: 2 },
  },
  {
    id: 'custom_prompt',
    label: 'Custom AI Grade',
    description: 'Write your own neural-style grading prompt.',
    aiPrompt: '',
  },
];

const PhotoWorkspace: React.FC<PhotoWorkspaceProps> = ({ onAddGeneratedMedia, seedImageUrl, onConsumeSeed }) => {
  const rasterCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const neuralRefInputRef = useRef<HTMLInputElement>(null);

  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [tool, setTool] = useState<ToolMode>('brush');
  const [maskMode, setMaskMode] = useState<'paint' | 'erase'>('paint');
  const [brushSize, setBrushSize] = useState(24);
  const [maskHasPaint, setMaskHasPaint] = useState(false);
  const [inpaintPrompt, setInpaintPrompt] = useState('');
  const [inpaintModel, setInpaintModel] = useState<'nano-banana-pro' | 'nano-banana-2-fal' | 'flux-2-pro' | 'z-turbo-inpaint'>('nano-banana-pro');
  const [resolution, setResolution] = useState<'1K' | '2K' | '4K' | 'match_input_image' | '0.5 MP' | '1 MP' | '2 MP' | '4 MP'>('2K');
  const [isInpainting, setIsInpainting] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [expandPadding, setExpandPadding] = useState(128);
  const [expandPrompt, setExpandPrompt] = useState('Extend the scene naturally, matching lighting and style.');

  const [adjustments, setAdjustments] = useState(DEFAULT_ADJUSTMENTS);
  const [cropRect, setCropRect] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [neuralIntensity, setNeuralIntensity] = useState(75);
  const [neuralPrompt, setNeuralPrompt] = useState('Balance skin tones and harmonize palette while preserving detail.');
  const [isApplyingNeural, setIsApplyingNeural] = useState(false);
  const [neuralReference, setNeuralReference] = useState<{
    file: File;
    url: string;
    base64: string;
    mimeType: string;
  } | null>(null);

  const [textLayers, setTextLayers] = useState<TextLayer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);

  const isDrawingRef = useRef(false);
  const activeToolRef = useRef<ToolMode>('brush');
  const maskPaintedRef = useRef(false);
  const lassoPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const maskSnapshotRef = useRef<ImageData | null>(null);
  const cloneSourceRef = useRef<{ x: number; y: number } | null>(null);
  const cloneOffsetRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (inpaintModel === 'nano-banana-pro' || inpaintModel === 'nano-banana-2-fal') {
      setResolution('2K');
    } else if (inpaintModel === 'flux-2-pro') {
      setResolution('match_input_image');
    } else {
      setResolution('2K');
    }
  }, [inpaintModel]);

  const filterStyle = useMemo(() => {
    const filters = [
      `brightness(${adjustments.brightness}%)`,
      `contrast(${adjustments.contrast}%)`,
      `saturate(${adjustments.saturate}%)`,
      `hue-rotate(${adjustments.hue}deg)`,
      adjustments.blur > 0 ? `blur(${adjustments.blur}px)` : '',
    ].filter(Boolean);
    return filters.join(' ');
  }, [adjustments]);

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  const normalizeAiFilters = (filters: any): typeof DEFAULT_ADJUSTMENTS => {
    const rawHue = Number(filters?.hueRotate ?? filters?.hue ?? 0);
    const normalizedHue = rawHue > 180 ? rawHue - 360 : rawHue;
    return {
      brightness: clamp(Math.round(Number(filters?.brightness ?? 100)), 50, 150),
      contrast: clamp(Math.round(Number(filters?.contrast ?? 100)), 50, 150),
      saturate: clamp(Math.round(Number(filters?.saturate ?? 100)), 50, 150),
      hue: clamp(Math.round(Number.isFinite(normalizedHue) ? normalizedHue : 0), -180, 180),
      blur: clamp(Math.round(Number(filters?.blur ?? 0)), 0, 20),
    };
  };

  const blendAdjustments = (
    base: typeof DEFAULT_ADJUSTMENTS,
    target: typeof DEFAULT_ADJUSTMENTS,
    intensityPercent: number,
  ) => {
    const t = clamp(intensityPercent, 0, 100) / 100;
    return {
      brightness: Math.round(base.brightness + (target.brightness - base.brightness) * t),
      contrast: Math.round(base.contrast + (target.contrast - base.contrast) * t),
      saturate: Math.round(base.saturate + (target.saturate - base.saturate) * t),
      hue: Math.round(base.hue + (target.hue - base.hue) * t),
      blur: Math.round(base.blur + (target.blur - base.blur) * t),
    };
  };

  const getRasterCanvasPayload = () => {
    const canvas = rasterCanvasRef.current;
    if (!canvas || !canvas.width || !canvas.height) return null;
    const dataUrl = canvas.toDataURL('image/png');
    const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
    if (!match || !match[1] || !match[2]) return null;
    return { mimeType: match[1], base64: match[2] };
  };

  const getCanvasPoint = (event: React.PointerEvent) => {
    const canvas = maskCanvasRef.current || rasterCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  };

  const clearMask = useCallback(() => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;
    const ctx = maskCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    setMaskHasPaint(false);
    maskPaintedRef.current = false;
  }, []);

  const loadImageToCanvas = useCallback((url: string) => {
    const img = new Image();
    img.onload = () => {
      const canvas = rasterCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = img.width;
      canvas.height = img.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      setCanvasSize({ width: img.width, height: img.height });
      setCropRect({ x: 0, y: 0, width: img.width, height: img.height });
      setAdjustments(DEFAULT_ADJUSTMENTS);

      const maskCanvas = maskCanvasRef.current;
      if (maskCanvas) {
        maskCanvas.width = img.width;
        maskCanvas.height = img.height;
      }
      clearMask();
      setStatus('');
    };
    img.src = url;
  }, [clearMask]);

  useEffect(() => {
    if (!seedImageUrl) return;
    loadImageToCanvas(seedImageUrl);
    onConsumeSeed?.();
  }, [seedImageUrl, loadImageToCanvas, onConsumeSeed]);

  const handleFileSelect = (file: File) => {
    const url = URL.createObjectURL(file);
    loadImageToCanvas(url);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleNeuralReferenceSelect = async (file: File) => {
    const base64 = await fileToBase64(file);
    const url = URL.createObjectURL(file);
    setNeuralReference({
      file,
      url,
      base64,
      mimeType: file.type || 'image/png',
    });
    setStatus('Reference loaded for Harmonize.');
  };

  const applyNeuralPreset = async (preset: NeuralPreset) => {
    const payload = getRasterCanvasPayload();
    if (!payload) {
      setStatus('Upload an image before using Neural Filters.');
      return;
    }

    if (preset.requiresReference && !neuralReference) {
      setStatus('Upload a reference image to use Harmonize.');
      return;
    }

    setIsApplyingNeural(true);
    setStatus(`Applying ${preset.label}...`);
    try {
      let targetAdjustment: typeof DEFAULT_ADJUSTMENTS | null = null;

      if (preset.id === 'harmonize' && neuralReference) {
        const result = await matchReferenceGrade(
          payload.base64,
          payload.mimeType,
          neuralReference.base64,
          neuralReference.mimeType,
        );
        targetAdjustment = normalizeAiFilters(result.filters);
      } else if (preset.aiPrompt) {
        const prompt = preset.id === 'custom_prompt' ? (neuralPrompt.trim() || preset.description) : preset.aiPrompt;
        const result = await gradeImageFromPrompt(payload.base64, payload.mimeType, prompt);
        targetAdjustment = normalizeAiFilters(result.filters);
      } else if (preset.fallback) {
        targetAdjustment = {
          ...DEFAULT_ADJUSTMENTS,
          ...preset.fallback,
        };
      }

      if (!targetAdjustment) {
        setStatus('No neural adjustments were produced.');
        return;
      }

      setAdjustments((current) => blendAdjustments(current, targetAdjustment as typeof DEFAULT_ADJUSTMENTS, neuralIntensity));
      setStatus(`${preset.label} ready. Click "Apply" in Adjustments to bake it into the image.`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setStatus(`Neural filter failed: ${msg}`);
    } finally {
      setIsApplyingNeural(false);
    }
  };

  const handleBrushStart = (point: { x: number; y: number }) => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;
    const ctx = maskCanvas.getContext('2d');
    if (!ctx) return;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
    ctx.lineWidth = brushSize;
    ctx.globalCompositeOperation = maskMode === 'erase' ? 'destination-out' : 'source-over';
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    isDrawingRef.current = true;
    activeToolRef.current = 'brush';
  };

  const handleBrushMove = (point: { x: number; y: number }) => {
    if (!isDrawingRef.current) return;
    const maskCanvas = maskCanvasRef.current;
    const ctx = maskCanvas?.getContext('2d');
    if (!ctx) return;
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    if (!maskPaintedRef.current) {
      maskPaintedRef.current = true;
      setMaskHasPaint(true);
    }
  };

  const handleLassoStart = (point: { x: number; y: number }) => {
    const maskCanvas = maskCanvasRef.current;
    const ctx = maskCanvas?.getContext('2d');
    if (!ctx || !maskCanvas) return;
    lassoPointsRef.current = [point];
    maskSnapshotRef.current = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    isDrawingRef.current = true;
    activeToolRef.current = 'lasso';
  };

  const handleLassoMove = (point: { x: number; y: number }) => {
    if (!isDrawingRef.current) return;
    const maskCanvas = maskCanvasRef.current;
    const ctx = maskCanvas?.getContext('2d');
    const snapshot = maskSnapshotRef.current;
    if (!ctx || !maskCanvas || !snapshot) return;

    lassoPointsRef.current.push(point);
    ctx.putImageData(snapshot, 0, 0);
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const points = lassoPointsRef.current;
    ctx.moveTo(points[0].x, points[0].y);
    points.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.stroke();
  };

  const finalizeLasso = () => {
    const maskCanvas = maskCanvasRef.current;
    const ctx = maskCanvas?.getContext('2d');
    const snapshot = maskSnapshotRef.current;
    if (!ctx || !maskCanvas || !snapshot) return;

    const points = lassoPointsRef.current;
    if (points.length < 3) return;

    ctx.putImageData(snapshot, 0, 0);
    ctx.fillStyle = 'rgba(239, 68, 68, 0.6)';
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    points.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.fill();

    if (!maskPaintedRef.current) {
      maskPaintedRef.current = true;
      setMaskHasPaint(true);
    }
  };

  const applyCloneAt = (point: { x: number; y: number }) => {
    const source = cloneSourceRef.current;
    const offset = cloneOffsetRef.current;
    const canvas = rasterCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!source || !offset || !ctx || !canvas) return;

    const radius = Math.max(4, Math.round(brushSize / 2));
    const srcX = Math.round(point.x - offset.x);
    const srcY = Math.round(point.y - offset.y);
    const dstX = Math.round(point.x);
    const dstY = Math.round(point.y);

    const size = radius * 2;
    const safeSrcX = Math.max(0, Math.min(canvas.width - size, srcX - radius));
    const safeSrcY = Math.max(0, Math.min(canvas.height - size, srcY - radius));
    const safeDstX = Math.max(0, Math.min(canvas.width - size, dstX - radius));
    const safeDstY = Math.max(0, Math.min(canvas.height - size, dstY - radius));

    const imageData = ctx.getImageData(safeSrcX, safeSrcY, size, size);
    ctx.putImageData(imageData, safeDstX, safeDstY);
  };

  const handleCloneStart = (event: React.PointerEvent, point: { x: number; y: number }) => {
    if (event.altKey) {
      cloneSourceRef.current = point;
      setStatus('Stamp source set.');
      return;
    }

    if (!cloneSourceRef.current) {
      setStatus('Alt-click to set a stamp source.');
      return;
    }

    cloneOffsetRef.current = {
      x: point.x - cloneSourceRef.current.x,
      y: point.y - cloneSourceRef.current.y,
    };
    isDrawingRef.current = true;
    activeToolRef.current = 'stamp';
    applyCloneAt(point);
  };

  const handleTextAdd = (point: { x: number; y: number }) => {
    if (!canvasSize.width || !canvasSize.height) return;
    const newLayer: TextLayer = {
      id: `text-${Date.now()}`,
      text: 'Edit text',
      x: point.x / canvasSize.width,
      y: point.y / canvasSize.height,
      fontSize: 32,
      color: '#ffffff',
      opacity: 1,
      visible: true,
    };
    setTextLayers((prev) => [...prev, newLayer]);
    setSelectedLayerId(newLayer.id);
  };

  const handlePointerDown = (event: React.PointerEvent) => {
    if (!canvasSize.width) return;
    const point = getCanvasPoint(event);

    if (tool === 'brush') {
      handleBrushStart(point);
    } else if (tool === 'lasso') {
      handleLassoStart(point);
    } else if (tool === 'clone' || tool === 'stamp') {
      handleCloneStart(event, point);
    } else if (tool === 'text') {
      handleTextAdd(point);
    }
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!isDrawingRef.current) return;
    const point = getCanvasPoint(event);
    if (activeToolRef.current === 'brush') {
      handleBrushMove(point);
    } else if (activeToolRef.current === 'lasso') {
      handleLassoMove(point);
    } else if (activeToolRef.current === 'clone' || activeToolRef.current === 'stamp') {
      applyCloneAt(point);
    }
  };

  const handlePointerUp = () => {
    if (activeToolRef.current === 'lasso') {
      finalizeLasso();
    }
    isDrawingRef.current = false;
    activeToolRef.current = tool;
    lassoPointsRef.current = [];
    maskSnapshotRef.current = null;
  };

  const buildMaskedImageDataUrl = () => {
    const baseCanvas = rasterCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!baseCanvas || !maskCanvas) return null;

    const offscreen = document.createElement('canvas');
    offscreen.width = baseCanvas.width;
    offscreen.height = baseCanvas.height;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(baseCanvas, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(maskCanvas, 0, 0);

    return offscreen.toDataURL('image/png');
  };

  const handleInpaint = async (promptOverride?: string) => {
    if (!maskHasPaint && !maskPaintedRef.current) {
      setStatus('Paint a mask before inpainting.');
      return;
    }
    const maskedDataUrl = buildMaskedImageDataUrl();
    if (!maskedDataUrl) return;

    setIsInpainting(true);
    setStatus('Inpainting...');
    try {
      const prompt = promptOverride || inpaintPrompt || 'Reconstruct the masked area seamlessly.';
      const item = inpaintModel === 'nano-banana-pro'
        ? await inpaintWithNanoBanana(prompt, maskedDataUrl, resolution as '1K' | '2K' | '4K')
        : inpaintModel === 'nano-banana-2-fal'
          ? await (async () => {
            const match = maskedDataUrl.match(/^data:(.*?);base64,(.*)$/);
            const payload = match && match[1] && match[2]
              ? { mimeType: match[1], base64: match[2] }
              : { mimeType: 'image/png', base64: (maskedDataUrl.split(',')[1] || '') };
            const images = await editImageWithFalNanoBanana2(prompt, payload, {
              resolution: resolution as '1K' | '2K' | '4K',
            });
            if (!images.length) throw new Error('FAL Nano Banana 2 Edit returned no images.');
            return images[0];
          })()
        : inpaintModel === 'flux-2-pro'
          ? await inpaintWithFlux2Pro(prompt, maskedDataUrl, resolution as 'match_input_image' | '0.5 MP' | '1 MP' | '2 MP' | '4 MP')
          : await inpaintWithZTurboInpaint(prompt, maskedDataUrl);

      loadImageToCanvas(item.url);
      clearMask();
      setStatus('Inpaint complete.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(`Inpaint failed: ${msg}`);
    } finally {
      setIsInpainting(false);
    }
  };

  const handleExpandCanvas = (paddingOverride?: number) => {
    const baseCanvas = rasterCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!baseCanvas || !maskCanvas) {
      setStatus('Load an image before expanding.');
      return false;
    }
    const pad = Math.max(0, Math.round(paddingOverride ?? expandPadding));
    if (pad <= 0) {
      setStatus('Padding must be greater than 0.');
      return false;
    }
    const prevWidth = baseCanvas.width;
    const prevHeight = baseCanvas.height;
    if (!prevWidth || !prevHeight) {
      setStatus('Load an image before expanding.');
      return false;
    }
    const nextWidth = prevWidth + pad * 2;
    const nextHeight = prevHeight + pad * 2;

    const temp = document.createElement('canvas');
    temp.width = nextWidth;
    temp.height = nextHeight;
    const tempCtx = temp.getContext('2d');
    if (!tempCtx) return false;
    tempCtx.clearRect(0, 0, nextWidth, nextHeight);
    tempCtx.drawImage(baseCanvas, pad, pad);

    baseCanvas.width = nextWidth;
    baseCanvas.height = nextHeight;
    const baseCtx = baseCanvas.getContext('2d');
    if (!baseCtx) return false;
    baseCtx.clearRect(0, 0, nextWidth, nextHeight);
    baseCtx.drawImage(temp, 0, 0);

    maskCanvas.width = nextWidth;
    maskCanvas.height = nextHeight;
    const maskCtx = maskCanvas.getContext('2d');
    if (maskCtx) {
      maskCtx.clearRect(0, 0, nextWidth, nextHeight);
      maskCtx.fillStyle = 'rgba(239, 68, 68, 0.6)';
      maskCtx.fillRect(0, 0, nextWidth, nextHeight);
      maskCtx.clearRect(pad, pad, prevWidth, prevHeight);
    }

    setCanvasSize({ width: nextWidth, height: nextHeight });
    setCropRect({ x: 0, y: 0, width: nextWidth, height: nextHeight });
    setAdjustments(DEFAULT_ADJUSTMENTS);
    setMaskHasPaint(true);
    maskPaintedRef.current = true;
    setStatus('Canvas expanded. Run inpaint to fill the new area.');
    return true;
  };

  const handleExpandAndInpaint = async () => {
    if (isInpainting) return;
    const expanded = handleExpandCanvas();
    if (!expanded) return;
    await handleInpaint(expandPrompt || 'Extend the scene naturally.');
  };

  const applyAdjustments = () => {
    const canvas = rasterCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const offscreen = document.createElement('canvas');
    offscreen.width = canvas.width;
    offscreen.height = canvas.height;
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return;

    offCtx.putImageData(snapshot, 0, 0);
    offCtx.filter = filterStyle;
    const filtered = document.createElement('canvas');
    filtered.width = canvas.width;
    filtered.height = canvas.height;
    const filteredCtx = filtered.getContext('2d');
    if (!filteredCtx) return;
    filteredCtx.filter = filterStyle;
    filteredCtx.drawImage(offscreen, 0, 0);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(filtered, 0, 0);
    setAdjustments(DEFAULT_ADJUSTMENTS);
  };

  const applyCrop = () => {
    const canvas = rasterCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y, width, height } = cropRect;
    if (width <= 0 || height <= 0) return;

    const snapshot = ctx.getImageData(x, y, width, height);
    canvas.width = width;
    canvas.height = height;
    ctx.putImageData(snapshot, 0, 0);
    setCanvasSize({ width, height });
    setCropRect({ x: 0, y: 0, width, height });
    clearMask();
  };

  const exportToMedia = () => {
    if (!rasterCanvasRef.current) return;
    const baseCanvas = rasterCanvasRef.current;

    const output = document.createElement('canvas');
    output.width = baseCanvas.width;
    output.height = baseCanvas.height;
    const ctx = output.getContext('2d');
    if (!ctx) return;

    ctx.filter = filterStyle;
    ctx.drawImage(baseCanvas, 0, 0);
    ctx.filter = 'none';

    textLayers.forEach((layer) => {
      if (!layer.visible) return;
      ctx.globalAlpha = layer.opacity;
      ctx.fillStyle = layer.color;
      ctx.font = `${layer.fontSize}px sans-serif`;
      ctx.textBaseline = 'top';
      const x = layer.x * output.width;
      const y = layer.y * output.height;
      ctx.fillText(layer.text, x, y);
    });
    ctx.globalAlpha = 1;

    const url = output.toDataURL('image/png');
    const item: MediaItem = {
      id: `photo-${Date.now()}`,
      name: `photo_edit_${Date.now()}.png`,
      type: 'image',
      url,
      source: 'generated',
      generatedBy: 'Photo Editor',
    };

    if (onAddGeneratedMedia) onAddGeneratedMedia(item);
    setStatus('Saved to Media Bin.');
  };

  const selectedLayer = textLayers.find((layer) => layer.id === selectedLayerId) || null;

  const updateSelectedLayer = (updates: Partial<TextLayer>) => {
    if (!selectedLayer) return;
    setTextLayers((prev) => prev.map((layer) => layer.id === selectedLayer.id ? { ...layer, ...updates } : layer));
  };

  const handleLayerDrag = (event: React.PointerEvent, layer: TextLayer) => {
    event.preventDefault();
    event.stopPropagation();

    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();

    const move = (moveEvent: PointerEvent) => {
      const x = (moveEvent.clientX - rect.left) / rect.width;
      const y = (moveEvent.clientY - rect.top) / rect.height;
      setTextLayers((prev) =>
        prev.map((l) => l.id === layer.id ? { ...l, x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) } : l),
      );
    };

    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  return (
    <div className="studio-workspace h-full w-full bg-gray-900 text-white flex flex-col">
      <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold">Photo Studio</h2>
          <span className="text-xs text-gray-400">Brush, lasso, stamp, neural filters, inpaint</span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
          />
          <button onClick={handleUploadClick} className="bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg text-sm">Upload Image</button>
          <button onClick={exportToMedia} className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg text-sm">Save to Media Bin</button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-64 border-r border-gray-800 p-4 space-y-4 overflow-y-auto">
          <div>
            <h3 className="text-xs uppercase text-gray-400 font-semibold mb-2">Tools</h3>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setTool('brush')} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${tool === 'brush' ? 'bg-indigo-600' : 'bg-gray-800 hover:bg-gray-700'}`}>
                <BrushIcon className="w-4 h-4" /> Brush
              </button>
              <button onClick={() => setTool('lasso')} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${tool === 'lasso' ? 'bg-indigo-600' : 'bg-gray-800 hover:bg-gray-700'}`}>
                <MagicWandIcon className="w-4 h-4" /> Lasso
              </button>
              <button onClick={() => setTool('stamp')} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${tool === 'stamp' || tool === 'clone' ? 'bg-indigo-600' : 'bg-gray-800 hover:bg-gray-700'}`}>
                <LayersIcon className="w-4 h-4" /> Stempel
              </button>
              <button onClick={() => setTool('text')} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${tool === 'text' ? 'bg-indigo-600' : 'bg-gray-800 hover:bg-gray-700'}`}>
                <TextIcon className="w-4 h-4" /> Text
              </button>
            </div>
            <div className="mt-3 rounded-lg bg-indigo-900/20 border border-indigo-500/20 p-2 text-[10px] text-indigo-200/70">
              <span className="font-bold text-indigo-300">Tip:</span> {TOOL_HINTS[tool]}
            </div>
          </div>

          <div>
            <h3 className="text-xs uppercase text-gray-400 font-semibold mb-2">Mask</h3>
            <div className="flex items-center gap-2">
              <button onClick={() => setMaskMode('paint')} className={`px-3 py-2 rounded-lg text-xs ${maskMode === 'paint' ? 'bg-indigo-600' : 'bg-gray-800 hover:bg-gray-700'}`}>
                Paint
              </button>
              <button onClick={() => setMaskMode('erase')} className={`px-3 py-2 rounded-lg text-xs ${maskMode === 'erase' ? 'bg-indigo-600' : 'bg-gray-800 hover:bg-gray-700'}`}>
                Erase
              </button>
            </div>
            <div className="mt-3">
              <label className="block text-xs text-gray-400 mb-1 flex justify-between">Brush Size <span className="text-gray-500">{brushSize}px</span></label>
              <input type="range" min="4" max="80" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-full" />
            </div>
            <button onClick={clearMask} className="mt-3 text-xs text-red-400 hover:text-red-300">Clear Mask</button>
          </div>

          <div>
            <h3 className="text-xs uppercase text-gray-400 font-semibold mb-2">Inpaint</h3>
            <textarea
              value={inpaintPrompt}
              onChange={(e) => setInpaintPrompt(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-xs"
              rows={3}
              placeholder="Describe what to generate..."
            />
            <div className="mt-2 flex flex-col gap-2">
              <select
                value={inpaintModel}
                onChange={(e) => setInpaintModel(e.target.value as any)}
                className="bg-gray-800 border border-gray-700 rounded-lg p-2 text-xs"
              >
                <option value="nano-banana-pro">Nano Banana Pro</option>
                <option value="nano-banana-2-fal">Nano Banana 2 Edit (FAL)</option>
                <option value="flux-2-pro">Flux 2 Pro</option>
                <option value="z-turbo-inpaint">Z-Turbo Inpaint</option>
              </select>
              {inpaintModel === 'z-turbo-inpaint' ? (
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-2 text-xs text-gray-300">
                  Resolution: Auto
                </div>
              ) : (
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value as any)}
                  className="bg-gray-800 border border-gray-700 rounded-lg p-2 text-xs"
                >
                  {inpaintModel === 'nano-banana-pro' || inpaintModel === 'nano-banana-2-fal' ? (
                    <>
                      <option value="1K">1K</option>
                      <option value="2K">2K</option>
                      <option value="4K">4K</option>
                    </>
                  ) : (
                    <>
                      <option value="match_input_image">Match Input</option>
                      <option value="0.5 MP">0.5 MP</option>
                      <option value="1 MP">1 MP</option>
                      <option value="2 MP">2 MP</option>
                      <option value="4 MP">4 MP</option>
                    </>
                  )}
                </select>
              )}
              <button
                onClick={() => handleInpaint()}
                disabled={isInpainting}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-semibold py-2 rounded-lg"
              >
                {isInpainting ? 'Inpainting...' : 'Inpaint Selection'}
              </button>
              <button
                onClick={() => handleInpaint('Reconstruct the masked area seamlessly.')}
                disabled={isInpainting}
                className="bg-gray-800 hover:bg-gray-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-semibold py-2 rounded-lg"
              >
                Heal Selection
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-xs uppercase text-gray-400 font-semibold mb-2">Image Expand</h3>
            <label className="block text-xs text-gray-400 mb-1">Padding (px)</label>
            <input
              type="number"
              value={expandPadding}
              onChange={(e) => setExpandPadding(Number(e.target.value))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-xs"
              min={0}
            />
            <textarea
              value={expandPrompt}
              onChange={(e) => setExpandPrompt(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-xs mt-2"
              rows={2}
              placeholder="Describe how to extend the scene..."
            />
            <div className="mt-2 flex flex-col gap-2">
              <button
                onClick={() => handleExpandCanvas()}
                disabled={isInpainting}
                className="bg-gray-800 hover:bg-gray-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-semibold py-2 rounded-lg"
              >
                Expand Canvas
              </button>
              <button
                onClick={handleExpandAndInpaint}
                disabled={isInpainting}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-semibold py-2 rounded-lg"
              >
                Expand + Fill
              </button>
            </div>
          </div>

          {status && <p className="text-xs text-gray-400">{status}</p>}
        </div>

        <div className="flex-1 flex items-center justify-center p-6 overflow-auto">
          <div
            ref={viewportRef}
            className="relative w-full max-w-4xl bg-gray-950/60 border border-gray-800 rounded-xl overflow-hidden"
            style={{ aspectRatio: canvasSize.width && canvasSize.height ? `${canvasSize.width}/${canvasSize.height}` : '16/9' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            <canvas
              ref={rasterCanvasRef}
              className="absolute inset-0 w-full h-full"
              style={{ filter: filterStyle }}
            />
            <canvas
              ref={maskCanvasRef}
              className="absolute inset-0 w-full h-full"
            />
            {textLayers.map((layer) => (
              layer.visible ? (
                <div
                  key={layer.id}
                  className={`absolute cursor-move ${selectedLayerId === layer.id ? 'outline outline-1 outline-indigo-400' : ''}`}
                  style={{
                    left: `${layer.x * 100}%`,
                    top: `${layer.y * 100}%`,
                    transform: 'translate(-50%, -50%)',
                    color: layer.color,
                    fontSize: `${layer.fontSize}px`,
                    opacity: layer.opacity,
                  }}
                  onPointerDown={(e) => {
                    setSelectedLayerId(layer.id);
                    handleLayerDrag(e, layer);
                  }}
                >
                  {layer.text}
                </div>
              ) : null
            ))}
            {!canvasSize.width && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
                Upload an image to start editing.
              </div>
            )}
          </div>
        </div>

        <div className="w-72 border-l border-gray-800 p-4 space-y-4 overflow-y-auto">
          <div>
            <h3 className="text-xs uppercase text-gray-400 font-semibold mb-2">Layers</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2 text-xs">
                <span>Base Image</span>
                <span className="text-gray-400">Raster</span>
              </div>
              {textLayers.map((layer) => (
                <button
                  key={layer.id}
                  onClick={() => setSelectedLayerId(layer.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs ${selectedLayerId === layer.id ? 'bg-indigo-600' : 'bg-gray-800 hover:bg-gray-700'}`}
                >
                  {layer.text || 'Text Layer'}
                </button>
              ))}
            </div>
            <button
              onClick={() => setTool('text')}
              className="mt-3 w-full bg-gray-800 hover:bg-gray-700 text-xs py-2 rounded-lg"
            >
              Add Text Layer
            </button>
          </div>

          {selectedLayer && (
            <div>
              <h3 className="text-xs uppercase text-gray-400 font-semibold mb-2">Text Properties</h3>
              <div className="space-y-2">
                <input
                  type="text"
                  value={selectedLayer.text}
                  onChange={(e) => updateSelectedLayer({ text: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-xs"
                />
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={selectedLayer.color}
                    onChange={(e) => updateSelectedLayer({ color: e.target.value })}
                    className="w-10 h-8 bg-transparent"
                  />
                  <input
                    type="number"
                    value={selectedLayer.fontSize}
                    onChange={(e) => updateSelectedLayer({ fontSize: Number(e.target.value) })}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg p-2 text-xs"
                    min={8}
                    max={200}
                  />
                </div>
                <label className="text-xs text-gray-400">Opacity</label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={selectedLayer.opacity}
                  onChange={(e) => updateSelectedLayer({ opacity: Number(e.target.value) })}
                  className="w-full"
                />
                <button
                  onClick={() => updateSelectedLayer({ visible: !selectedLayer.visible })}
                  className="w-full bg-gray-800 hover:bg-gray-700 text-xs py-2 rounded-lg"
                >
                  {selectedLayer.visible ? 'Hide Layer' : 'Show Layer'}
                </button>
              </div>
            </div>
          )}

          <div>
            <h3 className="text-xs uppercase text-gray-400 font-semibold mb-2">Adjustments</h3>
            <div className="space-y-2">
              {Object.entries(adjustments).map(([key, value]) => {
                const config = ADJUSTMENT_CONFIG[key];
                if (!config) return null;
                return (
                  <div key={key}>
                    <label className="text-xs text-gray-400">{config.label}</label>
                    <input
                      type="range"
                      min={config.min}
                      max={config.max}
                      value={value}
                      onChange={(e) => setAdjustments((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                      className="w-full"
                    />
                  </div>
                );
              })}
              <div className="flex gap-2">
                <button onClick={applyAdjustments} className="flex-1 bg-gray-800 hover:bg-gray-700 text-xs py-2 rounded-lg">Apply</button>
                <button
                  onClick={() => setAdjustments(DEFAULT_ADJUSTMENTS)}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-xs py-2 rounded-lg"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-xs uppercase text-gray-400 font-semibold mb-2">Neural Filters (Beta)</h3>
            <div className="space-y-3 bg-gray-800/60 border border-gray-700 rounded-lg p-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block flex justify-between">
                  Intensity <span className="text-gray-500">{neuralIntensity}%</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={neuralIntensity}
                  onChange={(e) => setNeuralIntensity(Number(e.target.value))}
                  className="w-full"
                />
              </div>

              <input
                type="file"
                accept="image/*"
                ref={neuralRefInputRef}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  void handleNeuralReferenceSelect(file);
                  e.currentTarget.value = '';
                }}
              />

              <div className="grid grid-cols-1 gap-2">
                {NEURAL_PRESETS.filter((preset) => preset.id !== 'custom_prompt').map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => applyNeuralPreset(preset)}
                    disabled={isApplyingNeural}
                    className="w-full text-left bg-gray-900 hover:bg-gray-700 disabled:opacity-60 disabled:cursor-not-allowed border border-gray-700 rounded-lg px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-white">{preset.label}</span>
                      {preset.requiresReference ? <span className="text-[10px] text-amber-300">ref</span> : null}
                    </div>
                    <p className="text-[10px] text-gray-400 mt-0.5">{preset.description}</p>
                  </button>
                ))}
              </div>

              <div className="pt-2 border-t border-gray-700">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-gray-300">Harmonize Reference</span>
                  <button
                    onClick={() => neuralRefInputRef.current?.click()}
                    className="text-[10px] bg-gray-900 hover:bg-gray-700 border border-gray-700 rounded px-2 py-1"
                  >
                    {neuralReference ? 'Change' : 'Upload'}
                  </button>
                </div>
                {neuralReference ? (
                  <div className="mt-2 flex items-center gap-2">
                    <img src={neuralReference.url} alt="Neural reference" className="w-12 h-12 rounded object-cover border border-gray-700" />
                    <div className="min-w-0">
                      <p className="text-[10px] text-gray-300 truncate">{neuralReference.file.name}</p>
                      <button
                        onClick={() => setNeuralReference(null)}
                        className="text-[10px] text-red-300 hover:text-red-200"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-[10px] text-gray-500">Needed for Harmonize.</p>
                )}
              </div>

              <div className="pt-2 border-t border-gray-700">
                <label className="text-[11px] text-gray-300 block mb-1">Custom AI Grade Prompt</label>
                <textarea
                  value={neuralPrompt}
                  onChange={(e) => setNeuralPrompt(e.target.value)}
                  rows={2}
                  className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-[11px]"
                  placeholder="e.g. Match daylight tones, reduce green cast, preserve skin detail."
                />
                <button
                  onClick={() => applyNeuralPreset(NEURAL_PRESETS.find((preset) => preset.id === 'custom_prompt')!)}
                  disabled={isApplyingNeural || !neuralPrompt.trim()}
                  className="mt-2 w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-semibold py-2 rounded-lg"
                >
                  {isApplyingNeural ? 'Applying...' : 'Apply Custom Neural Grade'}
                </button>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-xs uppercase text-gray-400 font-semibold mb-2">Crop</h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <input
                type="number"
                value={cropRect.x}
                onChange={(e) => setCropRect((prev) => ({ ...prev, x: Number(e.target.value) }))}
                className="bg-gray-800 border border-gray-700 rounded-lg p-2"
                placeholder="X"
              />
              <input
                type="number"
                value={cropRect.y}
                onChange={(e) => setCropRect((prev) => ({ ...prev, y: Number(e.target.value) }))}
                className="bg-gray-800 border border-gray-700 rounded-lg p-2"
                placeholder="Y"
              />
              <input
                type="number"
                value={cropRect.width}
                onChange={(e) => setCropRect((prev) => ({ ...prev, width: Number(e.target.value) }))}
                className="bg-gray-800 border border-gray-700 rounded-lg p-2"
                placeholder="Width"
              />
              <input
                type="number"
                value={cropRect.height}
                onChange={(e) => setCropRect((prev) => ({ ...prev, height: Number(e.target.value) }))}
                className="bg-gray-800 border border-gray-700 rounded-lg p-2"
                placeholder="Height"
              />
            </div>
            <div className="mt-2 flex gap-2">
              <button onClick={applyCrop} className="flex-1 bg-gray-800 hover:bg-gray-700 text-xs py-2 rounded-lg">Apply</button>
              <button
                onClick={() => setCropRect({ x: 0, y: 0, width: canvasSize.width, height: canvasSize.height })}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-xs py-2 rounded-lg"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PhotoWorkspace;
