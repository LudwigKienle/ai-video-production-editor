import React, { useMemo, useState } from 'react';
import { Notebook, notebookLMService } from '../services/notebookLMService';

const NotebookLMPanel: React.FC = () => {
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [notebooks, setNotebooks] = useState<Notebook[]>([]);
    const [selectedNotebookId, setSelectedNotebookId] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [tools, setTools] = useState<any[]>([]);
    const [resources, setResources] = useState<any[]>([]);
    const [resourcesLoading, setResourcesLoading] = useState(false);
    const [toolsLoading, setToolsLoading] = useState(false);
    const [resourceFilter, setResourceFilter] = useState('');
    const [resourcePreview, setResourcePreview] = useState<{ uri: string; title?: string; content: string } | null>(null);
    const [resourcePreviewLoading, setResourcePreviewLoading] = useState(false);
    const [resourcePreviewError, setResourcePreviewError] = useState<string | null>(null);

    const formatPreviewContent = (payload: any) => {
        if (typeof payload === 'string') return payload;
        if (typeof payload?.content === 'string') return payload.content;
        if (typeof payload?.text === 'string') return payload.text;
        if (Array.isArray(payload?.contents)) {
            return payload.contents
                .map((entry: any) => {
                    if (typeof entry?.text === 'string') return entry.text;
                    if (typeof entry?.content === 'string') return entry.content;
                    if (entry?.data !== undefined) {
                        if (typeof entry.data === 'string') return entry.data;
                        return JSON.stringify(entry.data, null, 2);
                    }
                    return '';
                })
                .filter(Boolean)
                .join('\n\n');
        }
        return JSON.stringify(payload, null, 2);
    };

    const connect = async () => {
        setError(null);
        setIsConnecting(true);
        try {
            const ok = await notebookLMService.init();
            if (ok) {
                setIsConnected(true);
                await Promise.all([loadNotebooks(), loadResources(), loadTools()]);
            } else {
                setError("Failed to connect to NotebookLM MCP. Make sure the server is running.");
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setIsConnecting(false);
        }
    };

    const loadNotebooks = async () => {
        try {
            const list = await notebookLMService.listNotebooks();
            setNotebooks(Array.isArray(list) ? list : []);
        } catch (e: any) {
            setError("Failed to list notebooks: " + e.message);
        }
    };

    const loadResources = async () => {
        setResourcesLoading(true);
        try {
            const list = await notebookLMService.listResources();
            setResources(list || []);
        } catch (e: any) {
            setError("Failed to list MCP resources: " + e.message);
        } finally {
            setResourcesLoading(false);
        }
    };

    const loadTools = async () => {
        setToolsLoading(true);
        try {
            const list = await notebookLMService.listTools();
            setTools(list || []);
        } catch (e: any) {
            setError("Failed to list MCP tools: " + e.message);
        } finally {
            setToolsLoading(false);
        }
    };

    const formatResourceLabel = (resource: any) =>
        resource?.name || resource?.title || resource?.uri || resource?.id || 'Untitled Resource';

    const formatToolLabel = (tool: any) =>
        tool?.name || tool?.title || tool?.id || 'Tool';

    const filteredResources = useMemo(() => {
        const term = resourceFilter.trim().toLowerCase();
        if (!term) return resources;
        return resources.filter((resource) => {
            const label = formatResourceLabel(resource).toLowerCase();
            const uri = String(resource?.uri || '').toLowerCase();
            return label.includes(term) || uri.includes(term);
        });
    }, [resourceFilter, resources]);

    const handlePreviewResource = async (resource: any) => {
        const uri = resource?.uri;
        if (!uri) return;
        setResourcePreviewLoading(true);
        setResourcePreviewError(null);
        try {
            const result = await notebookLMService.readResource(uri);
            const content = formatPreviewContent(result);
            setResourcePreview({ uri, title: formatResourceLabel(resource), content });
        } catch (e: any) {
            setResourcePreviewError(e.message);
            setResourcePreview(null);
        } finally {
            setResourcePreviewLoading(false);
        }
    };

    const handleQuery = async () => {
        if (!selectedNotebookId || !query.trim() || isLoading) return;

        const userMsg = query;
        setChatHistory(prev => [...prev, { role: 'user', content: userMsg }]);
        setQuery('');
        setIsLoading(true);

        try {
            const answer = await notebookLMService.queryNotebook(selectedNotebookId, userMsg);
            setChatHistory(prev => [...prev, { role: 'assistant', content: answer }]);
        } catch (e: any) {
            setChatHistory(prev => [...prev, { role: 'assistant', content: "Error: " + e.message }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-gray-900 text-white p-4">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">NotebookLM Research</h2>
                {isConnected && (
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-200 border border-emerald-500/30">
                            Connected
                        </span>
                        <button
                            onClick={() => {
                                loadNotebooks();
                                loadResources();
                                loadTools();
                            }}
                            className="bg-gray-800 hover:bg-gray-700 text-xs px-3 py-1.5 rounded"
                        >
                            Refresh
                        </button>
                        <button
                            onClick={() => setChatHistory([])}
                            className="bg-gray-800 hover:bg-gray-700 text-xs px-3 py-1.5 rounded"
                        >
                            Clear Chat
                        </button>
                    </div>
                )}
            </div>

            {error && (
                <div className="bg-red-500/20 text-red-200 p-2 rounded mb-4">
                    {error}
                </div>
            )}

            {!isConnected ? (
                <div className="flex flex-col items-center justify-center flex-1">
                    <button
                        onClick={connect}
                        disabled={isConnecting}
                        className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-lg font-medium transition-colors"
                    >
                        {isConnecting ? 'Connecting...' : 'Connect to NotebookLM'}
                    </button>
                    <p className="mt-2 text-gray-400 text-sm">Requires local MCP server</p>
                </div>
            ) : (
                <div className="flex flex-col lg:flex-row gap-4 flex-1 overflow-hidden">
                    <div className="flex-1 flex flex-col min-h-[300px]">
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-gray-400 mb-1">Select Notebook</label>
                            <select
                                className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white"
                                onChange={(e) => setSelectedNotebookId(e.target.value)}
                                value={selectedNotebookId || ''}
                            >
                                <option value="">-- Select a Notebook --</option>
                                {notebooks.map(nb => (
                                    <option key={nb.id} value={nb.id}>
                                        {nb.title} ({nb.sourceCount} sources)
                                    </option>
                                ))}
                            </select>
                        </div>

                        {selectedNotebookId && (
                            <div className="flex-1 flex flex-col bg-gray-800 rounded-lg overflow-hidden border border-gray-700">
                                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                                    {chatHistory.map((msg, i) => (
                                        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`max-w-[80%] rounded-lg p-3 ${msg.role === 'user'
                                                    ? 'bg-blue-600 text-white'
                                                    : 'bg-gray-700 text-gray-200'
                                                }`}>
                                                <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                                                {msg.role === 'assistant' && (
                                                    <button
                                                        className="mt-2 text-[10px] text-blue-200 hover:text-white"
                                                        onClick={() => navigator.clipboard.writeText(msg.content)}
                                                    >
                                                        Copy answer
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    {isLoading && (
                                        <div className="flex justify-start">
                                            <div className="bg-gray-700 text-gray-200 rounded-lg p-3 animate-pulse">
                                                Thinking...
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="p-4 border-t border-gray-700 flex gap-2">
                                    <input
                                        type="text"
                                        className="flex-1 bg-gray-900 border border-gray-600 rounded p-2 text-white focus:outline-none focus:border-blue-500"
                                        placeholder="Ask a question..."
                                        value={query}
                                        onChange={(e) => setQuery(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleQuery()}
                                        disabled={isLoading}
                                    />
                                    <button
                                        className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded disabled:opacity-50"
                                        onClick={handleQuery}
                                        disabled={isLoading}
                                    >
                                        Send
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="w-full lg:w-80 flex flex-col gap-4">
                        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-white">MCP Resources</h3>
                                <button
                                    onClick={loadResources}
                                    className="text-[10px] text-gray-400 hover:text-white"
                                >
                                    Refresh
                                </button>
                            </div>
                            <input
                                value={resourceFilter}
                                onChange={(e) => setResourceFilter(e.target.value)}
                                placeholder="Search resources..."
                                className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-xs text-white"
                            />
                            {resourcesLoading ? (
                                <div className="text-xs text-gray-400">Loading resources...</div>
                            ) : (
                                <div className="max-h-56 overflow-y-auto space-y-2">
                                    {filteredResources.map((resource, index) => (
                                        <div key={resource?.uri || index} className="bg-gray-900/60 border border-gray-700 rounded p-2">
                                            <div className="text-xs text-gray-200 truncate">{formatResourceLabel(resource)}</div>
                                            {resource?.uri && (
                                                <div className="text-[10px] text-gray-500 truncate">{resource.uri}</div>
                                            )}
                                            <div className="mt-2 flex items-center gap-2">
                                                <button
                                                    className="text-[10px] text-blue-200 hover:text-white"
                                                    onClick={() => handlePreviewResource(resource)}
                                                >
                                                    Preview
                                                </button>
                                                {resource?.uri && (
                                                    <button
                                                        className="text-[10px] text-gray-400 hover:text-white"
                                                        onClick={() => navigator.clipboard.writeText(resource.uri)}
                                                    >
                                                        Copy URI
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    {filteredResources.length === 0 && (
                                        <div className="text-[10px] text-gray-500">No resources found.</div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-white">MCP Tools</h3>
                                <button
                                    onClick={loadTools}
                                    className="text-[10px] text-gray-400 hover:text-white"
                                >
                                    Refresh
                                </button>
                            </div>
                            {toolsLoading ? (
                                <div className="text-xs text-gray-400">Loading tools...</div>
                            ) : (
                                <div className="max-h-40 overflow-y-auto space-y-2">
                                    {tools.map((tool, index) => (
                                        <div key={tool?.name || index} className="bg-gray-900/60 border border-gray-700 rounded p-2">
                                            <div className="text-xs text-gray-200 truncate">{formatToolLabel(tool)}</div>
                                            {tool?.description && (
                                                <div className="text-[10px] text-gray-500 line-clamp-2">{tool.description}</div>
                                            )}
                                        </div>
                                    ))}
                                    {tools.length === 0 && (
                                        <div className="text-[10px] text-gray-500">No tools reported.</div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-2">
                            <h3 className="text-sm font-semibold text-white">Resource Preview</h3>
                            {resourcePreviewLoading && (
                                <div className="text-xs text-gray-400">Loading preview...</div>
                            )}
                            {resourcePreviewError && (
                                <div className="text-xs text-red-300">{resourcePreviewError}</div>
                            )}
                            {!resourcePreviewLoading && !resourcePreview && (
                                <div className="text-[10px] text-gray-500">Select a resource to preview.</div>
                            )}
                            {resourcePreview && (
                                <div className="space-y-2">
                                    <div className="text-[10px] text-gray-400 truncate">{resourcePreview.title}</div>
                                    <div className="text-[10px] text-gray-500 truncate">{resourcePreview.uri}</div>
                                    <div className="max-h-40 overflow-y-auto text-[11px] whitespace-pre-wrap text-gray-200 bg-gray-900/60 border border-gray-700 rounded p-2">
                                        {resourcePreview.content}
                                    </div>
                                    <button
                                        className="text-[10px] text-blue-200 hover:text-white"
                                        onClick={() => navigator.clipboard.writeText(resourcePreview.content)}
                                    >
                                        Copy content
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default NotebookLMPanel;
