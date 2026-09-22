import test from 'node:test';
import assert from 'node:assert/strict';

import { isModelNotFoundError, pickFallbackModel } from './geminiModelFallback.ts';

test('recognises the API "model not found" error', () => {
  assert.equal(isModelNotFoundError(new Error('{"error":{"code":404,"message":"models/gemini-3.1-flash-preview is not found for API version v1beta, or is not supported for generateContent."}}')), true);
  assert.equal(isModelNotFoundError(new Error('429 RESOURCE_EXHAUSTED')), false);
});

test('picks the next listed model of the same family', () => {
  const available = new Set(['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-image']);
  assert.equal(pickFallbackModel('gemini-3.1-flash-preview', available), 'gemini-2.5-flash');
  assert.equal(pickFallbackModel('gemini-3.1-pro-preview', available), 'gemini-2.5-pro');
  assert.equal(pickFallbackModel('gemini-3.1-flash-image-preview', available), 'gemini-2.5-flash-image');
});

test('falls back to the chain when the list is unknown, and never to the same model', () => {
  assert.equal(pickFallbackModel('gemini-3.1-flash-preview', null), 'gemini-3-flash-preview');
  assert.equal(pickFallbackModel('unknown-model', null), null);
  assert.equal(pickFallbackModel('gemini-3.1-flash-preview', new Set(['gemini-3.1-flash-preview'])), null);
});
