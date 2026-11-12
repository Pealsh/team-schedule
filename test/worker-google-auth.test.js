import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTokenSource } from '../worker/google-auth.js';

async function fakeSa() {
  const kp = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  );
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  return { kp, json: JSON.stringify({ client_email: 'sa@p.iam.gserviceaccount.com', private_key: pem }) };
}

function tokenEndpoint(status = 200) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init, form: new URLSearchParams(init.body) });
    return { ok: status < 300, status, json: async () => (status < 300 ? { access_token: `at${calls.length}`, expires_in: 3600 } : { error: 'invalid_grant' }) };
  };
  f.calls = calls;
  return f;
}

const b64urlJson = (s) => JSON.parse(Buffer.from(s, 'base64url').toString());

test('JWT を署名して交換し、アクセストークンを返す', async () => {
  const { kp, json } = await fakeSa();
  const f = tokenEndpoint();
  const src = createTokenSource(json, { fetch: f, now: () => 1_000_000_000_000 });
  assert.equal(await src.get(), 'at1');
  const c = f.calls[0];
  assert.equal(c.url, 'https://oauth2.googleapis.com/token');
  assert.equal(c.init.method, 'POST');
  assert.equal(c.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(c.form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [h, p, sig] = c.form.get('assertion').split('.');
  assert.deepEqual(b64urlJson(h), { alg: 'RS256', typ: 'JWT' });
  assert.deepEqual(b64urlJson(p), {
    iss: 'sa@p.iam.gserviceaccount.com',
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: 1_000_000_000,
    exp: 1_000_003_600,
  });
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', kp.publicKey, Buffer.from(sig, 'base64url'), new TextEncoder().encode(`${h}.${p}`));
  assert.ok(ok);
});

test('期限内はキャッシュし、期限が近づいたら取り直す', async () => {
  const { json } = await fakeSa();
  const f = tokenEndpoint();
  let t = 1_000_000_000_000;
  const src = createTokenSource(json, { fetch: f, now: () => t });
  await src.get();
  t += 3000 * 1000;
  assert.equal(await src.get(), 'at1');
  assert.equal(f.calls.length, 1);
  t += 600 * 1000; // 3600 秒後
  assert.equal(await src.get(), 'at2');
  assert.equal(f.calls.length, 2);
});

test('交換に失敗したら reject', async () => {
  const { json } = await fakeSa();
  const src = createTokenSource(json, { fetch: tokenEndpoint(400), now: () => 1_000_000_000_000 });
  await assert.rejects(src.get(), /400/);
});

test('鍵が未設定でも作成時には投げず、get() で status 付きのエラーになる', async () => {
  const src = createTokenSource(undefined);
  const err = await src.get().catch((e) => e);
  assert.ok(err instanceof Error);
  assert.equal(err.status, 500);
});
