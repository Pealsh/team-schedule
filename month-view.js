// 月表示の描画。月表示に切り替えたときだけ読み込む
import { monthGrid, dayItems } from './lib/month.js';

export { monthGrid, monthLabel, shiftMonth } from './lib/month.js';

// 月表示の CSS は初回だけ読み込み、読み終わるまで待つ（崩れた見た目を出さない）
export const ready = new Promise((resolve) => {
  const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'month.css' });
  link.onload = link.onerror = resolve;
  document.head.append(link);
});

const esc = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const WEEK = '日月火水木金土';

export function renderMonth(el, { date, today, events, members, hidden }) {
  const month = date.slice(0, 7);
  const cells = monthGrid(date).map((d) => {
    const { items, more } = dayItems(events, members, hidden, d);
    const cls = `mcell${d.slice(0, 7) !== month ? ' out' : ''}${d === today ? ' today' : ''}`;
    return `<button class="${cls}" data-date="${d}" aria-label="${d}"><span class="mday">${+d.slice(8)}</span>`
      + '<span class="mevs">' + items.map((x) => `<span class="mev" style="--c:${x.color}" title="${x.start} ${esc(x.title)}"><i></i><span>${x.start} ${esc(x.title)}</span></span>`).join('')
      + (more ? `<span class="mmore" data-n="+${more}">他 ${more} 件</span>` : '')
      + '</span></button>';
  }).join('');
  el.innerHTML = `<div class="mhead">${[...WEEK].map((w) => `<span>${w}</span>`).join('')}</div><div class="mgrid">${cells}</div>`;
}
