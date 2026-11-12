import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeList, fmtDuration } from '../lib/freelist.js';

const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).toISOString();
const ev = (member_id, s, e) => ({ member_id, starts_at: s, ends_at: e });
const events = [
  ev('a', at(13, 12), at(13, 15)), // 13 日：12–15 は a が埋まり
  ev('b', at(14, 9), at(14, 18)), //  14 日：b が終日
  ev('c', at(13, 9), at(13, 18)), //  c は対象外
];
const base = { from: '2026-11-13', days: 3, workStart: 540, workEnd: 1080, minMinutes: 60, now: new Date(2026, 10, 1) };

test('freeList: 指定メンバー全員が空いている時間を、時間帯で切って日付順に', () => {
  assert.deepEqual(freeList(events, ['a', 'b'], base), [
    { date: '2026-11-13', start: 540, end: 720, minutes: 180 },
    { date: '2026-11-13', start: 900, end: 1080, minutes: 180 },
    { date: '2026-11-15', start: 540, end: 1080, minutes: 540 },
  ]);
});

test('freeList: 長い順', () => {
  const r = freeList(events, ['a', 'b'], { ...base, sort: 'long' });
  assert.deepEqual(r.map((x) => [x.date, x.start]), [['2026-11-15', 540], ['2026-11-13', 540], ['2026-11-13', 900]]);
});

test('freeList: 最小の長さより短い空きは出さない', () => {
  const r = freeList([ev('a', at(13, 9, 30), at(13, 18))], ['a'], { ...base, days: 1, minMinutes: 60 });
  assert.deepEqual(r, []);
});

test('freeList: 今日は今より前を出さない（15 分単位で切り上げ）', () => {
  const r = freeList([], ['a'], { ...base, days: 1, now: new Date(2026, 10, 13, 10, 5) });
  assert.deepEqual(r, [{ date: '2026-11-13', start: 615, end: 1080, minutes: 465 }]);
});

test('fmtDuration', () => {
  assert.equal(fmtDuration(180), '3時間');
  assert.equal(fmtDuration(90), '1時間30分');
  assert.equal(fmtDuration(45), '45分');
});
