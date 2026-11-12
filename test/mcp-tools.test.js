import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTools } from '../mcp/tools.js';

function fakeApi() {
  const db = {
    members: [
      { id: 'a', name: '佐藤', color: '#e5484d' },
      { id: 'b', name: '鈴木', color: '#3e63dd' },
    ],
    events: [],
  };
  let n = 0;
  return {
    db,
    members: async () => db.members,
    addMember: async (m) => { const r = { id: `m${++n}`, ...m }; db.members.push(r); return r; },
    events: async (from, to) => db.events.filter((e) => new Date(e.starts_at) < to && new Date(e.ends_at) > from),
    addEvent: async (e) => { const r = { id: `e${++n}`, ...e }; db.events.push(r); return r; },
    deleteEvent: async (id) => { db.events = db.events.filter((e) => e.id !== id); },
  };
}

test('add_event: 名前で登録できる', async () => {
  const api = fakeApi();
  const t = createTools(api);
  const out = await t.add_event({ member: '佐藤', title: '定例', date: '2026-11-12', start: '10:00', end: '11:00' });
  assert.match(out, /佐藤/);
  assert.equal(api.db.events.length, 1);
  assert.equal(new Date(api.db.events[0].starts_at).getHours(), 10);
});

test('add_event: 24:00 終了と、終了<開始は翌日扱い', async () => {
  const api = fakeApi();
  const t = createTools(api);
  await t.add_event({ member: '佐藤', title: 'x', date: '2026-11-12', start: '23:00', end: '24:00' });
  await t.add_event({ member: '佐藤', title: 'y', date: '2026-11-12', start: '23:00', end: '01:00' });
  const [a, b] = api.db.events;
  assert.equal(new Date(a.ends_at).getDate(), 13);
  assert.equal(new Date(b.ends_at).getHours(), 1);
});

test('add_event: 存在しないメンバーはエラー', async () => {
  const t = createTools(fakeApi());
  await assert.rejects(
    t.add_event({ member: '田中', title: 'x', date: '2026-11-12', start: '10:00', end: '11:00' }),
    /田中/,
  );
});

test('find_free_slots: 指定メンバー・時間帯・最小分数', async () => {
  const api = fakeApi();
  const t = createTools(api);
  await t.add_event({ member: '佐藤', title: 'x', date: '2026-11-12', start: '10:00', end: '11:00' });
  await t.add_event({ member: '鈴木', title: 'y', date: '2026-11-12', start: '13:00', end: '17:30' });
  const out = await t.find_free_slots({
    date: '2026-11-12', members: ['佐藤', '鈴木'], min_minutes: 60, work_start: '09:00', work_end: '18:00',
  });
  assert.equal(out, '2026-11-12（木）: 9:00–10:00 / 11:00–13:00');
});

test('find_free_slots: 複数日', async () => {
  const t = createTools(fakeApi());
  const out = await t.find_free_slots({ date: '2026-11-12', days: 2, work_start: '09:00', work_end: '18:00' });
  assert.equal(out, '2026-11-12（木）: 9:00–18:00\n2026-11-13（金）: 9:00–18:00');
});

test('list_events: 予定と ID を返す', async () => {
  const api = fakeApi();
  const t = createTools(api);
  await t.add_event({ member: '鈴木', title: '客先', date: '2026-11-12', start: '13:00', end: '15:30' });
  const out = await t.list_events({ date: '2026-11-12' });
  assert.match(out, /13:00–15:30 鈴木「客先」/);
  assert.match(out, /id: e\d/);
});

test('add_member: 色を自動で割り当てる', async () => {
  const api = fakeApi();
  const out = await createTools(api).add_member({ name: '高橋' });
  assert.match(out, /高橋/);
  assert.equal(api.db.members[2].color, '#f76b15'); // 緑系は空き時間と紛れるので使わない
});

test('now を渡すと「今日」がそれに従う', async () => {
  const t = createTools(fakeApi(), { now: () => new Date(2026, 0, 5, 12) });
  assert.match(await t.list_events({}), /^2026-01-05（月）/);
});

// ---------- self（AI 接続）：自分の予定だけ書ける ----------
function selfApi() {
  const api = fakeApi();
  api.db.members[0].email = 'sato@x.com';
  api.event = async (id) => api.db.events.find((e) => e.id === id) ?? null;
  return api;
}

test('self: member を省略すると自分の予定として追加', async () => {
  const api = selfApi();
  await createTools(api, { self: 'sato@x.com' }).add_event({ title: '定例', date: '2026-11-12', start: '10:00', end: '11:00' });
  assert.equal(api.db.events[0].member_id, 'a');
});

test('self: 自分の名前の指定は OK、他人の名前は拒否', async () => {
  const api = selfApi();
  const t = createTools(api, { self: 'sato@x.com' });
  await t.add_event({ member: '佐藤', title: 'x', date: '2026-11-12', start: '10:00', end: '11:00' });
  await assert.rejects(t.add_event({ member: '鈴木', title: 'y', date: '2026-11-12', start: '10:00', end: '11:00' }), /自分の予定しか/);
  assert.equal(api.db.events.length, 1);
});

test('self: 他人の予定は削除できない、自分のは削除できる', async () => {
  const api = selfApi();
  api.db.events.push({ id: 'mine', member_id: 'a' }, { id: 'theirs', member_id: 'b' });
  const t = createTools(api, { self: 'sato@x.com' });
  await assert.rejects(t.delete_event({ id: 'theirs' }), /自分の予定しか/);
  await t.delete_event({ id: 'mine' });
  assert.deepEqual(api.db.events.map((e) => e.id), ['theirs']);
});

test('self: 自分のメンバーが無ければ、先にログインするよう伝える', async () => {
  const t = createTools(selfApi(), { self: 'new@x.com' });
  await assert.rejects(t.add_event({ title: 'x', date: '2026-11-12', start: '10:00', end: '11:00' }), /ログイン/);
});

test('self なし（従来）は member 必須', async () => {
  await assert.rejects(createTools(fakeApi()).add_event({ title: 'x', date: '2026-11-12', start: '10:00', end: '11:00' }), /member/);
});
