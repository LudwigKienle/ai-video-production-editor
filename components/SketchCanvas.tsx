
import React, { useRef, useEffect, useState } from 'react';
import { TrashIcon } from './icons';

interface SketchCanvasProps {
    width?: number;
    height?: number;
    onSave: (dataUrl: string) => void;
    initialImage?: string;
    className?: string;
}

const SketchCanvas: React.FC<SketchCanvasProps> = ({ width = 320, height = 180, onSave, initialImage, className }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [ctx, setCtx] = useState<CanvasRenderingContext2D | null>(null);
    const [brushSize, setBrushSize] = useState(2);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas) {
            const context = canvas.getContext('2d');
            if (context) {
                context.lineCap = 'round';
                context.lineJoin = 'round';
                context.strokeStyle = 'white';
                context.lineWidth = brushSize;
                setCtx(context);

                // Initialize with black background
                context.fillStyle = '#111827'; // gray-900
                context.fillRect(0, 0, canvas.width, canvas.height);

                if (initialImage) {
                    const img = new Image();
                    img.src = initialImage;
                    img.onload = () => {
                        context.drawImage(img, 0, 0, canvas.width, canvas.height);
                    };
                }
            }
        }
    }, []);

    useEffect(() => {
        if (ctx) ctx.lineWidth = brushSize;
    }, [brushSize, ctx]);

    const getPos = (e: React.MouseEvent | React.TouchEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();

        let clientX, clientY;
        if ('touches' in e) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = (e as React.MouseEvent).clientX;
            clientY = (e as React.MouseEvent).clientY;
        }

        return {
            x: (clientX - rect.left) * (canvas.width / rect.width),
            y: (clientY - rect.top) * (canvas.height / rect.height)
        };
    };

    const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
        e.preventDefault(); // Prevent scrolling on touch
        setIsDrawing(true);
        const { x, y } = getPos(e);
        ctx?.beginPath();
        ctx?.moveTo(x, y);
    };

    const draw = (e: React.MouseEvent | React.TouchEvent) => {
        e.preventDefault();
        if (!isDrawing || !ctx) return;
        const { x, y } = getPos(e);
        ctx.lineTo(x, y);
        ctx.stroke();
    };

    const stopDrawing = () => {
        setIsDrawing(false);
        if (canvasRef.current) {
            onSave(canvasRef.current.toDataURL('image/png'));
        }
    };

    const clearCanvas = () => {
        if (ctx && canvasRef.current) {
            ctx.fillStyle = '#111827';
            ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            onSave(canvasRef.current.toDataURL('image/png'));
        }
    };

    return (
        <div className={`flex flex-col gap-2 ${className}`}>
            <canvas
                ref={canvasRef}
                width={width}
                height={height}
                className="border border-gray-600 rounded bg-gray-900 cursor-crosshair touch-none"
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
            />
            <div className="flex items-center justify-between text-xs text-gray-400">
                <div className="flex items-center gap-2">
                    <span>Brush:</span>
                    <input
                        type="range"
                        min="1"
                        max="10"
                        value={brushSize}
                        onChange={(e) => setBrushSize(parseInt(e.target.value))}
                        className="w-16"
                    />
                </div>
                <button onClick={clearCanvas} className="text-red-400 hover:text-red-300 flex items-center gap-1">
                    <TrashIcon className="w-3 h-3" /> Clear
                </button>
            </div>
        </div>
    );
};

export default SketchCanvas;
