// 月表示の計算（純粋関数）。日付は 'YYYY-MM-DD'、ローカル時刻で扱う。
import { dayStartOf, toDateStr, clipToDay, fmtMin } from './timeline.js';

const ymd = (dateStr) => dateStr.split('-').map(Number);

// 1 日を含む週の日曜から 42 日（6 週）
export function monthGrid(dateStr) {
  const [y, m] = ymd(dateStr);
  const first = new Date(y, m - 1, 1);
  return Array.from({ length: 42 }, (_, i) => toDateStr(new Date(y, m - 1, 1 - first.getDay() + i)));
}

export const monthLabel = (dateStr) => { const [y, m] = ymd(dateStr); return `${y}年${m}月`; };

export function shiftMonth(dateStr, n) {
  const [y, m] = ymd(dateStr);
  return toDateStr(new Date(y, m - 1 + n, 1));
}

// その日に掛かる予定（表示中のメンバーだけ）を開始順に max 件。残りは more
export function dayItems(events, members, hidden, dateStr, max = 3) {
  const day = dayStartOf(dateStr);
  const color = Object.fromEntries(members.filter((m) => !hidden.has(m.id)).map((m) => [m.id, m.color]));
  const all = events
    .filter((e) => color[e.member_id])
    .map((e) => ({ e, r: clipToDay(e, day) }))
    .filter((x) => x.r)
    .sort((a, b) => a.r[0] - b.r[0] || a.e.title.localeCompare(b.e.title))
    .map(({ e, r }) => ({ id: e.id, title: e.title, color: color[e.member_id], start: fmtMin(r[0]) }));
  return { items: all.slice(0, max), more: Math.max(0, all.length - max), total: all.length };
}
