import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(new URL('./fixtures/utc-tools.mjs', import.meta.url));
const run = () => JSON.parse(execFileSync(process.execPath, [fixture], { env: { ...process.env, TZ: 'UTC' } }));

test('UTC の環境でも「今日」は日本時間の日付', () => {
  assert.equal(run().head, '2026-11-13（金）');
});

test('UTC の環境でも 9:00 は日本時間の 9:00 として保存し、9:00 と表示する', () => {
  const r = run();
  assert.equal(r.starts_at, '2026-11-13T00:00:00.000Z');
  assert.match(r.listed, /9:00–10:00 佐藤「x」/);
});
