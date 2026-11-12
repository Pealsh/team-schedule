// MCP ツールの定義（説明と JSON Schema）と、最小限の入力チェック。Worker の MCP と REST で共用。
// メンバー追加は AI に出さない（メンバーは画面へのログインで自動で作られる）

const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' };
const time = { type: 'string', pattern: '^\\d{1,2}:\\d{2}$', description: 'HH:MM（24:00 可）' };
const days = { type: 'integer', minimum: 1, maximum: 31, description: '何日分か（既定 1）' };
const obj = (properties, required = []) => ({ type: 'object', properties, required });

export const TOOL_DEFS = [
  { name: 'list_members', description: 'チームメンバーの一覧', inputSchema: obj({}) },
  {
    name: 'list_events',
    description: '予定の一覧（日付省略で今日）。削除に使う id も返す',
    inputSchema: obj({ date, days, member: { type: 'string', description: 'メンバー名で絞り込み' } }),
  },
  {
    name: 'add_event',
    description: '自分の予定を追加する。終了が開始以前なら翌日扱い',
    inputSchema: obj({
      member: { type: 'string', description: 'メンバー名。省略すると自分（AI 接続では自分の予定しか追加できない）' },
      title: { type: 'string', minLength: 1, maxLength: 80 },
      date, start: time, end: time,
    }, ['title', 'date', 'start', 'end']),
  },
  {
    name: 'delete_event',
    description: '自分の予定を削除する（id は list_events で確認）',
    inputSchema: obj({ id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$', description: '予定の id' } }, ['id']),
  },
  {
    name: 'find_free_slots',
    description: '指定メンバー全員が空いている時間帯を探す',
    inputSchema: obj({
      date, days,
      members: { type: 'array', items: { type: 'string' }, description: 'メンバー名の配列。省略で全員' },
      min_minutes: { type: 'integer', minimum: 0, description: '最小の空き分数（既定 30）' },
      work_start: { ...time, description: '探す時間帯の開始（例 09:00）' },
      work_end: { ...time, description: '探す時間帯の終了（例 18:00）' },
    }),
  },
];

const TYPE_OK = {
  string: (v) => typeof v === 'string',
  integer: (v) => Number.isInteger(v),
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  array: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
};

// 違反があれば日本語のメッセージを 1 つ返す。問題なければ null
export function validateArgs(schema, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return '引数はオブジェクトで指定してください';
  for (const k of schema.required ?? []) {
    if (args[k] === undefined) return `${k} は必須です`;
  }
  for (const [k, v] of Object.entries(args)) {
    const p = schema.properties?.[k];
    if (!p || v === undefined) continue;
    if (!TYPE_OK[p.type](v)) return `${k} の型が違います（${p.type}）`;
    if (p.pattern && !new RegExp(p.pattern).test(v)) return `${k} の形式が違います（${p.description ?? p.pattern}）`;
    if (p.minLength && v.length < p.minLength) return `${k} を入力してください`;
    if (p.maxLength && v.length > p.maxLength) return `${k} は ${p.maxLength} 文字以内にしてください`;
    if (p.minimum !== undefined && v < p.minimum) return `${k} は ${p.minimum} 以上にしてください`;
    if (p.maximum !== undefined && v > p.maximum) return `${k} は ${p.maximum} 以下にしてください`;
  }
  return null;
}
