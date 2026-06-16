

import React from 'react';
import { SubscriptionPlan } from '../types';
import { MagicWandIcon, ScriptIcon, FilmIcon, BrainIcon, SparklesIcon, ClipboardCheckIcon, CheckCircleIcon, UserCircleIcon } from './icons';

interface PricingScreenProps {
    onSelectPlan: (plan: SubscriptionPlan) => void;
}

const PricingScreen: React.FC<PricingScreenProps> = ({ onSelectPlan }) => {
    return (
        <div className="min-h-screen bg-gray-900 text-white py-12 px-4 sm:px-6 lg:px-8 flex flex-col items-center">
            <div className="text-center max-w-3xl mx-auto mb-12">
                <h2 className="text-indigo-400 font-semibold tracking-wide uppercase text-sm mb-2">Upgrade your Studio</h2>
                <h1 className="text-4xl font-extrabold sm:text-5xl sm:tracking-tight mb-4">
                    One Price. All Features.
                </h1>
                <p className="text-xl text-gray-400">
                    Get full lifetime access for the price of a lunch.
                    <br/>
                    <span className="text-sm opacity-70">(You only pay Google for your own API usage)</span>
                </p>
            </div>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 max-w-4xl w-full">
                {/* Indie Plan */}
                <div className="flex flex-col bg-gray-800 rounded-2xl border border-gray-700 shadow-xl overflow-hidden hover:border-gray-600 transition-all transform hover:-translate-y-1 opacity-70 hover:opacity-100">
                    <div className="p-6 sm:p-10 flex-grow">
                        <h3 className="text-lg font-medium text-white">Trial</h3>
                        <p className="mt-2 text-sm text-gray-400">Explore the interface.</p>
                        <div className="mt-4 flex items-baseline text-white">
                            <span className="text-4xl font-extrabold tracking-tight">Free</span>
                        </div>
                        <ul className="mt-6 space-y-4">
                            <li className="flex items-start">
                                <div className="flex-shrink-0"><CheckIcon /></div>
                                <p className="ml-3 text-sm text-gray-300">Basic Timeline Editor</p>
                            </li>
                            <li className="flex items-start">
                                <div className="flex-shrink-0"><CheckIcon /></div>
                                <p className="ml-3 text-sm text-gray-300">Manual Image Generation</p>
                            </li>
                            <li className="flex items-start">
                                <div className="flex-shrink-0"><CheckIcon /></div>
                                <p className="ml-3 text-sm text-gray-300">Bring Your Own Key (BYOK)</p>
                            </li>
                        </ul>
                    </div>
                    <div className="p-6 border-t border-gray-700 bg-gray-900/50">
                        <button
                            onClick={() => onSelectPlan('free')}
                            className="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-4 rounded-lg transition-colors"
                        >
                            Continue Free
                        </button>
                    </div>
                </div>

                {/* Pro Plan */}
                <div className="flex flex-col bg-gradient-to-b from-indigo-900/40 to-gray-800 rounded-2xl border-2 border-indigo-500 shadow-2xl relative overflow-hidden transform scale-105 z-10">
                    <div className="absolute top-0 right-0 bg-indigo-500 text-white text-xs font-bold px-3 py-1 rounded-bl-lg uppercase">
                        Popular
                    </div>
                    <div className="p-6 sm:p-10 flex-grow">
                        <h3 className="text-lg font-medium text-indigo-300 flex items-center gap-2">
                            <SparklesIcon className="w-5 h-5"/> Pro License
                        </h3>
                        <p className="mt-2 text-sm text-gray-300">Unlock the full AI production suite.</p>
                        <div className="mt-4 flex items-baseline text-white">
                            <span className="text-5xl font-extrabold tracking-tight">€10</span>
                            <span className="ml-2 text-xl font-semibold text-gray-400">/ lifetime</span>
                        </div>
                        <ul className="mt-6 space-y-4">
                            <li className="flex items-start">
                                <div className="flex-shrink-0"><CheckIcon color="text-indigo-400" /></div>
                                <p className="ml-3 text-sm text-white font-medium flex items-center gap-2"><ScriptIcon className="w-4 h-4"/> AI Script Writer</p>
                            </li>
                            <li className="flex items-start">
                                <div className="flex-shrink-0"><CheckIcon color="text-indigo-400" /></div>
                                <p className="ml-3 text-sm text-white font-medium flex items-center gap-2"><MagicWandIcon className="w-4 h-4"/> Automated Storyboarding</p>
                            </li>
                            <li className="flex items-start">
                                <div className="flex-shrink-0"><CheckIcon color="text-indigo-400" /></div>
                                <p className="ml-3 text-sm text-white flex items-center gap-2"><BrainIcon className="w-4 h-4 text-purple-400"/> AI Director Review</p>
                            </li>
                            <li className="flex items-start">
                                <div className="flex-shrink-0"><CheckIcon color="text-indigo-400" /></div>
                                <p className="ml-3 text-sm text-white flex items-center gap-2"><ClipboardCheckIcon className="w-4 h-4"/> Cinematography Analysis</p>
                            </li>
                            <li className="flex items-start">
                                <div className="flex-shrink-0"><CheckIcon color="text-indigo-400" /></div>
                                <p className="ml-3 text-sm text-white">Commercial License</p>
                            </li>
                        </ul>
                    </div>
                    <div className="p-6 border-t border-indigo-500/30 bg-indigo-900/40">
                        <button
                            onClick={() => onSelectPlan('pro')}
                            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 px-4 rounded-lg transition-all shadow-lg shadow-indigo-500/40 flex items-center justify-center gap-2 text-lg"
                        >
                            Get Lifetime Access (€10)
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const CheckIcon: React.FC<{color?: string}> = ({color = "text-green-500"}) => (
    <svg className={`flex-shrink-0 h-5 w-5 ${color}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
);

export default PricingScreen;