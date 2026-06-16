
import React from 'react';
import { ScriptIcon } from '../components/icons';

const ScriptWorkspace: React.FC = () => {
    return (
        <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <ScriptIcon className="w-16 h-16 mb-4 text-gray-700"/>
            <h2 className="text-xl font-semibold">Script Workspace</h2>
            <p>Please use the "Project" tab for the integrated script and production workflow.</p>
        </div>
    );
};

export default ScriptWorkspace;
