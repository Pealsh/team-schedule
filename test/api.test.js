import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, toFields, fromDoc } from '../lib/api.js';
import { hashToken } from '../lib/token.js';

const BASE = 'https://firestore.googleapis.com/v1/projects/p1/databases/(default)/documents';

// 呼ばれたリクエストを記録し、決めたレスポンスを返す fetch
function mockFetch(handler) {
  const calls = [];
  const f = async (url, init = {}) => {
    const call = { url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body && JSON.parse(init.body) };
    calls.push(call);
    const [status, json] = (await handler(call)) ?? [200, {}];
    return { ok: status < 300, status, json: async () => json, text: async () => JSON.stringify(json) };
  };
  f.calls = calls;
  return f;
}
const api = (fetch) => createApi({ projectId: 'p1', apiKey: 'k1', teamKey: 'team-abc', fetch });
const doc = (path, fields) => ({ name: `projects/p1/databases/(default)/documents/${path}`, fields });

test('toFields / fromDoc: 文字列と日時を変換', () => {
  const f = toFields({ title: '定例', starts_at: '2026-11-12T01:00:00.000Z' }, ['starts_at']);
  assert.deepEqual(f, {
    title: { stringValue: '定例' },
    starts_at: { timestampValue: '2026-11-12T01:00:00.000Z' },
  });
  const o = fromDoc(doc('teams/team-abc/events/e1', {
    title: { stringValue: '定例' }, starts_at: { timestampValue: '2026-11-12T01:00:00Z' },
  }));
  assert.deepEqual(o, { id: 'e1', title: '定例', starts_at: '2026-11-12T01:00:00.000Z' });
});

test('checkAccess: 200 → ok、403 → forbidden、404 → missing、それ以外は投げる', async () => {
  const ok = mockFetch(() => [200, doc('teams/team-abc', {})]);
  assert.equal(await api(ok).checkAccess(), 'ok');
  assert.equal(ok.calls[0].url, `${BASE}/teams/team-abc?key=k1`);
  assert.equal(await api(mockFetch(() => [403, { error: {} }])).checkAccess(), 'forbidden');
  assert.equal(await api(mockFetch(() => [404, { error: {} }])).checkAccess(), 'missing');
  await assert.rejects(api(mockFetch(() => [500, { error: {} }])).checkAccess(), /500/);
});

test('getAuthHeader: 返した値を Authorization に付ける', async () => {
  const f = mockFetch((c) => [200, c.method === 'POST' ? doc('teams/team-abc/events/e1', c.body.fields) : {}]);
  const a = createApi({ projectId: 'p1', apiKey: 'k1', teamKey: 'team-abc', fetch: f, getAuthHeader: async () => 'Bearer X' });
  await a.members();
  await a.addEvent({ member_id: 'a', title: 't', starts_at: 0, ends_at: 1 });
  assert.ok(f.calls.every((c) => c.headers.Authorization === 'Bearer X'));
});

test('getAuthHeader なしなら Authorization は付かない', async () => {
  const f = mockFetch(() => [200, {}]);
  await api(f).members();
  assert.equal(f.calls[0].headers.Authorization, undefined);
});

test('apiKey が空なら URL に key= を付けない', async () => {
  const f = mockFetch(() => [200, {}]);
  await createApi({ projectId: 'p1', apiKey: '', teamKey: 'team-abc', fetch: f }).members();
  assert.ok(!f.calls[0].url.includes('key='));
  assert.match(f.calls[0].url, /members\?pageSize=300$/);
});

test('toFields / fromDoc: 配列は arrayValue、空配列は []', () => {
  assert.deepEqual(toFields({ allowed: ['a@x.com'] }), {
    allowed: { arrayValue: { values: [{ stringValue: 'a@x.com' }] } },
  });
  const o = fromDoc(doc('teams/t', { allowed: { arrayValue: {} }, owner: { stringValue: 'o@x.com' } }));
  assert.deepEqual(o, { id: 't', allowed: [], owner: 'o@x.com' });
  const o2 = fromDoc(doc('teams/t', { allowed: { arrayValue: { values: [{ stringValue: 'a@x.com' }] } } }));
  assert.deepEqual(o2.allowed, ['a@x.com']);
});

test('team: owner と allowed を返す', async () => {
  const f = mockFetch(() => [200, doc('teams/team-abc', {
    name: { stringValue: 'T' }, owner: { stringValue: 'o@x.com' },
    allowed: { arrayValue: { values: [{ stringValue: 'o@x.com' }] } },
  })]);
  assert.deepEqual(await api(f).team(), { name: 'T', owner: 'o@x.com', allowed: ['o@x.com'] });
});

test('setAllowed: allowed だけを PATCH', async () => {
  const f = mockFetch(() => [200, {}]);
  await api(f).setAllowed(['a@x.com']);
  assert.equal(f.calls[0].method, 'PATCH');
  assert.match(f.calls[0].url, /teams\/team-abc\?key=k1&updateMask.fieldPaths=allowed$/);
  assert.deepEqual(f.calls[0].body.fields.allowed.arrayValue.values, [{ stringValue: 'a@x.com' }]);
});

test('createToken: ハッシュを文書 ID にして tokens に作る', async () => {
  const f = mockFetch((c) => [200, doc('tokens/x', c.body.fields)]);
  const { token, hash } = await api(f).createToken('claude', 'a@x.com');
  assert.equal(hash, await hashToken(token));
  const c = f.calls[0];
  assert.equal(c.method, 'POST');
  assert.equal(c.url, `${BASE}/tokens?key=k1&documentId=${hash}`);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(c.body.fields.team.stringValue, 'team-abc');
  assert.equal(c.body.fields.email.stringValue, 'a@x.com');
  assert.equal(c.body.fields.label.stringValue, 'claude');
  assert.ok(c.body.fields.created_at.timestampValue);
  assert.deepEqual(Object.keys(c.body.fields).sort(), ['created_at', 'email', 'label', 'team']);
});

test('myTokens: 自分のメールで問い合わせ、別チームは除き新しい順', async () => {
  const t = (id, team, at) => ({ document: doc(`tokens/${id}`, {
    team: { stringValue: team }, email: { stringValue: 'a@x.com' }, label: { stringValue: id }, created_at: { timestampValue: at },
  }) });
  const f = mockFetch(() => [200, [t('h1', 'team-abc', '2026-01-01T00:00:00Z'), t('h2', 'other', '2026-01-02T00:00:00Z'), t('h3', 'team-abc', '2026-01-03T00:00:00Z'), {}]]);
  const list = await api(f).myTokens('a@x.com');
  assert.deepEqual(list.map((x) => x.id), ['h3', 'h1']);
  const c = f.calls[0];
  assert.equal(c.url, `${BASE}:runQuery?key=k1`);
  assert.equal(c.body.structuredQuery.from[0].collectionId, 'tokens');
  const ff = c.body.structuredQuery.where.fieldFilter;
  assert.deepEqual([ff.field.fieldPath, ff.op, ff.value.stringValue], ['email', 'EQUAL', 'a@x.com']);
});

test('revokeToken: tokens/{hash} を DELETE', async () => {
  const f = mockFetch(() => [200, {}]);
  await api(f).revokeToken('h1');
  assert.equal(f.calls[0].method, 'DELETE');
  assert.equal(f.calls[0].url, `${BASE}/tokens/h1?key=k1`);
});

test('members: 一覧を作成順に返す', async () => {
  const f = mockFetch(() => [200, { documents: [
    doc('teams/team-abc/members/b', { name: { stringValue: '鈴木' }, created_at: { timestampValue: '2026-01-02T00:00:00Z' } }),
    doc('teams/team-abc/members/a', { name: { stringValue: '佐藤' }, created_at: { timestampValue: '2026-01-01T00:00:00Z' } }),
  ] }]);
  const ms = await api(f).members();
  assert.deepEqual(ms.map((m) => m.name), ['佐藤', '鈴木']);
  assert.match(f.calls[0].url, /\/teams\/team-abc\/members\?/);
});

test('members: 空なら []', async () => {
  assert.deepEqual(await api(mockFetch(() => [200, {}])).members(), []);
});

test('addMember: 同名がいれば duplicate エラー', async () => {
  const f = mockFetch((c) => c.method === 'GET'
    ? [200, { documents: [doc('teams/team-abc/members/a', { name: { stringValue: '佐藤' } })] }]
    : [200, doc('teams/team-abc/members/new', c.body.fields)]);
  await assert.rejects(api(f).addMember({ name: '佐藤', color: '#000000' }), /duplicate/);
  const m = await api(f).addMember({ name: '高橋', color: '#30a46c' });
  assert.equal(m.id, 'new');
  assert.equal(m.name, '高橋');
  const post = f.calls.find((c) => c.method === 'POST');
  assert.ok(post.body.fields.created_at.timestampValue);
});

test('events: starts_at の範囲で問い合わせ、ends_at で絞る', async () => {
  const from = new Date('2026-11-12T00:00:00+09:00');
  const to = new Date('2026-11-13T00:00:00+09:00');
  const ev = (id, s, e) => ({ document: doc(`teams/team-abc/events/${id}`, {
    member_id: { stringValue: 'a' }, starts_at: { timestampValue: s }, ends_at: { timestampValue: e },
  }) });
  const f = mockFetch(() => [200, [
    ev('old', '2026-11-11T05:00:00Z', '2026-11-11T06:00:00Z'), // 前日に終わっている → 除外
    ev('in', '2026-11-12T01:00:00Z', '2026-11-12T02:00:00Z'),
    {}, // 0 件のときなどに混ざる空要素
  ]]);
  const list = await api(f).events(from, to);
  assert.deepEqual(list.map((e) => e.id), ['in']);
  const c = f.calls[0];
  assert.equal(c.url, `${BASE}/teams/team-abc:runQuery?key=k1`);
  assert.equal(c.body.structuredQuery.from[0].collectionId, 'events');
  const filters = c.body.structuredQuery.where.compositeFilter.filters.map((x) => x.fieldFilter);
  assert.deepEqual(filters.map((x) => [x.field.fieldPath, x.op]), [['starts_at', 'LESS_THAN'], ['starts_at', 'GREATER_THAN_OR_EQUAL']]);
  assert.equal(filters[0].value.timestampValue, to.toISOString());
});

test('addEvent: 日時は timestampValue で送る', async () => {
  const f = mockFetch((c) => [200, doc('teams/team-abc/events/e9', c.body.fields)]);
  const e = await api(f).addEvent({
    member_id: 'a', title: 'x', starts_at: '2026-11-12T01:00:00.000Z', ends_at: '2026-11-12T02:00:00.000Z',
  });
  assert.equal(e.id, 'e9');
  assert.equal(f.calls[0].body.fields.ends_at.timestampValue, '2026-11-12T02:00:00.000Z');
  assert.equal(f.calls[0].body.fields.member_id.stringValue, 'a');
});

test('updateMember: updateMask 付きで PATCH', async () => {
  const f = mockFetch(() => [200, {}]);
  await api(f).updateMember('a', { color: '#111111' });
  assert.equal(f.calls[0].method, 'PATCH');
  assert.match(f.calls[0].url, /members\/a\?key=k1&updateMask.fieldPaths=color$/);
});

test('deleteMember: その人の予定も消す', async () => {
  const f = mockFetch((c) => c.url.includes(':runQuery')
    ? [200, [{ document: doc('teams/team-abc/events/e1', { member_id: { stringValue: 'a' } }) }]]
    : [200, {}]);
  await api(f).deleteMember('a');
  const deletes = f.calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
  assert.ok(deletes.some((u) => u.includes('/events/e1')));
  assert.ok(deletes.some((u) => u.includes('/members/a')));
});

test('エラー時はステータスを含めて投げる', async () => {
  const f = mockFetch(() => [403, { error: { message: 'Missing or insufficient permissions.' } }]);
  await assert.rejects(api(f).members(), /403.*permissions/);
});

test('パス片は encodeURIComponent し、. と .. は拒否する', async () => {
  const f = mockFetch(() => [200, {}]);
  const a = api(f);
  await a.deleteEvent('a b');
  assert.equal(f.calls[0].url, `${BASE}/teams/team-abc/events/a%20b?key=k1`);
  for (const bad of ['..', '.', '../../T', 'a/b']) {
    await assert.rejects(a.deleteEvent(bad), /id/);
    await assert.rejects(a.revokeToken(bad), /id/);
    await assert.rejects(a.updateMember(bad, { color: '#000000' }), /id/);
    await assert.rejects(a.deleteMember(bad), /id/);
  }
  assert.equal(f.calls.length, 1);
});

test('addMember / addEvent は 20 文字の英数字 ID を指定して作る（ルールが ID を確かめるため）', async () => {
  const f = mockFetch((c) => [200, c.method === 'POST' ? doc('teams/team-abc/x/y', c.body.fields) : {}]);
  await api(f).addMember({ name: '高橋', color: '#000000' });
  await api(f).addEvent({ member_id: 'a', title: 't', starts_at: 0, ends_at: 1 });
  const posts = f.calls.filter((c) => c.method === 'POST');
  assert.match(posts[0].url, /\/teams\/team-abc\/members\?key=k1&documentId=[A-Za-z0-9]{20}$/);
  assert.match(posts[1].url, /\/teams\/team-abc\/events\?key=k1&documentId=[A-Za-z0-9]{20}$/);
});

test('createInvite: 32 文字のコードを ID にして、7 日後の期限で作る', async () => {
  const f = mockFetch((c) => [200, doc('teams/team-abc/invites/x', c.body.fields)]);
  const before = Date.now();
  const { code, expires_at } = await api(f).createInvite();
  assert.match(code, /^[A-Za-z0-9]{32}$/);
  const c = f.calls[0];
  assert.equal(c.url, `${BASE}/teams/team-abc/invites?key=k1&documentId=${code}`);
  assert.deepEqual(Object.keys(c.body.fields).sort(), ['created_at', 'expires_at']);
  const exp = new Date(c.body.fields.expires_at.timestampValue).getTime();
  assert.ok(exp >= before + 7 * 86400000 - 1000 && exp <= Date.now() + 7 * 86400000);
  assert.equal(expires_at, c.body.fields.expires_at.timestampValue);
});

test('invites: 期限内のものだけ、期限の近い順', async () => {
  const inv = (id, at) => doc(`teams/team-abc/invites/${id}`, { expires_at: { timestampValue: at } });
  const f = mockFetch(() => [200, { documents: [inv('b', '2999-01-02T00:00:00Z'), inv('old', '2000-01-01T00:00:00Z'), inv('a', '2999-01-01T00:00:00Z')] }]);
  const list = await api(f).invites();
  assert.deepEqual(list.map((x) => x.id), ['a', 'b']);
  assert.match(f.calls[0].url, /\/teams\/team-abc\/invites\?key=k1/);
});

test('revokeInvite: invites/{code} を DELETE', async () => {
  const f = mockFetch(() => [200, {}]);
  await api(f).revokeInvite('C1');
  assert.equal(f.calls[0].url, `${BASE}/teams/team-abc/invites/C1?key=k1`);
  assert.equal(f.calls[0].method, 'DELETE');
});

test('joinWithInvite: commit で invite を「コード:メール」にし、allowed に自分を追記', async () => {
  const f = mockFetch(() => [200, {}]);
  await api(f).joinWithInvite('C1', 'n@x.com');
  const c = f.calls[0];
  assert.equal(c.url, `${BASE}:commit?key=k1`);
  assert.deepEqual(c.body.writes, [{
    update: { name: 'projects/p1/databases/(default)/documents/teams/team-abc', fields: { invite: { stringValue: 'C1:n@x.com' } } },
    updateMask: { fieldPaths: ['invite'] },
    updateTransforms: [{ fieldPath: 'allowed', appendMissingElements: { values: [{ stringValue: 'n@x.com' }] } }],
    currentDocument: { exists: true },
  }]);
});
