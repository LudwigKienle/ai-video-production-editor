import React, { useState, useMemo } from 'react';
import { Preset } from '../services/presetService';

interface SelectionModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    presets: Preset[];
    selectedId: string | null;
    onSelect: (id: string | null) => void;
    onAddCustom?: (label: string, prompt: string, imageUrl: string) => void;
    onRemoveCustom?: (id: string) => void;
}

export const SelectionModal: React.FC<SelectionModalProps> = ({
    isOpen,
    onClose,
    title,
    presets,
    selectedId,
    onSelect,
    onAddCustom,
    onRemoveCustom,
}) => {
    const [search, setSearch] = useState('');
    const [isAdding, setIsAdding] = useState(false);

    // New Custom Preset Form State
    const [newLabel, setNewLabel] = useState('');
    const [newPrompt, setNewPrompt] = useState('');
    const [newImage, setNewImage] = useState('');

    const filteredPresets = useMemo(() => {
        if (!search) return presets;
        const lower = search.toLowerCase();
        return presets.filter(p =>
            p.label.toLowerCase().includes(lower) ||
            p.prompt.toLowerCase().includes(lower)
        );
    }, [presets, search]);

    if (!isOpen) return null;

    const handleSaveCustom = () => {
        if (onAddCustom && newLabel && newPrompt && newImage) {
            onAddCustom(newLabel, newPrompt, newImage);
            setIsAdding(false);
            setNewLabel('');
            setNewPrompt('');
            setNewImage('');
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-[#121212] w-full max-w-5xl h-[85vh] rounded-2xl border border-gray-800 flex flex-col shadow-2xl overflow-hidden">

                {/* Header */}
                <div className="p-6 border-b border-gray-800 flex items-center justify-between shrink-0">
                    <div>
                        <h2 className="text-xl font-bold tracking-tight text-white uppercase">{title}</h2>
                        <p className="text-xs text-indigo-400 font-mono mt-1">// {presets.length} OPTIONS AVAILABLE</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-800 rounded-full transition-colors text-gray-400 hover:text-white"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>

                {/* Search Bar */}
                <div className="px-6 py-4 shrink-0 bg-[#121212]">
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Filter options..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full bg-black/40 border border-gray-700 text-gray-200 px-4 py-3 pl-10 rounded-lg focus:outline-none focus:border-indigo-500 transition-colors placeholder-gray-600"
                        />
                        <svg className="w-5 h-5 absolute left-3 top-3.5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                    </div>
                </div>

                {/* Grid Area */}
                <div className="flex-1 overflow-y-auto p-6">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">

                        {/* Add Custom Button */}
                        {onAddCustom && !isAdding && (
                            <button
                                onClick={() => setIsAdding(true)}
                                className="group relative aspect-square rounded-xl border-2 border-dashed border-gray-700 hover:border-indigo-500 flex flex-col items-center justify-center gap-2 transition-all hover:bg-gray-900/50"
                            >
                                <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center group-hover:bg-indigo-500/20 group-hover:text-indigo-400 transition-colors text-gray-500">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                                </div>
                                <span className="text-sm font-medium text-gray-400 group-hover:text-indigo-400">Add Custom</span>
                            </button>
                        )}

                        {/* Custom Add Form (Inline Card) */}
                        {isAdding && (
                            <div className="col-span-2 md:col-span-1 row-span-2 md:row-span-1 aspect-square md:aspect-auto rounded-xl bg-gray-900 border border-indigo-500 p-4 flex flex-col gap-3">
                                <h3 className="text-sm font-bold text-white">New Preset</h3>
                                <input className="app-input text-xs" placeholder="Label (e.g. Green Cyber Noir)" value={newLabel} onChange={e => setNewLabel(e.target.value)} />
                                <input className="app-input text-xs" placeholder="Image URL" value={newImage} onChange={e => setNewImage(e.target.value)} />
                                <textarea className="app-input text-xs flex-1 resize-none" placeholder="Prompt modifiers..." value={newPrompt} onChange={e => setNewPrompt(e.target.value)} />
                                <div className="flex gap-2">
                                    <button onClick={handleSaveCustom} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs py-2 rounded">Save</button>
                                    <button onClick={() => setIsAdding(false)} className="px-3 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs py-2 rounded">Cancel</button>
                                </div>
                            </div>
                        )}

                        {/* Preset Cards */}
                        {filteredPresets.map((preset) => (
                            <div
                                key={preset.id}
                                onClick={() => onSelect(preset.id)}
                                className={`
                  relative group cursor-pointer rounded-xl overflow-hidden aspect-square
                  border-2 transition-all duration-300
                  ${selectedId === preset.id
                                        ? 'border-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.5)] scale-105 z-10'
                                        : 'border-transparent hover:border-gray-600 hover:scale-105 hover:z-10'
                                    }
                `}
                            >
                                {/* Image */}
                                <div className="absolute inset-0 bg-gray-800">
                                    {preset.image ? (
                                        <img
                                            src={preset.image}
                                            alt={preset.label}
                                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM0YjU1NjMiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cmVjdCB4PSIzIiB5PSIzIiB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHJ4PSIyIiByeT0iMiIvPjxjaXJjbGUgY3g9IjguNSIgY3k9IjguNSIgcj0iMS41Ii8+PHBvbHlsaW5lIHBvaW50cz0iMjEgMTUgMTYgMTAgNSAyMSIvPjwvc3ZnPg=='; // Placeholder icon
                                                (e.target as HTMLImageElement).classList.add('p-8', 'opacity-20');
                                            }}
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center bg-gray-800 text-gray-600">
                                            <span className="text-xs">No Image</span>
                                        </div>
                                    )}

                                    {/* Gradient Overlay */}
                                    <div className={`
                    absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent
                    transition-opacity duration-300
                    ${selectedId === preset.id ? 'opacity-80' : 'opacity-60 group-hover:opacity-80'}
                  `} />
                                </div>

                                {/* Label */}
                                <div className="absolute bottom-0 left-0 right-0 p-3">
                                    <span className={`
                    text-xs font-bold uppercase tracking-wider transition-colors duration-300 block truncate
                    ${selectedId === preset.id ? 'text-indigo-400' : 'text-gray-200 group-hover:text-white'}
                  `}>
                                        {preset.label}
                                    </span>
                                </div>

                                {/* Selected Checkmark */}
                                {selectedId === preset.id && (
                                    <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center shadow-lg">
                                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                        </svg>
                                    </div>
                                )}

                                {/* Delete Button (Custom Only) */}
                                {preset.isCustom && onRemoveCustom && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onRemoveCustom(preset.id);
                                        }}
                                        className="absolute top-2 left-2 p-1.5 rounded-full bg-black/50 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black hover:text-red-300"
                                        title="Delete Preset"
                                    >
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Footer / Actions (Optional) */}
                <div className="p-4 border-t border-gray-800 bg-[#121212] flex justify-end">
                    <button onClick={onClose} className="px-6 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors">
                        Done
                    </button>
                </div>

            </div>
        </div>
    );
};
