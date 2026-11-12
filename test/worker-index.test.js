import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../worker/index.js';
import { hashToken } from '../lib/token.js';

const BASE = 'https://firestore.googleapis.com/v1/projects/p1/databases/(default)/documents';
const env = { FIREBASE_PROJECT_ID: 'p1' };
const doc = (path, fields) => ({ name: `projects/p1/databases/(default)/documents/${path}`, fields });
const s = (v) => ({ stringValue: v });

// Firestore の偽物。state を書き換えて状況を作る
async function setup({ allowed = ['m@x.com'], teamStatus = 200, spyTools } = {}) {
  const good = await hashToken('ts_good');
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', auth: init.headers?.Authorization });
    const res = (status, json) => ({ ok: status < 300, status, json: async () => json });
    if (url.startsWith(`${BASE}/tokens/${good}`)) return res(200, doc(`tokens/${good}`, { team: s('T'), email: s('m@x.com') }));
    if (url.startsWith(`${BASE}/tokens/`)) return res(404, { error: {} });
    if (url.startsWith(`${BASE}/teams/T:runQuery`)) return res(200, []);
    if (url.startsWith(`${BASE}/teams/T/members`)) return res(200, { documents: [doc('teams/T/members/a', { name: s('佐藤'), color: s('#e5484d') })] });
    if (url.startsWith(`${BASE}/teams/T?`) || url === `${BASE}/teams/T`) {
      return teamStatus === 200
        ? res(200, doc('teams/T', { owner: s('o@x.com'), allowed: { arrayValue: { values: allowed.map(s) } } }))
        : res(teamStatus, { error: {} });
    }
    return res(404, { error: {} });
  };
  const toolCalls = [];
  const makeTools = spyTools && (() => new Proxy({}, {
    // then を返すと Promise と誤認されるので除く
    get: (_, name) => (name === 'then' ? undefined : async (args) => { toolCalls.push([name, args]); return `ok:${name}`; }),
  }));
  const h = createHandler({ fetch, tokenSource: { get: async () => 'AT' }, makeTools });
  const call = (path, init = {}) => h(new Request(`https://w.dev${path}`, init), env);
  return { call, calls, toolCalls };
}

const mcp = (method, params) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
});
const bearer = (t) => ({ headers: { Authorization: `Bearer ${t}` } });

test('POST /mcp/<正しいトークン> で tools/list', async () => {
  const { call } = await setup();
  const r = await call('/mcp/ts_good', mcp('tools/list'));
  assert.equal(r.status, 200);
  assert.match(r.headers.get('Content-Type'), /application\/json/);
  assert.equal((await r.json()).result.tools.length, 6);
});

test('末尾スラッシュ付きの MCP URL も通る', async () => {
  const { call } = await setup();
  assert.equal((await call('/mcp/ts_good/', mcp('ping'))).status, 200);
});

test('Firestore にはサービスアカウントのトークンで問い合わせ、key は付けない', async () => {
  const { call, calls } = await setup();
  await call('/mcp/ts_good', mcp('ping'));
  assert.ok(calls.length >= 2);
  assert.ok(calls.every((c) => c.auth === 'Bearer AT' && !c.url.includes('key=')));
});

test('間違ったトークンは 401 invalid token', async () => {
  const { call } = await setup();
  const r = await call('/mcp/ts_bad', mcp('ping'));
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: 'invalid token' });
});

test('許可リストから外れた人のトークンは 401', async () => {
  const { call } = await setup({ allowed: ['o@x.com'] });
  const r = await call('/api/members', bearer('ts_good'));
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: 'invalid token' });
});

test('トークンが無ければ 401', async () => {
  const { call } = await setup();
  assert.equal((await call('/api/members')).status, 401);
});

test('GET /api/members（空白付きの Bearer）で一覧を返す', async () => {
  const { call } = await setup();
  const r = await call('/api/members', { headers: { Authorization: 'Bearer  ts_good ' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match((await r.json()).result, /佐藤/);
});

test('GET /api/free のクエリをツール引数に変換する', async () => {
  const { call, toolCalls } = await setup({ spyTools: true });
  const q = new URLSearchParams({ date: '2026-11-13', days: '2', members: '佐藤,鈴木', min: '60', from: '09:00', to: '18:00' });
  const r = await call(`/api/free?${q}`, bearer('ts_good'));
  assert.equal(r.status, 200);
  assert.deepEqual(toolCalls, [['find_free_slots', {
    date: '2026-11-13', days: 2, members: ['佐藤', '鈴木'], min_minutes: 60, work_start: '09:00', work_end: '18:00',
  }]]);
});

test('GET /api/events のクエリをツール引数に変換する', async () => {
  const { call, toolCalls } = await setup({ spyTools: true });
  await call('/api/events?date=2026-11-13&member=佐藤', bearer('ts_good'));
  assert.deepEqual(toolCalls, [['list_events', { date: '2026-11-13', member: '佐藤' }]]);
});

test('POST /api/members と /api/events は JSON 本文をそのまま渡す', async () => {
  const { call, toolCalls } = await setup({ spyTools: true });
  const post = (body) => ({ method: 'POST', headers: { Authorization: 'Bearer ts_good', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await call('/api/members', post({ name: '高橋' }));
  const ev = { member: '佐藤', title: '定例', date: '2026-11-13', start: '10:00', end: '11:00' };
  await call('/api/events', post(ev));
  assert.deepEqual(toolCalls, [['add_member', { name: '高橋' }], ['add_event', ev]]);
});

test('POST /api/events の入力が不正なら 400', async () => {
  const { call, toolCalls } = await setup({ spyTools: true });
  const r = await call('/api/events', {
    method: 'POST', headers: { Authorization: 'Bearer ts_good' },
    body: JSON.stringify({ member: '佐藤', title: 't', date: '2026/11/13', start: '10:00', end: '11:00' }),
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /date/);
  assert.equal(toolCalls.length, 0);
});

test('POST の本文が JSON でなければ 400', async () => {
  const { call } = await setup({ spyTools: true });
  const r = await call('/api/members', { method: 'POST', headers: { Authorization: 'Bearer ts_good' }, body: '{' });
  assert.equal(r.status, 400);
});

test('DELETE /api/events/<id> で delete_event', async () => {
  const { call, toolCalls } = await setup({ spyTools: true });
  const r = await call('/api/events/e1', { method: 'DELETE', headers: { Authorization: 'Bearer ts_good' } });
  assert.equal(r.status, 200);
  assert.deepEqual(toolCalls, [['delete_event', { id: 'e1' }]]);
});

test('ツールのエラー（メンバーがいない等）は 400', async () => {
  const { call } = await setup();
  const r = await call('/api/events?member=田中', bearer('ts_good'));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /田中/);
});

test('Firestore が 500 なら 502 upstream', async () => {
  const { call } = await setup({ teamStatus: 500 });
  const r = await call('/api/members', bearer('ts_good'));
  assert.equal(r.status, 502);
  assert.deepEqual(await r.json(), { error: 'upstream' });
});

test('OPTIONS /api/* は 204 と CORS ヘッダー', async () => {
  const { call } = await setup();
  const r = await call('/api/members', { method: 'OPTIONS' });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(r.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  assert.match(r.headers.get('Access-Control-Allow-Methods'), /DELETE/);
});

test('GET /mcp/<t> は 405、知らないパスは 404', async () => {
  const { call } = await setup();
  assert.equal((await call('/mcp/ts_good')).status, 405);
  assert.equal((await call('/nope')).status, 404);
  assert.equal((await call('/api/nope', bearer('ts_good'))).status, 404);
});

test('DELETE /api/events/..%2F..%2FT は 400 で、Firestore に削除は飛ばない', async () => {
  const { call, calls } = await setup();
  const r = await call('/api/events/..%2F..%2FT', { method: 'DELETE', headers: { Authorization: 'Bearer ts_good' } });
  assert.equal(r.status, 400);
  assert.ok(!calls.some((c) => c.method === 'DELETE'));
});

test('MCP の delete_event に ../../T を渡しても消さずに isError', async () => {
  const { call, calls } = await setup();
  const r = await call('/mcp/ts_good', mcp('tools/call', { name: 'delete_event', arguments: { id: '../../T' } }));
  assert.equal((await r.json()).result.isError, true);
  assert.ok(!calls.some((c) => c.method === 'DELETE'));
});
