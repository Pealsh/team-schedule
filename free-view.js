// 空き時間の一覧。「空き」に切り替えたときだけ読み込む
import { freeList, fmtDuration } from './lib/freelist.js';
import { dayStartOf, fmtMin } from './lib/timeline.js';

const WEEK = '日月火水木金土';
export const DAYS = 14;

export const ready = new Promise((resolve) => {
  const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'free.css' });
  link.onload = link.onerror = resolve;
  document.head.append(link);
});

const hours = (sel) => Array.from({ length: 25 }, (_, h) => `<option value="${h}"${h === sel ? ' selected' : ''}>${h}:00</option>`).join('');
const mins = [30, 60, 90, 120, 180];

// opts: { sort, from, to, min }（from/to は時、min は分）
export function renderFree(el, { events, memberIds, from, opts }) {
  const list = freeList(events, memberIds, {
    from, days: DAYS, workStart: opts.from * 60, workEnd: opts.to * 60, minMinutes: opts.min, sort: opts.sort,
  });
  const label = (date) => { const d = dayStartOf(date); return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`; };
  el.innerHTML = `<div class="fbar">
      <div class="seg" role="group" aria-label="並び順">
        <button data-sort="date" aria-pressed="${opts.sort === 'date'}">日付順</button><button data-sort="long" aria-pressed="${opts.sort === 'long'}">長い順</button>
      </div>
      <span class="frange"><select data-k="from" aria-label="開始">${hours(opts.from)}</select>〜<select data-k="to" aria-label="終了">${hours(opts.to)}</select></span>
      <select data-k="min" aria-label="最小の長さ">${mins.map((m) => `<option value="${m}"${m === opts.min ? ' selected' : ''}>${fmtDuration(m)}以上</option>`).join('')}</select>
    </div>
    <p class="fnote">${memberIds.length ? `表示中の ${memberIds.length} 人全員が空いている時間（今日から ${DAYS} 日間）` : 'メンバーがいません'}</p>`
    + (list.length
      ? `<ul class="flist">${list.map((x) => `<li><button data-date="${x.date}" data-start="${x.start}"><span class="fdate">${label(x.date)}</span><span class="ftime">${fmtMin(x.start)}–${fmtMin(x.end)}</span><span class="flen">${fmtDuration(x.minutes)}</span></button></li>`).join('')}</ul>`
      : '<p class="empty">条件に合う空き時間はありません</p>');
}
