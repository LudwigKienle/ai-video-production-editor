

import React, { useState } from 'react';
import { User, BillingProfile } from '../types';
import { ReceiptIcon, CheckCircleIcon, UserCircleIcon, LockIcon } from './icons';

interface BillingModalProps {
    user: User;
    onClose: () => void;
    onUpgrade: () => void;
}

const BillingModal: React.FC<BillingModalProps> = ({ user, onClose, onUpgrade }) => {
    const [activeTab, setActiveTab] = useState<'overview' | 'invoices'>('overview');

    // Mock Data Generator if profile exists
    const mockBillingProfile: BillingProfile = user.billingProfile || {
        licenseKey: user.plan !== 'free' ? 'ABCD-1234-EFGH-5678' : undefined,
        status: user.plan === 'free' ? 'canceled' : 'active',
        invoices: [
            { id: 'inv_1', date: new Date().toISOString(), amount: 1000, status: 'paid', pdfUrl: '#' }
        ]
    };

    const formatDate = (isoString: string) => {
        return new Date(isoString).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[80]">
            <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl h-[80vh] flex flex-col overflow-hidden">
                <header className="flex justify-between items-center p-6 border-b border-gray-800">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-500/20 rounded-lg">
                            <UserCircleIcon className="w-6 h-6 text-indigo-400" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white">Account & License</h2>
                            <p className="text-xs text-gray-400">{user.email}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">&times;</button>
                </header>

                <div className="flex border-b border-gray-800 px-6">
                    <button
                        onClick={() => setActiveTab('overview')}
                        className={`py-4 mr-6 text-sm font-medium border-b-2 transition-colors ${activeTab === 'overview' ? 'border-indigo-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
                    >
                        Overview
                    </button>
                    {user.plan !== 'free' && (
                        <button
                            onClick={() => setActiveTab('invoices')}
                            className={`py-4 text-sm font-medium border-b-2 transition-colors ${activeTab === 'invoices' ? 'border-indigo-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
                        >
                            History
                        </button>
                    )}
                </div>

                <div className="flex-grow overflow-y-auto p-6">
                    {activeTab === 'overview' && (
                        <div className="space-y-6">
                            {/* Current Plan Card */}
                            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700 relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-4 opacity-10">
                                    <LockIcon className="w-24 h-24 text-white" />
                                </div>
                                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">Current License</h3>
                                <div className="flex items-end gap-2 mb-4">
                                    <span className="text-3xl font-bold text-white capitalize">{user.plan === 'pro' ? 'Pro License' : 'Free Trial'}</span>
                                    {user.plan !== 'free' && (
                                        <span className="bg-indigo-500/20 text-indigo-400 text-xs px-2 py-1 rounded-full font-bold mb-1 border border-indigo-500/30">
                                            Lifetime Access
                                        </span>
                                    )}
                                </div>

                                {user.plan === 'free' ? (
                                    <button onClick={onUpgrade} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm">
                                        Buy Lifetime License (€10)
                                    </button>
                                ) : (
                                    <div className="bg-gray-900/50 p-4 rounded border border-gray-700 mt-4">
                                        <div className="flex justify-between items-center mb-1">
                                            <p className="text-xs text-gray-400 uppercase font-semibold">License Key</p>
                                            <span className="text-xs text-green-400 font-bold flex items-center gap-1"><CheckCircleIcon className="w-3 h-3"/> Valid</span>
                                        </div>
                                        <p className="text-lg font-mono text-white tracking-widest">{mockBillingProfile.licenseKey}</p>
                                        <p className="text-[10px] text-gray-500 mt-2">Purchased via Gumroad</p>
                                    </div>
                                )}
                            </div>

                            {/* Features Summary */}
                            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Features Unlocked</h3>
                                <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <li className="flex items-center gap-2 text-sm text-gray-300"><CheckCircleIcon className={`w-4 h-4 ${user.plan === 'pro' ? 'text-green-500' : 'text-gray-600'}`}/> Unlimited Projects</li>
                                    <li className="flex items-center gap-2 text-sm text-gray-300"><CheckCircleIcon className={`w-4 h-4 ${user.plan === 'pro' ? 'text-green-500' : 'text-gray-600'}`}/> 4K Export Quality</li>
                                    <li className="flex items-center gap-2 text-sm text-gray-300"><CheckCircleIcon className={`w-4 h-4 ${user.plan === 'pro' ? 'text-green-500' : 'text-gray-600'}`}/> AI Scriptwriter</li>
                                    <li className="flex items-center gap-2 text-sm text-gray-300"><CheckCircleIcon className={`w-4 h-4 ${user.plan === 'pro' ? 'text-green-500' : 'text-gray-600'}`}/> AI Director Mode</li>
                                </ul>
                            </div>
                        </div>
                    )}

                    {activeTab === 'invoices' && user.plan !== 'free' && (
                        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                            <table className="w-full text-left text-sm text-gray-400">
                                <thead className="bg-gray-900/50 text-xs uppercase font-bold text-gray-500">
                                    <tr>
                                        <th className="px-6 py-3">Date</th>
                                        <th className="px-6 py-3">Amount</th>
                                        <th className="px-6 py-3">Status</th>
                                        <th className="px-6 py-3 text-right">Receipt</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-700">
                                    {mockBillingProfile.invoices.map(invoice => (
                                        <tr key={invoice.id} className="hover:bg-gray-700/30 transition-colors">
                                            <td className="px-6 py-4">{formatDate(invoice.date)}</td>
                                            <td className="px-6 py-4 text-white font-medium">€{(invoice.amount / 100).toFixed(2)}</td>
                                            <td className="px-6 py-4">
                                                <span className="bg-green-500/10 text-green-400 px-2 py-1 rounded-full text-xs font-bold border border-green-500/20 capitalize">{invoice.status}</span>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <button className="text-indigo-400 hover:text-white flex items-center justify-end gap-1 ml-auto">
                                                    <ReceiptIcon className="w-4 h-4" /> <span className="text-xs">Invoice</span>
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BillingModal;