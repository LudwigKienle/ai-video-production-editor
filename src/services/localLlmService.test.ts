import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChatCompletionRequest,
  cleanLocalText,
  geminiSchemaToJsonSchema,
  isLocalServable,
  shouldUseLocalLlm,
} from './localLlmService.ts';

const ready = { provider: 'ollama' as const, baseUrl: 'http://127.0.0.1:11434', model: 'qwen3.5:9b', textProvider: 'local' as const };

test('Gemini schemas become JSON Schema', () => {
  const schema = geminiSchemaToJsonSchema({
    type: 'OBJECT',
    propertyOrdering: ['title', 'shots'],
    properties: {
      title: { type: 'STRING', nullable: true },
      shots: { type: 'ARRAY', items: { type: 'OBJECT', properties: { duration: { type: 'NUMBER' } }, required: ['duration'] } },
    },
    required: ['shots'],
  });
  assert.deepEqual(schema, {
    type: 'object',
    properties: {
      title: { type: ['string', 'null'] },
      shots: { type: 'array', items: { type: 'object', properties: { duration: { type: 'number' } }, required: ['duration'] } },
    },
    required: ['shots'],
  });
});

test('a JSON request carries the system instruction, history and schema', () => {
  const body = buildChatCompletionRequest({
    contents: 'Break this script down.',
    config: {
      systemInstruction: 'You are a script supervisor.',
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { scenes: { type: 'ARRAY', items: { type: 'STRING' } } } },
      temperature: 0.2,
      maxOutputTokens: 2048,
    },
  }, 'qwen3.5:9b', 'ollama');
  assert.equal(body.model, 'qwen3.5:9b');
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'You are a script supervisor.' },
    { role: 'user', content: 'Break this script down.' },
  ]);
  assert.equal(body.temperature, 0.2);
  assert.equal(body.max_tokens, 2048);
  assert.equal(body.response_format.type, 'json_schema');
  assert.deepEqual(body.response_format.json_schema.schema, { type: 'object', properties: { scenes: { type: 'array', items: { type: 'string' } } } });
});

test('JSON without a schema: json_object, except on LM Studio', () => {
  const params = { contents: 'List three shots as JSON.', config: { responseMimeType: 'application/json' } };
  assert.deepEqual(buildChatCompletionRequest(params, 'm', 'ollama').response_format, { type: 'json_object' });
  assert.equal(buildChatCompletionRequest(params, 'm', 'lmstudio').response_format, undefined);
});

test('function calls and responses map to tool calls with matching ids', () => {
  const body = buildChatCompletionRequest({
    contents: [
      { role: 'user', parts: [{ text: 'Add a shot.' }] },
      { role: 'model', parts: [{ functionCall: { name: 'add_shot', args: { scene: 2 } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'add_shot', response: { ok: true } } }] },
    ],
    config: { tools: [{ functionDeclarations: [{ name: 'add_shot', description: 'Adds a shot', parameters: { type: 'OBJECT', properties: { scene: { type: 'INTEGER' } } } }] }] },
  }, 'm', 'ollama');
  const assistant = body.messages[1];
  assert.equal(assistant.role, 'assistant');
  const callId = assistant.tool_calls[0].id;
  assert.equal(assistant.tool_calls[0].function.name, 'add_shot');
  assert.equal(assistant.tool_calls[0].function.arguments, '{"scene":2}');
  assert.deepEqual(body.messages[2], { role: 'tool', tool_call_id: callId, content: '{"ok":true}' });
  assert.deepEqual(body.tools[0].function.parameters, { type: 'object', properties: { scene: { type: 'integer' } } });
});

test('images are sent as data URLs; video and audio stay with Gemini', () => {
  const image = { inlineData: { mimeType: 'image/png', data: 'AAAA' } };
  const body = buildChatCompletionRequest({ contents: [{ role: 'user', parts: [{ text: 'Describe' }, image] }] }, 'm', 'ollama');
  assert.deepEqual(body.messages[0].content, [
    { type: 'text', text: 'Describe' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
  ]);
  assert.equal(isLocalServable({ model: 'gemini-3.1-flash-preview', contents: [{ role: 'user', parts: [image] }] }), true);
  assert.equal(isLocalServable({ model: 'gemini-3.1-flash-preview', contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'video/mp4', data: 'x' } }] }] }), false);
  assert.equal(isLocalServable({ model: 'gemini-3.1-flash-preview', contents: [{ role: 'user', parts: [{ fileData: { fileUri: 'files/1', mimeType: 'video/mp4' } }] }] }), false);
  assert.equal(isLocalServable({ model: 'gemini-3-pro-image-preview', contents: 'a cat' }), false);
  assert.equal(isLocalServable({ model: 'gemini-3.1-flash-preview', contents: 'hi', config: { responseModalities: ['IMAGE'] } }), false);
});

test('routing: local when chosen, or when there is no Gemini key', () => {
  const text = { model: 'gemini-3.1-pro-preview', contents: 'Write a logline.' };
  assert.equal(shouldUseLocalLlm(text, true, ready), true);
  assert.equal(shouldUseLocalLlm(text, true, { ...ready, textProvider: 'gemini' }), false);
  assert.equal(shouldUseLocalLlm(text, false, { ...ready, textProvider: 'gemini' }), true);
  assert.equal(shouldUseLocalLlm(text, false, { ...ready, model: '' }), false);
});

test('local answers lose reasoning tags and JSON fences', () => {
  assert.equal(cleanLocalText('<think>plan</think>\n```json\n{"a":1}\n```', true), '{"a":1}');
  assert.equal(cleanLocalText('<think>x</think>Hello', false), 'Hello');
});
