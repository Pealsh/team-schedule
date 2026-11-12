import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_DEFS, validateArgs } from '../mcp/schema.js';

const schema = (name) => TOOL_DEFS.find((d) => d.name === name).inputSchema;

test('TOOL_DEFS: 5 ツール（add_member は AI に出さない）', () => {
  assert.deepEqual(TOOL_DEFS.map((d) => d.name).sort(),
    ['add_event', 'delete_event', 'find_free_slots', 'list_events', 'list_members']);
  for (const d of TOOL_DEFS) {
    assert.ok(d.description);
    assert.equal(d.inputSchema.type, 'object');
  }
});

test('validateArgs: 正しい入力は null', () => {
  assert.equal(validateArgs(schema('add_event'), { member: 'a', title: 't', date: '2026-11-13', start: '9:00', end: '10:00' }), null);
  assert.equal(validateArgs(schema('list_members'), {}), null);
  assert.equal(validateArgs(schema('find_free_slots'), { members: ['a', 'b'], min_minutes: 60 }), null);
});

test('validateArgs: 日付の形式違いはメッセージ', () => {
  assert.match(validateArgs(schema('add_event'), { member: 'a', title: 't', date: '2026/11/13', start: '9:00', end: '10:00' }), /date/);
});

test('validateArgs: 必須が無い・型違い・範囲外はメッセージ', () => {
  assert.match(validateArgs(schema('add_event'), { member: 'a', date: '2026-11-13', start: '9:00', end: '10:00' }), /title/);
  assert.match(validateArgs(schema('list_events'), { days: 0 }), /days/);
  assert.match(validateArgs(schema('list_events'), { days: 1.5 }), /days/);
  assert.match(validateArgs(schema('find_free_slots'), { members: 'a' }), /members/);
  assert.match(validateArgs(schema('add_event'), { title: '', date: '2026-11-13', start: '9:00', end: '10:00' }), /title/);
  assert.match(validateArgs(schema('delete_event'), { id: 3 }), /id/);
});

test('validateArgs: 引数がオブジェクトでなければメッセージ', () => {
  assert.ok(validateArgs(schema('list_members'), null));
});

test('validateArgs: id は英数字・_・- だけ（パスを辿る id を拒否）', () => {
  const s = schema('delete_event');
  assert.equal(validateArgs(s, { id: 'AbC123_-xyz' }), null);
  for (const id of ['../../T', '..', 'a/b', '%2e%2e', '']) assert.match(validateArgs(s, { id }) ?? '', /id/, id);
});

test('validateArgs: タイトルは 80 文字まで、member は省略できる', () => {
  assert.equal(validateArgs(schema('add_event'), { title: 't', date: '2026-11-13', start: '9:00', end: '10:00' }), null);
  const ev = { member: 'a', date: '2026-11-13', start: '9:00', end: '10:00' };
  assert.match(validateArgs(schema('add_event'), { ...ev, title: 'x'.repeat(81) }), /title/);
  assert.equal(validateArgs(schema('add_event'), { ...ev, title: 'x'.repeat(80) }), null);
});
