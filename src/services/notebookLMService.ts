export interface Notebook {
    id: string;
    title: string;
    sourceCount: number;
}

export interface NotebookLMService {
    init: () => Promise<boolean>;
    listNotebooks: () => Promise<Notebook[]>;
    queryNotebook: (notebookId: string, query: string) => Promise<string>;
    listResources: () => Promise<any[]>;
    listTools: () => Promise<any[]>;
    readResource: (uri: string) => Promise<any>;
}

type McpBridge = {
    init: () => Promise<{ ok?: boolean; error?: string }>;
    callTool: (name: string, args: any) => Promise<any>;
    listResources: () => Promise<any>;
    listTools: () => Promise<any>;
    readResource: (resourceUri: string) => Promise<any>;
};

const getMcpBridge = (): McpBridge | undefined => {
    return (window as any)?.electron?.mcp as McpBridge | undefined;
};

const stripCodeFences = (input: string) => {
    return String(input || '')
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
};

const parseJsonFromText = (input: string): any | null => {
    const cleaned = stripCodeFences(input);
    if (!cleaned) return null;
    try {
        return JSON.parse(cleaned);
    } catch {
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            try {
                return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
            } catch {
                return null;
            }
        }
        const firstBracket = cleaned.indexOf('[');
        const lastBracket = cleaned.lastIndexOf(']');
        if (firstBracket >= 0 && lastBracket > firstBracket) {
            try {
                return JSON.parse(cleaned.slice(firstBracket, lastBracket + 1));
            } catch {
                return null;
            }
        }
        return null;
    }
};

const extractMcpTextParts = (result: any): string[] => {
    const blocks: string[] = [];
    const append = (value: any) => {
        if (typeof value === 'string' && value.trim()) {
            blocks.push(value);
        }
    };

    const content = Array.isArray(result?.content)
        ? result.content
        : Array.isArray(result?.contents)
            ? result.contents
            : [];

    content.forEach((part: any) => {
        append(part?.text);
        append(part?.content);
        append(part?.data);
    });

    append(result?.text);
    append(result?.answer);
    append(result?.content);

    return blocks;
};

const normalizeNotebookList = (payload: any): Notebook[] => {
    const list = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.notebooks)
            ? payload.notebooks
            : [];

    return list
        .map((item: any, index: number) => {
            const id = String(item?.id || item?.notebook_id || item?.name || `notebook-${index + 1}`);
            const title = String(item?.title || item?.name || id).trim() || id;
            const sourceCountRaw = item?.sourceCount ?? item?.source_count ?? item?.sources ?? 0;
            const sourceCount = Number.isFinite(Number(sourceCountRaw)) ? Number(sourceCountRaw) : 0;
            return { id, title, sourceCount };
        })
        .filter((item: Notebook) => Boolean(item.id));
};

const parseToolResult = (result: any) => {
    if (result?.error) {
        throw new Error(String(result.error));
    }
    if (result?.isError) {
        const text = extractMcpTextParts(result).join('\n').trim();
        throw new Error(text || 'NotebookLM MCP tool returned an error.');
    }
    return result;
};

const callToolWithFallback = async (mcp: McpBridge, toolNames: string[], args: any) => {
    let lastError: Error | null = null;
    for (const name of toolNames) {
        try {
            const response = await mcp.callTool(name, args);
            return parseToolResult(response);
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
        }
    }
    throw lastError || new Error('No NotebookLM MCP tool responded.');
};

export const notebookLMService: NotebookLMService = {
    init: async () => {
        const mcp = getMcpBridge();
        if (mcp) {
            try {
                const result = await mcp.init();
                return Boolean(result && result.ok);
            } catch (error) {
                console.error('NotebookLM MCP init failed:', error);
                return false;
            }
        }
        return false;
    },

    listNotebooks: async () => {
        const mcp = getMcpBridge();
        if (!mcp) return [];

        const result = await callToolWithFallback(mcp, ['notebook_list', 'list_notebooks', 'notebooks_list'], {});
        const direct = normalizeNotebookList(result);
        if (direct.length > 0) return direct;

        const textBlocks = extractMcpTextParts(result);
        for (const block of textBlocks) {
            const parsed = parseJsonFromText(block);
            const notebooks = normalizeNotebookList(parsed);
            if (notebooks.length > 0) return notebooks;
        }
        return [];
    },

    queryNotebook: async (notebookId: string, query: string) => {
        const mcp = getMcpBridge();
        if (!mcp) return "MCP not available";

        const result = await callToolWithFallback(mcp, ['notebook_query', 'query_notebook', 'notebooks_query'], {
            notebook_id: notebookId,
            query: query
        });
        if (typeof result?.answer === 'string' && result.answer.trim()) {
            return result.answer.trim();
        }

        const textBlocks = extractMcpTextParts(result);
        if (textBlocks.length > 0) {
            return textBlocks.join('\n').trim();
        }
        return JSON.stringify(result, null, 2);
    },

    listResources: async () => {
        const mcp = getMcpBridge();
        if (!mcp) return [];
        const result = await mcp.listResources();
        if (result?.error) throw new Error(String(result.error));
        if (Array.isArray(result)) return result;
        return Array.isArray(result?.resources) ? result.resources : [];
    },

    listTools: async () => {
        const mcp = getMcpBridge();
        if (!mcp) return [];
        const result = await mcp.listTools();
        if (result?.error) throw new Error(String(result.error));
        if (Array.isArray(result)) return result;
        return Array.isArray(result?.tools) ? result.tools : [];
    },

    readResource: async (uri: string) => {
        const mcp = getMcpBridge();
        if (!mcp) return { error: 'MCP not available' };
        const result = await mcp.readResource(uri);
        if (result.error) {
            throw new Error(result.error);
        }
        return result;
    },
};
