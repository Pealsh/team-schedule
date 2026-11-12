// Firestore ルールのテスト。`npm run test:rules`（エミュレーターが必要）で実行する。
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApi } from '../../lib/api.js';
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, query, where, getDocs, serverTimestamp,
} from 'firebase/firestore';

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-ts',
    firestore: { rules: readFileSync('firebase/firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'teams/T'), { name: 'T', owner: 'o@x.com', allowed: ['o@x.com', 'm@x.com'] });
    await setDoc(doc(db, 'tokens/hm'), { team: 'T', email: 'm@x.com', label: 'c', created_at: new Date() });
  });
});

const as = (email, verified = true) => env.authenticatedContext(email, { email, email_verified: verified }).firestore();
const member = { name: '佐藤', color: '#e5484d', created_at: new Date() };
const H = 'a'.repeat(64);
const token = (email, extra = {}) => ({ team: 'T', email, label: 'c', created_at: serverTimestamp(), ...extra });

test('許可された人はチームと members を読み書きできる', async () => {
  const db = as('m@x.com');
  await assertSucceeds(getDoc(doc(db, 'teams/T')));
  await assertSucceeds(setDoc(doc(db, 'teams/T/members/a'), member));
  await assertSucceeds(getDocs(collection(db, 'teams/T/members')));
});

test('リスト外の人は読めない・書けない', async () => {
  const db = as('z@x.com');
  await assertFails(getDoc(doc(db, 'teams/T')));
  await assertFails(getDocs(collection(db, 'teams/T/members')));
  await assertFails(setDoc(doc(db, 'teams/T/members/a'), member));
});

test('メール未確認は拒否', async () => {
  await assertFails(getDoc(doc(as('m@x.com', false), 'teams/T')));
});

test('未ログインは拒否', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'teams/T')));
  await assertFails(getDocs(collection(db, 'teams/T/events')));
});

test('オーナーは allowed を更新できる', async () => {
  await assertSucceeds(updateDoc(doc(as('o@x.com'), 'teams/T'), { allowed: ['o@x.com', 'n@x.com'] }));
});

test('オーナーが自分を allowed から外す更新は拒否', async () => {
  await assertFails(updateDoc(doc(as('o@x.com'), 'teams/T'), { allowed: ['m@x.com'] }));
});

test('オーナーでも allowed 以外は更新できない', async () => {
  await assertFails(updateDoc(doc(as('o@x.com'), 'teams/T'), { name: 'X' }));
});

test('オーナー以外は allowed を更新できない', async () => {
  await assertFails(updateDoc(doc(as('m@x.com'), 'teams/T'), { allowed: ['o@x.com', 'm@x.com', 'z@x.com'] }));
});

test('チーム文書の作成・削除は誰もできない', async () => {
  await assertFails(setDoc(doc(as('o@x.com'), 'teams/U'), { name: 'U', owner: 'o@x.com', allowed: ['o@x.com'] }));
  await assertFails(deleteDoc(doc(as('o@x.com'), 'teams/T')));
});

test('自分のトークンは作れる', async () => {
  await assertSucceeds(setDoc(doc(as('m@x.com'), `tokens/${H}`), token('m@x.com')));
});

test('他人名義のトークンは作れない', async () => {
  await assertFails(setDoc(doc(as('m@x.com'), `tokens/${H}`), token('o@x.com')));
});

test('余計な項目付きのトークンは作れない', async () => {
  await assertFails(setDoc(doc(as('m@x.com'), `tokens/${H}`), token('m@x.com', { admin: true })));
});

test('ラベルが空や 41 文字以上のトークンは作れない', async () => {
  await assertFails(setDoc(doc(as('m@x.com'), `tokens/${H}`), token('m@x.com', { label: '' })));
  await assertFails(setDoc(doc(as('m@x.com'), `tokens/${H}`), token('m@x.com', { label: 'x'.repeat(41) })));
});

test('リスト外の人はそのチームのトークンを作れない', async () => {
  await assertFails(setDoc(doc(as('z@x.com'), `tokens/${H}`), token('z@x.com')));
});

test('自分のトークンは読めて消せる', async () => {
  const db = as('m@x.com');
  await assertSucceeds(getDoc(doc(db, 'tokens/hm')));
  await assertSucceeds(deleteDoc(doc(db, 'tokens/hm')));
});

test('他人のトークンは読めない・消せない', async () => {
  const db = as('o@x.com');
  await assertFails(getDoc(doc(db, 'tokens/hm')));
  await assertFails(deleteDoc(doc(db, 'tokens/hm')));
});

test('トークンは更新できない', async () => {
  await assertFails(updateDoc(doc(as('m@x.com'), 'tokens/hm'), { label: 'x' }));
});

test('email で絞ったトークン一覧は本人だけ', async () => {
  await assertSucceeds(getDocs(query(collection(as('m@x.com'), 'tokens'), where('email', '==', 'm@x.com'))));
  await assertFails(getDocs(query(collection(as('o@x.com'), 'tokens'), where('email', '==', 'm@x.com'))));
});

test('members / events の文書 ID は英数字・_・- だけ（HTML を仕込めない）', async () => {
  const db = as('m@x.com');
  await assertFails(setDoc(doc(db, 'teams/T/members/x" onmouseover="alert(1)'), member));
  await assertSucceeds(setDoc(doc(db, 'teams/T/members/Ab_9-z'), member));
  const ev = { member_id: 'a', title: 't', starts_at: new Date(0), ends_at: new Date(1000), created_at: new Date() };
  await assertFails(setDoc(doc(db, 'teams/T/events/<img>'), ev));
  await assertSucceeds(setDoc(doc(db, 'teams/T/events/e1'), ev));
});

test('member_id にも HTML を仕込めない', async () => {
  const ev = { member_id: 'a"><b', title: 't', starts_at: new Date(0), ends_at: new Date(1000), created_at: new Date() };
  await assertFails(setDoc(doc(as('m@x.com'), 'teams/T/events/e1'), ev));
});

test('tokens の文書 ID は 64 文字の hex だけ', async () => {
  await assertFails(setDoc(doc(as('m@x.com'), 'tokens/x"><img'), token('m@x.com')));
  await assertSucceeds(setDoc(doc(as('m@x.com'), `tokens/${'a'.repeat(64)}`), token('m@x.com')));
});

test('自動 ID での追加（画面と同じ）も許可される', async () => {
  const db = as('m@x.com');
  await assertSucceeds(addDoc(collection(db, 'teams/T/members'), member));
  const ev = { member_id: 'a', title: 't', starts_at: new Date(0), ends_at: new Date(1000), created_at: new Date() };
  await assertSucceeds(addDoc(collection(db, 'teams/T/events'), ev));
});

// 画面と同じ REST リクエスト（lib/api.js）をエミュレーターに向けて送る
function restApi(email) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const jwt = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: 'https://securetoken.google.com/demo-ts', aud: 'demo-ts', sub: email, user_id: email,
    email, email_verified: true, iat: now, exp: now + 3600, auth_time: now, firebase: { sign_in_provider: 'google.com' },
  })}.`;
  const fetch = (url, init) => globalThis.fetch(url.replace('https://firestore.googleapis.com', 'http://127.0.0.1:8080'), init);
  return createApi({ projectId: 'demo-ts', apiKey: 'k', teamKey: 'T', fetch, getAuthHeader: async () => `Bearer ${jwt}` });
}

test('REST（画面と同じ）でメンバーと予定を追加できる', async () => {
  const a = restApi('m@x.com');
  assert.equal(await a.checkAccess(), 'ok');
  const m = await a.addMember({ name: '佐藤', color: '#e5484d' });
  await a.addEvent({ member_id: m.id, title: 't', starts_at: '2026-11-13T00:00:00Z', ends_at: '2026-11-13T01:00:00Z' });
  assert.equal((await a.members()).length, 1);
});

// ---------- 招待リンク ----------
const CODE = 'Abcdefghijklmnopqrstuvwxyz012345'; // 32 文字
const days = (n) => new Date(Date.now() + n * 86400000);
async function seedInvite(code = CODE, expires = days(7)) {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), `teams/T/invites/${code}`), { created_at: new Date(), expires_at: expires }));
}
const join = (email, code = CODE, extra = {}) => updateDoc(doc(as(email), 'teams/T'), {
  allowed: ['o@x.com', 'm@x.com', email], invite: `${code}:${email}`, ...extra,
});

test('オーナーだけが招待を作れる・一覧できる・消せる', async () => {
  const inv = { created_at: new Date(), expires_at: days(7) };
  await assertSucceeds(setDoc(doc(as('o@x.com'), `teams/T/invites/${CODE}`), inv));
  await assertSucceeds(getDocs(collection(as('o@x.com'), 'teams/T/invites')));
  await assertFails(setDoc(doc(as('m@x.com'), 'teams/T/invites/Zbcdefghijklmnopqrstuvwxyz012345'), inv));
  await assertFails(getDocs(collection(as('m@x.com'), 'teams/T/invites')));
  await assertFails(deleteDoc(doc(as('m@x.com'), `teams/T/invites/${CODE}`)));
  await assertSucceeds(deleteDoc(doc(as('o@x.com'), `teams/T/invites/${CODE}`)));
});

test('招待の期限は 8 日以内、コードは英数字 32 文字', async () => {
  await assertFails(setDoc(doc(as('o@x.com'), `teams/T/invites/${CODE}`), { created_at: new Date(), expires_at: days(30) }));
  await assertFails(setDoc(doc(as('o@x.com'), 'teams/T/invites/short'), { created_at: new Date(), expires_at: days(7) }));
});

test('有効な招待コードで、自分のメールを許可リストに足せる', async () => {
  await seedInvite();
  await assertSucceeds(join('n@x.com'));
});

test('存在しない・期限切れのコードでは参加できない', async () => {
  await assertFails(join('n@x.com'));
  await seedInvite(CODE, days(-1));
  await assertFails(join('n@x.com'));
});

test('招待コードがあっても、他人のメールは足せない', async () => {
  await seedInvite();
  await assertFails(updateDoc(doc(as('n@x.com'), 'teams/T'), { allowed: ['o@x.com', 'm@x.com', 'z@x.com'], invite: `${CODE}:n@x.com` }));
  await assertFails(updateDoc(doc(as('n@x.com'), 'teams/T'), { allowed: ['o@x.com', 'm@x.com', 'n@x.com', 'z@x.com'], invite: `${CODE}:n@x.com` }));
});

test('招待コードがあっても、既存の人を消したり名前を変えたりできない', async () => {
  await seedInvite();
  await assertFails(updateDoc(doc(as('n@x.com'), 'teams/T'), { allowed: ['o@x.com', 'n@x.com'], invite: `${CODE}:n@x.com` }));
  await assertFails(join('n@x.com', CODE, { name: 'X' }));
});

test('前の人が使ったコードがチーム文書に残っていても、コードを知らない人は流用できない', async () => {
  await seedInvite();
  await assertSucceeds(join('n@x.com'));
  // n@x.com の invite が残っている状態で、コードを知らない z@x.com が allowed だけ書き換える
  await assertFails(updateDoc(doc(as('z@x.com'), 'teams/T'), { allowed: ['o@x.com', 'm@x.com', 'n@x.com', 'z@x.com'] }));
});

test('REST（画面と同じ）で招待コードを使って参加できる', async () => {
  await seedInvite();
  const a = restApi('n@x.com');
  assert.equal(await a.checkAccess(), 'forbidden');
  await a.joinWithInvite(CODE, 'n@x.com');
  assert.equal(await a.checkAccess(), 'ok');
  await assert.rejects(restApi('z@x.com').joinWithInvite('Zbcdefghijklmnopqrstuvwxyz012345', 'z@x.com'), /403/);
});

test('REST（画面と同じ）でオーナーが招待を作って一覧・削除できる', async () => {
  const a = restApi('o@x.com');
  const { code } = await a.createInvite();
  assert.deepEqual((await a.invites()).map((x) => x.id), [code]);
  await a.revokeInvite(code);
  assert.deepEqual(await a.invites(), []);
});

// ---------- Gmail ひも付きメンバー ----------
async function seedMember(id, data) {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), `teams/T/members/${id}`), { color: '#e5484d', created_at: new Date(), ...data }));
}

test('自分のメールを付けたメンバーは作れる、他人のメールは付けられない', async () => {
  await assertSucceeds(setDoc(doc(as('m@x.com'), 'teams/T/members/me1'), { ...member, email: 'm@x.com' }));
  await assertFails(setDoc(doc(as('m@x.com'), 'teams/T/members/me2'), { ...member, email: 'o@x.com' }));
});

test('メンバーの email は後から変えられない・付けられない', async () => {
  await seedMember('a', { name: '佐藤', email: 'm@x.com' });
  await seedMember('b', { name: '手動' });
  await assertFails(updateDoc(doc(as('m@x.com'), 'teams/T/members/a'), { email: 'z@x.com' }));
  await assertFails(updateDoc(doc(as('m@x.com'), 'teams/T/members/b'), { email: 'm@x.com' }));
});

test('名前は本人・オーナー・メール無しのメンバーなら変えられる', async () => {
  await seedMember('a', { name: '佐藤', email: 'm@x.com' });
  await seedMember('b', { name: '手動' });
  await assertSucceeds(updateDoc(doc(as('m@x.com'), 'teams/T/members/a'), { name: 'さとう' }));
  await assertSucceeds(updateDoc(doc(as('o@x.com'), 'teams/T/members/a'), { name: 'サトウ' }));
  await assertSucceeds(updateDoc(doc(as('m@x.com'), 'teams/T/members/b'), { name: 'てどう' }));
});

test('他人（オーナー以外）の名前は変えられないが、色は変えられる', async () => {
  await seedMember('o', { name: 'オーナー', email: 'o@x.com' });
  await assertFails(updateDoc(doc(as('m@x.com'), 'teams/T/members/o'), { name: 'X' }));
  await assertSucceeds(updateDoc(doc(as('m@x.com'), 'teams/T/members/o'), { color: '#000000' }));
});
