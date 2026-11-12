import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authDomainFor } from '../lib/auth.js';

test('authDomainFor: Firebase Hosting 上ではアプリと同じドメインでログイン処理する（Safari の保存領域の分離対策）', () => {
  assert.equal(authDomainFor('team-schedule-5afa8a.web.app', 'team-schedule-5afa8a'), 'team-schedule-5afa8a.web.app');
  assert.equal(authDomainFor('team-schedule-5afa8a.firebaseapp.com', 'team-schedule-5afa8a'), 'team-schedule-5afa8a.firebaseapp.com');
});

test('authDomainFor: それ以外（localhost など）は firebaseapp.com', () => {
  assert.equal(authDomainFor('localhost', 'p1'), 'p1.firebaseapp.com');
  assert.equal(authDomainFor('pealsh.github.io', 'p1'), 'p1.firebaseapp.com');
  assert.equal(authDomainFor('evil.web.app', 'p1'), 'p1.firebaseapp.com');
});
