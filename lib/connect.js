// 接続ダイアログ用の純粋関数

const trimSlash = (u) => u.replace(/\/+$/, '');

export const mcpUrl = (workerUrl, token) => `${trimSlash(workerUrl)}/mcp/${token}`;

export const curlExample = (workerUrl, token) =>
  `curl -H "Authorization: Bearer ${token}" ${trimSlash(workerUrl)}/api/members`;

// 許可リストを小文字・重複なしにそろえ、オーナーを必ず先頭に入れる
export function normalizeAllowed(list, owner) {
  const o = owner.trim().toLowerCase();
  const out = [o];
  for (const raw of list) {
    const e = raw.trim().toLowerCase();
    if (!e) continue;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { error: `メールアドレスの形式ではありません: ${raw.trim()}` };
    if (!out.includes(e)) out.push(e);
  }
  return { list: out };
}

// 招待リンク：今のページの URL に #k=チームキー&i=招待コード を付ける
export const inviteUrl = (pageUrl, teamKey, code) =>
  `${pageUrl.split('#')[0]}#k=${encodeURIComponent(teamKey)}&i=${code}`;
