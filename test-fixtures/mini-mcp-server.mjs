#!/usr/bin/env node
/**
 * Minimal stdio MCP server used only for dsh-mcp-guard end-to-end checks.
 *
 * Implements the small subset the official MCP client needs to connect and
 * discover one tool: initialize, notifications/initialized, tools/list,
 * tools/call, ping. No dependencies, no network.
 */
import { createInterface } from 'node:readline';

const SERVER_INFO = { name: 'mini-mcp-server', version: '0.0.1' };
const TOOLS = [
  {
    name: 'echo',
    description: 'Return the provided text unchanged.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
  },
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });
reader.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return;
  }
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') return;
  const { id, method, params } = message;
  const isRequest = id !== undefined && id !== null;

  if (method === 'initialize') {
    const requested = typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2026-07-28';
    if (isRequest) {
      reply(id, {
        protocolVersion: requested,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });
    }
    return;
  }
  if (method === 'notifications/initialized' || method === 'initialized') return;
  if (method === 'ping') {
    if (isRequest) reply(id, {});
    return;
  }
  if (method === 'tools/list') {
    if (isRequest) reply(id, { tools: TOOLS });
    return;
  }
  if (method === 'tools/call') {
    const name = params?.name;
    if (!isRequest) return;
    if (name !== 'echo') {
      fail(id, -32602, `unknown tool: ${String(name)}`);
      return;
    }
    const text = typeof params?.arguments?.text === 'string' ? params.arguments.text : '';
    reply(id, { content: [{ type: 'text', text }], isError: false });
    return;
  }
  if (method === 'resources/list') {
    if (isRequest) reply(id, { resources: [] });
    return;
  }
  if (method === 'resources/templates/list') {
    if (isRequest) reply(id, { resourceTemplates: [] });
    return;
  }
  if (method === 'prompts/list') {
    if (isRequest) reply(id, { prompts: [] });
    return;
  }
  if (isRequest) fail(id, -32601, `method not found: ${method}`);
});
