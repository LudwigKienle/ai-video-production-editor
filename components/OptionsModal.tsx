import React, { useState, useEffect } from 'react';

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

export type OptionsModalConfig = {
    title: string;
    description: string;
    fields: FormField[];
    submitText?: string;
};

interface OptionsModalProps {
    isOpen: boolean;
    config: OptionsModalConfig | null;
    onClose: () => void;
    onSubmit: (values: Record<string, any>) => void;
}

const OptionsModal: React.FC<OptionsModalProps> = ({ isOpen, config, onClose, onSubmit }) => {
    const [formState, setFormState] = useState<Record<string, any>>({});
    const [filePreview, setFilePreview] = useState<string | null>(null);

    useEffect(() => {
        if (config) {
            const initialState: Record<string, any> = {};
            config.fields.forEach(field => {
                initialState[field.name] = field.defaultValue || '';
            });
            setFormState(initialState);
            setFilePreview(null);
        }
    }, [config]);

    useEffect(() => {
        // Clean up object URL on unmount or when file changes
        return () => {
            if (filePreview) {
                URL.revokeObjectURL(filePreview);
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
            if (filePreview) URL.revokeObjectURL(filePreview);
            setFilePreview(URL.createObjectURL(file));
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(formState);
    };

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-[70]">
            <div className="bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl p-6 max-w-lg w-full text-left transform transition-all duration-300 scale-100">
                <h2 className="text-2xl font-bold mb-2 text-white">{config.title}</h2>
                <p className="text-gray-400 mb-6">{config.description}</p>
                <form onSubmit={handleSubmit} className="space-y-4">
                    {config.fields.map(field => (
                        <div key={field.name}>
                            <label htmlFor={field.name} className="block text-sm font-medium text-gray-300 mb-1">{field.label}</label>
                            {field.type === 'textarea' ? (
                                <textarea
                                    id={field.name}
                                    name={field.name}
                                    value={formState[field.name] || ''}
                                    onChange={handleInputChange}
                                    required={field.required}
                                    rows={3}
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 focus:ring-2 focus:ring-indigo-500"
                                    placeholder={field.required ? 'Required' : 'Optional'}
                                />
                            ) : field.type === 'select' ? (
                                <select
                                    id={field.name}
                                    name={field.name}
                                    value={formState[field.name]}
                                    onChange={handleInputChange}
                                    required={field.required}
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 focus:ring-2 focus:ring-indigo-500"
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
                                        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 focus:ring-2 focus:ring-indigo-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                                    />
                                    {filePreview && <img src={filePreview} alt="Preview" className="mt-2 rounded-lg max-h-32"/>}
                                </>
                            ) : (
                                <input
                                    type="text"
                                    id={field.name}
                                    name={field.name}
                                    value={formState[field.name] || ''}
                                    onChange={handleInputChange}
                                    required={field.required}
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 focus:ring-2 focus:ring-indigo-500"
                                />
                            )}
                        </div>
                    ))}
                    <div className="flex justify-end gap-2 pt-4">
                         <button type="button" onClick={onClose} className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg">Cancel</button>
                         <button type="submit" className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-lg">{config.submitText || 'Generate'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default OptionsModal;
