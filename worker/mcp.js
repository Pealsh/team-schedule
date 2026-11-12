// MCP（Streamable HTTP）の最小実装。JSON 応答だけのステートレス。tools は mcp/tools.js の createTools の戻り値。
import { TOOL_DEFS, validateArgs } from '../mcp/schema.js';

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const ok = (id, result) => ({ status: 200, json: { jsonrpc: '2.0', id, result } });
const fail = (id, code, message) => ({ status: 200, json: { jsonrpc: '2.0', id, error: { code, message } } });
const text = (t, isError) => ({ content: [{ type: 'text', text: t }], ...(isError && { isError: true }) });

export async function handleMcp(msg, tools) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.method !== 'string') {
    return fail(null, -32600, 'Invalid Request');
  }
  const { id, method, params = {} } = msg;
  if (id === undefined) return { status: 202 };

  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'team-schedule', version: '2.0.0' },
      });
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: TOOL_DEFS });
    case 'tools/call': {
      const def = TOOL_DEFS.find((d) => d.name === params.name);
      if (!def) return fail(id, -32602, `Unknown tool: ${params.name}`);
      const args = params.arguments ?? {};
      const bad = validateArgs(def.inputSchema, args);
      if (bad) return ok(id, text(bad, true));
      try {
        return ok(id, text(await tools[def.name](args)));
      } catch (e) {
        return ok(id, text(e.message, true));
      }
    }
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}
