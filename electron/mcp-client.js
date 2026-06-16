const { spawn } = require('child_process');
const path = require('path');

class McpClient {
    constructor() {
        this.process = null;
        this.requestId = 0;
        this.pendingRequests = new Map();
        this.buffer = Buffer.alloc(0);
        this.initTimeout = null;
    }

    writeMessage(message) {
        if (!this.process || !this.process.stdin || this.process.killed) {
            throw new Error('MCP Client not connected');
        }
        const payload = JSON.stringify(message);
        const framed = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`;
        this.process.stdin.write(framed);
    }

    async start() {
        if (this.process && !this.process.killed) {
            return;
        }
        console.log('Starting NotebookLM MCP Server...');
        return new Promise((resolve, reject) => {
            let settled = false;
            const fail = (err) => {
                if (settled) return;
                settled = true;
                if (this.initTimeout) {
                    clearTimeout(this.initTimeout);
                    this.initTimeout = null;
                }
                if (this.process && !this.process.killed) {
                    try {
                        this.process.kill();
                    } catch { }
                }
                this.process = null;
                reject(err);
            };

            try {
                // We use 'uv' as verified in the test script.
                // Ensure 'uv' is in the PATH or provide full path if necessary.
                // The test script used: ["uv", "tool", "run", "--from", "notebooklm-mcp-server", "notebooklm-mcp"]
                this.process = spawn('uv', ['tool', 'run', '--from', 'notebooklm-mcp-server', 'notebooklm-mcp'], {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: process.env // Inherit env (useful for auth tokens if needed)
                });
            } catch (err) {
                fail(err);
                return;
            }

            this.process.on('error', (err) => {
                console.error('MCP process error:', err);
                fail(err);
            });

            this.process.stderr.on('data', (data) => {
                console.error(`MCP Stderr: ${data}`);
            });

            this.process.stdout.on('data', (data) => {
                this.buffer = Buffer.concat([this.buffer, Buffer.from(data)]);
                this.processBuffer();
            });

            this.process.on('close', (code) => {
                console.log(`MCP Server exited with code ${code}`);
                if (!settled) {
                    fail(new Error(`MCP Server exited with code ${code}`));
                } else {
                    this.process = null;
                }
                if (this.pendingRequests.size > 0) {
                    const error = new Error('MCP Server disconnected');
                    this.pendingRequests.forEach(({ reject }) => reject(error));
                    this.pendingRequests.clear();
                }
            });

            this.initTimeout = setTimeout(() => {
                fail(new Error('MCP initialization timed out.'));
            }, 10000);

            this.initialize()
                .then(() => {
                    if (settled) return;
                    settled = true;
                    if (this.initTimeout) {
                        clearTimeout(this.initTimeout);
                        this.initTimeout = null;
                    }
                    resolve();
                })
                .catch((err) => {
                    fail(err);
                });
        });
    }

    processBuffer() {
        while (true) {
            let leading = 0;
            while (leading < this.buffer.length && [9, 10, 13, 32].includes(this.buffer[leading])) {
                leading += 1;
            }
            if (leading > 0) {
                this.buffer = this.buffer.subarray(leading);
            }
            if (this.buffer.length === 0) return;

            const startsWithHeader = this.buffer.subarray(0, 15).toString('utf8').toLowerCase() === 'content-length:';
            if (startsWithHeader) {
                const headerEndRnrn = this.buffer.indexOf(Buffer.from('\r\n\r\n'));
                const headerEndNn = this.buffer.indexOf(Buffer.from('\n\n'));
                let headerEnd = -1;
                let delimiterLength = 0;
                if (headerEndRnrn !== -1 && (headerEndNn === -1 || headerEndRnrn < headerEndNn)) {
                    headerEnd = headerEndRnrn;
                    delimiterLength = 4;
                } else if (headerEndNn !== -1) {
                    headerEnd = headerEndNn;
                    delimiterLength = 2;
                }
                if (headerEnd === -1) return;

                const headerBlock = this.buffer.subarray(0, headerEnd).toString('utf8');
                const lengthMatch = headerBlock.match(/Content-Length:\s*(\d+)/i);
                if (!lengthMatch) {
                    const nextLine = this.buffer.indexOf(Buffer.from('\n'));
                    if (nextLine === -1) return;
                    this.buffer = this.buffer.subarray(nextLine + 1);
                    continue;
                }

                const contentLength = Number(lengthMatch[1]);
                const payloadStart = headerEnd + delimiterLength;
                const payloadEnd = payloadStart + contentLength;
                if (this.buffer.length < payloadEnd) return;

                const payload = this.buffer.subarray(payloadStart, payloadEnd).toString('utf8');
                this.buffer = this.buffer.subarray(payloadEnd);

                try {
                    const message = JSON.parse(payload);
                    this.handleMessage(message);
                } catch (error) {
                    console.error('Failed to parse framed MCP message:', error);
                }
                continue;
            }

            const newlineIndex = this.buffer.indexOf(Buffer.from('\n'));
            if (newlineIndex === -1) return;
            const line = this.buffer.subarray(0, newlineIndex).toString('utf8').trim();
            this.buffer = this.buffer.subarray(newlineIndex + 1);
            if (!line) continue;
            try {
                const message = JSON.parse(line);
                this.handleMessage(message);
            } catch (error) {
                console.error('Failed to parse line-delimited MCP message:', line, error);
            }
        }
    }

    handleMessage(message) {
        if (message.id !== undefined && this.pendingRequests.has(message.id)) {
            const { resolve, reject } = this.pendingRequests.get(message.id);
            this.pendingRequests.delete(message.id);
            if (message.error) {
                reject(message.error);
            } else {
                resolve(message.result);
            }
        } else {
            // Notification or request from server (not handled yet)
            console.log('Received MCP notification/request:', message);
        }
    }

    sendRequest(method, params) {
        return new Promise((resolve, reject) => {
            const id = ++this.requestId;
            const request = {
                jsonrpc: '2.0',
                id,
                method,
                params
            };
            this.pendingRequests.set(id, { resolve, reject });
            try {
                this.writeMessage(request);
            } catch (err) {
                this.pendingRequests.delete(id);
                reject(err);
            }
        });
    }

    sendNotification(method, params) {
        const notification = {
            jsonrpc: '2.0',
            method,
            params
        };
        try {
            this.writeMessage(notification);
        } catch (error) {
            console.error('Failed to send MCP notification:', error);
        }
    }

    async initialize() {
        const result = await this.sendRequest('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'ai-video-studio', version: '1.0.0' }
        });
        console.log('MCP Initialized:', result);
        this.sendNotification('notifications/initialized');
        return result;
    }

    async listTools() {
        return this.sendRequest('tools/list', {});
    }

    async callTool(name, args) {
        return this.sendRequest('tools/call', {
            name,
            arguments: args
        });
    }

    async listResources() {
        return this.sendRequest('resources/list', {});
    }

    async readResource(uri) {
        return this.sendRequest('resources/read', { uri });
    }

    stop() {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
    }
}

module.exports = McpClient;
