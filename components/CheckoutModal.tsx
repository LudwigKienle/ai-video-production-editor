

import React, { useState } from 'react';
import { LockIcon, CheckCircleIcon } from './icons';
import { SubscriptionPlan } from '../types';

interface CheckoutModalProps {
    plan: SubscriptionPlan;
    onClose: () => void;
    onSuccess: (licenseKey: string) => void;
}

const CheckoutModal: React.FC<CheckoutModalProps> = ({ plan, onClose, onSuccess }) => {
    const [licenseKey, setLicenseKey] = useState('');
    const [isVerifying, setIsVerifying] = useState(false);
    const [step, setStep] = useState<'enter_key' | 'success'>('enter_key');
    const [error, setError] = useState<string | null>(null);

    const price = 10;

    const handleVerify = (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsVerifying(true);

        // SIMULATION: In production, verify this key against Gumroad API
        // https://api.gumroad.com/v2/licenses/verify
        setTimeout(() => {
            if (licenseKey.length < 8) {
                setError("Invalid License Key format.");
                setIsVerifying(false);
                return;
            }

            setIsVerifying(false);
            setStep('success');

            // Auto-close after showing success
            setTimeout(() => {
                onSuccess(licenseKey);
            }, 1500);
        }, 1500);
    };

    if (step === 'success') {
        return (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[100] animate-fadeIn">
                <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center transform scale-100 transition-all">
                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <CheckCircleIcon className="w-10 h-10 text-green-600" />
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">Activation Successful!</h2>
                    <p className="text-gray-500">Welcome to the Pro plan.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[90]">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col md:flex-row">
                {/* Product Info Side */}
                <div className="bg-indigo-900 p-8 md:w-2/5 text-white flex flex-col justify-between relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-indigo-900 to-purple-900 opacity-50"></div>
                    <div className="relative z-10">
                        <h3 className="text-indigo-200 font-semibold text-xs uppercase tracking-wider mb-4">Unlock Pro</h3>
                        <div className="mb-2">
                            <span className="text-2xl font-bold capitalize block">Pro License</span>
                            <span className="text-4xl font-extrabold text-white">€{price}</span>
                            <span className="text-sm text-indigo-300 ml-1">/ one-time</span>
                        </div>
                        <ul className="text-xs text-indigo-200 space-y-2 mt-4">
                            <li>✓ All AI Features</li>
                            <li>✓ Lifetime Updates</li>
                            <li>✓ Commercial Usage</li>
                        </ul>
                    </div>
                    <div className="relative z-10 mt-8">
                        <p className="text-[10px] text-indigo-300">Don't have a key yet?</p>
                        <a
                            href="https://gumroad.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block mt-2 bg-white text-indigo-900 font-bold py-2 px-4 rounded text-xs hover:bg-indigo-50 transition-colors"
                        >
                            Purchase (€10) &rarr;
                        </a>
                    </div>
                </div>

                {/* Activation Form Side */}
                <div className="p-8 md:w-3/5 bg-white">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold text-gray-900">Activate License</h2>
                        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
                    </div>

                    <form onSubmit={handleVerify} className="space-y-4">
                        <div>
                            <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">License Key</label>
                            <input
                                type="text"
                                required
                                value={licenseKey}
                                onChange={(e) => setLicenseKey(e.target.value)}
                                className="w-full border border-gray-300 rounded-md p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900 font-mono placeholder-gray-400"
                                placeholder="XXXX-XXXX-XXXX-XXXX"
                            />
                            {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
                        </div>

                        <button
                            type="submit"
                            disabled={isVerifying}
                            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-md shadow-md transition-all flex items-center justify-center gap-2 mt-4 disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                            {isVerifying ? (
                                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            ) : (
                                <>
                                    <LockIcon className="w-4 h-4" /> Activate Software
                                </>
                            )}
                        </button>

                        <p className="text-[10px] text-gray-400 text-center mt-4">
                            Your license key was sent to your email receipt from Gumroad.
                        </p>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default CheckoutModal;