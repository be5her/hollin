export interface ClientSnippet {
  id: string;
  client: string;
  /** Where the snippet goes. */
  where: string;
  text: string;
}

/** Ready-to-copy configuration for common MCP clients, shown in Settings. */
export function clientSnippets(name: string, url: string): ClientSnippet[] {
  const json = (value: unknown) => JSON.stringify(value, null, 2);
  return [
    { id: 'claude-code', client: 'Claude Code', where: 'Run in a terminal', text: `claude mcp add --transport http ${name} ${url}` },
    {
      id: 'claude-desktop',
      client: 'Claude Desktop',
      where: 'claude_desktop_config.json (Settings > Developer > Edit Config); needs Node.js',
      text: json({ mcpServers: { [name]: { command: 'npx', args: ['-y', 'mcp-remote', url] } } }),
    },
    { id: 'cursor', client: 'Cursor', where: '~/.cursor/mcp.json', text: json({ mcpServers: { [name]: { url } } }) },
    { id: 'vscode', client: 'VS Code', where: '.vscode/mcp.json', text: json({ servers: { [name]: { type: 'http', url } } }) },
    { id: 'url', client: 'Any client', where: 'Streamable HTTP endpoint', text: url },
  ];
}
