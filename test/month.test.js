import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthGrid, dayItems, monthLabel, shiftMonth } from '../lib/month.js';

test('monthGrid: 1 日を含む週の日曜から 42 日', () => {
  const g = monthGrid('2026-11-12'); // 2026-11-01 は日曜
  assert.equal(g.length, 42);
  assert.equal(g[0], '2026-11-01');
  assert.equal(g[41], '2026-12-12');
  const g2 = monthGrid('2026-12-31'); // 2026-12-01 は火曜
  assert.equal(g2[0], '2026-11-29');
  assert.equal(g2[2], '2026-12-01');
});

test('monthLabel / shiftMonth', () => {
  assert.equal(monthLabel('2026-11-12'), '2026年11月');
  assert.equal(shiftMonth('2026-11-12', 1), '2026-12-01');
  assert.equal(shiftMonth('2026-01-31', -1), '2025-12-01');
  assert.equal(shiftMonth('2026-12-15', 1), '2027-01-01');
});

const members = [
  { id: 'a', name: '佐藤', color: '#e5484d' },
  { id: 'b', name: '鈴木', color: '#3e63dd' },
];
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).toISOString();
const ev = (id, member_id, title, s, e) => ({ id, member_id, title, starts_at: s, ends_at: e });

test('dayItems: その日の予定を開始順に、色と開始時刻つきで', () => {
  const events = [
    ev('2', 'b', '開発', at(12, 13), at(12, 14)),
    ev('1', 'a', '定例', at(12, 10), at(12, 11)),
    ev('x', 'a', '別の日', at(13, 10), at(13, 11)),
  ];
  assert.deepEqual(dayItems(events, members, new Set(), '2026-11-12'), {
    items: [
      { id: '1', title: '定例', color: '#e5484d', start: '10:00' },
      { id: '2', title: '開発', color: '#3e63dd', start: '13:00' },
    ],
    more: 0,
    total: 2,
  });
});

test('dayItems: 日をまたぐ予定は翌日にも 0:00 から出る', () => {
  const events = [ev('n', 'a', '夜勤', at(12, 22), at(13, 6))];
  assert.equal(dayItems(events, members, new Set(), '2026-11-13').items[0].start, '0:00');
});

test('dayItems: 非表示メンバーと、いないメンバーの予定は出さない', () => {
  const events = [ev('1', 'a', 'x', at(12, 10), at(12, 11)), ev('2', 'zz', 'y', at(12, 10), at(12, 11))];
  assert.equal(dayItems(events, members, new Set(['a']), '2026-11-12').total, 0);
});

test('dayItems: max を超えた分は more に数える', () => {
  const events = [1, 2, 3, 4, 5].map((h) => ev(`e${h}`, 'a', `t${h}`, at(12, h), at(12, h, 30)));
  const r = dayItems(events, members, new Set(), '2026-11-12', 3);
  assert.deepEqual(r.items.map((x) => x.id), ['e1', 'e2', 'e3']);
  assert.equal(r.more, 2);
  assert.equal(r.total, 5);
});
