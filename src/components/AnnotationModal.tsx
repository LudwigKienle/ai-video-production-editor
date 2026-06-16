import React, { useEffect, useRef, useState } from 'react';

type AnnotationTool = 'pen' | 'rect' | 'circle' | 'arrow' | 'text';

interface AnnotationModalProps {
  isOpen: boolean;
  title: string;
  imageUrl: string;
  initialMarkupUrl?: string | null;
  onClose: () => void;
  onSave: (dataUrl: string) => void;
}

const TOOL_OPTIONS: Array<{ id: AnnotationTool; label: string }> = [
  { id: 'pen', label: 'Freehand' },
  { id: 'rect', label: 'Box' },
  { id: 'circle', label: 'Circle' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'text', label: 'Text' },
];

const COLOR_OPTIONS = ['#f87171', '#fbbf24', '#22c55e', '#38bdf8', '#ffffff'];

const fitToBounds = (width: number, height: number, maxWidth: number, maxHeight: number) => {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

const AnnotationModal: React.FC<AnnotationModalProps> = ({
  isOpen,
  title,
  imageUrl,
  initialMarkupUrl,
  onClose,
  onSave,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snapshotRef = useRef<ImageData | null>(null);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const baseImageRef = useRef<HTMLImageElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState<AnnotationTool>('pen');
  const [color, setColor] = useState(COLOR_OPTIONS[0]);
  const [lineWidth, setLineWidth] = useState(4);
  const [textValue, setTextValue] = useState('Change this');
  const [textSize, setTextSize] = useState(24);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setIsReady(false);
    const baseUrl = initialMarkupUrl || imageUrl;
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { width, height } = fitToBounds(img.naturalWidth, img.naturalHeight, 1600, 900);
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      baseImageRef.current = img;
      setIsReady(true);
    };
    img.src = baseUrl;
  }, [isOpen, imageUrl, initialMarkupUrl]);

  const getCanvasPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  };

  const applyStrokeStyle = (ctx: CanvasRenderingContext2D) => {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };

  const drawArrow = (ctx: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }) => {
    const headLength = Math.max(10, lineWidth * 2.5);
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - headLength * Math.cos(angle - Math.PI / 6), to.y - headLength * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(to.x - headLength * Math.cos(angle + Math.PI / 6), to.y - headLength * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  };

  const drawShape = (ctx: CanvasRenderingContext2D, start: { x: number; y: number }, end: { x: number; y: number }) => {
    if (tool === 'rect') {
      ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
      return;
    }
    if (tool === 'circle') {
      const radius = Math.hypot(end.x - start.x, end.y - start.y);
      ctx.beginPath();
      ctx.arc(start.x, start.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    if (tool === 'arrow') {
      drawArrow(ctx, start, end);
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isReady) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const point = getCanvasPoint(event);
    applyStrokeStyle(ctx);
    if (tool === 'text') {
      ctx.font = `${textSize}px "DM Sans", sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(textValue || 'Note', point.x, point.y);
      return;
    }
    setIsDrawing(true);
    startPointRef.current = point;
    if (tool === 'pen') {
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      return;
    }
    snapshotRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    event.preventDefault();
    const point = getCanvasPoint(event);
    applyStrokeStyle(ctx);
    if (tool === 'pen') {
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      return;
    }
    if (!startPointRef.current || !snapshotRef.current) return;
    ctx.putImageData(snapshotRef.current, 0, 0);
    drawShape(ctx, startPointRef.current, point);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    event.preventDefault();
    const point = getCanvasPoint(event);
    applyStrokeStyle(ctx);
    if (tool !== 'pen' && startPointRef.current && snapshotRef.current) {
      ctx.putImageData(snapshotRef.current, 0, 0);
      drawShape(ctx, startPointRef.current, point);
    }
    setIsDrawing(false);
    startPointRef.current = null;
    snapshotRef.current = null;
  };

  const handleReset = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const baseImage = baseImageRef.current;
    if (!canvas || !ctx || !baseImage) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height);
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onSave(canvas.toDataURL('image/png'));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-6">
      <div className="app-card flex h-[80vh] w-full max-w-6xl overflow-hidden">
        <div className="flex flex-1 items-center justify-center bg-black p-4">
          <canvas
            ref={canvasRef}
            className="max-h-full max-w-full rounded-lg border border-slate-600/40 bg-black touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          />
        </div>
        <div className="w-72 border-l border-slate-700/50 bg-slate-900/80 p-4 text-sm text-slate-200">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Director Markup</div>
            <button className="text-xs text-slate-300 hover:text-white" onClick={onClose}>
              Close
            </button>
          </div>
          <h3 className="mt-2 text-base font-semibold">{title}</h3>
          <div className="mt-4 space-y-3">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Tools</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {TOOL_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    className={`rounded border px-2 py-1 text-xs ${tool === option.id ? 'border-sky-400/60 bg-sky-400/10 text-sky-200' : 'border-slate-600/40 text-slate-300'}`}
                    onClick={() => setTool(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Color</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {COLOR_OPTIONS.map((option) => (
                  <button
                    key={option}
                    className={`h-6 w-6 rounded-full border ${color === option ? 'border-white' : 'border-slate-600/40'}`}
                    style={{ backgroundColor: option }}
                    onClick={() => setColor(option)}
                    aria-label={`Pick ${option}`}
                  />
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Stroke</div>
              <input
                type="range"
                min={2}
                max={14}
                value={lineWidth}
                onChange={(e) => setLineWidth(Number(e.target.value))}
                className="mt-2 w-full"
              />
            </div>
            {tool === 'text' && (
              <div className="space-y-2">
                <input
                  className="app-input text-xs"
                  value={textValue}
                  onChange={(e) => setTextValue(e.target.value)}
                  placeholder="Annotation text"
                />
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Text Size</div>
                  <input
                    type="range"
                    min={12}
                    max={48}
                    value={textSize}
                    onChange={(e) => setTextSize(Number(e.target.value))}
                    className="mt-2 w-full"
                  />
                </div>
              </div>
            )}
          </div>
          <div className="mt-6 flex flex-col gap-2">
            <button className="app-button border border-slate-500/40" onClick={handleReset}>
              Reset Markup
            </button>
            <button className="app-button border border-slate-500/40" onClick={handleSave}>
              Save Markup
            </button>
          </div>
          <p className="mt-4 text-xs text-slate-400">
            Markups are saved as assets for the artist and attached to this shot.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AnnotationModal;
