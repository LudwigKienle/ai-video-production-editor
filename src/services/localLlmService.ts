import type { GoogleGenAI } from '@google/genai';

/**
 * Local LLMs (Ollama, LM Studio, any OpenAI-compatible server).
 *
 * The app's text features all call Gemini through `ai.models.generateContent`. When a
 * local model is selected, `withLocalLlm` answers those calls from the local server
 * instead: it translates the Gemini request (system instruction, history, function
 * declarations, JSON schema) to an OpenAI-style chat completion and the answer back to
 * a Gemini-shaped response. Requests a local model cannot serve (image/video/audio
 * generation, video or audio input) still go to Gemini.
 */

export type LocalLlmProvider = 'ollama' | 'lmstudio' | 'openai-compatible';

export type LocalLlmConfig = {
  provider: LocalLlmProvider;
  baseUrl: string;
  /** Model used for text features; empty means local text is not set up. */
  model: string;
  /** 'local' answers text features locally; 'gemini' only uses the local model when no Gemini key is set. */
  textProvider: 'gemini' | 'local';
};

export const LOCAL_LLM_DEFAULT_URLS: Record<LocalLlmProvider, string> = {
  ollama: 'http://127.0.0.1:11434',
  lmstudio: 'http://127.0.0.1:1234',
  'openai-compatible': 'http://127.0.0.1:8080',
};

const STORAGE_KEY = 'local_llm_config_v1';

const DEFAULT_CONFIG: LocalLlmConfig = {
  provider: 'ollama',
  baseUrl: LOCAL_LLM_DEFAULT_URLS.ollama,
  model: '',
  textProvider: 'gemini',
};

const listeners = new Set<(config: LocalLlmConfig) => void>();

export const getLocalLlmConfig = (): LocalLlmConfig => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      provider: ['ollama', 'lmstudio', 'openai-compatible'].includes(parsed?.provider) ? parsed.provider : DEFAULT_CONFIG.provider,
      textProvider: parsed?.textProvider === 'local' ? 'local' : 'gemini',
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
};

export const setLocalLlmConfig = (patch: Partial<LocalLlmConfig>): LocalLlmConfig => {
  const next = { ...getLocalLlmConfig(), ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  for (const listener of listeners) listener(next);
  return next;
};

export const onLocalLlmConfigChange = (listener: (config: LocalLlmConfig) => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const isLocalLlmReady = (config = getLocalLlmConfig()) => Boolean(config.model && config.baseUrl);

// ---------------------------------------------------------------------------
// Transport: through the Electron main process when available (no CORS), else fetch.
// ---------------------------------------------------------------------------

type LocalAiBridge = {
  request: (payload: { url: string; method?: string; body?: unknown; timeoutMs?: number }) => Promise<{ ok: boolean; status: number; body?: string; base64?: string; contentType?: string; error?: string }>;
  stream: (payload: { id: string; url: string; method?: string; body?: unknown }) => Promise<{ ok: boolean; error?: string }>;
  cancelStream: (payload: { id: string }) => Promise<{ ok: boolean }>;
  onStreamEvent: (callback: (event: { id: string; data?: any; done?: boolean; error?: string }) => void) => () => void;
};

export const localAiBridge = (): LocalAiBridge | undefined =>
  (typeof window !== 'undefined' ? (window as any).electron?.localAi : undefined);

const trimUrl = (url: string) => url.replace(/\/+$/, '');

export type LocalHttpResult = { ok: boolean; status: number; text: string; base64?: string; contentType?: string };

/** JSON request to a local server; returns the raw text so callers can report server errors verbatim. */
export const localHttp = async (url: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<LocalHttpResult> => {
  const bridge = localAiBridge();
  if (bridge) {
    const result = await bridge.request({ url, method: init.method || (init.body === undefined ? 'GET' : 'POST'), body: init.body, timeoutMs: init.timeoutMs });
    if (result.error && !result.status) throw new Error(result.error);
    return { ok: result.ok, status: result.status, text: result.body || '', base64: result.base64, contentType: result.contentType };
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), init.timeoutMs || 120000);
  try {
    const response = await fetch(url, {
      method: init.method || (init.body === undefined ? 'GET' : 'POST'),
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') || '';
    if (/^image\//.test(contentType)) {
      const buffer = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (let i = 0; i < buffer.length; i += 1) binary += String.fromCharCode(buffer[i]);
      return { ok: response.ok, status: response.status, text: '', base64: btoa(binary), contentType };
    }
    return { ok: response.ok, status: response.status, text: await response.text(), contentType };
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error(`Local server did not answer in time (${url}).`);
    throw new Error(`Could not reach ${url}. Is the server running? (${error?.message || error})`);
  } finally {
    window.clearTimeout(timer);
  }
};

const localJson = async (url: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}) => {
  const result = await localHttp(url, init);
  let data: any = null;
  try {
    data = result.text ? JSON.parse(result.text) : null;
  } catch {
    data = null;
  }
  if (!result.ok) {
    const message = data?.error?.message || data?.error || result.text || `HTTP ${result.status}`;
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
  }
  return data;
};

// ---------------------------------------------------------------------------
// Servers and models
// ---------------------------------------------------------------------------

export type LocalLlmModel = {
  id: string;
  sizeBytes?: number;
  parameterSize?: string;
  family?: string;
  vision?: boolean;
};

export type LocalServerStatus = { provider: LocalLlmProvider; baseUrl: string; online: boolean; version?: string; error?: string };

export const probeLocalServer = async (provider: LocalLlmProvider, baseUrl = LOCAL_LLM_DEFAULT_URLS[provider]): Promise<LocalServerStatus> => {
  const base = trimUrl(baseUrl);
  try {
    if (provider === 'ollama') {
      const data = await localJson(`${base}/api/version`, { timeoutMs: 4000 });
      return { provider, baseUrl: base, online: true, version: data?.version };
    }
    await localJson(`${base}/v1/models`, { timeoutMs: 4000 });
    return { provider, baseUrl: base, online: true };
  } catch (error: any) {
    return { provider, baseUrl: base, online: false, error: error?.message || String(error) };
  }
};

/** Looks for Ollama and LM Studio on their default ports. */
export const detectLocalServers = async () => Promise.all([
  probeLocalServer('ollama'),
  probeLocalServer('lmstudio'),
]);

const VISION_HINT = /vision|vl\b|-vl|llava|gemma3|gemma4|qwen3\.5|qwen3\.6|mistral-small|minicpm-v|moondream|pixtral/i;

export const listLocalModels = async (provider: LocalLlmProvider, baseUrl: string): Promise<LocalLlmModel[]> => {
  const base = trimUrl(baseUrl);
  if (provider === 'ollama') {
    const data = await localJson(`${base}/api/tags`, { timeoutMs: 8000 });
    return (Array.isArray(data?.models) ? data.models : []).map((model: any) => ({
      id: String(model.name || model.model),
      sizeBytes: typeof model.size === 'number' ? model.size : undefined,
      parameterSize: model.details?.parameter_size,
      family: model.details?.family,
      vision: VISION_HINT.test(String(model.name || '')) || (Array.isArray(model.details?.families) && model.details.families.some((f: string) => /clip|mllama|vision/i.test(f))),
    }));
  }
  const data = await localJson(`${base}/v1/models`, { timeoutMs: 8000 });
  return (Array.isArray(data?.data) ? data.data : [])
    .filter((model: any) => !/embed/i.test(String(model.id)))
    .map((model: any) => ({ id: String(model.id), vision: VISION_HINT.test(String(model.id)) }));
};

export type PullProgress = { status: string; completed?: number; total?: number; done?: boolean; error?: string };

/** Download a model into Ollama ("ollama pull"), reporting progress. Resolves when the pull finishes. */
export const pullOllamaModel = (baseUrl: string, model: string, onProgress: (progress: PullProgress) => void): { promise: Promise<void>; cancel: () => void } => {
  const base = trimUrl(baseUrl);
  const bridge = localAiBridge();
  if (bridge) {
    const id = `pull-${model}-${Date.now()}`;
    let unsubscribe = () => {};
    const promise = new Promise<void>((resolve, reject) => {
      unsubscribe = bridge.onStreamEvent((event) => {
        if (event.id !== id) return;
        if (event.error) {
          unsubscribe();
          onProgress({ status: 'error', error: event.error });
          reject(new Error(event.error));
        } else if (event.done) {
          unsubscribe();
          onProgress({ status: 'success', done: true });
          resolve();
        } else if (event.data) {
          if (event.data.error) {
            unsubscribe();
            onProgress({ status: 'error', error: event.data.error });
            reject(new Error(event.data.error));
            return;
          }
          onProgress({ status: String(event.data.status || ''), completed: event.data.completed, total: event.data.total });
        }
      });
      bridge.stream({ id, url: `${base}/api/pull`, body: { model, stream: true } }).then((result) => {
        if (!result.ok) {
          unsubscribe();
          reject(new Error(result.error || 'Could not start the download.'));
        }
      });
    });
    return { promise, cancel: () => { bridge.cancelStream({ id }); unsubscribe(); } };
  }

  const controller = new AbortController();
  const promise = (async () => {
    const response = await fetch(`${base}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error(`Ollama pull failed: HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const data = JSON.parse(line);
        if (data.error) throw new Error(data.error);
        onProgress({ status: String(data.status || ''), completed: data.completed, total: data.total });
      }
    }
    onProgress({ status: 'success', done: true });
  })();
  return { promise, cancel: () => controller.abort() };
};

export const deleteOllamaModel = async (baseUrl: string, model: string) => {
  await localJson(`${trimUrl(baseUrl)}/api/delete`, { method: 'DELETE', body: { model } });
};

/** Curated models that run well on a laptop or desktop GPU; tags are from the Ollama library. */
export const RECOMMENDED_LOCAL_LLMS: Array<{ tag: string; label: string; size: string; memory: string; vision: boolean; note: string }> = [
  { tag: 'qwen3.5:4b', label: 'Qwen 3.5 4B', size: '≈ 3 GB', memory: '8 GB RAM', vision: true, note: 'Fast all-rounder for scripts, breakdowns and prompts; can read images.' },
  { tag: 'gemma4:4b', label: 'Gemma 4 4B', size: '≈ 3 GB', memory: '8 GB RAM', vision: true, note: 'Google\'s small multimodal model; good writing quality for its size.' },
  { tag: 'qwen3.5:9b', label: 'Qwen 3.5 9B', size: '≈ 6.5 GB', memory: '16 GB RAM', vision: true, note: 'Recommended default: reliable JSON for script analysis and shot lists.' },
  { tag: 'gemma4:12b', label: 'Gemma 4 12B', size: '≈ 8 GB', memory: '16 GB RAM', vision: true, note: 'Strong creative writing and dialogue; reads images and audio.' },
  { tag: 'gpt-oss:20b', label: 'gpt-oss 20B', size: '≈ 14 GB', memory: '24 GB RAM', vision: false, note: 'OpenAI\'s open-weights reasoning model; good for planning and tool use.' },
  { tag: 'qwen3.6:27b', label: 'Qwen 3.6 27B', size: '≈ 17 GB', memory: '32 GB RAM', vision: true, note: 'Best quality here for long scripts and agent tasks; needs a big GPU or a Mac with 32 GB+.' },
];

// ---------------------------------------------------------------------------
// Gemini request → OpenAI chat completion
// ---------------------------------------------------------------------------

export class LocalLlmUnsupportedError extends Error {}

type OpenAiMessage =
  | { role: 'system' | 'user'; content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> }
  | { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; tool_call_id: string; content: string };

const asArray = <T,>(value: T | T[] | undefined | null): T[] => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);

/** Gemini accepts a string, a Part, a Content or a list of either. */
const normalizeContents = (contents: any): Array<{ role: string; parts: any[] }> => {
  if (typeof contents === 'string') return [{ role: 'user', parts: [{ text: contents }] }];
  const list = asArray(contents);
  if (list.length === 0) return [];
  const looksLikeContent = (item: any) => item && typeof item === 'object' && Array.isArray(item.parts);
  if (list.every(looksLikeContent)) return list.map((item: any) => ({ role: item.role || 'user', parts: item.parts }));
  // A flat list of parts/strings is one user turn.
  return [{ role: 'user', parts: list.map((item: any) => (typeof item === 'string' ? { text: item } : item)) }];
};

const instructionText = (instruction: any): string => {
  if (!instruction) return '';
  if (typeof instruction === 'string') return instruction;
  if (Array.isArray(instruction)) return instruction.map(instructionText).join('\n');
  if (Array.isArray(instruction.parts)) return instruction.parts.map((part: any) => part?.text || '').join('\n');
  if (typeof instruction.text === 'string') return instruction.text;
  return '';
};

const GEMINI_TYPES: Record<string, string> = {
  STRING: 'string', NUMBER: 'number', INTEGER: 'integer', BOOLEAN: 'boolean', ARRAY: 'array', OBJECT: 'object', NULL: 'null',
};

/** Gemini's Schema (upper-case types, nullable, propertyOrdering) → plain JSON Schema. */
export const geminiSchemaToJsonSchema = (schema: any): any => {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(geminiSchemaToJsonSchema);
  const out: any = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'propertyOrdering' || key === 'nullable' || key === 'example') continue;
    if (key === 'type' && typeof value === 'string') {
      const type = GEMINI_TYPES[value.toUpperCase()] || value.toLowerCase();
      out.type = schema.nullable ? [type, 'null'] : type;
    } else if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(Object.entries(value as Record<string, any>).map(([name, sub]) => [name, geminiSchemaToJsonSchema(sub)]));
    } else if (key === 'items' || key === 'anyOf' || key === 'oneOf' || key === 'allOf') {
      out[key] = geminiSchemaToJsonSchema(value);
    } else {
      out[key] = value;
    }
  }
  return out;
};

const isImageMime = (mime: string | undefined) => /^image\//i.test(String(mime || ''));

/** True when every media part is an image (or there is no media at all). */
export const isLocalServable = (params: { model?: string; contents?: any; config?: any }) => {
  const model = String(params.model || '').toLowerCase();
  if (/image|imagen|veo|tts|embedding|native-audio|live/.test(model)) return false;
  const modalities = asArray(params.config?.responseModalities).map((m: any) => String(m).toUpperCase());
  if (modalities.some((m) => m === 'IMAGE' || m === 'AUDIO')) return false;
  for (const content of normalizeContents(params.contents)) {
    for (const part of content.parts || []) {
      if (part?.fileData) return false;
      if (part?.inlineData && !isImageMime(part.inlineData.mimeType)) return false;
    }
  }
  return true;
};

export const buildChatCompletionRequest = (
  params: { contents?: any; config?: any },
  model: string,
  provider: LocalLlmProvider,
) => {
  const config = params.config || {};
  const messages: OpenAiMessage[] = [];
  const system = instructionText(config.systemInstruction);
  if (system.trim()) messages.push({ role: 'system', content: system });

  // Gemini call ids are optional; give every call an id and match responses by name, in order.
  const pendingCallIds = new Map<string, string[]>();
  let callCounter = 0;

  for (const content of normalizeContents(params.contents)) {
    const parts = content.parts || [];
    const role = content.role === 'model' ? 'assistant' : 'user';
    const functionCalls = parts.filter((part: any) => part?.functionCall);
    const functionResponses = parts.filter((part: any) => part?.functionResponse);
    const text = parts.filter((part: any) => typeof part?.text === 'string' && !part.thought).map((part: any) => part.text).join('');

    if (role === 'assistant') {
      const toolCalls = functionCalls.map((part: any) => {
        const name = String(part.functionCall.name);
        const id = String(part.functionCall.id || `call_${callCounter += 1}_${name}`);
        pendingCallIds.set(name, [...(pendingCallIds.get(name) || []), id]);
        return { id, type: 'function' as const, function: { name, arguments: JSON.stringify(part.functionCall.args || {}) } };
      });
      messages.push(toolCalls.length ? { role: 'assistant', content: text || null, tool_calls: toolCalls } : { role: 'assistant', content: text });
      continue;
    }

    for (const part of functionResponses) {
      const name = String(part.functionResponse.name);
      const queue = pendingCallIds.get(name) || [];
      const id = String(part.functionResponse.id || queue.shift() || `call_${callCounter += 1}_${name}`);
      pendingCallIds.set(name, queue);
      messages.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(part.functionResponse.response ?? {}) });
    }

    const images = parts.filter((part: any) => part?.inlineData && isImageMime(part.inlineData.mimeType));
    if (images.length) {
      messages.push({
        role: 'user',
        content: [
          ...(text ? [{ type: 'text' as const, text }] : []),
          ...images.map((part: any) => ({ type: 'image_url' as const, image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` } })),
        ],
      });
    } else if (text) {
      messages.push({ role: 'user', content: text });
    }
  }

  const body: Record<string, any> = { model, messages, stream: false };
  const generation = config;
  if (typeof generation.temperature === 'number') body.temperature = generation.temperature;
  if (typeof generation.topP === 'number') body.top_p = generation.topP;
  if (typeof generation.maxOutputTokens === 'number') body.max_tokens = generation.maxOutputTokens;
  if (typeof generation.seed === 'number') body.seed = generation.seed;

  const declarations = asArray(config.tools).flatMap((tool: any) => asArray(tool?.functionDeclarations));
  if (declarations.length) {
    body.tools = declarations.map((declaration: any) => ({
      type: 'function',
      function: {
        name: declaration.name,
        description: declaration.description || '',
        parameters: declaration.parametersJsonSchema || geminiSchemaToJsonSchema(declaration.parameters) || { type: 'object', properties: {} },
      },
    }));
  }

  if (String(config.responseMimeType || '').toLowerCase() === 'application/json') {
    const schema = config.responseJsonSchema || (config.responseSchema ? geminiSchemaToJsonSchema(config.responseSchema) : null);
    if (schema) {
      body.response_format = { type: 'json_schema', json_schema: { name: 'response', schema, strict: false } };
    } else if (provider !== 'lmstudio') {
      // LM Studio only accepts json_schema; without a schema the prompt has to carry the format.
      body.response_format = { type: 'json_object' };
    }
  }
  return body;
};

/** Local models often wrap JSON in fences or prefix their reasoning; strip both. */
export const cleanLocalText = (text: string, expectJson: boolean) => {
  let out = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (expectJson) {
    const fenced = out.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) out = fenced[1].trim();
  }
  return out;
};

const toGeminiResponse = (data: any, expectJson: boolean) => {
  const choice = data?.choices?.[0] || {};
  const message = choice.message || {};
  const text = cleanLocalText(typeof message.content === 'string' ? message.content : '', expectJson);
  const functionCalls = asArray(message.tool_calls).map((call: any) => {
    let args: Record<string, unknown> = {};
    try {
      args = typeof call.function?.arguments === 'string' ? JSON.parse(call.function.arguments || '{}') : (call.function?.arguments || {});
    } catch {
      args = {};
    }
    return { id: call.id, name: call.function?.name, args };
  });
  const parts: any[] = [];
  if (text) parts.push({ text });
  for (const call of functionCalls) parts.push({ functionCall: call });
  const usage = data?.usage || {};
  return {
    text,
    functionCalls: functionCalls.length ? functionCalls : undefined,
    candidates: [{ content: { role: 'model', parts }, finishReason: choice.finish_reason === 'length' ? 'MAX_TOKENS' : 'STOP', index: 0 }],
    usageMetadata: { promptTokenCount: usage.prompt_tokens, candidatesTokenCount: usage.completion_tokens, totalTokenCount: usage.total_tokens },
    modelVersion: data?.model,
  };
};

/** Run one Gemini-style generateContent call on the configured local model. */
export const generateContentWithLocalLlm = async (params: { model?: string; contents?: any; config?: any }, config = getLocalLlmConfig()) => {
  if (!isLocalLlmReady(config)) throw new Error('No local model selected. Choose one in Local AI.');
  const expectJson = String(params.config?.responseMimeType || '').toLowerCase() === 'application/json';
  const body = buildChatCompletionRequest(params, config.model, config.provider);
  const url = `${trimUrl(config.baseUrl)}/v1/chat/completions`;
  try {
    return toGeminiResponse(await localJson(url, { body, timeoutMs: 600000 }), expectJson);
  } catch (error: any) {
    // Older servers reject json_schema or tools; retry once without them.
    const message = String(error?.message || error);
    if (body.response_format && /response_format|json_schema|schema/i.test(message)) {
      delete body.response_format;
      return toGeminiResponse(await localJson(url, { body, timeoutMs: 600000 }), expectJson);
    }
    if (/does not support tools|tool/i.test(message) && body.tools) {
      throw new Error(`The local model ${config.model} cannot call tools. Pick a model with tool support (for example qwen3.5 or gpt-oss) for the assistant.`);
    }
    throw new Error(`Local model (${config.model}): ${message}`);
  }
};

/** Should this request be answered by the local model? */
export const shouldUseLocalLlm = (params: { model?: string; contents?: any; config?: any }, hasGeminiKey: boolean, config = getLocalLlmConfig()) => {
  if (!isLocalLlmReady(config)) return false;
  if (config.textProvider !== 'local' && hasGeminiKey) return false;
  return isLocalServable(params);
};

/**
 * Route text requests of a Gemini client to the local model. Idempotent; reads the
 * configuration on every call so switching models in the UI takes effect immediately.
 */
export const withLocalLlm = (ai: GoogleGenAI, hasGeminiKey: boolean): GoogleGenAI => {
  const marked = ai as GoogleGenAI & { __localLlm?: boolean };
  if (marked.__localLlm) return ai;
  const models = ai.models as unknown as { generateContent: (params: any) => Promise<any> };
  const original = models.generateContent.bind(ai.models);
  models.generateContent = async (params: any) => {
    if (shouldUseLocalLlm(params, hasGeminiKey)) return generateContentWithLocalLlm(params);
    if (!hasGeminiKey) {
      throw new Error(isLocalLlmReady()
        ? 'This step needs Gemini (it makes or reads images, video or audio). Add a Gemini key in Settings, or use a step that only works with text.'
        : 'API Key is missing. Please enter your Google Gemini API Key in the settings, or choose a local model in Local AI.');
    }
    return original(params);
  };
  marked.__localLlm = true;
  return ai;
};
