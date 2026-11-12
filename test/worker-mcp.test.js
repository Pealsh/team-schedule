import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMcp } from '../worker/mcp.js';

const tools = {
  list_members: async () => '佐藤',
  add_event: async () => { throw new Error('メンバー「田中」が見つかりません'); },
};
const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params });

test('initialize: 対応するバージョンはそのまま返す', async () => {
  const r = await handleMcp(rpc('initialize', { protocolVersion: '2025-03-26' }), tools);
  assert.equal(r.status, 200);
  assert.equal(r.json.id, 1);
  assert.equal(r.json.result.protocolVersion, '2025-03-26');
  assert.deepEqual(r.json.result.capabilities, { tools: {} });
  assert.deepEqual(r.json.result.serverInfo, { name: 'team-schedule', version: '2.0.0' });
});

test('initialize: 知らないバージョンには 2025-06-18', async () => {
  const r = await handleMcp(rpc('initialize', { protocolVersion: '1999-01-01' }), tools);
  assert.equal(r.json.result.protocolVersion, '2025-06-18');
});

test('ping は空の結果', async () => {
  assert.deepEqual((await handleMcp(rpc('ping'), tools)).json, { jsonrpc: '2.0', id: 1, result: {} });
});

test('tools/list は 6 ツール', async () => {
  const r = await handleMcp(rpc('tools/list'), tools);
  assert.equal(r.json.result.tools.length, 6);
  assert.ok(r.json.result.tools.every((t) => t.name && t.inputSchema));
});

test('tools/call 成功はテキストで返す', async () => {
  const r = await handleMcp(rpc('tools/call', { name: 'list_members', arguments: {} }), tools);
  assert.deepEqual(r.json.result, { content: [{ type: 'text', text: '佐藤' }] });
});

test('tools/call で arguments 省略は {} 扱い', async () => {
  const r = await handleMcp(rpc('tools/call', { name: 'list_members' }), tools);
  assert.equal(r.json.result.content[0].text, '佐藤');
});

test('tools/call でツールが投げたら isError', async () => {
  const r = await handleMcp(rpc('tools/call', {
    name: 'add_event', arguments: { member: '田中', title: 't', date: '2026-11-13', start: '9:00', end: '10:00' },
  }), tools);
  assert.equal(r.json.result.isError, true);
  assert.match(r.json.result.content[0].text, /田中/);
});

test('tools/call で入力チェックに落ちたら isError', async () => {
  const r = await handleMcp(rpc('tools/call', { name: 'add_event', arguments: { member: 'a' } }), tools);
  assert.equal(r.json.result.isError, true);
  assert.match(r.json.result.content[0].text, /title/);
});

test('tools/call で知らないツールは -32602', async () => {
  const r = await handleMcp(rpc('tools/call', { name: 'nope', arguments: {} }), tools);
  assert.equal(r.json.error.code, -32602);
});

test('通知（id なし）は 202', async () => {
  const r = await handleMcp({ jsonrpc: '2.0', method: 'notifications/initialized' }, tools);
  assert.equal(r.status, 202);
  assert.equal(r.json, undefined);
});

test('知らないメソッドは -32601', async () => {
  assert.equal((await handleMcp(rpc('resources/list'), tools)).json.error.code, -32601);
});

test('配列や JSON でない入力は -32600', async () => {
  assert.equal((await handleMcp([rpc('ping')], tools)).json.error.code, -32600);
  assert.equal((await handleMcp(null, tools)).json.error.code, -32600);
  assert.equal((await handleMcp({ id: 1 }, tools)).json.error.code, -32600);
});
