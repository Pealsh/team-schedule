import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayStartOf, clipToDay, mergeIntervals, freeSlots, fmtMin, pickColor, PALETTE,
} from '../lib/timeline.js';

const day = dayStartOf('2026-11-12');
const at = (h, m = 0) => new Date(day.getTime() + (h * 60 + m) * 60000).toISOString();
const ev = (member_id, s, e) => ({ member_id, starts_at: s, ends_at: e });

test('dayStartOf はローカルの 0:00', () => {
  assert.equal(day.getHours(), 0);
  assert.equal(day.getDate(), 12);
});

test('clipToDay: 日内の予定を分に変換', () => {
  assert.deepEqual(clipToDay(ev('a', at(9), at(10, 30)), day), [540, 630]);
});

test('clipToDay: 日をまたぐ予定は切り取る', () => {
  assert.deepEqual(clipToDay(ev('a', at(-2), at(1)), day), [0, 60]);
  assert.deepEqual(clipToDay(ev('a', at(23), at(26)), day), [1380, 1440]);
});

test('clipToDay: 別の日の予定は null', () => {
  assert.equal(clipToDay(ev('a', at(25), at(26)), day), null);
  assert.equal(clipToDay(ev('a', at(-3), at(0)), day), null);
});

test('mergeIntervals: 重なり・隣接をまとめる', () => {
  assert.deepEqual(
    mergeIntervals([[600, 660], [540, 600], [700, 720], [710, 800]]),
    [[540, 660], [700, 800]],
  );
  assert.deepEqual(mergeIntervals([]), []);
});

test('freeSlots: 選択メンバー全員が空いている時間', () => {
  const events = [
    ev('a', at(9), at(10)),
    ev('b', at(9, 30), at(11)),
    ev('c', at(12), at(13)), // c は対象外
  ];
  assert.deepEqual(freeSlots(events, ['a', 'b'], day), [[0, 540], [660, 1440]]);
});

test('freeSlots: 最小分数より短い空きは除外', () => {
  const events = [ev('a', at(9), at(10)), ev('a', at(10, 30), at(12))];
  assert.deepEqual(freeSlots(events, ['a'], day, 60), [[0, 540], [720, 1440]]);
});

test('freeSlots: メンバー未選択なら終日空き', () => {
  assert.deepEqual(freeSlots([ev('a', at(9), at(10))], [], day), [[0, 1440]]);
});

test('fmtMin', () => {
  assert.equal(fmtMin(0), '0:00');
  assert.equal(fmtMin(545), '9:05');
  assert.equal(fmtMin(1440), '24:00');
});

test('pickColor: 未使用の色を返す', () => {
  assert.equal(pickColor([]), PALETTE[0]);
  assert.equal(pickColor([PALETTE[0], PALETTE[1]]), PALETTE[2]);
  assert.equal(pickColor(PALETTE), PALETTE[0]); // 全部使用済みなら循環
});
