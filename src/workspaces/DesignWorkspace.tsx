import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DesignCanvasElement,
  DesignCanvasPreset,
  DesignCanvasState,
  MediaItem,
} from '../types';
import {
  DESIGN_CANVAS_PRESETS,
  addDesignElement,
  createDefaultDesignState,
  duplicateDesignElement,
  moveDesignElementLayer,
  normalizeDesignState,
  removeDesignElement,
  resizeDesignCanvas,
  updateDesignElement,
} from '../utils/designCanvas';
import {
  AddIcon,
  DownloadIcon,
  LayersIcon,
  SparklesIcon,
  TextIcon,
  TrashIcon,
} from '../components/icons';

interface DesignWorkspaceProps {
  designState: DesignCanvasState | null;
  onChange: (state: DesignCanvasState) => void;
  mediaItems: MediaItem[];
  projectName?: string | null;
  apiKeyReady?: boolean;
  onAddGeneratedMedia: (item: MediaItem) => void;
  onExportDesign: (dataUrl: string, name: string, sendToTimeline?: boolean) => void;
  onGenerateImage?: (prompt: string, aspectRatio: '1:1' | '16:9' | '9:16' | '3:4') => Promise<MediaItem>;
}

type CanvasAction = {
  id: string;
  mode: 'move' | 'resize';
  startClientX: number;
  startClientY: number;
  element: DesignCanvasElement;
};

const PRESET_ORDER: DesignCanvasPreset[] = ['16:9', '9:16', '1:1', '4:5'];

const safeFileName = (value: string) =>
  value
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_.-]/gi, '')
    .replace(/^_+|_+$/g, '')
    || 'design';

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load image layer.'));
    image.src = url;
  });

const drawRoundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) => {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
};

const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
  const explicitLines = text.split('\n');
  const lines: string[] = [];
  explicitLines.forEach((line) => {
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      return;
    }
    let current = words[0];
    words.slice(1).forEach((word) => {
      const candidate = `${current} ${word}`;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    });
    lines.push(current);
  });
  return lines;
};

const renderDesignToPng = async (state: DesignCanvasState, mediaItems: MediaItem[]) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(state.width));
  canvas.height = Math.max(1, Math.round(state.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not initialize export canvas.');

  const mediaById = new Map(mediaItems.map((item) => [item.id, item]));
  ctx.fillStyle = state.background || '#111827';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const elements = [...state.elements]
    .filter((element) => element.visible !== false)
    .sort((a, b) => a.zIndex - b.zIndex);

  for (const element of elements) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, element.opacity ?? 1));
    ctx.translate(element.x + element.width / 2, element.y + element.height / 2);
    ctx.rotate(((element.rotation || 0) * Math.PI) / 180);

    if (element.type === 'shape') {
      ctx.fillStyle = element.fill || '#2563EB';
      ctx.strokeStyle = element.stroke || 'transparent';
      ctx.lineWidth = element.strokeWidth || 0;
      if (element.shape === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(0, 0, element.width / 2, element.height / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        if ((element.strokeWidth || 0) > 0) ctx.stroke();
      } else {
        drawRoundedRect(ctx, -element.width / 2, -element.height / 2, element.width, element.height, element.borderRadius || 0);
        ctx.fill();
        if ((element.strokeWidth || 0) > 0) ctx.stroke();
      }
    }

    if (element.type === 'image') {
      const media = element.mediaId ? mediaById.get(element.mediaId) : null;
      const url = media?.url || element.imageUrl;
      if (url) {
        const image = await loadImage(url);
        const scale = Math.max(element.width / image.width, element.height / image.height);
        const drawWidth = image.width * scale;
        const drawHeight = image.height * scale;
        ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      }
    }

    if (element.type === 'text') {
      const fontWeight = element.fontWeight || 'bold';
      const fontSize = Math.max(8, element.fontSize || 72);
      ctx.font = `${fontWeight} ${fontSize}px ${element.fontFamily || 'Arial, sans-serif'}`;
      ctx.fillStyle = element.color || '#FFFFFF';
      ctx.textAlign = element.textAlign || 'center';
      ctx.textBaseline = 'middle';
      const lines = wrapText(ctx, element.text || '', element.width);
      const lineHeight = fontSize * 1.12;
      const totalHeight = lineHeight * lines.length;
      const x = element.textAlign === 'left' ? -element.width / 2 : element.textAlign === 'right' ? element.width / 2 : 0;
      lines.forEach((line, index) => {
        ctx.fillText(line, x, -totalHeight / 2 + lineHeight * index + lineHeight / 2);
      });
    }

    ctx.restore();
  }

  return canvas.toDataURL('image/png');
};

const getGenerationAspectRatio = (preset: DesignCanvasPreset): '1:1' | '16:9' | '9:16' | '3:4' => {
  if (preset === '4:5') return '3:4';
  return preset;
};

const DesignWorkspace: React.FC<DesignWorkspaceProps> = ({
  designState,
  onChange,
  mediaItems,
  projectName,
  apiKeyReady,
  onAddGeneratedMedia,
  onExportDesign,
  onGenerateImage,
}) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const design = useMemo(() => normalizeDesignState(designState), [designState]);
  const designRef = useRef(design);
  const [stageScale, setStageScale] = useState(1);
  const [action, setAction] = useState<CanvasAction | null>(null);
  const [aiPrompt, setAiPrompt] = useState('cinematic product background, clean negative space, premium lighting');
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    designRef.current = design;
  }, [design]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const updateScale = () => {
      const rect = stage.getBoundingClientRect();
      setStageScale(rect.width > 0 ? rect.width / Math.max(1, design.width) : 1);
    };
    updateScale();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateScale) : null;
    observer?.observe(stage);
    window.addEventListener('resize', updateScale);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateScale);
    };
  }, [design.width]);

  useEffect(() => {
    if (!designState) {
      onChange(createDefaultDesignState('16:9'));
    }
  }, [designState, onChange]);

  const imageAssets = useMemo(
    () => mediaItems.filter((item) => item.type === 'image'),
    [mediaItems],
  );

  const selectedElement = useMemo(
    () => design.elements.find((element) => element.id === design.selectedElementId) || null,
    [design.elements, design.selectedElementId],
  );

  const setDesign = (updater: (current: DesignCanvasState) => DesignCanvasState) => {
    onChange(updater(normalizeDesignState(designRef.current)));
  };

  const selectElement = (id: string | null) => {
    onChange({ ...design, selectedElementId: id, updatedAt: new Date().toISOString() });
  };

  const addText = () => {
    setDesign((current) => addDesignElement(current, {
      type: 'text',
      name: 'Headline',
      text: 'Your title',
      x: Math.round(current.width * 0.18),
      y: Math.round(current.height * 0.42),
      width: Math.round(current.width * 0.64),
    }));
  };

  const addShape = (shape: 'rect' | 'ellipse') => {
    setDesign((current) => addDesignElement(current, {
      type: 'shape',
      name: shape === 'ellipse' ? 'Ellipse' : 'Rectangle',
      shape,
      x: Math.round(current.width * 0.34),
      y: Math.round(current.height * 0.36),
      width: Math.round(current.width * 0.32),
      height: Math.round(current.height * 0.18),
      fill: shape === 'ellipse' ? '#F97316' : '#2563EB',
      borderRadius: shape === 'ellipse' ? 999 : 16,
    }));
  };

  const addImageAsset = (item: MediaItem) => {
    setDesign((current) => addDesignElement(current, {
      type: 'image',
      name: item.name || 'Image',
      mediaId: item.id,
      imageUrl: item.url,
      x: Math.round(current.width * 0.28),
      y: Math.round(current.height * 0.22),
      width: Math.round(current.width * 0.44),
      height: Math.round(current.height * 0.44),
    }));
  };

  const applyTemplate = (kind: 'title' | 'thumbnail' | 'lower-third') => {
    let next = createDefaultDesignState(design.preset);
    next = { ...next, background: kind === 'thumbnail' ? '#0F172A' : '#111827', name: design.name };
    if (kind === 'thumbnail') {
      next = addDesignElement(next, {
        type: 'shape',
        name: 'Accent panel',
        shape: 'rect',
        x: Math.round(next.width * 0.06),
        y: Math.round(next.height * 0.12),
        width: Math.round(next.width * 0.48),
        height: Math.round(next.height * 0.76),
        fill: '#F97316',
        opacity: 0.92,
        borderRadius: 32,
      });
      next = addDesignElement(next, {
        type: 'text',
        name: 'Thumbnail headline',
        text: 'BIG IDEA',
        x: Math.round(next.width * 0.09),
        y: Math.round(next.height * 0.33),
        width: Math.round(next.width * 0.42),
        height: Math.round(next.height * 0.26),
        fontSize: Math.round(next.width * 0.075),
        textAlign: 'left',
      });
    } else if (kind === 'lower-third') {
      next = addDesignElement(next, {
        type: 'shape',
        name: 'Lower third bar',
        shape: 'rect',
        x: Math.round(next.width * 0.08),
        y: Math.round(next.height * 0.72),
        width: Math.round(next.width * 0.58),
        height: Math.round(next.height * 0.14),
        fill: '#111827',
        opacity: 0.82,
        borderRadius: 18,
      });
      next = addDesignElement(next, {
        type: 'text',
        name: 'Name',
        text: 'Speaker Name',
        x: Math.round(next.width * 0.12),
        y: Math.round(next.height * 0.745),
        width: Math.round(next.width * 0.46),
        height: Math.round(next.height * 0.08),
        fontSize: Math.round(next.width * 0.034),
        textAlign: 'left',
      });
    } else {
      next = addDesignElement(next, {
        type: 'text',
        name: 'Title',
        text: projectName || 'Title Card',
        x: Math.round(next.width * 0.18),
        y: Math.round(next.height * 0.38),
        width: Math.round(next.width * 0.64),
        height: Math.round(next.height * 0.18),
        fontSize: Math.round(next.width * 0.052),
      });
    }
    onChange(next);
  };

  const handlePointerDown = (event: React.PointerEvent, element: DesignCanvasElement, mode: CanvasAction['mode'] = 'move') => {
    event.stopPropagation();
    if (element.locked) {
      selectElement(element.id);
      return;
    }
    setAction({
      id: element.id,
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      element,
    });
    selectElement(element.id);
  };

  useEffect(() => {
    if (!action) return;

    const handleMove = (event: PointerEvent) => {
      const stage = stageRef.current;
      const current = designRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const scaleX = current.width / Math.max(1, rect.width);
      const scaleY = current.height / Math.max(1, rect.height);
      const deltaX = (event.clientX - action.startClientX) * scaleX;
      const deltaY = (event.clientY - action.startClientY) * scaleY;
      if (action.mode === 'resize') {
        onChange(updateDesignElement(current, action.id, {
          width: Math.max(32, Math.round(action.element.width + deltaX)),
          height: Math.max(32, Math.round(action.element.height + deltaY)),
        }));
        return;
      }
      onChange(updateDesignElement(current, action.id, {
        x: Math.round(action.element.x + deltaX),
        y: Math.round(action.element.y + deltaY),
      }));
    };

    const handleUp = () => setAction(null);
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [action, onChange]);

  const updateSelected = (updates: Partial<DesignCanvasElement>) => {
    if (!selectedElement) return;
    setDesign((current) => updateDesignElement(current, selectedElement.id, updates));
  };

  const handleGenerateAsset = async () => {
    const prompt = aiPrompt.trim();
    if (!prompt || !onGenerateImage) return;
    if (apiKeyReady === false) {
      setStatus('Add a Gemini API key first.');
      return;
    }
    setIsGenerating(true);
    setStatus(null);
    try {
      const item = await onGenerateImage(prompt, getGenerationAspectRatio(design.preset));
      onAddGeneratedMedia(item);
      setDesign((current) => addDesignElement(current, {
        type: 'image',
        name: item.name || 'AI asset',
        mediaId: item.id,
        imageUrl: item.url,
        prompt,
        x: Math.round(current.width * 0.18),
        y: Math.round(current.height * 0.14),
        width: Math.round(current.width * 0.64),
        height: Math.round(current.height * 0.58),
      }));
      setStatus('Generated asset added to canvas.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExport = async (sendToTimeline = false) => {
    setIsExporting(true);
    setStatus(null);
    try {
      const dataUrl = await renderDesignToPng(design, mediaItems);
      const name = `${safeFileName(projectName || design.name)}_${design.preset}_${Date.now()}.png`;
      onExportDesign(dataUrl, name, sendToTimeline);
      setStatus(sendToTimeline ? 'Exported PNG and sent it to the timeline.' : 'Exported PNG to the media bin.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsExporting(false);
    }
  };

  const sortedElements = [...design.elements].sort((a, b) => b.zIndex - a.zIndex);
  const stageAspect = `${design.width} / ${design.height}`;

  return (
    <div className="h-full bg-gray-950 text-gray-100 flex flex-col overflow-auto xl:overflow-hidden">
      <div className="border-b border-gray-800 px-4 py-3 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">AI Design Canvas</h2>
          <p className="text-xs text-gray-500 mt-1">Compose thumbnails, title cards, posters, lower thirds, and social covers from generated or library assets.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PRESET_ORDER.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setDesign((current) => resizeDesignCanvas(current, preset))}
              className={`px-3 py-2 rounded-lg border text-xs ${design.preset === preset ? 'border-blue-400 bg-blue-500/20 text-blue-100' : 'border-gray-700 bg-gray-900 text-gray-300 hover:bg-gray-800'}`}
              title={`${DESIGN_CANVAS_PRESETS[preset].label} ${preset}`}
            >
              {preset}
            </button>
          ))}
          <button
            type="button"
            onClick={() => handleExport(false)}
            disabled={isExporting}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-sm"
            title="Export PNG to media bin"
          >
            <DownloadIcon className="w-4 h-4" />
            Export
          </button>
          <button
            type="button"
            onClick={() => handleExport(true)}
            disabled={isExporting}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm font-medium"
            title="Export PNG and add it to the timeline"
          >
            <AddIcon className="w-4 h-4" />
            Timeline
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)_300px] overflow-auto xl:overflow-hidden">
        <aside className="border-b xl:border-b-0 xl:border-r border-gray-800 bg-gray-900/70 overflow-y-auto">
          <div className="p-4 space-y-4">
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs uppercase tracking-widest text-gray-500">Tools</h3>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={addText} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm" title="Add text">
                  <TextIcon className="w-4 h-4" /> Text
                </button>
                <button type="button" onClick={() => addShape('rect')} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm" title="Add rectangle">
                  <AddIcon className="w-4 h-4" /> Rect
                </button>
                <button type="button" onClick={() => addShape('ellipse')} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm" title="Add ellipse">
                  <AddIcon className="w-4 h-4" /> Circle
                </button>
                <button
                  type="button"
                  onClick={() => selectedElement && setDesign((current) => duplicateDesignElement(current, selectedElement.id))}
                  disabled={!selectedElement}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-sm"
                  title="Duplicate selected layer"
                >
                  <LayersIcon className="w-4 h-4" /> Duplicate
                </button>
              </div>
            </section>

            <section>
              <h3 className="text-xs uppercase tracking-widest text-gray-500 mb-2">Templates</h3>
              <div className="space-y-2">
                <button type="button" onClick={() => applyTemplate('title')} className="w-full text-left px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm">Title Card</button>
                <button type="button" onClick={() => applyTemplate('thumbnail')} className="w-full text-left px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm">Thumbnail</button>
                <button type="button" onClick={() => applyTemplate('lower-third')} className="w-full text-left px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm">Lower Third</button>
              </div>
            </section>

            <section>
              <h3 className="text-xs uppercase tracking-widest text-gray-500 mb-2">AI Asset</h3>
              <textarea
                value={aiPrompt}
                onChange={(event) => setAiPrompt(event.target.value)}
                rows={4}
                className="w-full rounded-lg border border-gray-700 bg-gray-950 p-2 text-sm"
              />
              <button
                type="button"
                onClick={handleGenerateAsset}
                disabled={isGenerating || !aiPrompt.trim()}
                className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-sm font-medium"
                title="Generate an image asset and place it on the canvas"
              >
                <SparklesIcon className="w-4 h-4" />
                {isGenerating ? 'Generating...' : 'Generate Layer'}
              </button>
            </section>

            <section>
              <h3 className="text-xs uppercase tracking-widest text-gray-500 mb-2">Project Assets</h3>
              <div className="grid grid-cols-2 gap-2">
                {imageAssets.slice(0, 24).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => addImageAsset(item)}
                    className="group aspect-square rounded-lg overflow-hidden bg-gray-800 border border-gray-700 hover:border-blue-400 relative"
                    title={`Add ${item.name}`}
                  >
                    <img src={item.url} alt={item.name} className="w-full h-full object-cover" />
                    <span className="absolute inset-x-0 bottom-0 bg-black/70 p-1 text-[10px] text-left truncate">{item.name}</span>
                  </button>
                ))}
                {imageAssets.length === 0 && (
                  <div className="col-span-2 rounded-lg border border-dashed border-gray-700 p-4 text-center text-xs text-gray-500">
                    Generated and imported images appear here.
                  </div>
                )}
              </div>
            </section>
          </div>
        </aside>

        <main className="min-w-0 min-h-[420px] xl:min-h-0 bg-gray-950 flex flex-col">
          <div className="px-4 py-2 border-b border-gray-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs text-gray-500">
            <span>{design.width} x {design.height}px</span>
            <span>{status || 'Drag layers on the canvas. Use the corner handle to resize.'}</span>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-4 xl:p-8 flex items-center justify-center">
            <div
              ref={stageRef}
              onPointerDown={() => selectElement(null)}
              className="relative shadow-2xl border border-gray-700 overflow-hidden bg-gray-900"
              style={{
                aspectRatio: stageAspect,
                width: design.preset === '9:16' ? 'min(46vh, 62%)' : 'min(100%, 92vh)',
                maxHeight: '100%',
                background: design.background,
              }}
            >
              {[...design.elements].sort((a, b) => a.zIndex - b.zIndex).map((element) => {
                if (element.visible === false) return null;
                const isSelected = element.id === design.selectedElementId;
                const media = element.mediaId ? mediaItems.find((item) => item.id === element.mediaId) : null;
                return (
                  <div
                    key={element.id}
                    onPointerDown={(event) => handlePointerDown(event, element)}
                    className={`absolute select-none ${element.locked ? 'cursor-default' : 'cursor-move'} ${isSelected ? 'ring-2 ring-blue-400' : ''}`}
                    style={{
                      left: `${(element.x / design.width) * 100}%`,
                      top: `${(element.y / design.height) * 100}%`,
                      width: `${(element.width / design.width) * 100}%`,
                      height: `${(element.height / design.height) * 100}%`,
                      transform: `rotate(${element.rotation || 0}deg)`,
                      opacity: element.opacity ?? 1,
                      zIndex: element.zIndex,
                    }}
                  >
                    {element.type === 'shape' && (
                      <div
                        className="w-full h-full"
                        style={{
                          background: element.fill || '#2563EB',
                          borderRadius: element.shape === 'ellipse' ? '999px' : `${element.borderRadius || 0}px`,
                          border: `${element.strokeWidth || 0}px solid ${element.stroke || 'transparent'}`,
                        }}
                      />
                    )}
                    {element.type === 'image' && (
                      <img
                        src={media?.url || element.imageUrl}
                        alt={element.name}
                        className="w-full h-full object-cover pointer-events-none"
                        draggable={false}
                      />
                    )}
                    {element.type === 'text' && (
                      <div
                        className="w-full h-full overflow-hidden flex items-center whitespace-pre-wrap leading-tight"
                        style={{
                          color: element.color || '#FFFFFF',
                          fontFamily: element.fontFamily || 'Inter, Arial, sans-serif',
                          fontSize: `${Math.max(8, (element.fontSize || 72) * stageScale)}px`,
                          fontWeight: element.fontWeight || 'bold',
                          justifyContent: element.textAlign === 'left' ? 'flex-start' : element.textAlign === 'right' ? 'flex-end' : 'center',
                          textAlign: element.textAlign || 'center',
                        }}
                      >
                        {element.text}
                      </div>
                    )}
                    {isSelected && !element.locked && (
                      <button
                        type="button"
                        onPointerDown={(event) => handlePointerDown(event, element, 'resize')}
                        className="absolute -right-2 -bottom-2 h-4 w-4 rounded-full bg-blue-400 border-2 border-gray-950 cursor-nwse-resize"
                        title="Resize"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </main>

        <aside className="border-t xl:border-t-0 xl:border-l border-gray-800 bg-gray-900/70 overflow-y-auto">
          <div className="p-4 space-y-4">
            <section>
              <h3 className="text-xs uppercase tracking-widest text-gray-500 mb-2">Layers</h3>
              <div className="space-y-2">
                {sortedElements.map((element) => (
                  <button
                    key={element.id}
                    type="button"
                    onClick={() => selectElement(element.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg border ${element.id === design.selectedElementId ? 'border-blue-400 bg-blue-500/15' : 'border-gray-700 bg-gray-800 hover:bg-gray-750'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm truncate">{element.name}</span>
                      <span className="text-[10px] uppercase text-gray-500">{element.type}</span>
                    </div>
                  </button>
                ))}
                {sortedElements.length === 0 && (
                  <div className="rounded-lg border border-dashed border-gray-700 p-4 text-center text-xs text-gray-500">
                    Add text, shapes, AI images, or project assets.
                  </div>
                )}
              </div>
            </section>

            <section>
              <h3 className="text-xs uppercase tracking-widest text-gray-500 mb-2">Inspector</h3>
              {!selectedElement ? (
                <div className="space-y-3">
                  <label className="block text-xs text-gray-400">
                    Background
                    <input
                      type="color"
                      value={design.background}
                      onChange={(event) => onChange({ ...design, background: event.target.value, updatedAt: new Date().toISOString() })}
                      className="mt-2 h-9 w-full rounded bg-gray-800"
                    />
                  </label>
                </div>
              ) : (
                <div className="space-y-3">
                  <label className="block text-xs text-gray-400">
                    Name
                    <input
                      value={selectedElement.name}
                      onChange={(event) => updateSelected({ name: event.target.value })}
                      className="mt-1 w-full rounded border border-gray-700 bg-gray-950 p-2 text-sm text-gray-100"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['x', 'y', 'width', 'height'] as const).map((key) => (
                      <label key={key} className="block text-xs text-gray-400">
                        {key.toUpperCase()}
                        <input
                          type="number"
                          value={Math.round(selectedElement[key])}
                          onChange={(event) => updateSelected({ [key]: Number(event.target.value) } as Partial<DesignCanvasElement>)}
                          className="mt-1 w-full rounded border border-gray-700 bg-gray-950 p-2 text-sm text-gray-100"
                        />
                      </label>
                    ))}
                  </div>
                  <label className="block text-xs text-gray-400">
                    Rotation
                    <input
                      type="range"
                      min="-180"
                      max="180"
                      value={selectedElement.rotation || 0}
                      onChange={(event) => updateSelected({ rotation: Number(event.target.value) })}
                      className="mt-2 w-full"
                    />
                  </label>
                  <label className="block text-xs text-gray-400">
                    Opacity
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={selectedElement.opacity ?? 1}
                      onChange={(event) => updateSelected({ opacity: Number(event.target.value) })}
                      className="mt-2 w-full"
                    />
                  </label>

                  {selectedElement.type === 'text' && (
                    <>
                      <label className="block text-xs text-gray-400">
                        Text
                        <textarea
                          value={selectedElement.text || ''}
                          onChange={(event) => updateSelected({ text: event.target.value })}
                          rows={4}
                          className="mt-1 w-full rounded border border-gray-700 bg-gray-950 p-2 text-sm text-gray-100"
                        />
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block text-xs text-gray-400">
                          Size
                          <input
                            type="number"
                            min="8"
                            value={selectedElement.fontSize || 72}
                            onChange={(event) => updateSelected({ fontSize: Number(event.target.value) })}
                            className="mt-1 w-full rounded border border-gray-700 bg-gray-950 p-2 text-sm text-gray-100"
                          />
                        </label>
                        <label className="block text-xs text-gray-400">
                          Color
                          <input
                            type="color"
                            value={selectedElement.color || '#FFFFFF'}
                            onChange={(event) => updateSelected({ color: event.target.value })}
                            className="mt-1 h-9 w-full rounded bg-gray-800"
                          />
                        </label>
                      </div>
                      <select
                        value={selectedElement.textAlign || 'center'}
                        onChange={(event) => updateSelected({ textAlign: event.target.value as DesignCanvasElement['textAlign'] })}
                        className="w-full rounded border border-gray-700 bg-gray-950 p-2 text-sm"
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </>
                  )}

                  {selectedElement.type === 'shape' && (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-xs text-gray-400">
                        Fill
                        <input
                          type="color"
                          value={selectedElement.fill || '#2563EB'}
                          onChange={(event) => updateSelected({ fill: event.target.value })}
                          className="mt-1 h-9 w-full rounded bg-gray-800"
                        />
                      </label>
                      <label className="block text-xs text-gray-400">
                        Radius
                        <input
                          type="number"
                          min="0"
                          value={selectedElement.borderRadius || 0}
                          onChange={(event) => updateSelected({ borderRadius: Number(event.target.value) })}
                          className="mt-1 w-full rounded border border-gray-700 bg-gray-950 p-2 text-sm text-gray-100"
                        />
                      </label>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setDesign((current) => moveDesignElementLayer(current, selectedElement.id, 'front'))}
                      className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm"
                    >
                      To front
                    </button>
                    <button
                      type="button"
                      onClick={() => setDesign((current) => moveDesignElementLayer(current, selectedElement.id, 'back'))}
                      className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm"
                    >
                      To back
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedElement.visible !== false}
                        onChange={(event) => updateSelected({ visible: event.target.checked })}
                      />
                      Visible
                    </label>
                    <label className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedElement.locked === true}
                        onChange={(event) => updateSelected({ locked: event.target.checked })}
                      />
                      Locked
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDesign((current) => removeDesignElement(current, selectedElement.id))}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-200 text-sm"
                  >
                    <TrashIcon className="w-4 h-4" />
                    Delete layer
                  </button>
                </div>
              )}
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default DesignWorkspace;
