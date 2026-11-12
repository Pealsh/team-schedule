// サービスアカウント JSON から Google のアクセストークンを取る（Firestore 用）。期限まで使い回す。

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/datastore';

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));

async function importPem(pem) {
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

export function createTokenSource(saJson, { fetch = globalThis.fetch, now = Date.now } = {}) {
  let sa;
  let keyP;
  let cache = { token: null, until: 0 };

  async function fetchToken() {
    // 鍵の読み込みは最初に使うときだけ（未設定でも Worker 自体は動く）。失敗は status 付きで投げ、502 にする
    try {
      sa ??= JSON.parse(saJson);
      keyP ??= importPem(sa.private_key);
      await keyP;
    } catch (e) {
      sa = undefined;
      keyP = undefined;
      throw Object.assign(new Error(`GOOGLE_SA が読めません: ${e.message}`), { status: 500 });
    }
    const iat = Math.floor(now() / 1000);
    const body = `${b64urlJson({ alg: 'RS256', typ: 'JWT' })}.${b64urlJson({
      iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600,
    })}`;
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await keyP, new TextEncoder().encode(body));
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${body}.${b64url(sig)}`,
      }).toString(),
    });
    if (!res.ok) throw Object.assign(new Error(`token ${res.status}`), { status: res.status });
    const j = await res.json();
    cache = { token: j.access_token, until: now() + (j.expires_in - 60) * 1000 };
    return cache.token;
  }

  return {
    get: () => (cache.token && now() < cache.until ? Promise.resolve(cache.token) : fetchToken()),
  };
}
