import React, { useState, useEffect } from 'react';
import type { UsageKind, UsageProvider } from '../types';

type FieldOption = {
    value: string;
    label: string;
};

type FormField = {
    name: string;
    type: 'text' | 'textarea' | 'select' | 'file';
    label: string;
    required?: boolean;
    options?: FieldOption[];
    defaultValue?: string;
    accept?: string;
};

export type EstimateResult = {
    tokens: number;
    budget: number;
    severity: 'low' | 'medium' | 'high';
    detail?: string;
    adjustedTokens?: number;
};

export type PricingResult = {
    mode: 'hosted' | 'byok' | 'both';
    hostedUsd?: number;
    byokUsd?: number;
    credits?: number;
    units?: number;
    unitLabel?: string;
    detail?: string;
    provider?: UsageProvider;
    kind?: UsageKind;
    model?: string;
};

type EstimateConfig = {
    label?: string;
    compute: (values: Record<string, any>) => EstimateResult | null;
};

type PricingConfig = {
    label?: string;
    compute: (values: Record<string, any>) => PricingResult | null;
};

export type OptionsModalConfig = {
    title: string;
    description: string;
    fields: FormField[];
    submitText?: string;
    estimate?: EstimateConfig;
    pricing?: PricingConfig;
};

interface OptionsModalProps {
    isOpen: boolean;
    config: OptionsModalConfig | null;
    onClose: () => void;
    onSubmit: (values: Record<string, any>, pricing: PricingResult | null) => void | Promise<void>;
}

const OptionsModal: React.FC<OptionsModalProps> = ({ isOpen, config, onClose, onSubmit }) => {
    const [formState, setFormState] = useState<Record<string, any>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [filePreview, setFilePreview] = useState<{
        url: string;
        type: 'image' | 'audio' | 'video' | 'file';
        name: string;
    } | null>(null);

    useEffect(() => {
        if (config) {
            const initialState: Record<string, any> = {};
            config.fields.forEach(field => {
                initialState[field.name] = field.defaultValue || '';
            });
            setFormState(initialState);
            setFilePreview(null);
            setIsSubmitting(false);
        }
    }, [config]);

    useEffect(() => {
        // Clean up object URL on unmount or when file changes
        return () => {
            if (filePreview?.url) {
                URL.revokeObjectURL(filePreview.url);
            }
        };
    }, [filePreview]);

    if (!isOpen || !config) return null;

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormState(prev => ({ ...prev, [name]: value }));
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setFormState(prev => ({ ...prev, [e.target.name]: file }));
            if (filePreview?.url) URL.revokeObjectURL(filePreview.url);
            const url = URL.createObjectURL(file);
            const type = file.type.startsWith('image')
                ? 'image'
                : file.type.startsWith('audio')
                    ? 'audio'
                    : file.type.startsWith('video')
                        ? 'video'
                        : 'file';
            setFilePreview({ url, type, name: file.name });
        }
    };

    const pricing = config.pricing?.compute(formState) || null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSubmitting) return;
        setIsSubmitting(true);
        try {
            await onSubmit(formState, pricing);
        } finally {
            setIsSubmitting(false);
        }
    };

    const estimate = config.estimate?.compute(formState) || null;
    const estimateTone = estimate?.severity || 'low';
    const estimateStyles: Record<string, string> = {
        low: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
        medium: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
        high: 'border-red-500/50 bg-red-500/10 text-red-200',
    };
    const formatUsd = (value: number) => {
        const abs = Math.abs(value);
        if (abs >= 1) return `$${value.toFixed(2)}`;
        if (abs >= 0.1) return `$${value.toFixed(3)}`;
        return `$${value.toFixed(4)}`;
    };
    const formatUnits = (units?: number, unitLabel?: string) => {
        if (typeof units !== 'number' || !unitLabel) return null;
        const unitText = Number.isInteger(units) ? units.toFixed(0) : units.toFixed(2);
        const suffix = units === 1 ? '' : 's';
        return `${unitText} ${unitLabel}${suffix}`;
    };

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-[70]">
            <div className="app-modal p-6 max-w-lg w-full text-left transform transition-all duration-300 scale-100">
                <h2 className="text-2xl font-bold mb-2">{config.title}</h2>
                <p className="app-muted mb-6">{config.description}</p>
                <form onSubmit={handleSubmit} className="space-y-4">
                    {config.fields.map(field => (
                        <div key={field.name}>
                            <label htmlFor={field.name} className="block text-sm font-medium app-muted mb-1">{field.label}</label>
                            {field.type === 'textarea' ? (
                                <textarea
                                    id={field.name}
                                    name={field.name}
                                    value={formState[field.name] || ''}
                                    onChange={handleInputChange}
                                    required={field.required}
                                    rows={3}
                                    className="app-textarea"
                                    placeholder={field.required ? 'Required' : 'Optional'}
                                />
                            ) : field.type === 'select' ? (
                                <select
                                    id={field.name}
                                    name={field.name}
                                    value={formState[field.name]}
                                    onChange={handleInputChange}
                                    required={field.required}
                                    className="app-select"
                                >
                                    {field.options?.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                </select>
                            ) : field.type === 'file' ? (
                                <>
                                    <input
                                        type="file"
                                        id={field.name}
                                        name={field.name}
                                        onChange={handleFileChange}
                                        required={field.required}
                                        accept={field.accept}
                                        className="app-input-file"
                                    />
                                    {filePreview && filePreview.type === 'image' && (
                                        <img src={filePreview.url} alt="Preview" className="mt-2 rounded-lg max-h-32"/>
                                    )}
                                    {filePreview && filePreview.type === 'audio' && (
                                        <audio controls className="mt-2 w-full">
                                            <source src={filePreview.url} />
                                        </audio>
                                    )}
                                    {filePreview && filePreview.type === 'video' && (
                                        <video controls className="mt-2 w-full rounded-lg max-h-40">
                                            <source src={filePreview.url} />
                                        </video>
                                    )}
                                    {filePreview && filePreview.type === 'file' && (
                                        <div className="mt-2 text-xs text-gray-400">Selected: {filePreview.name}</div>
                                    )}
                                </>
                            ) : (
                                <input
                                    type="text"
                                    id={field.name}
                                    name={field.name}
                                    value={formState[field.name] || ''}
                                    onChange={handleInputChange}
                                    required={field.required}
                                    className="app-input"
                                />
                            )}
                        </div>
                    ))}
                    {estimate && (
                        <div className={`rounded-lg border p-3 text-xs ${estimateStyles[estimateTone]}`}>
                            <div className="flex items-center justify-between text-[10px] uppercase tracking-wide">
                                <span>{config.estimate?.label || 'Token Budget'}</span>
                                <span>{estimateTone}</span>
                            </div>
                            <div className="mt-2 text-sm text-white">Prompt tokens: {estimate.tokens}</div>
                            <div className="text-[11px] app-muted">Budget threshold: {estimate.budget} tokens</div>
                            {estimate.detail && (
                                <div className="text-[11px] app-muted mt-1">{estimate.detail}</div>
                            )}
                        </div>
                    )}
                    {pricing && (
                        <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-100">
                            <div className="flex items-center justify-between text-[10px] uppercase tracking-wide">
                                <span>{config.pricing?.label || 'Estimated Cost'}</span>
                                <span>{pricing.mode === 'byok' ? 'BYOK' : pricing.mode === 'hosted' ? 'Hosted' : 'Mixed'}</span>
                            </div>
                            {(pricing.mode === 'hosted' || pricing.mode === 'both') && typeof pricing.hostedUsd === 'number' && (
                                <div className="mt-2 text-sm text-white">
                                    Hosted: {formatUsd(pricing.hostedUsd)}
                                    {typeof pricing.credits === 'number' && pricing.credits > 0 ? ` (${pricing.credits} credits)` : ''}
                                </div>
                            )}
                            {(pricing.mode === 'byok' || pricing.mode === 'both') && typeof pricing.byokUsd === 'number' && (
                                <div className="mt-1 text-sm text-white">
                                    BYOK provider: {formatUsd(pricing.byokUsd)}
                                </div>
                            )}
                            {formatUnits(pricing.units, pricing.unitLabel) && (
                                <div className="text-[11px] app-muted mt-1">
                                    Based on {formatUnits(pricing.units, pricing.unitLabel)}
                                </div>
                            )}
                            {pricing.detail && (
                                <div className="text-[11px] app-muted mt-1">{pricing.detail}</div>
                            )}
                        </div>
                    )}
                    <div className="flex justify-end gap-2 pt-4">
                         <button type="button" onClick={onClose} className="app-button app-secondary" disabled={isSubmitting}>Cancel</button>
                         <button type="submit" className="app-button app-primary" disabled={isSubmitting}>
                            {isSubmitting ? 'Checking...' : (config.submitText || 'Generate')}
                         </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default OptionsModal;
