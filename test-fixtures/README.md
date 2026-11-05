# Test fixtures

`mini-mcp-server.mjs` is a dependency-free stdio MCP server used for **manual**
end-to-end checks of `dsh-mcp-guard`. It implements only the handshake subset a
client needs to connect and discover one tool (`echo`), which is enough to prove
that:

- the Host half resolves the official `@deepseek-ai/dsh-mcp-client`;
- an enabled server from the managed list is mounted as a child plugin;
- the official client spawns the stdio process and registers
  `mcp__<serverName>__echo` on the tool registry.

It is **not** used by CI (the unit tests never spawn processes). To exercise it
manually on a development machine:

1. Install the plugin bundle (`plugin_manager` → install bundle from the package
   directory, or `dsh plugin --profile <name> add <absolute path>`).
2. Temporarily add a row configuration with this fixture, for example in the
   package's `cordis.patch.yml`:

   ```yaml
   - insert:
       - id: dsh-mcp-guard
         name: dsh-mcp-guard
         config:
           servers:
             - enabled: true
               client:
                 serverName: mini
                 transport: stdio
                 command: /absolute/path/to/node
                 args:
                   - /absolute/path/to/test-fixtures/mini-mcp-server.mjs
   ```

3. Reload the bundle (disable/enable it in Plugin Manager) and confirm that
   `mcp__mini__echo` appears in the tool list and that the
   `mini-mcp-server.mjs` process exists.
4. Revert the test configuration and reload; the process and the tool
   registration must disappear.

Never enable this fixture in a production profile; it is a test-only command.
