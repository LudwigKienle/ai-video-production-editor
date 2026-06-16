import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MediaItem } from '../types';
import { inpaintWithNanoBanana, inpaintWithFlux2Pro } from '../services/replicateService';
import { BrushIcon, TextIcon, LayersIcon, MagicWandIcon } from '../components/icons';

interface PhotoWorkspaceProps {
  onAddGeneratedMedia?: (item: MediaItem) => void;
}

type ToolMode = 'brush' | 'lasso' | 'clone' | 'text';

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
};

const TOOL_HINTS: Record<ToolMode, string> = {
  brush: 'Paint areas to inpaint or heal.',
  lasso: 'Drag to outline a region.',
  clone: 'Alt-click to set a source, then paint to clone.',
  text: 'Click on the canvas to add a text layer.',
};

const PhotoWorkspace: React.FC<PhotoWorkspaceProps> = ({ onAddGeneratedMedia }) => {
  const rasterCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [tool, setTool] = useState<ToolMode>('brush');
  const [maskMode, setMaskMode] = useState<'paint' | 'erase'>('paint');
  const [brushSize, setBrushSize] = useState(24);
  const [maskHasPaint, setMaskHasPaint] = useState(false);
  const [inpaintPrompt, setInpaintPrompt] = useState('');
  const [inpaintModel, setInpaintModel] = useState<'nano-banana-pro' | 'flux-2-pro'>('nano-banana-pro');
  const [resolution, setResolution] = useState<'1K' | '2K' | '4K' | 'match_input_image' | '0.5 MP' | '1 MP' | '2 MP' | '4 MP'>('2K');
  const [isInpainting, setIsInpainting] = useState(false);
  const [status, setStatus] = useState<string>('');

  const [adjustments, setAdjustments] = useState(DEFAULT_ADJUSTMENTS);
  const [cropRect, setCropRect] = useState({ x: 0, y: 0, width: 0, height: 0 });

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
    setResolution(inpaintModel === 'nano-banana-pro' ? '2K' : 'match_input_image');
  }, [inpaintModel]);

  const filterStyle = useMemo(() => {
    return `brightness(${adjustments.brightness}%) contrast(${adjustments.contrast}%) saturate(${adjustments.saturate}%) hue-rotate(${adjustments.hue}deg)`;
  }, [adjustments]);

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

  const handleFileSelect = (file: File) => {
    const url = URL.createObjectURL(file);
    loadImageToCanvas(url);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
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
      setStatus('Clone source set.');
      return;
    }

    if (!cloneSourceRef.current) {
      setStatus('Alt-click to set a clone source.');
      return;
    }

    cloneOffsetRef.current = {
      x: point.x - cloneSourceRef.current.x,
      y: point.y - cloneSourceRef.current.y,
    };
    isDrawingRef.current = true;
    activeToolRef.current = 'clone';
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
    } else if (tool === 'clone') {
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
    } else if (activeToolRef.current === 'clone') {
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
    if (!maskHasPaint) {
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
        : await inpaintWithFlux2Pro(prompt, maskedDataUrl, resolution as 'match_input_image' | '0.5 MP' | '1 MP' | '2 MP' | '4 MP');

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
    <div className="h-full w-full bg-gray-900 text-white flex flex-col">
      <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold">Photo Studio</h2>
          <span className="text-xs text-gray-400">Brush, lasso, layers, inpaint</span>
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
              <button onClick={() => setTool('clone')} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${tool === 'clone' ? 'bg-indigo-600' : 'bg-gray-800 hover:bg-gray-700'}`}>
                <LayersIcon className="w-4 h-4" /> Clone
              </button>
              <button onClick={() => setTool('text')} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${tool === 'text' ? 'bg-indigo-600' : 'bg-gray-800 hover:bg-gray-700'}`}>
                <TextIcon className="w-4 h-4" /> Text
              </button>
            </div>
            <div className="mt-3 rounded-lg bg-gray-900/60 border border-gray-800 p-2 text-[10px] text-gray-400">
              Tip: {TOOL_HINTS[tool]}
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
              <label className="block text-xs text-gray-400 mb-1">Brush Size</label>
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
                <option value="flux-2-pro">Flux 2 Pro</option>
              </select>
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value as any)}
                className="bg-gray-800 border border-gray-700 rounded-lg p-2 text-xs"
              >
                {inpaintModel === 'nano-banana-pro' ? (
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
              {Object.entries(adjustments).map(([key, value]) => (
                <div key={key}>
                  <label className="text-xs text-gray-400 capitalize">{key}</label>
                  <input
                    type="range"
                    min={key === 'hue' ? -180 : 50}
                    max={key === 'hue' ? 180 : 150}
                    value={value}
                    onChange={(e) => setAdjustments((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                    className="w-full"
                  />
                </div>
              ))}
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
