#!/usr/bin/env node
// stdio ⇄ HTTP bridge for MCP clients that only start local servers as processes
// (Claude Desktop, and any other stdio-only client). It reads newline-delimited JSON-RPC
// from stdin, forwards each message to the running editor's /mcp endpoint and writes the
// responses to stdout. URL and token come from ~/.ai-video-production-editor/studio-connect.json,
// which the editor writes on start, so no secret has to live in the client's config.
//
// Run it with plain Node, or with the editor's own binary: ELECTRON_RUN_AS_NODE=1 <app> studio-mcp-stdio.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const readline = require('readline');

const DISCOVERY_FILE = process.env.STUDIO_CONNECT_FILE || path.join(os.homedir(), '.ai-video-production-editor', 'studio-connect.json');

const readDiscovery = () => {
  try {
    const info = JSON.parse(fs.readFileSync(DISCOVERY_FILE, 'utf8'));
    if (info && info.mcpUrl && info.token) return info;
  } catch {
    /* editor not running */
  }
  return null;
};

let sessionId = null;

const post = (info, payload) => new Promise((resolve, reject) => {
  const url = new URL(info.mcpUrl);
  const body = Buffer.from(JSON.stringify(payload));
  const req = http.request({
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${info.token}`,
      'Content-Length': body.length,
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    },
  }, (res) => {
    if (res.headers['mcp-session-id']) sessionId = String(res.headers['mcp-session-id']);
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (res.statusCode === 202 || !text) return resolve(null);
      if (res.statusCode && res.statusCode >= 400 && !text.startsWith('{')) return reject(new Error(`HTTP ${res.statusCode}`));
      try { resolve(JSON.parse(text)); } catch (error) { reject(error); }
    });
  });
  req.on('error', reject);
  req.end(body);
});

const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

const offline = (id) => ({
  jsonrpc: '2.0',
  id,
  error: { code: -32000, message: 'The AI Video Production Editor is not running. Open the app and try again.' },
});

const rl = readline.createInterface({ input: process.stdin });
let queue = Promise.resolve();

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  // Keep request order; the editor answers each call when its tool finishes.
  queue = queue.then(async () => {
    const info = readDiscovery();
    const expectsReply = message && message.id !== undefined;
    if (!info) {
      if (expectsReply) write(offline(message.id));
      return;
    }
    try {
      const response = await post(info, message);
      if (response && expectsReply) write(response);
    } catch (error) {
      if (expectsReply) write({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: `Editor unreachable: ${error.message}` } });
    }
  });
});

rl.on('close', () => { queue.then(() => process.exit(0)); });
