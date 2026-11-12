import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mcpUrl, curlExample, normalizeAllowed } from '../lib/connect.js';

test('mcpUrl: 末尾スラッシュを除いて /mcp/ とつなぐ', () => {
  assert.equal(mcpUrl('https://w.dev/', 'ts_a'), 'https://w.dev/mcp/ts_a');
  assert.equal(mcpUrl('https://w.dev', 'ts_a'), 'https://w.dev/mcp/ts_a');
});

test('curlExample: Bearer 付きで /api/members', () => {
  assert.equal(curlExample('https://w.dev/', 'ts_a'), 'curl -H "Authorization: Bearer ts_a" https://w.dev/api/members');
});

test('normalizeAllowed: 小文字・空白除去・重複除去、オーナーが先頭', () => {
  assert.deepEqual(normalizeAllowed([' A@Gmail.com ', 'a@gmail.com', 'o@x.com'], 'o@x.com'), { list: ['o@x.com', 'a@gmail.com'] });
});

test('normalizeAllowed: オーナーを外してもオーナーが戻る', () => {
  assert.deepEqual(normalizeAllowed(['b@x.com'], 'O@x.com'), { list: ['o@x.com', 'b@x.com'] });
});

test('normalizeAllowed: 空行は無視、メール形式でなければ error', () => {
  assert.deepEqual(normalizeAllowed(['', '  '], 'o@x.com'), { list: ['o@x.com'] });
  const r = normalizeAllowed(['bad'], 'o@x.com');
  assert.match(r.error, /bad/);
  assert.equal(r.list, undefined);
});

test('inviteUrl: 今のページの URL にチームキーと招待コードを付ける', async () => {
  const { inviteUrl } = await import('../lib/connect.js');
  assert.equal(inviteUrl('https://a.github.io/app/?x=1#k=old', 'T 1', 'C1'), 'https://a.github.io/app/?x=1#k=T%201&i=C1');
});
