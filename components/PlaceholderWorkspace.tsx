
import React from 'react';
import { MagicWandIcon } from './icons';

interface PlaceholderWorkspaceProps {
    name: string;
    description?: string;
}

const PlaceholderWorkspace: React.FC<PlaceholderWorkspaceProps> = ({ name, description }) => {
    return (
        <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 p-8">
            <div className="p-4 bg-gray-800 rounded-full border border-gray-700 mb-4">
                <MagicWandIcon className="w-12 h-12 text-indigo-500" />
            </div>
            <h2 className="text-3xl font-bold text-white mb-2">{name} Panel</h2>
            <p className="max-w-md">
                {description || `This workspace is under construction. Advanced ${name.toLowerCase()} tools will be available here in a future update.`}
            </p>
        </div>
    );
};

export default PlaceholderWorkspace;
