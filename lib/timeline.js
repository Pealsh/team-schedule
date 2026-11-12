// 空き時間計算などの純粋関数。ブラウザと MCP サーバーの両方から使う。

// 緑系は「空き時間」の色なので、メンバーには使わない
export const PALETTE = [
  '#e5484d', '#3e63dd', '#f76b15', '#8e4ec6', '#d6409f',
  '#0090ff', '#ad7f58', '#e2a336', '#5b5bd6', '#60646c',
];

const MIN = 60000;

// 'YYYY-MM-DD' -> その日のローカル 0:00
export function dayStartOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function toDateStr(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function dayLength(dayStart) {
  const next = new Date(dayStart);
  next.setDate(next.getDate() + 1);
  return Math.round((next - dayStart) / MIN);
}

// 予定を「その日の 0:00 からの分」[start, end] に変換。日に掛からなければ null
export function clipToDay(event, dayStart) {
  const len = dayLength(dayStart);
  const s = Math.max(0, (new Date(event.starts_at) - dayStart) / MIN);
  const e = Math.min(len, (new Date(event.ends_at) - dayStart) / MIN);
  return e > s ? [s, e] : null;
}

export function mergeIntervals(list) {
  const sorted = [...list].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

// memberIds 全員が空いている区間 [[start, end], ...]（分）
export function freeSlots(events, memberIds, dayStart, minMinutes = 0) {
  const ids = new Set(memberIds);
  const busy = mergeIntervals(
    events.filter((e) => ids.has(e.member_id))
      .map((e) => clipToDay(e, dayStart))
      .filter(Boolean),
  );
  const free = [];
  let cur = 0;
  for (const [s, e] of busy) {
    if (s > cur) free.push([cur, s]);
    cur = Math.max(cur, e);
  }
  const len = dayLength(dayStart);
  if (cur < len) free.push([cur, len]);
  return free.filter(([s, e]) => e - s >= minMinutes);
}

export function fmtMin(m) {
  const h = Math.floor(m / 60);
  return `${h}:${String(Math.round(m % 60)).padStart(2, '0')}`;
}

export function pickColor(used) {
  const u = new Set(used);
  return PALETTE.find((c) => !u.has(c)) ?? PALETTE[used.length % PALETTE.length];
}
