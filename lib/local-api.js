// config.js 未設定時のデモ用。createApi と同じ形で localStorage に保存する。
import { toDateStr, dayStartOf, PALETTE } from './timeline.js';

const KEY = 'ts-demo';

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d) return d;
  } catch {}
  return seed();
}
function save(d) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {}
}

function seed() {
  const day = dayStartOf(toDateStr(new Date()));
  const at = (h, m = 0) => new Date(day.getTime() + (h * 60 + m) * 60000).toISOString();
  const members = ['佐藤', '鈴木', '高橋'].map((name, i) => ({ id: `m${i}`, name, color: PALETTE[i] }));
  const ev = (m, title, s, e) => ({ id: crypto.randomUUID(), member_id: m, title, starts_at: s, ends_at: e });
  return {
    members,
    events: [
      ev('m0', '睡眠', at(0), at(7)), ev('m1', '睡眠', at(0), at(6, 30)), ev('m2', '睡眠', at(1), at(8)),
      ev('m0', '定例', at(10), at(11)), ev('m1', '定例', at(10), at(11)),
      ev('m1', '客先訪問', at(13), at(15, 30)), ev('m2', '開発', at(9), at(12)),
      ev('m0', '面談', at(16), at(17)), ev('m2', '移動', at(17, 30), at(18, 30)),
      ev('m0', '睡眠', at(23, 30), at(24)),
    ],
  };
}

export function createLocalApi() {
  let db = load();
  const done = (v) => { save(db); return Promise.resolve(v); };
  return {
    demo: true,
    checkKey: () => Promise.resolve(true),
    members: () => Promise.resolve([...db.members]),
    addMember: (m) => { const r = { id: crypto.randomUUID(), ...m }; db.members.push(r); return done(r); },
    updateMember: (id, patch) => { Object.assign(db.members.find((m) => m.id === id), patch); return done(null); },
    deleteMember: (id) => {
      db.members = db.members.filter((m) => m.id !== id);
      db.events = db.events.filter((e) => e.member_id !== id);
      return done(null);
    },
    events: (from, to) => Promise.resolve(db.events.filter(
      (e) => new Date(e.starts_at) < to && new Date(e.ends_at) > from,
    )),
    addEvent: (e) => { const r = { id: crypto.randomUUID(), ...e }; db.events.push(r); return done(r); },
    deleteEvent: (id) => { db.events = db.events.filter((e) => e.id !== id); return done(null); },
  };
}
