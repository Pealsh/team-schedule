// Cloudflare Worker：/mcp/<接続トークン>（MCP）と /api/*（REST）。
// トークンを tokens/{ハッシュ} で照合し、発行者がまだ teams/{team}.allowed に居るときだけ通す。
// Firestore にはサービスアカウント（secret GOOGLE_SA）で入るので、ルールではなくここで許可を確認する。
import { createApi, fromDoc } from '../lib/api.js';
import { hashToken } from '../lib/token.js';
import { withFixedOffset, fixedNow } from '../lib/fixed-offset.js';
import { toDateStr } from '../lib/timeline.js';
import { createTools } from '../mcp/tools.js';
import { TOOL_DEFS, validateArgs } from '../mcp/schema.js';
import { handleMcp } from './mcp.js';
import { createTokenSource } from './google-auth.js';

const JST = 540;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
});
const isUpstream = (e) => e.status !== undefined || e instanceof TypeError;
// self: トークン発行者のメール。AI からの書き込みはその人の予定だけに限る
const defaultTools = (api, self) => createTools(withFixedOffset(api, JST), { now: fixedNow(JST), self });

// REST のパスとクエリ → [ツール名, 引数]。本文が要るものは body を使う
function route(method, path, q, body) {
  const num = (v) => (v === null || v === '' ? undefined : Number(v));
  const pick = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  if (path === '/api/members' && method === 'GET') return ['list_members', {}];
  if (path === '/api/events' && method === 'GET') {
    return ['list_events', pick({ date: q.get('date'), days: num(q.get('days')), member: q.get('member') })];
  }
  if (path === '/api/events' && method === 'POST') return ['add_event', body];
  const del = path.match(/^\/api\/events\/([^/]+)$/);
  if (del && method === 'DELETE') return ['delete_event', { id: decodeURIComponent(del[1]) }];
  if (path === '/api/free' && method === 'GET') {
    return ['find_free_slots', pick({
      date: q.get('date'),
      days: num(q.get('days')),
      members: q.get('members')?.split(',').map((x) => x.trim()).filter(Boolean),
      min_minutes: num(q.get('min')),
      work_start: q.get('from'),
      work_end: q.get('to'),
    })];
  }
  return null;
}

export function createHandler({ fetch = globalThis.fetch, tokenSource, makeTools = defaultTools }) {
  const getAuthHeader = async () => `Bearer ${await tokenSource.get()}`;

  // 見つからなければ null。それ以外の失敗は upstream として投げる
  async function fsGet(base, path) {
    const res = await fetch(`${base}/${path}`, { headers: { Authorization: await getAuthHeader() } });
    if (res.status === 404) return null;
    if (!res.ok) throw Object.assign(new Error(`firestore ${res.status}`), { status: res.status });
    return fromDoc(await res.json());
  }

  // トークンが有効ならツール一式、無効なら null
  async function authorize(token, env) {
    if (!token) return null;
    const projectId = env.FIREBASE_PROJECT_ID;
    const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
    const t = await fsGet(base, `tokens/${await hashToken(token)}`);
    if (!t?.team || !t.email) return null;
    const team = await fsGet(base, `teams/${encodeURIComponent(t.team)}`);
    const email = t.email.toLowerCase();
    if (!team?.allowed?.some((a) => a.toLowerCase() === email)) return null;
    return makeTools(createApi({ projectId, apiKey: '', teamKey: t.team, getAuthHeader, fetch }), email);
  }

  async function rest(request, url, path, env) {
    const token = request.headers.get('Authorization')?.trim().replace(/^Bearer\s+/i, '').trim();
    const tools = await authorize(token, env);
    if (!tools) return json(401, { error: 'invalid token' });
    let body = {};
    if (request.method === 'POST') {
      try {
        body = await request.json();
      } catch {
        return json(400, { error: '本文は JSON で送ってください' });
      }
    }
    const r = route(request.method, path, url.searchParams, body);
    if (!r) return json(404, { error: 'not found' });
    const [name, args] = r;
    const bad = validateArgs(TOOL_DEFS.find((d) => d.name === name).inputSchema, args);
    if (bad) return json(400, { error: bad });
    try {
      return json(200, { result: await tools[name](args) });
    } catch (e) {
      if (isUpstream(e)) throw e;
      return json(400, { error: e.message });
    }
  }

  async function mcp(request, token, env) {
    if (request.method !== 'POST') return json(405, { error: 'method not allowed' }, { Allow: 'POST' });
    const tools = await authorize(token, env);
    if (!tools) return json(401, { error: 'invalid token' });
    const msg = await request.json().catch(() => null);
    const r = await handleMcp(msg, tools);
    return r.json ? json(r.status, r.json) : new Response(null, { status: r.status });
  }

  // AI のチャットに貼る読み取り専用ページ。AI はリンクを開くだけで予定を読める
  async function aiPage(request, token, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'method not allowed' }, { Allow: 'GET' });
    const tools = await authorize(token, env);
    if (!tools) return json(401, { error: 'invalid token' });
    const [members, events, free] = await Promise.all([
      tools.list_members({}),
      tools.list_events({ days: 28 }),
      tools.find_free_slots({ days: 14, min_minutes: 30, work_start: '09:00', work_end: '18:00' }),
    ]);
    const text = `# チーム予定（${toDateStr(fixedNow(JST)())} 時点・時刻は日本時間）
このページは読み取り専用です。予定の追加・削除はできません。

## メンバー
${members}

## 予定（今日から 28 日間）
${events}

## 全員が空いている時間（9:00〜18:00、30 分以上、今日から 14 日間）
${free}
`;
    return new Response(text, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
    });
  }

  return async (request, env) => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    try {
      if (path.startsWith('/api/')) {
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
        const res = await rest(request, url, path, env);
        for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
        return res;
      }
      const ai = path.match(/^\/ai\/([^/]+)$/);
      if (ai) return await aiPage(request, decodeURIComponent(ai[1]).trim(), env);
      const m = path.match(/^\/mcp\/([^/]+)$/);
      if (m) return await mcp(request, decodeURIComponent(m[1]).trim(), env);
      return json(404, { error: 'not found' });
    } catch (e) {
      if (!isUpstream(e)) throw e;
      return json(502, { error: 'upstream' }, path.startsWith('/api/') ? CORS : {});
    }
  };
}

let tokenSource;
export default {
  fetch(request, env) {
    tokenSource ??= createTokenSource(env.GOOGLE_SA);
    return createHandler({ tokenSource })(request, env);
  },
};
