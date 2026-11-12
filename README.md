# チーム予定

チーム全員の予定を 1 日ずつ縦（0:00〜24:00）に並べ、**全員が空いている時間を緑で強調**するツール。
画面・REST API・MCP（AI）のどれからでも予定を入れられる。

- 画面：GitHub Pages（HTML/CSS/JS のみ、ビルド不要、約 41KB）
- ログイン：Google アカウント（Firebase Authentication）。許可リストに載った Gmail だけが使える
- データ：Firebase Cloud Firestore（無料の Spark プラン）
- AI 連携 / REST API：Cloudflare Worker（`worker/`、無料枠）。claude.ai・スマホ・Claude Code から URL だけでつながる

要件定義 → [docs/requirements.md](docs/requirements.md)

## 1. Firebase を用意（約 15 分）

1. https://console.firebase.google.com でプロジェクトを作成（Google アナリティクスは不要）
2. **Firestore Database** を作成（ロケーション `asia-northeast1`、本番モード）
3. **プロジェクトの設定 → マイアプリ** で Web アプリを追加し、`projectId` と `apiKey` を `config.js` に書く
4. **Authentication → Sign-in method** で **Google** を有効にする。**設定 → 承認済みドメイン** に `<ユーザー名>.github.io` を追加
5. チームキーを決める（例：`openssl rand -hex 16`）。チームキーは秘密ではなく、ただのチーム ID
6. Firestore のコンソールで **コレクション `teams` → ドキュメント ID にチームキー** を作り、次のフィールドを入れる
   - `name`（string）：チーム名
   - `owner`（string）：自分の Gmail（小文字）
   - `allowed`（array）：自分の Gmail を 1 つ
7. ルールを反映：`npx firebase-tools deploy --only firestore:rules --project <projectId>`

`apiKey` は公開して問題ない値。読み書きは `firebase/firestore.rules` で「`allowed` に載ったログイン中のアカウント」に限っている。
メンバーを増やすときは、画面右上のアイコン → **AI・API と接続** で（オーナーだけ）：
- **招待リンクを作る**：リンクを開いて Google でログインした人が、自動で許可リストに入る（7 日間有効・何人でも・一覧から無効化できる）
- **アクセスを許可する Gmail**：メールアドレスを直接追加する

## 2. GitHub Pages で公開

1. GitHub にリポジトリを作り、このフォルダを push
2. **Settings → Pages → Build and deployment** で `Deploy from a branch` / `main` / `/ (root)`
3. メンバーには次の形式のリンクを共有（初回だけキーが保存される）。開くと Google ログインを求められる

```
https://<ユーザー名>.github.io/<リポジトリ名>/#k=<チームキー>
```

## 3. AI・API 用の Worker を公開（約 10 分）

1. https://dash.cloudflare.com で無料アカウントを作る
2. Firebase コンソールの **プロジェクトの設定 → サービスアカウント → 新しい秘密鍵の生成** で JSON を保存（リポジトリには入れない）
3. Worker を公開する

```sh
cd worker && npm install
npx wrangler login
npx wrangler secret put GOOGLE_SA < /保存した場所/鍵.json
npx wrangler deploy          # → https://team-schedule.<アカウント>.workers.dev
```

4. 表示された URL を `config.js` の `WORKER_URL` に書いて、GitHub に push

`worker/wrangler.toml` の `FIREBASE_PROJECT_ID` は自分の projectId に変える。

## 4. AI（MCP）から使う

画面右上のアイコン → **AI・API と接続** → **URL を発行**。出てきた URL を使う（表示は 1 回だけ）。

- **AI のチャットに貼る（読むだけ）**：①の文面をコピーして、claude.ai や ChatGPT の会話に送る。AI がリンク（`/ai/<トークン>`）を開き、メンバー・4 週間分の予定・全員の空き時間を読んで答える
- 予定の追加・削除まで AI にさせたいときは、下のコネクタ登録（MCP）を使う。MCP URL はチャット欄に貼っても動かない

- claude.ai / スマホの Claude：**設定 → コネクタ → カスタムコネクタを追加** に MCP URL を貼る
- Claude Code：`claude mcp add --transport http team-schedule <MCP URL>`

| ツール | 内容 |
|---|---|
| `list_members` / `add_member` | メンバー一覧・追加 |
| `list_events` | 予定一覧（日付・日数・メンバーで絞り込み） |
| `add_event` | 予定追加（メンバーは名前で指定） |
| `delete_event` | 予定削除 |
| `find_free_slots` | 指定メンバー全員の空き時間（時間帯・最小分数・複数日） |

話しかけ方の例：「明日 佐藤さんと鈴木さんが 9〜18 時で 1 時間空いてるのはいつ？」「来週月曜 14 時から 1 時間、高橋さんに『レビュー』を入れて」

時刻は日本時間（Asia/Tokyo）で扱う。URL が漏れたら、同じ画面の **発行済み → 無効化** ですぐ止められる。

## 5. REST API（curl など）

同じ接続 URL のトークンを `Authorization: Bearer` に付ける。結果は `{"result": "<テキスト>"}`、エラーは `{"error": "..."}`。

```sh
W=https://team-schedule.<アカウント>.workers.dev
T=ts_...   # 発行したトークン（MCP URL の /mcp/ の後ろ）

curl -H "Authorization: Bearer $T" $W/api/members
curl -H "Authorization: Bearer $T" "$W/api/events?date=2026-11-13&days=7&member=佐藤"
curl -H "Authorization: Bearer $T" "$W/api/free?date=2026-11-13&members=佐藤,鈴木&min=60&from=09:00&to=18:00"
curl -H "Authorization: Bearer $T" -H "Content-Type: application/json" -X POST $W/api/events \
  -d '{"member":"佐藤","title":"定例","date":"2026-11-13","start":"10:00","end":"11:00"}'
curl -H "Authorization: Bearer $T" -H "Content-Type: application/json" -X POST $W/api/members -d '{"name":"高橋"}'
curl -H "Authorization: Bearer $T" -X DELETE $W/api/events/<予定ID>
```

| 状態 | 意味 |
|---|---|
| 401 | トークンが違う・無効化済み・発行者が許可リストから外れた |
| 400 | 入力の形式違い、メンバーが見つからない など |
| 502 | Firestore 側のエラー |

## ローカルで試す

```sh
python3 -m http.server 8000   # → http://localhost:8000
npm test                      # 空き時間計算・API・Worker・MCP のテスト
npm run test:rules            # セキュリティルールのテスト（Firestore エミュレーター、Java が必要）
```

`config.js` が未設定の間は **デモモード**（サンプルデータ、ブラウザ内保存）で動く。

## 操作

- `‹ ›` / キーボード `← →`：前日・翌日。日付をタップでカレンダー
- 凡例のメンバーをタップ：表示 ON/OFF（空き判定からも外れる）
- レーンの空白をタップ：その人・その時刻で予定追加。`n` キーでも追加
- 予定をタップ：詳細・削除
