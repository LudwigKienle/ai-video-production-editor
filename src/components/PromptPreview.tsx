import React, { useMemo, useState } from 'react';
import { adaptPromptForModel, promptStyleGuide, resolvePromptFamily, type PromptKind } from '../services/promptStyle';

/**
 * Shows the prompt exactly as it will reach the selected model after the
 * per-model shaping (`adaptPromptForModel`): Midjourney gets its parameter strip,
 * Gemini prose, Hailuo bracketed camera commands… Presets (camera, lens, lighting,
 * style) are part of the text handed in, so their placement is visible too.
 */
const PromptPreview: React.FC<{
  modelId: string | null | undefined;
  modelLabel?: string;
  prompt: string;
  kind: PromptKind;
  aspectRatio?: string;
  hasReferences?: boolean;
  durationSeconds?: number;
  negatives?: string[];
  /** Shown instead of the preview when the prompt is still empty. */
  emptyHint?: string;
}> = ({ modelId, modelLabel, prompt, kind, aspectRatio, hasReferences, durationSeconds, negatives, emptyHint }) => {
  const [copied, setCopied] = useState(false);
  const isAuto = !modelId || modelId === 'auto';
  const shaped = useMemo(() => {
    if (!prompt.trim()) return '';
    if (isAuto) return prompt.trim();
    try {
      return adaptPromptForModel(modelId, prompt, { kind, aspectRatio, hasReferences, durationSeconds, negatives });
    } catch {
      return prompt.trim();
    }
  }, [modelId, prompt, kind, aspectRatio, hasReferences, durationSeconds, negatives, isAuto]);

  if (!prompt.trim()) {
    return emptyHint ? <p className="pk-hint prompt-preview__empty">{emptyHint}</p> : null;
  }
  const family = isAuto ? 'chosen at run time' : resolvePromptFamily(modelId, kind);
  const changed = shaped.trim() !== prompt.trim();
  const guide = isAuto
    ? 'Auto picks the model when you generate; the prompt is shaped for it at that moment.'
    : promptStyleGuide(modelId, kind).replace(/^Target model:[^.]*\.\s*/, '');
  const jeffNote = family === 'midjourney' ? ' Jeff adds --ar, --sref/--oref and the default --v 8.2 --style raw at submit time.' : '';

  return (
    <details className="phase-settings prompt-preview">
      <summary>
        <span>Prompt for {modelLabel || modelId || 'model'}</span>
        <small>{family}{changed ? ' · reshaped' : ' · as written'}</small>
      </summary>
      <div className="phase-settings__body prompt-preview__body">
        <pre className="prompt-preview__text">{shaped}</pre>
        <div className="prompt-preview__foot">
          <span className="pk-hint">{guide}{jeffNote}</span>
          <button
            type="button"
            className="edit-text-btn edit-text-btn--outline"
            onClick={() => {
              void navigator.clipboard?.writeText(shaped);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </details>
  );
};

export default PromptPreview;
