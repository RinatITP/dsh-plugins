/**
 * dsh-visual-studio — inline choice widgets and published visuals for
 * DeepSeek Harness.
 *
 * The Host entry only re-exports the plugin description; the implementation
 * lives in lib/host.js so it can be reviewed and unit-tested separately.
 */
export { name, inject, apply } from './lib/host.js';
