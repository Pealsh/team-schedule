// TZ=UTC の子プロセスで動かし、Worker（UTC）でも日本時間で答えることを確かめる
import { createTools } from '../../mcp/tools.js';
import { withFixedOffset, fixedNow } from '../../lib/fixed-offset.js';

const saved = [];
const inner = {
  members: async () => [{ id: 'a', name: '佐藤', color: '#e5484d' }],
  events: async (from, to) => saved.filter((e) => new Date(e.starts_at) < to && new Date(e.ends_at) > from),
  addEvent: async (e) => { const r = { id: 'e1', ...e }; saved.push(r); return r; },
};
const realNow = Date.now;
Date.now = () => new Date('2026-11-12T16:30:00Z').getTime(); // 日本時間 11/13 1:30
const t = createTools(withFixedOffset(inner, 540), { now: fixedNow(540) });
const head = (await t.list_events({})).split('\n')[0];
await t.add_event({ member: '佐藤', title: 'x', date: '2026-11-13', start: '09:00', end: '10:00' });
const listed = await t.list_events({ date: '2026-11-13' });
Date.now = realNow;
console.log(JSON.stringify({ head, starts_at: saved[0].starts_at, listed }));
