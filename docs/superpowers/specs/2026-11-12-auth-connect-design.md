# Gmail ログイン ＋ 接続画面（MCP / REST API）設計

日付：2026-11-12

## 1. 目的

- 許可した Gmail アカウントだけがチームの予定を読み書きできるようにする（チームキーが漏れても入れない）
- 画面上で MCP URL と REST API の接続情報を発行し、claude.ai・スマホ・Claude Code など、どこからでも AI をつなげるようにする
- 追加費用は無料（Firebase Spark ＋ Cloudflare Workers 無料枠）

## 2. 決まったこと（ユーザー確認済み）

| 項目 | 決定 |
|---|---|
| ログインの目的 | 許可リストに載った Gmail だけが入れる |
| MCP の接続元 | claude.ai やスマホを含む、どこからでも。無料 |
| 接続方式 | 接続トークン付き URL（OAuth は今回やらない） |
| stdio 版 MCP（`mcp/server.js`） | 削除。Claude Code も URL で接続する |

## 3. 全体構成

```
ブラウザ（GitHub Pages）
  ├─ Firebase Auth（Google ログイン、SDK は gstatic CDN）
  └─ Firestore REST（Authorization: Bearer <ID トークン>）── ルールで許可リストを確認

claude.ai / Claude Code / curl
  └─ Cloudflare Worker（team-schedule.<account>.workers.dev）
       ├─ /mcp/<接続トークン>   MCP（Streamable HTTP、JSON 応答のみのステートレス）
       └─ /api/...              REST（Authorization: Bearer <接続トークン>）
            └─ サービスアカウントで Firestore REST（ルールの対象外。Worker 側で許可を確認）
```

## 4. データモデル（Firestore）

```
teams/{チームキー}
  name     string
  owner    string    オーナーの Gmail（コンソールで1回だけ設定）
  allowed  string[]  読み書きを許可する Gmail（owner も含める）
  members/{自動ID}   既存のまま
  events/{自動ID}    既存のまま

tokens/{SHA-256(接続トークン) の hex}
  team        string     チームキー
  email       string     発行した人の Gmail
  label       string     1〜40文字（例：「claude.ai」）
  created_at  timestamp
```

- チームキーは秘密ではなく、ただの ID になる。URL の `#k=` はそのまま残す
- 接続トークンそのものは保存しない。発行時に1回だけ画面に表示する
- メールアドレスは小文字にそろえて保存・比較する

## 5. セキュリティルール

- `signedIn()`：`request.auth != null` かつ `email_verified == true`
- `allowedIn(team)`：`request.auth.token.email` が `teams/{team}.allowed` に含まれる
- `teams/{team}`
  - get：`allowedIn(team)`
  - update：オーナー本人だけ。変更できるのは `allowed` のみで、オーナー自身は必ず残る
  - create / delete：不可（コンソールで作る）
- `members` / `events`：今の項目チェックをそのまま使い、`teamExists()` を `allowedIn(team)` に置き換える
- `tokens/{h}`
  - create：`signedIn()`、`email` が自分、`allowedIn(team)`、項目は `team, email, label, created_at` のみ
  - get / list / delete：`resource.data.email` が自分
  - update：不可

## 6. ブラウザ側

### 6.1 ログイン / ログアウト
- `lib/auth.js`：Firebase Auth の薄いラッパー
  - `signIn()`：PC はポップアップ、スマホはリダイレクト
  - `signOut()`、`onChange(cb)`、`getIdToken()`
- 表示の切り替え
  - 未ログイン：ロゴと「Google でログイン」ボタンだけを表示
  - 許可外のアカウント（チーム文書の get が 403）：「このアカウント（xxx@gmail.com）は許可されていません」と「ログアウト」を表示
  - ログイン済み：ヘッダー右に、メールアドレスのアイコン（メニュー：接続 / ログアウト）を表示
- デモモード（`config.js` 未設定）では、ログインせずに今まで通り動く

### 6.2 接続画面（ダイアログ）
- 「接続 URL を発行」：ラベルを入力 → トークン生成 → 次の2つを1回だけ表示し、コピーボタンを付ける
  - MCP URL：`https://<worker>/mcp/<トークン>`
  - REST の curl 例：`curl -H "Authorization: Bearer <トークン>" https://<worker>/api/members`
- 「発行済み」一覧：ラベル、発行日、「無効化」ボタン（tokens 文書を削除）
- オーナーだけに「アクセスを許可する Gmail」欄を表示：追加 / 削除
- Worker の URL は `config.js` の `WORKER_URL` に書く

### 6.3 lib/api.js の変更
- `createApi({ ..., getAuthHeader })` を追加し、すべてのリクエストに `Authorization` を付ける
  - ブラウザ：ID トークン
  - Worker：サービスアカウントのアクセストークン
- `checkKey()` は `checkAccess()` に改名し、`'ok' | 'forbidden' | 'missing'` を返す
- 追加するメソッド
  - `team()`：owner と allowed を取得
  - `setAllowed(list)`
  - `createToken(label)`
  - `myTokens()`
  - `revokeToken(hash)`

### 6.4 lib/token.js（ブラウザと Worker で共用）
- `generateToken()`：`ts_` ＋ 32 バイトの乱数を base64url にしたもの
- `hashToken(t)`：WebCrypto で SHA-256 を計算し、hex で返す

## 7. Cloudflare Worker（`worker/`）

- `worker/index.js`：ルーティング
  - `POST /mcp/:token`：MCP の JSON-RPC
  - `GET /mcp/:token`：405 を返す（SSE は使わない）
  - `/api/*`：REST
- 認証（各リクエスト共通）：トークンをハッシュ化 → `tokens/{h}` を取得 → `teams/{team}.allowed` に `email` があるか確認 → 1つでも失敗したら 401
- `worker/google-auth.js`：サービスアカウント JSON（Worker の secret `GOOGLE_SA`）から RS256 の JWT を作り、アクセストークンと交換する。期限まで Worker のメモリにキャッシュする
- `worker/mcp.js`：MCP を手書きで最小実装（依存なし）
  - 対応メソッド：`initialize`、`notifications/initialized`、`ping`、`tools/list`、`tools/call`
  - 応答は `application/json` のみ
  - ツールの定義（説明と JSON Schema）は `mcp/tools.js` に移し、ツールの実装はそのまま使い回す
- REST エンドポイント（中身は MCP ツールを呼ぶだけ）

  | メソッド | パス | 呼ぶツール |
  |---|---|---|
  | GET | `/api/members` | list_members |
  | POST | `/api/members` | add_member |
  | GET | `/api/events?date=&days=&member=` | list_events |
  | POST | `/api/events` | add_event |
  | DELETE | `/api/events/:id` | delete_event |
  | GET | `/api/free?date=&days=&members=&min=&from=&to=` | find_free_slots |

  - 応答は JSON（`{ result }` または `{ error }`）
- CORS：`/api/*` は全オリジンを許可する（トークン必須のため）
- `wrangler.toml`：無料プランで、KV などは使わない

## 8. エラー処理

| 状況 | 返すもの |
|---|---|
| トークン不正・無効化済み・許可外 | 401 `{ error: "invalid token" }`（理由は区別しない） |
| ツールの入力エラー | REST は 400 `{ error }`、MCP は `isError: true` |
| Firestore の障害 | 502 `{ error: "upstream" }` |
| ブラウザで ID トークンが切れた | SDK が自動で更新する。失敗したらログイン画面に戻す |

## 9. テスト（実装より先に書く）

| 対象 | 方法 |
|---|---|
| `lib/token.js` | 形式、ハッシュが一致すること |
| `lib/api.js` | Authorization ヘッダーが付くこと、新メソッドのリクエスト形（fetch をモック） |
| `worker/mcp.js` | initialize / tools/list / tools/call の応答形 |
| `worker/index.js` | 認証の可否、REST ルーティング、401 / 400 / 405（Firestore をモック） |
| `worker/google-auth.js` | JWT のヘッダーとクレーム、キャッシュ |
| `firebase/firestore.rules` | エミュレーター（`@firebase/rules-unit-testing`）で、許可・不許可・オーナー更新・tokens の権限 |
| 既存テスト | 27 件がそのまま通ること |

本番での確認：ログイン → 予定を追加 → MCP URL から `list_events` で読める → トークンを無効化すると 401 になる。

## 10. ユーザーの手作業（合計 約20分）

1. Firebase コンソールで Authentication → Google を有効化。承認済みドメインに `<ユーザー名>.github.io` を追加
2. チーム文書に `owner` と `allowed`（自分の Gmail）を追加
3. サービスアカウントの鍵（JSON）を作成し、`wrangler secret put GOOGLE_SA` で Worker に登録
4. Cloudflare に無料登録し、`wrangler login` を実行
5. GitHub へ push（Claude は push しない）

## 11. 要件定義（docs/requirements.md）の更新

- N-01：「自前の JS と CSS で合計 30KB 以下。外部 SDK（Firebase Auth）は数えない」
- N-04：「許可リストに載った Google アカウントだけが読み書きできる」
- F-40〜：ログイン / ログアウト、許可リストの管理、接続 URL の発行と無効化
- 範囲外から「ユーザーログイン」を外し、「OAuth 接続、トークンの有効期限、複数チームへの所属」を加える

## 12. 範囲外

- MCP の OAuth 認証
- トークンの有効期限・権限の細分化（無効化は手動）
- 1人が複数のチームに入ること
- stdio 版 MCP の維持
