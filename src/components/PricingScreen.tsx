
import React, { useEffect, useMemo, useState } from 'react';
import { CostLineItem, CostRate, CostSettings, SubscriptionPlan, UsageLedger, UsageProvider, UsageKind, UsageUnit } from '../types';
import { LockIcon } from './icons';
import { STRIPE_PLANS } from '../config/stripe';
import { subscriptionService } from '../services/subscriptionService';

interface PricingScreenProps {
    onSelectPlan: (plan: SubscriptionPlan) => void;
    onClose?: () => void;
    usageLedger?: UsageLedger;
    costSettings?: CostSettings;
    onUpdateCostSettings?: (settings: CostSettings) => void;
    projectName?: string;
    canView?: boolean;
    activeRole?: 'artist' | 'director';
}

const DEFAULT_SETTINGS: CostSettings = {
    currency: 'USD',
    usdToEurRate: 0.92,
    visibility: { artist: true, director: true },
    includeSoftwareFee: false,
    softwareFee: 0,
    softwareLabel: 'Software License',
    rates: [],
    extraLineItems: [],
    invoiceNotes: '',
};

const formatCurrency = (value: number, currency: CostSettings['currency']) => {
    const absValue = Math.abs(value);
    const fractionDigits = absValue > 0 && absValue < 0.01 ? 6 : 2;
    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency,
            minimumFractionDigits: fractionDigits,
            maximumFractionDigits: fractionDigits,
        }).format(value);
    } catch {
        return `${currency} ${value.toFixed(fractionDigits)}`;
    }
};

const PricingScreen: React.FC<PricingScreenProps> = ({
    onSelectPlan,
    onClose,
    usageLedger,
    costSettings,
    onUpdateCostSettings,
    projectName,
    canView = true,
    activeRole = 'artist',
}) => {
    useEffect(() => {
        if (!onClose) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const settings = costSettings || DEFAULT_SETTINGS;
    const entries = usageLedger?.entries || [];
    const [selectedModel, setSelectedModel] = useState('');
    const [newItemLabel, setNewItemLabel] = useState('');
    const [newItemAmount, setNewItemAmount] = useState('0');
    const fxRate = settings.usdToEurRate > 0 ? settings.usdToEurRate : 1;

    const toDisplayCurrency = (usdValue: number) =>
        settings.currency === 'EUR' ? usdValue * fxRate : usdValue;
    const fromDisplayCurrency = (displayValue: number) =>
        settings.currency === 'EUR' ? displayValue / fxRate : displayValue;

    const summary = useMemo(() => {
        const rateByModel = new Map<string, CostRate>();
        const rateByProvider = new Map<string, CostRate>();
        settings.rates.forEach((rate) => {
            if (rate.model) {
                rateByModel.set(`${rate.provider}:${rate.model}:${rate.kind}`, rate);
            } else {
                rateByProvider.set(`${rate.provider}:${rate.kind}`, rate);
            }
        });
        const bucket = new Map<string, { provider: UsageProvider; kind: UsageKind; units: number; unitLabel: string; rate?: CostRate; model?: string }>();
        entries.forEach((entry) => {
            const modelKey = entry.model ? `${entry.provider}:${entry.model}:${entry.kind}` : null;
            const rate = (modelKey && rateByModel.get(modelKey)) || rateByProvider.get(`${entry.provider}:${entry.kind}`);
            const key = entry.model ? `model:${entry.model}:${entry.kind}` : `${entry.provider}:${entry.kind}`;
            const existing = bucket.get(key);
            if (!existing) {
                bucket.set(key, {
                    provider: entry.provider,
                    kind: entry.kind,
                    units: entry.units,
                    unitLabel: entry.unitLabel,
                    rate,
                    model: entry.model,
                });
            } else {
                existing.units += entry.units;
            }
        });
        const lines = Array.from(bucket.values()).map((line) => {
            const unitCost = line.rate?.unitCost || 0;
            const cost = line.units * unitCost;
            return {
                ...line,
                unitCost,
                cost,
                label: line.rate?.label || line.model || `${line.provider} ${line.kind}`,
            };
        });
        const usageTotal = lines.reduce((sum, line) => sum + line.cost, 0);
        return { lines, usageTotal };
    }, [entries, settings.rates]);

    const extraItems = settings.extraLineItems || [];
    const extrasTotal = extraItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    const softwareTotal = settings.includeSoftwareFee ? settings.softwareFee : 0;
    const grandTotal = summary.usageTotal + extrasTotal + softwareTotal;
    const canEdit = activeRole === 'director';
    const canSeeDetails = canView || canEdit;

    const modelRates = settings.rates.filter((rate) => rate.model);
    const fallbackRates = settings.rates.filter((rate) => !rate.model);

    const observedModels = useMemo(() => {
        const map = new Map<string, { provider: UsageProvider; kind: UsageKind; unitLabel: UsageUnit }>();
        entries.forEach((entry) => {
            if (!entry.model) return;
            if (!map.has(entry.model)) {
                map.set(entry.model, {
                    provider: entry.provider,
                    kind: entry.kind,
                    unitLabel: entry.unitLabel,
                });
            }
        });
        return Array.from(map.entries())
            .filter(([model]) => !modelRates.some((rate) => rate.model === model))
            .map(([model, info]) => ({ model, ...info }));
    }, [entries, modelRates]);

    const updateSettings = (updates: Partial<CostSettings>) => {
        if (!onUpdateCostSettings) return;
        onUpdateCostSettings({
            ...settings,
            ...updates,
            visibility: {
                ...settings.visibility,
                ...(updates.visibility || {}),
            },
        });
    };

    const handleRateUpdate = (id: string, value: number) => {
        const nextRates = settings.rates.map((rate) =>
            rate.id === id ? { ...rate, unitCost: fromDisplayCurrency(value) } : rate,
        );
        updateSettings({ rates: nextRates });
    };

    const handleAddLineItem = () => {
        const label = newItemLabel.trim();
        const amount = Number(newItemAmount);
        if (!label || !Number.isFinite(amount)) return;
        const nextItem: CostLineItem = {
            id: `item-${Date.now()}`,
            label,
            amount: fromDisplayCurrency(amount),
        };
        updateSettings({ extraLineItems: [...extraItems, nextItem] });
        setNewItemLabel('');
        setNewItemAmount('0');
    };

    const handleRemoveLineItem = (id: string) => {
        updateSettings({ extraLineItems: extraItems.filter((item) => item.id !== id) });
    };

    const handleExportJson = () => {
        const payload = {
            project: projectName || 'Untitled Project',
            exportedAt: new Date().toISOString(),
            currency: settings.currency,
            usage: summary.lines.map((line) => ({
                provider: line.provider,
                kind: line.kind,
                model: line.model || null,
                units: line.units,
                unitLabel: line.unitLabel,
                unitCost: toDisplayCurrency(line.unitCost),
                total: toDisplayCurrency(line.cost),
            })),
            extras: extraItems.map((item) => ({ ...item, amount: toDisplayCurrency(Number(item.amount) || 0) })),
            softwareFee: settings.includeSoftwareFee
                ? { label: settings.softwareLabel, amount: toDisplayCurrency(settings.softwareFee) }
                : null,
            total: toDisplayCurrency(grandTotal),
            notes: settings.invoiceNotes || '',
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `project-usage-${Date.now()}.json`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const handleExportPdf = () => {
        const html = `
          <html>
            <head>
              <title>Project Invoice</title>
              <style>
                body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
                h1 { margin: 0 0 8px; }
                table { width: 100%; border-collapse: collapse; margin-top: 12px; }
                th, td { border-bottom: 1px solid #ddd; padding: 8px; font-size: 12px; text-align: left; }
                .total { font-weight: bold; }
              </style>
            </head>
            <body>
              <h1>Project Invoice</h1>
              <p>Project: ${projectName || 'Untitled Project'}</p>
              <table>
                <thead>
                  <tr><th>Item</th><th>Units</th><th>Rate</th><th>Total</th></tr>
                </thead>
                <tbody>
                  ${summary.lines
                .map((line) => {
                    const rateLabel = formatCurrency(toDisplayCurrency(line.unitCost), settings.currency);
                    return `<tr><td>${line.label}</td><td>${line.units.toFixed(2)} ${line.unitLabel}</td><td>${rateLabel}</td><td>${formatCurrency(toDisplayCurrency(line.cost), settings.currency)}</td></tr>`;
                })
                .join('')}
                  ${extraItems
                .map((item) => `<tr><td>${item.label}</td><td>-</td><td>-</td><td>${formatCurrency(toDisplayCurrency(Number(item.amount) || 0), settings.currency)}</td></tr>`)
                .join('')}
                  ${settings.includeSoftwareFee
                ? `<tr><td>${settings.softwareLabel}</td><td>-</td><td>-</td><td>${formatCurrency(toDisplayCurrency(settings.softwareFee), settings.currency)}</td></tr>`
                : ''}
                </tbody>
              </table>
              <p class="total">Total: ${formatCurrency(toDisplayCurrency(grandTotal), settings.currency)}</p>
              ${settings.invoiceNotes ? `<p>${settings.invoiceNotes}</p>` : ''}
            </body>
          </html>
        `;
        const popup = window.open('', '_blank');
        if (!popup) return;
        popup.document.write(html);
        popup.document.close();
        popup.focus();
        popup.print();
    };

    const handleSubscribe = async (priceId: string) => {
        try {
            await subscriptionService.checkout(priceId);
        } catch (e: any) {
            console.error("Subscription failed", e);
            alert(`Failed to start checkout: ${e.message}`);
        }
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white py-12 px-4 sm:px-6 lg:px-8 flex flex-col items-center justify-start relative overflow-x-hidden overflow-y-auto">
            {/* Background Ambience */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-900/30 rounded-full blur-3xl"></div>
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-900/30 rounded-full blur-3xl"></div>

            {onClose && (
                <button
                    onClick={onClose}
                    className="absolute top-6 right-6 text-sm text-gray-400 hover:text-white border border-gray-700 rounded-full px-3 py-1 bg-gray-900/70"
                    aria-label="Close pricing screen"
                >
                    Close
                </button>
            )}

            {onClose && (
                <button
                    onClick={onClose}
                    className="fixed bottom-6 right-6 app-button app-secondary text-xs shadow-lg"
                    aria-label="Close pricing screen"
                    aria-keyshortcuts="Escape"
                    title="Close (Esc)"
                >
                    Close (Esc)
                </button>
            )}

            <div className="text-center max-w-3xl mx-auto mb-12 relative z-10">
                <div className="inline-flex p-3 bg-gray-800 rounded-full mb-6 border border-gray-700 shadow-xl">
                    <LockIcon className="w-8 h-8 text-indigo-400" />
                </div>
                <h1 className="text-4xl font-extrabold sm:text-5xl sm:tracking-tight mb-4">
                    License Required
                </h1>
                <p className="text-xl text-gray-400 max-w-2xl mx-auto">
                    AI Video Production Editor is a premium tool. <br />
                    Purchase a lifetime license to unlock the full production suite.
                </p>
            </div>

            <div className="w-full max-w-5xl relative z-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {Object.values(STRIPE_PLANS).map((plan) => (
                    <div key={plan.id} className="flex flex-col bg-gray-800 rounded-2xl border border-gray-700 shadow-xl overflow-hidden transform transition-all hover:scale-[1.02] hover:border-indigo-500/50">
                        {/* Header */}
                        <div className="bg-gray-900/50 p-6 text-center border-b border-gray-700">
                            <h3 className="text-xl font-bold text-white mb-2">{plan.name}</h3>
                            <div className="flex items-center justify-center text-white">
                                <span className="text-3xl font-extrabold tracking-tight">€{plan.price}</span>
                                <span className="ml-2 text-sm font-medium text-gray-400">/ {plan.interval === 'one_time' ? 'once' : plan.interval}</span>
                            </div>
                        </div>

                        {/* Features */}
                        <div className="p-6 bg-gray-800 flex-grow">
                            <ul className="space-y-3 mb-6">
                                <li className="flex items-center text-sm text-gray-300">
                                    <CheckIcon />
                                    <span className="ml-3">Full Access to Studio</span>
                                </li>
                                {plan.id === 'byo' && (
                                    <li className="flex items-center text-sm text-gray-300">
                                        <CheckIcon />
                                        <span className="ml-3">Bring Your Own Keys</span>
                                    </li>
                                )}
                                {plan.id === 'studio' && (
                                    <li className="flex items-center text-sm text-gray-300">
                                        <CheckIcon />
                                        <span className="ml-3">Priority Support</span>
                                    </li>
                                )}
                            </ul>

                            <button
                                onClick={() => handleSubscribe(plan.priceId)}
                                className="block w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-4 rounded-lg text-center transition-all shadow-lg shadow-indigo-500/30 active:scale-95"
                            >
                                {plan.interval === 'one_time' ? 'Buy License' : 'Subscribe'}
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <div className="w-full max-w-4xl mt-10 relative z-10">
                <div className="app-card p-6">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <h2 className="text-xl font-semibold">Project Usage & Costs</h2>
                            <p className="text-xs text-gray-400">Model-based pricing with editable rates; token-based items may need manual rates.</p>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                            <span>Role: {activeRole}</span>
                            <label className="sr-only" htmlFor="pricing-currency">Currency</label>
                            <select
                                id="pricing-currency"
                                className="app-select text-xs"
                                value={settings.currency}
                                onChange={(e) => updateSettings({ currency: e.target.value as CostSettings['currency'] })}
                                disabled={!canEdit}
                                aria-label="Display currency"
                            >
                                <option value="USD">USD</option>
                                <option value="EUR">EUR</option>
                            </select>
                            <span className="text-[10px] text-gray-500">USD→EUR {fxRate.toFixed(2)}</span>
                        </div>
                    </div>

                    {!canSeeDetails && (
                        <div className="mt-4 rounded-lg border border-gray-700 bg-gray-900/60 p-4 text-sm text-gray-400">
                            Usage visibility is disabled for your role.
                        </div>
                    )}

                    {canSeeDetails && (
                        <>
                            <div className="mt-4 overflow-x-auto">
                                <table className="w-full text-xs text-gray-300">
                                    <caption className="sr-only">Usage cost breakdown by provider and model</caption>
                                    <thead>
                                        <tr className="text-gray-500">
                                            <th scope="col" className="text-left pb-2">Provider</th>
                                            <th scope="col" className="text-left pb-2">Type</th>
                                            <th scope="col" className="text-left pb-2">Units</th>
                                            <th scope="col" className="text-left pb-2">Rate</th>
                                            <th scope="col" className="text-right pb-2">Subtotal</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {summary.lines.length === 0 && (
                                            <tr>
                                                <td colSpan={5} className="py-4 text-gray-500">
                                                    No usage recorded yet.
                                                </td>
                                            </tr>
                                        )}
                                        {summary.lines.map((line) => (
                                            <tr key={`${line.provider}-${line.kind}-${line.model || 'fallback'}`} className="border-t border-gray-800">
                                                <td className="py-2">{line.provider}</td>
                                                <td className="py-2">{line.model || line.kind}</td>
                                                <td className="py-2">{line.units.toFixed(2)} {line.unitLabel}</td>
                                                <td className="py-2">{formatCurrency(toDisplayCurrency(line.unitCost), settings.currency)}</td>
                                                <td className="py-2 text-right">{formatCurrency(toDisplayCurrency(line.cost), settings.currency)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 text-sm text-gray-200" aria-live="polite">
                                <div>
                                    <div className="text-xs uppercase tracking-wider text-gray-500">Usage Total</div>
                                    <div className="text-lg font-semibold">{formatCurrency(toDisplayCurrency(summary.usageTotal), settings.currency)}</div>
                                </div>
                                <div>
                                    <div className="text-xs uppercase tracking-wider text-gray-500">Grand Total</div>
                                    <div className="text-lg font-semibold">{formatCurrency(toDisplayCurrency(grandTotal), settings.currency)}</div>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={handleExportJson}
                                        className="bg-gray-700 hover:bg-gray-600 text-white text-xs font-semibold px-3 py-2 rounded"
                                    >
                                        Export JSON
                                    </button>
                                    <button
                                        onClick={handleExportPdf}
                                        className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-2 rounded"
                                    >
                                        Export Invoice PDF
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {canSeeDetails && (
                    <>
                        <div className="mt-6 grid gap-6 md:grid-cols-2">
                            <div className="app-card p-5">
                                <h3 className="text-sm font-semibold">Visibility & Software Fee</h3>
                                <p className="mt-1 text-xs text-gray-400">Control who sees usage totals and add software cost.</p>
                                <div className="mt-4 space-y-3 text-xs text-gray-300">
                                    <label className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={settings.visibility.artist}
                                            onChange={(e) => updateSettings({ visibility: { ...settings.visibility, artist: e.target.checked } })}
                                            disabled={!canEdit}
                                            aria-label="Show usage to artists"
                                        />
                                        Show to artists
                                    </label>
                                    <label className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={settings.visibility.director}
                                            onChange={(e) => updateSettings({ visibility: { ...settings.visibility, director: e.target.checked } })}
                                            disabled={!canEdit}
                                            aria-label="Show usage to directors"
                                        />
                                        Show to directors
                                    </label>
                                    <label className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={settings.includeSoftwareFee}
                                            onChange={(e) => updateSettings({ includeSoftwareFee: e.target.checked })}
                                            disabled={!canEdit}
                                            aria-label="Include software fee"
                                        />
                                        Include software fee
                                    </label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <input
                                            className="app-input text-xs"
                                            value={settings.softwareLabel}
                                            onChange={(e) => updateSettings({ softwareLabel: e.target.value })}
                                            placeholder="Software label"
                                            disabled={!canEdit}
                                            aria-label="Software fee label"
                                        />
                                        <input
                                            className="app-input text-xs"
                                            type="number"
                                            value={toDisplayCurrency(settings.softwareFee)}
                                            onChange={(e) => updateSettings({ softwareFee: fromDisplayCurrency(Number(e.target.value)) })}
                                            disabled={!canEdit}
                                            min={0}
                                            step={0.01}
                                            aria-label="Software fee amount"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="app-card p-5">
                                <h3 className="text-sm font-semibold">Additional Line Items</h3>
                                <p className="mt-1 text-xs text-gray-400">Add manual charges for clients.</p>
                                <div className="mt-3 space-y-2">
                                    {extraItems.length === 0 && <div className="text-xs text-gray-500">No extras yet.</div>}
                                    {extraItems.map((item) => (
                                        <div key={item.id} className="flex items-center justify-between text-xs">
                                            <div>{item.label}</div>
                                            <div className="flex items-center gap-2">
                                                <span>{formatCurrency(toDisplayCurrency(Number(item.amount) || 0), settings.currency)}</span>
                                                <button
                                                    className="text-gray-500 hover:text-white"
                                                    onClick={() => handleRemoveLineItem(item.id)}
                                                    disabled={!canEdit}
                                                    aria-label={`Remove line item ${item.label}`}
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-4 grid grid-cols-[1fr_110px_80px] gap-2">
                                    <input
                                        className="app-input text-xs"
                                        placeholder="Label"
                                        value={newItemLabel}
                                        onChange={(e) => setNewItemLabel(e.target.value)}
                                        disabled={!canEdit}
                                        aria-label="New line item label"
                                    />
                                    <input
                                        className="app-input text-xs"
                                        type="number"
                                        value={newItemAmount}
                                        onChange={(e) => setNewItemAmount(e.target.value)}
                                        disabled={!canEdit}
                                        min={0}
                                        step={0.01}
                                        aria-label="New line item amount"
                                    />
                                    <button
                                        className="app-button border border-gray-600 text-xs"
                                        onClick={handleAddLineItem}
                                        disabled={!canEdit}
                                        aria-label="Add line item"
                                    >
                                        Add
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="mt-6 app-card p-5">
                            <h3 className="text-sm font-semibold">Model Rates</h3>
                            <p className="mt-1 text-xs text-gray-400">Defaults follow public pricing ranges (midpoints). Adjust to match your billing.</p>
                            <div className="mt-3 grid gap-2">
                                {modelRates.map((rate) => (
                                    <div key={rate.id} className="flex items-center justify-between gap-4 text-xs text-gray-300">
                                        <div className="flex-1">
                                            <div className="font-semibold">{rate.label || rate.model || `${rate.provider} ${rate.kind}`}</div>
                                            <div className="text-[10px] text-gray-500">{rate.model || '-'} · {rate.kind}</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <input
                                                className="app-input text-xs w-24"
                                                type="number"
                                                value={toDisplayCurrency(rate.unitCost)}
                                                onChange={(e) => handleRateUpdate(rate.id, Number(e.target.value))}
                                                disabled={!canEdit}
                                                min={0}
                                                step={0.001}
                                                aria-label={`Rate for ${rate.label || rate.model || `${rate.provider} ${rate.kind}`}`}
                                            />
                                            <span className="text-[10px] text-gray-500">per {rate.unitLabel}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {observedModels.length > 0 && (
                                <div className="mt-4 border-t border-gray-800 pt-3">
                                    <div className="text-xs text-gray-400">Add rates for newly used models:</div>
                                    <div className="mt-2 flex items-center gap-2">
                                        <select
                                            className="app-select text-xs flex-1"
                                            value={selectedModel}
                                            onChange={(e) => setSelectedModel(e.target.value)}
                                            disabled={!canEdit}
                                            aria-label="Select model to add"
                                        >
                                            <option value="">Select model</option>
                                            {observedModels.map((item) => (
                                                <option key={item.model} value={item.model}>
                                                    {item.model}
                                                </option>
                                            ))}
                                        </select>
                                        <button
                                            className="app-button border border-gray-600 text-xs"
                                            disabled={!canEdit || !selectedModel}
                                            onClick={() => {
                                                const match = observedModels.find((item) => item.model === selectedModel);
                                                if (!match) return;
                                                const fallback = fallbackRates.find((rate) => rate.provider === match.provider && rate.kind === match.kind);
                                                const newRate: CostRate = {
                                                    id: `model-${Date.now()}`,
                                                    provider: match.provider,
                                                    model: match.model,
                                                    kind: match.kind,
                                                    unitCost: fallback?.unitCost || 0,
                                                    unitLabel: match.unitLabel,
                                                    label: `${match.model} (custom)`,
                                                };
                                                updateSettings({ rates: [...settings.rates, newRate] });
                                                setSelectedModel('');
                                            }}
                                            aria-label="Add selected model rate"
                                        >
                                            Add
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="mt-6 app-card p-5">
                            <h3 className="text-sm font-semibold">Provider Fallback Rates</h3>
                            <p className="mt-1 text-xs text-gray-400">Used when a model has no specific rate (average defaults).</p>
                            <div className="mt-3 grid gap-2">
                                {fallbackRates.map((rate) => (
                                    <div key={rate.id} className="flex items-center justify-between gap-4 text-xs text-gray-300">
                                        <div className="flex-1">
                                            <div className="font-semibold">{rate.label || `${rate.provider} ${rate.kind}`}</div>
                                            <div className="text-[10px] text-gray-500">{rate.provider} · {rate.kind}</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <input
                                                className="app-input text-xs w-24"
                                                type="number"
                                                value={toDisplayCurrency(rate.unitCost)}
                                                onChange={(e) => handleRateUpdate(rate.id, Number(e.target.value))}
                                                disabled={!canEdit}
                                                min={0}
                                                step={0.001}
                                                aria-label={`Fallback rate for ${rate.label || `${rate.provider} ${rate.kind}`}`}
                                            />
                                            <span className="text-[10px] text-gray-500">per {rate.unitLabel}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-4">
                                <label htmlFor="pricing-invoice-notes" className="block text-xs text-gray-400 mb-1">Invoice Notes</label>
                                <textarea
                                    id="pricing-invoice-notes"
                                    className="app-textarea text-xs"
                                    rows={2}
                                    value={settings.invoiceNotes || ''}
                                    onChange={(e) => updateSettings({ invoiceNotes: e.target.value })}
                                    disabled={!canEdit}
                                />
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

const CheckIcon: React.FC = () => (
    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-green-500/10 flex items-center justify-center">
        <svg className="w-4 h-4 text-green-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
    </div>
);

export default PricingScreen;
