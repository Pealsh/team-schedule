# Gmail ログイン＋接続画面 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 許可リストの Gmail だけが使えるようにし、画面から MCP URL / REST API の接続トークンを発行できるようにする。

**Architecture:** ブラウザは Firebase Auth（CDN）で取得した ID トークンを付けて Firestore REST を呼び、セキュリティルールで `teams/{team}.allowed` を確認する。Cloudflare Worker は接続トークンを照合したうえで、サービスアカウントで Firestore を読み書きし、既存の `mcp/tools.js` を MCP（手書きの JSON-RPC）と REST の両方に公開する。

**Tech Stack:** 素の ES Modules（ビルドなし）、Firebase Auth 13.3.0（gstatic CDN）、Firestore REST、Cloudflare Workers（wrangler 4.x）、node:test、@firebase/rules-unit-testing 6.x と Firestore エミュレーター

**Spec:** `docs/superpowers/specs/2026-11-12-auth-connect-design.md`

## Global Constraints

- このフォルダは git 管理外。各タスクの「Commit」は「`npm test` 全通過を確認」に置き換える。push は人間が行う
- メールアドレスは保存・比較の前に `trim().toLowerCase()` する
- 接続トークンの形式：`ts_` ＋ 32 バイト乱数の base64url（パディングなし）。保存するのは SHA-256 の hex（64 文字）だけ
- 401 の応答本文は常に `{"error":"invalid token"}`。理由は区別しない
- Worker のタイムゾーンは Asia/Tokyo 固定（UTC+540 分、夏時間なし）
- デモモード（`FIREBASE_PROJECT_ID` が `YOUR-` で始まる）はログインなしで今まで通り動く
- N-01 の上限：自前の JS と CSS で合計 **40KB 以下**。今の時点ですでに 30.1KB あり、仕様の 30KB では収まらないため、40KB への緩和をユーザーに確認する
- 依存を足してよいのは devDependencies（ルールテスト用）と `worker/` の wrangler だけ。Worker のランタイム依存はゼロ
- 既存の 27 テストは、`checkKey`→`checkAccess` の改名に合わせた修正を除き、そのまま通ること

## Review Focus

1. **URL 末尾の `/` や前後の空白付きでトークンを貼った**：`/mcp/<t>/` や `Bearer  <t> ` でも認証が通る（Task 6 にテストあり）
2. **オーナーが大文字入りの Gmail を許可リストに入れた**：小文字にそろえて保存され、その人がログインできる（Task 7 の `normalizeAllowed` にテストあり）
3. **オーナーが自分を許可リストから外そうとした**：画面でもルールでも拒否される（Task 2 と Task 7）
4. **Worker（UTC）で、日本時間の深夜 0〜9 時に「今日」の予定を聞いた**：日本時間の日付で答える（Task 3）
5. **トークン発行後に、その人が許可リストから外された／トークンが無効化された**：次のリクエストから 401 になる（Task 6）

---

### Task 1: lib/token.js と lib/api.js（認証ヘッダー・配列・新メソッド）

**Files:**
- Create: `lib/token.js`
- Modify: `lib/api.js`（`toFields`/`fromDoc`/`createApi` 全体）、`app.js:48-69`（`checkKey` を `checkAccess` に置き換え）
- Test: `test/token.test.js`（新規）、`test/api.test.js`（追記）

**Interfaces:**
- Produces:
  - `generateToken(): string`
  - `hashToken(token: string): Promise<string>`（hex 64 文字）
  - `toFields` は配列を `{ arrayValue: { values: [{ stringValue }] } }` にする。`fromDoc` は逆変換し、空配列は `[]` を返す
  - `createApi({ projectId, apiKey, teamKey, getAuthHeader?, fetch? })`：`getAuthHeader: () => Promise<string|null>`。値があれば `Authorization` ヘッダーに入れる。`apiKey` が空なら URL に `key=` を付けない（Worker 用。テスト：`apiKey: ''` のとき URL に `key=` が含まれない）
  - `api.checkAccess(): Promise<'ok'|'forbidden'|'missing'>`（200 / 403 / 404。それ以外は throw）
  - `api.team(): Promise<{ name, owner, allowed: string[] }>`
  - `api.setAllowed(list: string[]): Promise<void>`（`teams/{k}` を PATCH、`updateMask.fieldPaths=allowed`）
  - `api.createToken(label: string, email: string): Promise<{ token, hash }>`（`POST documents/tokens?documentId=<hash>`、項目は `team, email, label, created_at`）
  - `api.myTokens(email): Promise<Array<{ id, label, created_at }>>`（ルートの runQuery で `email EQUAL` を指定し、`team === teamKey` だけ残す。新しい順）
  - `api.revokeToken(hash): Promise<void>`
  - 既存のメソッドはシグネチャを変えない

- [ ] **Step 1: 失敗するテストを書く**
  - `test/token.test.js`
    - `generateToken` が `/^ts_[A-Za-z0-9_-]{43}$/` に一致し、2 回呼ぶと異なる値になる
    - `hashToken('abc')` が `'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'`
  - `test/api.test.js` に追記（既存の `mockFetch` を使う）
    - `getAuthHeader` が `'Bearer X'` を返すと、全リクエストに `Authorization: Bearer X` が付く。`mockFetch` は `init.headers` も記録するよう拡張する
    - `toFields({ allowed: ['a@x.com'] })` → `{ allowed: { arrayValue: { values: [{ stringValue: 'a@x.com' }] } } }`
    - `fromDoc` で `arrayValue: {}` → `[]` になる
    - `checkAccess`：200 → `'ok'`、403 → `'forbidden'`、404 → `'missing'`、500 → reject
    - `setAllowed(['a@x.com'])`：URL に `updateMask.fieldPaths=allowed`、method が `PATCH`
    - `createToken('claude', 'a@x.com')`：POST 先が `${BASE}/tokens?key=k1&documentId=<64hex>`、body の team が `'team-abc'`。戻り値の `hash` が `hashToken(token)` と一致する
    - `myTokens`：runQuery の結果から別チームの行が除かれる
    - `revokeToken('h1')`：`DELETE ${BASE}/tokens/h1`
- [ ] **Step 2: 実行して失敗を確認**：`npm test` → 新規テストが FAIL（`generateToken` が無い など）
- [ ] **Step 3: 実装する**
  - トークン生成は `crypto.getRandomValues` と `btoa`、ハッシュは `crypto.subtle.digest('SHA-256')`
  - `checkKey` を削除し、`app.js` の `connect()` を `checkAccess() === 'ok'` を見る形に直す（ログイン対応は Task 7）
- [ ] **Step 4: 実行して通過を確認**：`npm test` → 全件 PASS
- [ ] **Step 5: チェックポイント**：`npm test` 全通過

### Task 2: セキュリティルールとエミュレーターテスト

**Files:**
- Modify: `firebase/firestore.rules`、`firebase.json`（`emulators.firestore.port: 8080` を追加）、`package.json`（devDependencies：`@firebase/rules-unit-testing@^6`、`firebase@^13`、`firebase-tools@^15`。script `"test:rules": "firebase emulators:exec --only firestore --project demo-ts \"node --test test/rules/*.test.js\""`）
- Test: `test/rules/rules.test.js`（新規。`npm test` の glob `test/*.test.js` には含めない）

**Interfaces:**
- Consumes: 仕様の 5 章のルール
- Produces: 本番に反映できる `firebase/firestore.rules`

- [ ] **Step 1: 失敗するテストを書く**
  - 前提データは `withSecurityRulesDisabled` で入れる：`teams/T = { name, owner: 'o@x.com', allowed: ['o@x.com', 'm@x.com'] }`
  - 認証コンテキスト：`authenticatedContext(uid, { email, email_verified: true })`
  - テスト項目
    - `m@x.com` は `teams/T` の get と members の create/read ができる
    - `z@x.com`（リスト外）は get も members の read もできない
    - `email_verified: false` の `m@x.com` は拒否される
    - 未ログインは拒否される
    - `o@x.com` は `allowed` を `['o@x.com','n@x.com']` に更新できる
    - `o@x.com` が `allowed` から自分を外す更新は拒否される
    - `o@x.com` が `name` を変える更新は拒否される
    - `m@x.com`（オーナー以外）が `allowed` を更新するのは拒否される
    - `m@x.com` は `tokens/h1 = { team: 'T', email: 'm@x.com', label: 'c', created_at }` を作成できる
    - `email` が他人のトークンの作成は拒否される
    - 余計な項目付きのトークンの作成は拒否される
    - `z@x.com` が `team: 'T'` のトークンを作るのは拒否される
    - `m@x.com` は自分のトークンを get / delete できる
    - `o@x.com` は `m@x.com` のトークンを get できない
    - 誰であってもトークンの update はできない
    - `where('email','==','m@x.com')` のクエリは `m@x.com` なら成功し、`o@x.com` なら失敗する
- [ ] **Step 2: 実行して失敗を確認**：`npm install && npm run test:rules` → 今のルールでは許可リスト関連の項目が FAIL
- [ ] **Step 3: ルールを書き換える**：仕様の 5 章どおりに書く。`allowedIn` は `get(/databases/$(database)/documents/teams/$(team)).data.allowed.hasAny([request.auth.token.email])`。オーナー更新は `request.resource.data.diff(resource.data).affectedKeys().hasOnly(['allowed'])` と `request.resource.data.allowed.hasAny([resource.data.owner])` で判定する
- [ ] **Step 4: 実行して通過を確認**：`npm run test:rules` → 全件 PASS。`npm test` も PASS
- [ ] **Step 5: チェックポイント**。本番への反映は Task 8 で行う（今反映すると、本番のブラウザ版が先に壊れるため）

### Task 3: ツールの UTC 対応・JSON Schema・入力検証、stdio 版の削除

**Files:**
- Create: `lib/fixed-offset.js`、`mcp/schema.js`
- Modify: `mcp/tools.js`（`createTools(api, { now } = {})`、`today()` を `now()` 基準にする）
- Delete: `mcp/server.js`、`mcp/package.json`、`mcp/package-lock.json`、`mcp/node_modules/`
- Test: `test/fixed-offset.test.js`、`test/schema.test.js`（新規）、`test/mcp-tools.test.js`（追記）

**Interfaces:**
- Produces:
  - `withFixedOffset(api, offsetMin: number): api` と同じ形
    - Worker（UTC）内で「UTC の 0:00 を、その地域の 0:00 とみなす」ずらしを行う
    - `events(from, to)` は from/to から `offsetMin` 分を引いて問い合わせ、返す `starts_at`/`ends_at` に足す
    - `addEvent` の `starts_at`/`ends_at` からは引く
    - それ以外のメソッドはそのまま委譲する
  - `fixedNow(offsetMin): () => Date`（`new Date(Date.now() + offsetMin*60000)`）
  - `createTools(api, { now?: () => Date })`
  - `TOOL_DEFS: Array<{ name, description, inputSchema }>`（今の `server.js` の 6 ツールの説明と zod 定義を JSON Schema に書き写す。date は `pattern '^\\d{4}-\\d{2}-\\d{2}$'`、time は `'^\\d{1,2}:\\d{2}$'`、days は integer 1〜31）
  - `validateArgs(schema, args): string|null`
    - 確認するのは required、type（string / integer / number / array of string）、pattern、minimum / maximum、minLength
    - 違反があれば日本語のメッセージを 1 つ返す。未知のキーは無視する
- [ ] **Step 1: 失敗するテストを書く**
  - `fixed-offset`：`TZ=UTC` の子プロセスで実行する
    - テスト本体は `test/fixtures/utc-tools.mjs` に置き、`execFileSync(process.execPath, [file], { env: { ...process.env, TZ: 'UTC' } })` の出力を比較する
    - 確認内容：`now = 2026-11-12T16:30:00Z`（日本時間 11/13 1:30）で `list_events({})` を呼ぶと、見出しが `2026-11-13（金）` になる
    - 確認内容：`add_event({ member:'佐藤', title:'x', date:'2026-11-13', start:'09:00', end:'10:00' })` で保存される `starts_at` が `'2026-11-13T00:00:00.000Z'` になる
  - `schema`
    - `validateArgs(TOOL_DEFS.add_event の schema, { member:'a', title:'t', date:'2026/11/13', start:'9:00', end:'10:00' })` がメッセージを返す
    - 正しい入力なら `null`
    - `days: 0` はメッセージを返す
    - `TOOL_DEFS` の name 一覧が 6 ツールと一致する
  - `mcp-tools`：`now` を渡すと、`list_events({})` の日付がそれに従う
- [ ] **Step 2: 実行して失敗を確認**：`npm test` → FAIL
- [ ] **Step 3: 実装する**。続けて stdio 版のファイルを削除する
- [ ] **Step 4: 実行して通過を確認**：`npm test` → 全件 PASS
- [ ] **Step 5: チェックポイント**

### Task 4: worker/google-auth.js（サービスアカウント → アクセストークン）

**Files:**
- Create: `worker/google-auth.js`
- Test: `test/worker-google-auth.test.js`

**Interfaces:**
- Produces: `createTokenSource(saJson: string, { fetch?, now? }): { get(): Promise<string> }`
  - JWT の header は `{ alg:'RS256', typ:'JWT' }`
  - claims は `iss = client_email`、`scope = 'https://www.googleapis.com/auth/datastore'`、`aud = 'https://oauth2.googleapis.com/token'`、`iat = now秒`、`exp = iat+3600`
  - `POST https://oauth2.googleapis.com/token` に `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<jwt>`（form-urlencoded）を送る
  - 取得したトークンは `expires_in - 60` 秒までキャッシュする
- [ ] **Step 1: 失敗するテストを書く**
  - テスト内で `crypto.subtle.generateKey` を使って RSA 2048 鍵を作り、PKCS8 PEM の `private_key` を持つ偽の SA を用意する
  - 確認内容
    - 送られた assertion の署名が公開鍵で検証できる
    - claims が上の値と一致する
    - `get()` を 2 回呼んでも fetch は 1 回だけ
    - `now` を 3600 秒進めると再取得する
    - トークン取得の失敗（400）では reject する
- [ ] **Step 2: 実行して失敗を確認**：`npm test` → FAIL
- [ ] **Step 3: 実装する**（PEM → `importKey('pkcs8', …, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' })`）
- [ ] **Step 4: 実行して通過を確認**：`npm test` → PASS
- [ ] **Step 5: チェックポイント**

### Task 5: worker/mcp.js（最小の MCP JSON-RPC）

**Files:**
- Create: `worker/mcp.js`
- Test: `test/worker-mcp.test.js`

**Interfaces:**
- Consumes: `TOOL_DEFS`、`validateArgs`（Task 3）、`createTools` の戻り値
- Produces: `handleMcp(body: unknown, tools): Promise<{ status: number, json?: object }>`
  - `initialize`
    - `params.protocolVersion` が `['2025-06-18','2025-03-26','2024-11-05']` に含まれればその値を、含まれなければ `'2025-06-18'` を返す
    - `capabilities: { tools: {} }`、`serverInfo: { name:'team-schedule', version:'2.0.0' }`
  - `ping` は `{}` を返す
  - `tools/list` は `{ tools: TOOL_DEFS }` を返す
  - `tools/call`
    - 引数の検証に失敗、またはツールが throw したら `{ isError: true, content: [{ type:'text', text }] }`
    - 成功したら `{ content: [{ type:'text', text }] }`
    - 未知のツール名は JSON-RPC の error `-32602`
  - `id` の無いメッセージ（通知）は `{ status: 202 }`
  - 未知のメソッドは `-32601`
  - 配列（バッチ）や JSON でない入力は `-32600`
- [ ] **Step 1: 失敗するテストを書く**：上の各分岐ごとに 1 テスト。tools は偽物の `{ list_members: async () => '佐藤', add_event: async () => { throw new Error('x') } }`
- [ ] **Step 2: 実行して失敗を確認**：`npm test` → FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 実行して通過を確認**：`npm test` → PASS
- [ ] **Step 5: チェックポイント**

### Task 6: worker/index.js（認証・ルーティング・REST・CORS）と wrangler 設定

**Files:**
- Create: `worker/index.js`、`worker/wrangler.toml`（`name = "team-schedule"`、`main = "index.js"`、`compatibility_date = "2026-11-01"`、`[vars] FIREBASE_PROJECT_ID = "team-schedule-5afa8a"`）、`worker/package.json`（devDependency `wrangler@^4`、scripts `dev` / `deploy`）
- Test: `test/worker-index.test.js`

**Interfaces:**
- Consumes: `hashToken`（Task 1）、`createApi`（Task 1）、`withFixedOffset` / `fixedNow` / `createTools`（Task 3）、`createTokenSource`（Task 4）、`handleMcp`（Task 5）
- Produces:
  - `export default { fetch(request, env) }`
  - テスト用に `createHandler({ fetch, tokenSource }): (request, env) => Promise<Response>` も export する
  - 認証の流れ
    1. トークンを取り出す：`/mcp/<t>` のパス、または `Authorization: Bearer <t>`。どちらも trim し、末尾の `/` は無視する
    2. `hashToken` でハッシュ化する
    3. `GET documents/tokens/<h>` を取得する。404 なら 401
    4. `GET teams/<team>` の `allowed` に `email` が無ければ 401
    5. `createTools(withFixedOffset(createApi({ projectId, apiKey: '', teamKey: team, getAuthHeader: () => 'Bearer '+await tokenSource.get(), fetch }), 540), { now: fixedNow(540) })`
  - REST の対応表：仕様 7 章の表どおり
    - `/api/free` のクエリ `members` はカンマ区切り。`min`、`from`、`to` はそれぞれ `min_minutes`、`work_start`、`work_end` に対応する
    - 数値のパラメーターは `Number()` で変換する
    - `validateArgs` に通らなければ 400 `{ error }`
  - Firestore が 5xx を返したり通信に失敗したりしたら 502 `{"error":"upstream"}`
  - `OPTIONS /api/*` には 204 を返し、`Access-Control-Allow-Origin: *`、`Allow-Headers: Authorization, Content-Type`、`Allow-Methods: GET, POST, DELETE, OPTIONS` を付ける。`/api/*` の通常の応答にも `Allow-Origin: *` を付ける
  - `GET /mcp/<t>` には 405、どこにも当てはまらないパスには 404
- [ ] **Step 1: 失敗するテストを書く**
  - Firestore と Google の fetch をモックする。`tokens/<hash('ts_good')>` は `{ team:'T', email:'m@x.com' }`、`teams/T` は `allowed: ['m@x.com']`
  - テスト項目
    - `POST /mcp/ts_good` に `tools/list` を送ると 200 で 6 ツール
    - `/mcp/ts_good/`（末尾スラッシュ）も 200
    - `/mcp/ts_bad` は 401 で本文が `{"error":"invalid token"}`
    - `teams/T.allowed` から `m@x.com` を外すと 401
    - `GET /api/members` に `Authorization: Bearer  ts_good `（空白付き）を付けると 200 `{ result }`
    - `GET /api/free?members=佐藤,鈴木&min=60` のツール引数が `{ members:['佐藤','鈴木'], min_minutes:60 }` になる
    - `POST /api/events` で `date` が不正なら 400
    - `DELETE /api/events/e1` で `delete_event({ id:'e1' })` が呼ばれる
    - Firestore が 500 を返すと 502
    - `OPTIONS /api/members` は 204 と CORS ヘッダー
    - `GET /mcp/ts_good` は 405
    - `/nope` は 404
- [ ] **Step 2: 実行して失敗を確認**：`npm test` → FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 実行して通過を確認**：`npm test` → PASS。`cd worker && npm install && npx wrangler deploy --dry-run` でバンドルが通ることも確認する
- [ ] **Step 5: チェックポイント**

### Task 7: ブラウザ（ログイン・許可外画面・接続ダイアログ）

**Files:**
- Create: `lib/auth.js`、`lib/connect.js`、`connect-view.js`
- Modify: `app.js`（`init` と `connect`）、`index.html`（ログイン画面・許可外画面・アカウントメニュー・接続ダイアログ）、`style.css`、`config.js`（`export const WORKER_URL = 'https://team-schedule.<account>.workers.dev';`。実際の値は Task 8 で入れる）
- Test: `test/connect.test.js`

**Interfaces:**
- Consumes: Task 1 の api メソッド
- Produces:
  - `lib/auth.js`（テスト対象外。gstatic の `firebase-app.js` / `firebase-auth.js` 13.3.0 を動的 import）
    - `initAuth({ apiKey, projectId })`：`authDomain` は `${projectId}.firebaseapp.com`
    - `signIn()`：まず `signInWithPopup`、`auth/popup-blocked` のときだけ `signInWithRedirect`
    - `signOut()`
    - `onChange(cb: (user|null) => void)`
    - `getIdToken(): Promise<string>`
  - `lib/connect.js`（純粋関数）
    - `mcpUrl(workerUrl, token)`：`workerUrl` 末尾の `/` を除いて `/mcp/` とつなぐ
    - `curlExample(workerUrl, token)`：`curl -H "Authorization: Bearer <t>" <w>/api/members`
    - `normalizeAllowed(list, owner): { list: string[] } | { error: string }`
      - 小文字にそろえ、重複を除き、オーナーが含まれるようにする
      - メール形式（`/^[^@\s]+@[^@\s]+\.[^@\s]+$/`）でない値があれば error
      - owner が入っていなければ自動で先頭に足す
  - `connect-view.js`：`openConnect({ api, email, isOwner, workerUrl })` でダイアログを開く
    - 発行フォーム：ラベル 1〜40 文字
    - 発行直後に URL と curl を 1 回だけ表示し、コピーボタンを付ける
    - 発行済み一覧と「無効化」ボタン
    - オーナーには許可リストの編集欄を出す
  - 画面の状態
    - `login`：ロゴと「Google でログイン」
    - `forbidden`：文言「このアカウント（{email}）は許可されていません」と「ログアウト」
    - `app`：ヘッダー右にアカウントボタン（メニューは「接続」「ログアウト」）
    - デモモードでは `app` から始め、アカウントボタンを出さない
  - チームキーの扱いは今と同じ（`#k=` → localStorage）
    - `checkAccess` が `'missing'` のときはキー入力ダイアログを出す
    - `'forbidden'` のときは `forbidden` 画面を出す
- [ ] **Step 1: 失敗するテストを書く**（`test/connect.test.js`）
  - `mcpUrl('https://w.dev/', 'ts_a') === 'https://w.dev/mcp/ts_a'`
  - `curlExample` の完全一致
  - `normalizeAllowed([' A@Gmail.com ','a@gmail.com'], 'o@x.com')` → `{ list: ['o@x.com','a@gmail.com'] }`
  - `normalizeAllowed(['bad'], 'o@x.com')` は `error` を返す
  - オーナーを外した入力でもオーナーが戻る
- [ ] **Step 2: 実行して失敗を確認**：`npm test` → FAIL
- [ ] **Step 3: `lib/connect.js` を実装し、続けて auth / 画面 / CSS を作る**
  - 見た目は既存の方眼ノート調のトークンとダイアログの書き方に合わせる
  - 幅 360px で横スクロールが出ないこと
  - ライト / ダークの両方で見えること
- [ ] **Step 4: 確認する**
  - `npm test` → PASS
  - `wc -c app.js connect-view.js style.css lib/*.js` の合計が 40KB 以下
  - `python3 -m http.server 8000` でデモモードの画面が今まで通り動く（スクリーンショットで PC とスマホ幅を確認）
- [ ] **Step 5: チェックポイント**

### Task 8: ドキュメント・本番への反映・動作確認

**Files:**
- Modify: `README.md`（セットアップ手順を仕様 10 章の内容に差し替える。「AI（MCP）から使う」を URL 方式に、REST の節を Worker の `/api` に書き換える）、`docs/requirements.md`（仕様 11 章のとおり。N-01 は 40KB）、`config.js`（`WORKER_URL`）

- [ ] **Step 1: ドキュメントを更新する**
- [ ] **Step 2: ユーザーの手作業**（仕様 10 章の 1〜4）。Claude は手順を示して待つ
  - ルールの反映は、チーム文書に `owner` と `allowed` が入ったのを確認してから行う
- [ ] **Step 3: 反映する**
  - `npx firebase-tools deploy --only firestore:rules --project team-schedule-5afa8a`
  - `cd worker && npx wrangler deploy`
  - 自動モードに止められたら、ユーザーに `!` で実行してもらう
- [ ] **Step 4: 本番で確認する**（ユーザーと一緒に行う）
  1. ブラウザでログイン → 予定を追加 → 表示される
  2. 許可されていない Gmail では「許可されていません」と表示される
  3. 接続 URL を発行し、`curl -X POST <MCP URL>` に `tools/call list_events` を送ると、追加した予定が返る
  4. `curl -H "Authorization: Bearer <t>" <worker>/api/members` → 200
  5. 画面で無効化 → 同じ curl が 401
  6. claude.ai のカスタムコネクタに URL を登録 → 「今日の予定は？」に答える
- [ ] **Step 5: チェックポイント**：`npm test` と `npm run test:rules` が全通過。終わったら人間に push を依頼する
