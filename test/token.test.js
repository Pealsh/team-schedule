import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateToken, hashToken } from '../lib/token.js';

test('generateToken: ts_ + 43 文字の base64url、毎回違う', () => {
  const a = generateToken();
  assert.match(a, /^ts_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, generateToken());
});

test('hashToken: SHA-256 の hex', async () => {
  assert.equal(await hashToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
