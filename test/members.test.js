import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSelfMember, checkName } from '../lib/members.js';
import { PALETTE } from '../lib/timeline.js';

const ms = [
  { id: 'a', name: '佐藤', color: PALETTE[0] },
  { id: 'b', name: '鈴木', color: PALETTE[1], email: 's@x.com' },
];

test('planSelfMember: 自分のメールのメンバーが居れば作らない', () => {
  assert.equal(planSelfMember(ms, 's@x.com', '鈴木'), null);
});

test('planSelfMember: Google の表示名・空いている色・メール付きで作る', () => {
  assert.deepEqual(planSelfMember(ms, 'n@x.com', ' 高橋 花子 '), { name: '高橋 花子', color: PALETTE[2], email: 'n@x.com' });
});

test('planSelfMember: 表示名が無ければメールの @ より前', () => {
  assert.equal(planSelfMember(ms, 'taro.y@gmail.com', null).name, 'taro.y');
});

test('planSelfMember: 同じ名前があれば (2)、(3) と付ける', () => {
  assert.equal(planSelfMember(ms, 'n@x.com', '佐藤').name, '佐藤 (2)');
  assert.equal(planSelfMember([...ms, { id: 'c', name: '佐藤 (2)', color: '#000000' }], 'n@x.com', '佐藤').name, '佐藤 (3)');
});

test('planSelfMember: 30 文字に収める', () => {
  assert.equal(planSelfMember(ms, 'n@x.com', 'あ'.repeat(40)).name.length, 30);
  const long = 'い'.repeat(30);
  const r = planSelfMember([{ id: 'z', name: long, color: '#000000' }], 'n@x.com', long).name;
  assert.ok(r.length <= 30 && r.endsWith(' (2)'));
});

test('checkName: 空・31 文字以上・他の人と重複はメッセージ、自分と同じ名前は OK', () => {
  assert.match(checkName('  ', ms, 'a'), /入力/);
  assert.match(checkName('あ'.repeat(31), ms, 'a'), /30/);
  assert.match(checkName('鈴木', ms, 'a'), /同じ名前/);
  assert.equal(checkName('佐藤', ms, 'a'), null);
  assert.equal(checkName('さとう', ms, 'a'), null);
});
