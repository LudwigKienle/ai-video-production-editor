import React, { useEffect, useState } from 'react';
import { MagicWandIcon, LockIcon } from './icons';
import { getReplicateKeyPreview, validateReplicateApiKey } from '../services/replicateService';

interface ApiKeyModalProps {
  onKeySelected: () => void;
}

const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ onKeySelected }) => {
  const [googleKey, setGoogleKey] = useState('');
  const [replicateKey, setReplicateKey] = useState('');
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [error, setError] = useState('');
  const [replicateSavedPreview, setReplicateSavedPreview] = useState<string | null>(null);
  const [elevenLabsSavedPreview, setElevenLabsSavedPreview] = useState<string | null>(null);
  const [replicateTestStatus, setReplicateTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [replicateTestMessage, setReplicateTestMessage] = useState<string>('');

  useEffect(() => {
    setReplicateSavedPreview(getReplicateKeyPreview());
    const existingElevenLabs = localStorage.getItem('elevenlabs_api_key')?.trim();
    if (existingElevenLabs) {
      const preview = `${existingElevenLabs.slice(0, 4)}…${existingElevenLabs.slice(-4)}`;
      setElevenLabsSavedPreview(preview);
    }
  }, []);

  const handleSaveKeys = () => {
    setError('');

    const existingGoogle = localStorage.getItem('gemini_api_key')?.trim();
    const nextGoogle = googleKey.trim() || existingGoogle;
    if (!nextGoogle && !replicateKey.trim() && !elevenLabsKey.trim() && !replicateSavedPreview && !elevenLabsSavedPreview) {
      setError('Please enter at least one API key to continue.');
      return;
    }

    if (googleKey.trim()) localStorage.setItem('gemini_api_key', googleKey.trim());
    if (replicateKey.trim()) {
      localStorage.setItem('replicate_api_key', replicateKey.trim());
      setReplicateSavedPreview(getReplicateKeyPreview());
    }
    if (elevenLabsKey.trim()) {
      localStorage.setItem('elevenlabs_api_key', elevenLabsKey.trim());
      const preview = `${elevenLabsKey.trim().slice(0, 4)}…${elevenLabsKey.trim().slice(-4)}`;
      setElevenLabsSavedPreview(preview);
    }

    onKeySelected();
  };

  const handleTestReplicateKey = async () => {
    setError('');
    setReplicateTestStatus('testing');
    setReplicateTestMessage('');

    if (replicateKey.trim()) {
      localStorage.setItem('replicate_api_key', replicateKey.trim());
      setReplicateSavedPreview(getReplicateKeyPreview());
    }

    const result = await validateReplicateApiKey();
    if (result.ok) {
      setReplicateTestStatus('ok');
      setReplicateTestMessage('Replicate token works.');
    } else {
      setReplicateTestStatus('error');
      setReplicateTestMessage('message' in result ? result.message : 'Replicate token test failed.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50">
      <div className="bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl p-8 max-w-lg w-full text-center transform transition-all duration-300 scale-100">
        <div className="flex justify-center mb-6">
            <div className="p-4 bg-indigo-500/10 rounded-full border border-indigo-500/20">
              <MagicWandIcon className="w-12 h-12 text-indigo-400" />
            </div>
        </div>
        <h2 className="text-3xl font-bold mb-2 text-white">Setup Studio</h2>
        <p className="text-gray-400 mb-6 text-sm">
          Connect your AI providers to unlock generation features.
        </p>

        <div className="text-left mb-6">
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Google Gemini API Key</label>
            <div className="relative">
                <input
                    type="password"
                    value={googleKey}
                    onChange={(e) => setGoogleKey(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 pl-10 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    placeholder="AIzaSy..."
                />
                <div className="absolute left-3 top-3.5 text-gray-500">
                    <LockIcon className="w-4 h-4" />
                </div>
            </div>
            {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
            <p className="text-xs text-gray-500 mt-2">
                Don't have a key? <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">Get one from Google AI Studio</a>.
            </p>
        </div>

        <div className="text-left mb-6">
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-bold text-gray-500 uppercase">Replicate API Token (Optional)</label>
            {replicateSavedPreview && (
              <span className="text-[10px] text-green-300">Saved: {replicateSavedPreview}</span>
            )}
          </div>
          <div className="relative">
            <input
              type="password"
              value={replicateKey}
              onChange={(e) => setReplicateKey(e.target.value)}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 pl-10 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
              placeholder="r8_..."
            />
            <div className="absolute left-3 top-3.5 text-gray-500">
              <LockIcon className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={handleTestReplicateKey}
              disabled={replicateTestStatus === 'testing'}
              className="text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-lg"
            >
              {replicateTestStatus === 'testing' ? 'Testing…' : 'Test Replicate Token'}
            </button>
            {replicateTestStatus !== 'idle' && (
              <span
                className={`text-xs ${
                  replicateTestStatus === 'ok'
                    ? 'text-green-300'
                    : replicateTestStatus === 'error'
                      ? 'text-red-300'
                      : 'text-gray-300'
                }`}
              >
                {replicateTestMessage}
              </span>
            )}
          </div>
        </div>

        <div className="text-left mb-6">
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-bold text-gray-500 uppercase">ElevenLabs API Key (Optional)</label>
            {elevenLabsSavedPreview && (
              <span className="text-[10px] text-green-300">Saved: {elevenLabsSavedPreview}</span>
            )}
          </div>
          <div className="relative">
            <input
              type="password"
              value={elevenLabsKey}
              onChange={(e) => setElevenLabsKey(e.target.value)}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 pl-10 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
              placeholder="sk-..."
            />
            <div className="absolute left-3 top-3.5 text-gray-500">
              <LockIcon className="w-4 h-4" />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Enables ElevenLabs voice generation.
          </p>
        </div>

        <button
          onClick={handleSaveKeys}
          className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-6 rounded-lg transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-indigo-500/50"
        >
          Connect & Start
        </button>
      </div>
    </div>
  );
};

export default ApiKeyModal;
