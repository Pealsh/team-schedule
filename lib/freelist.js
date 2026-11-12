// 空き時間の一覧（純粋関数）。指定メンバー全員が空いている時間を、複数日まとめて並べる
import { dayStartOf, toDateStr, freeSlots } from './timeline.js';

export function freeList(events, memberIds, {
  from, days = 14, workStart = 0, workEnd = 1440, minMinutes = 30, now = new Date(), sort = 'date',
}) {
  const today = toDateStr(now);
  const nowMin = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15;
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = dayStartOf(from);
    d.setDate(d.getDate() + i);
    const date = toDateStr(d);
    if (date < today) continue;
    const lo = date === today ? Math.max(workStart, nowMin) : workStart;
    for (const [s, e] of freeSlots(events, memberIds, d)) {
      const start = Math.max(s, lo);
      const end = Math.min(e, workEnd);
      if (end - start >= Math.max(minMinutes, 1)) out.push({ date, start, end, minutes: end - start });
    }
  }
  if (sort === 'long') out.sort((a, b) => b.minutes - a.minutes || a.date.localeCompare(b.date) || a.start - b.start);
  return out;
}

export function fmtDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}時間${m ? `${m}分` : ''}` : `${m}分`;
}
