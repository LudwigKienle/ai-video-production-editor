/**
 * Click-to-edit timecode readout (program/source monitor, timeline).
 * Click (or Enter when focused) to type: "00:00:05:12", "512", "+12" (frames),
 * "-1:00", "2.5s". Enter commits, Esc cancels. See timecodeInput.ts.
 */
import React, { useEffect, useRef, useState } from 'react';
import { formatTimecode, DEFAULT_TIMELINE_FPS } from '../../utils/timecode';
import { parseTimecodeInput } from './timecodeInput';

type Props = {
    value: number;
    onCommit: (seconds: number) => void;
    fps?: number;
    max?: number;
    disabled?: boolean;
    className?: string;
    automationId?: string;
    title?: string;
};

const TimecodeField: React.FC<Props> = ({ value, onCommit, fps = DEFAULT_TIMELINE_FPS, max, disabled, className = '', automationId, title }) => {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [invalid, setInvalid] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!editing) return;
        inputRef.current?.focus();
        inputRef.current?.select();
    }, [editing]);

    const begin = () => {
        if (disabled) return;
        setDraft(formatTimecode(value, fps));
        setInvalid(false);
        setEditing(true);
    };

    const commit = () => {
        const parsed = parseTimecodeInput(draft, fps, value);
        if (parsed === null) {
            setInvalid(true);
            window.setTimeout(() => setEditing(false), 450);
            return;
        }
        onCommit(max !== undefined ? Math.min(max, parsed) : parsed);
        setEditing(false);
    };

    if (editing) {
        return (
            <input
                ref={inputRef}
                className={`ppx-tcfield ppx-tcfield--input ${invalid ? 'ppx-tcfield--invalid' : ''} ${className}`}
                value={draft}
                spellCheck={false}
                onChange={(event) => { setDraft(event.target.value); setInvalid(false); }}
                onBlur={() => { if (!invalid) commit(); }}
                onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') { event.preventDefault(); commit(); }
                    else if (event.key === 'Escape') { event.preventDefault(); setEditing(false); }
                }}
                aria-label="Timecode eingeben"
                data-automation-id={automationId ? `${automationId}.input` : undefined}
            />
        );
    }

    return (
        <button
            type="button"
            className={`ppx-tcfield ${className}`}
            onClick={begin}
            disabled={disabled}
            title={title ?? 'Klicken und Timecode eingeben (z. B. 00:00:05:12, 512, +12 Bilder, -1:00)'}
            data-automation-id={automationId}
        >
            {formatTimecode(value, fps)}
        </button>
    );
};

export default TimecodeField;
