/**
 * dsh-mcp-guard — security-first MCP server manager for DeepSeek Harness.
 *
 * The Host entry only re-exports the plugin description; the implementation
 * lives in lib/host.js so it can be unit-tested and reviewed separately.
 */
export { name, inject, apply } from './lib/host.js';
