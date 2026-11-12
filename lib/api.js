// Firestore REST の薄いクライアント。ブラウザと Worker で共用。
// データは teams/{チームキー}/members, teams/{チームキー}/events に置く。読み書きできるのは teams/{キー}.allowed の人だけ。
import { generateToken, hashToken } from './token.js';

const MAX_EVENT_DAYS = 7; // これより長い予定は日の範囲検索に掛からない
const TIME_FIELDS = ['starts_at', 'ends_at', 'created_at', 'expires_at'];
const INVITE_DAYS = 7;

export function toFields(obj, timeFields = TIME_FIELDS) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [
    k, toValue(v, timeFields.includes(k)),
  ]));
}

function toValue(v, isTime) {
  if (isTime) return { timestampValue: new Date(v).toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map((x) => ({ stringValue: String(x) })) } };
  return { stringValue: String(v) };
}

function fromValue(v) {
  if ('timestampValue' in v) return new Date(v.timestampValue).toISOString();
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(fromValue);
  return v.stringValue;
}

export function fromDoc(doc) {
  const out = { id: doc.name.split('/').pop() };
  for (const [k, v] of Object.entries(doc.fields ?? {})) {
    out[k] = fromValue(v);
  }
  return out;
}

// getAuthHeader: () => Promise<'Bearer …' | null>。ブラウザは ID トークン、Worker はサービスアカウント。
// URL のパス片。Worker はルール対象外なので、. / .. / スラッシュでパスを辿らせない
function seg(id) {
  if (typeof id !== 'string' || !id || id === '.' || id === '..' || id.includes('/')) throw new Error(`不正な id です: ${id}`);
  return encodeURIComponent(id);
}

// Firestore の自動 ID と同じ形（英数字 20 文字）。ID なしで作るとルールから ID が見えないので、自分で決めて渡す
function newId(len = 20) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(len)), (b) => abc[b % 62]).join('');
}

export function createApi({ projectId, apiKey, teamKey, getAuthHeader, fetch = globalThis.fetch }) {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const team = `${base}/teams/${encodeURIComponent(teamKey)}`;

  async function req(url, { method = 'GET', body, query = '' } = {}) {
    const qs = `${apiKey ? `key=${apiKey}` : ''}${query}`.replace(/^&/, '');
    const headers = { 'Content-Type': 'application/json' };
    const auth = await getAuthHeader?.();
    if (auth) headers.Authorization = auth;
    const res = await fetch(qs ? `${url}?${qs}` : url, {
      method,
      headers,
      body: body && JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      const err = new Error(`API ${res.status}: ${j.error?.message ?? ''}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  const ts = (d) => ({ timestampValue: new Date(d).toISOString() });
  const filter = (field, op, value) => ({ fieldFilter: { field: { fieldPath: field }, op, value } });
  async function query(where, parent = team, collectionId = 'events') {
    const rows = await req(`${parent}:runQuery`, {
      method: 'POST',
      body: { structuredQuery: { from: [{ collectionId }], where } },
    });
    return rows.filter((r) => r.document).map((r) => fromDoc(r.document));
  }

  async function members() {
    const r = await req(`${team}/members`, { query: '&pageSize=300' });
    return (r.documents ?? []).map(fromDoc)
      .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
  }

  return {
    async checkAccess() {
      try {
        await req(team);
        return 'ok';
      } catch (e) {
        if (e.status === 403) return 'forbidden';
        if (e.status === 404) return 'missing';
        throw e;
      }
    },
    async team() {
      const { name, owner, allowed = [] } = fromDoc(await req(team));
      return { name, owner, allowed };
    },
    setAllowed: (list) => req(team, {
      method: 'PATCH', body: { fields: toFields({ allowed: list }) }, query: '&updateMask.fieldPaths=allowed',
    }),
    async createToken(label, email) {
      const token = generateToken();
      const hash = await hashToken(token);
      await req(`${base}/tokens`, {
        method: 'POST',
        body: { fields: toFields({ team: teamKey, email, label, created_at: new Date() }) },
        query: `&documentId=${hash}`,
      });
      return { token, hash };
    },
    async myTokens(email) {
      const list = await query(filter('email', 'EQUAL', { stringValue: email }), base, 'tokens');
      return list.filter((t) => t.team === teamKey)
        .map(({ id, label, created_at }) => ({ id, label, created_at }))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    // 招待リンク（オーナーだけ作れる）。コードそのものが文書 ID
    async createInvite() {
      const code = newId(32);
      const expires_at = new Date(Date.now() + INVITE_DAYS * 86400000).toISOString();
      await req(`${team}/invites`, {
        method: 'POST', body: { fields: toFields({ created_at: new Date(), expires_at }) }, query: `&documentId=${code}`,
      });
      return { code, expires_at };
    },
    async invites() {
      const r = await req(`${team}/invites`, { query: '&pageSize=100' });
      const now = new Date().toISOString();
      return (r.documents ?? []).map(fromDoc).filter((x) => x.expires_at > now)
        .sort((a, b) => a.expires_at.localeCompare(b.expires_at));
    },
    revokeInvite: async (code) => req(`${team}/invites/${seg(code)}`, { method: 'DELETE' }),
    // 招待コードで参加：allowed に自分を追記し、invite に「コード:メール」を残す（ルールがこの形を確かめる）
    joinWithInvite: (code, email) => req(`${base}:commit`, {
      method: 'POST',
      body: { writes: [{
        update: { name: `projects/${projectId}/databases/(default)/documents/teams/${teamKey}`, fields: toFields({ invite: `${code}:${email}` }) },
        updateMask: { fieldPaths: ['invite'] },
        updateTransforms: [{ fieldPath: 'allowed', appendMissingElements: { values: [{ stringValue: email }] } }],
        currentDocument: { exists: true },
      }] },
    }),
    revokeToken: async (hash) => req(`${base}/tokens/${seg(hash)}`, { method: 'DELETE' }),
    members,
    async addMember(m) {
      if ((await members()).some((x) => x.name === m.name)) throw new Error('duplicate: 同じ名前のメンバーがいます');
      const doc = await req(`${team}/members`, {
        method: 'POST', body: { fields: toFields({ ...m, created_at: new Date() }) }, query: `&documentId=${newId()}`,
      });
      return fromDoc(doc);
    },
    updateMember: async (id, patch) => req(`${team}/members/${seg(id)}`, {
      method: 'PATCH',
      body: { fields: toFields(patch) },
      query: Object.keys(patch).map((k) => `&updateMask.fieldPaths=${k}`).join(''),
    }),
    async deleteMember(id) {
      const path = `${team}/members/${seg(id)}`;
      const evs = await query(filter('member_id', 'EQUAL', { stringValue: id }));
      await Promise.all(evs.map((e) => req(`${team}/events/${encodeURIComponent(e.id)}`, { method: 'DELETE' })));
      await req(path, { method: 'DELETE' });
    },
    // from〜to に掛かる予定
    async events(from, to) {
      const earliest = new Date(from.getTime() - MAX_EVENT_DAYS * 86400000);
      const list = await query({ compositeFilter: { op: 'AND', filters: [
        filter('starts_at', 'LESS_THAN', ts(to)),
        filter('starts_at', 'GREATER_THAN_OR_EQUAL', ts(earliest)),
      ] } });
      return list.filter((e) => new Date(e.ends_at) > from)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    },
    async addEvent(e) {
      return fromDoc(await req(`${team}/events`, {
        method: 'POST', body: { fields: toFields({ ...e, created_at: new Date() }) }, query: `&documentId=${newId()}`,
      }));
    },
    async event(id) {
      try {
        return fromDoc(await req(`${team}/events/${seg(id)}`));
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    },
    deleteEvent: async (id) => req(`${team}/events/${seg(id)}`, { method: 'DELETE' }),
  };
}
