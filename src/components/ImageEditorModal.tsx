import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { MediaItem } from '../types';
import {
  BrushIcon,
  LayersIcon,
  MagicWandIcon,
  SparklesIcon,
  UploadIcon,
} from './icons';
import {
  type LookAgentProvider,
  type LookAgentToolId,
  runLookAgentTool,
} from '../services/lookAgentService';
import { fileToBase64, getBase64FromUrl } from '../utils/helpers';

interface ImageEditorModalProps {
  isOpen: boolean;
  mediaItem: MediaItem | null;
  onClose: () => void;
  onSave: (media: MediaItem) => void;
}

const TOOL_META: Array<{
  id: LookAgentToolId;
  label: string;
  subtitle: string;
}> = [
  { id: 'edit', label: 'Edit', subtitle: 'General image surgery.' },
  { id: 'inpaint', label: 'Inpaint', subtitle: 'Targeted region-style fixes.' },
  { id: 'style_transfer', label: 'Style', subtitle: 'Reference-led transfer.' },
  { id: 'relight', label: 'Relight', subtitle: 'Lighting and mood pass.' },
  { id: 'analyze', label: 'Analyze', subtitle: 'Critique and shot notes.' },
];

const PLACEHOLDER_BY_TOOL: Record<LookAgentToolId, string> = {
  edit: 'e.g. remove the distracting background and make the wardrobe premium editorial',
  inpaint: 'e.g. replace the table prop with a matte black version and preserve perspective',
  style_transfer: 'e.g. borrow the palette and texture language from the reference while keeping the subject identity',
  relight: 'e.g. convert to golden hour side light with soft practical falloff and cinematic contrast',
  analyze: 'e.g. critique lighting continuity, composition strength, and production readiness',
};

const PROVIDER_OPTIONS: Array<{
  id: LookAgentProvider;
  label: string;
}> = [
  { id: 'gemini', label: 'Gemini' },
  { id: 'replicate', label: 'Replicate' },
];

const ImageEditorModal: React.FC<ImageEditorModalProps> = ({
  isOpen,
  mediaItem,
  onClose,
  onSave,
}) => {
  const [tool, setTool] = useState<LookAgentToolId>('edit');
  const [provider, setProvider] = useState<LookAgentProvider>('gemini');
  const [prompt, setPrompt] = useState('');
  const [analysis, setAnalysis] = useState('');
  const [status, setStatus] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [referenceImage, setReferenceImage] = useState<{
    file: File;
    url: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setTool('edit');
    setProvider('gemini');
    setPrompt('');
    setAnalysis('');
    setStatus('');
    setReferenceImage(null);
  }, [isOpen, mediaItem?.id]);

  useEffect(() => {
    if (tool === 'relight') {
      setProvider((prev) => (prev === 'replicate' ? prev : 'gemini'));
    }
    if (tool === 'analyze') {
      setProvider('gemini');
    }
  }, [tool]);

  const toolMeta = useMemo(
    () => TOOL_META.find((entry) => entry.id === tool) || TOOL_META[0],
    [tool],
  );

  if (!isOpen || !mediaItem) return null;

  const canUseReference = tool === 'style_transfer';
  const canChooseProvider = tool !== 'analyze';
  const needsPrompt = tool === 'analyze' || prompt.trim().length > 0;

  const handleRefUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setReferenceImage({ file, url: URL.createObjectURL(file) });
  };

  const handleRun = async () => {
    if (!needsPrompt) {
      setStatus('Add an instruction before running the look tool.');
      return;
    }
    setIsProcessing(true);
    setStatus('');
    setAnalysis('');

    try {
      const source = await getBase64FromUrl(mediaItem.url);
      const refPayload =
        referenceImage
          ? {
              base64: await fileToBase64(referenceImage.file),
              mimeType: referenceImage.file.type || 'image/png',
            }
          : null;

      const result = await runLookAgentTool({
        tool,
        prompt:
          prompt.trim() ||
          'Provide a concise but production-useful critique of this image.',
        provider,
        source: {
          base64: source.base64,
          mimeType: source.mimeType || 'image/png',
        },
        sourceMedia: mediaItem,
        referenceImage: refPayload,
      });

      if (result.analysis) {
        setAnalysis(result.analysis);
        if (result.media) {
          onSave(result.media);
        }
        setStatus('Analysis saved to the selected image.');
        return;
      }

      if (result.media) {
        onSave(result.media);
        onClose();
        return;
      }

      setStatus('The look tool finished without producing output.');
    } catch (error) {
      console.error(error);
      setStatus(
        error instanceof Error ? error.message : 'Image operation failed.',
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-md">
      <div className="flex h-[84vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl">
        <div className="relative flex flex-1 items-center justify-center bg-black p-5">
          <img
            src={mediaItem.url}
            alt="Edit target"
            className="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
          />
          <div className="absolute left-4 top-4 rounded-lg border border-white/10 bg-gray-900/85 px-3 py-2 text-xs text-white">
            <div className="font-semibold">{mediaItem.name}</div>
            <div className="mt-1 text-[11px] text-gray-400">
              {toolMeta.label} · {provider}
            </div>
          </div>
        </div>

        <div className="flex w-[360px] flex-col gap-5 border-l border-gray-700 bg-gray-800 p-6">
          <div>
            <h3 className="text-xl font-bold text-white">Look Agent</h3>
            <p className="text-sm text-gray-400">
              Controlled edit, relight and critique tools.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {TOOL_META.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTool(entry.id)}
                data-studio-action={`look-agent:${entry.id}`}
                className={`rounded-xl border px-3 py-2 text-left transition ${
                  tool === entry.id
                    ? 'border-indigo-400 bg-indigo-500/15 text-white'
                    : 'border-gray-700 bg-gray-900/40 text-gray-300 hover:border-gray-500'
                }`}
              >
                <div className="text-sm font-semibold">{entry.label}</div>
                <div className="mt-1 text-[11px] text-gray-400">
                  {entry.subtitle}
                </div>
              </button>
            ))}
          </div>

          {canChooseProvider && (
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                Provider
              </label>
              <div className="flex gap-2 rounded-xl bg-gray-900/60 p-1">
                {PROVIDER_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setProvider(option.id)}
                    className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${
                      provider === option.id
                        ? 'bg-indigo-600 text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
              Instruction
            </label>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={PLACEHOLDER_BY_TOOL[tool]}
              rows={tool === 'analyze' ? 5 : 7}
              className="w-full resize-none rounded-xl border border-gray-700 bg-gray-900 px-3 py-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {canUseReference && (
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                Reference
              </label>
              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex h-32 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-gray-600 bg-gray-900/50 transition hover:border-indigo-500 hover:bg-gray-700/30"
              >
                {referenceImage ? (
                  <img
                    src={referenceImage.url}
                    alt="Reference"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <>
                    <UploadIcon className="mb-2 h-8 w-8 text-gray-500" />
                    <span className="text-xs text-gray-500">
                      Upload style or content reference
                    </span>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleRefUpload}
              />
              {referenceImage && (
                <button
                  type="button"
                  onClick={() => setReferenceImage(null)}
                  className="mt-2 text-xs text-rose-300 hover:text-white"
                >
                  Remove reference
                </button>
              )}
            </div>
          )}

          {analysis && (
            <div className="min-h-0 flex-1 overflow-hidden">
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                Critique
              </label>
              <div className="h-full overflow-y-auto rounded-xl border border-gray-700 bg-gray-900 px-3 py-3 text-sm leading-6 text-gray-200">
                {analysis}
              </div>
            </div>
          )}

          {status && (
            <div className="rounded-xl border border-gray-700 bg-gray-900/70 px-3 py-2 text-xs text-gray-300">
              {status}
            </div>
          )}

          <div className="mt-auto flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl bg-gray-700 py-3 font-semibold text-white hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRun}
              disabled={isProcessing || (tool !== 'analyze' && !prompt.trim())}
              data-studio-action="look-agent:run"
              className="flex-[1.4] rounded-xl bg-indigo-600 py-3 font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isProcessing ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-b-2 border-white" />
                  Running
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  {tool === 'analyze' ? (
                    <LayersIcon className="h-4 w-4" />
                  ) : tool === 'relight' ? (
                    <SparklesIcon className="h-4 w-4" />
                  ) : tool === 'inpaint' ? (
                    <BrushIcon className="h-4 w-4" />
                  ) : (
                    <MagicWandIcon className="h-4 w-4" />
                  )}
                  Run
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImageEditorModal;
