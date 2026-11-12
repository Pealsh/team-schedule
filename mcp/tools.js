// MCP ツールの中身。api は lib/api.js の createApi と同じ形。結果は AI 向けのテキストで返す。
import {
  dayStartOf, toDateStr, clipToDay, freeSlots, fmtMin, pickColor,
} from '../lib/timeline.js';

const WEEK = '日月火水木金土';

function toMin(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m || +m[1] > 24 || +m[2] > 59) throw new Error(`時刻は HH:MM で指定してください: ${hhmm}`);
  return +m[1] * 60 + +m[2];
}
const addMin = (d, min) => new Date(d.getTime() + min * 60000);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const label = (d) => `${toDateStr(d)}（${WEEK[d.getDay()]}）`;

// now: 「今」を返す関数。Worker では fixedNow(540) を渡して日本時間にする
// self: AI 接続のトークン発行者のメール。指定すると、予定の追加・削除はその人のメンバーだけに限る
export function createTools(api, { now = () => new Date(), self } = {}) {
  const today = () => toDateStr(now());
  const ONLY_SELF = '自分の予定しか追加・削除できません（AI 接続は、URL を発行した本人の予定だけを書き換えられます）';

  async function selfMember() {
    const m = (await api.members()).find((x) => x.email === self);
    if (!m) throw new Error('あなたのメンバーがまだありません。先に画面に Google でログインしてください');
    return m;
  }

  async function findMember(name) {
    const all = await api.members();
    const key = name.trim().toLowerCase();
    const exact = all.find((m) => m.name.toLowerCase() === key);
    if (exact) return exact;
    const part = all.filter((m) => m.name.toLowerCase().includes(key));
    if (part.length === 1) return part[0];
    throw new Error(`メンバー「${name}」が見つかりません。登録済み: ${all.map((m) => m.name).join(', ') || 'なし'}`);
  }

  return {
    async list_members() {
      const all = await api.members();
      return all.length ? all.map((m) => `${m.name} (${m.color})`).join('\n') : 'メンバーはいません';
    },

    async add_member({ name, color }) {
      const all = await api.members();
      const m = await api.addMember({ name: name.trim(), color: color ?? pickColor(all.map((x) => x.color)) });
      return `メンバー「${m.name}」を追加しました（色 ${m.color}）`;
    },

    async list_events({ date = today(), days = 1, member }) {
      const from = dayStartOf(date);
      const to = addDays(from, days);
      const [all, events] = await Promise.all([api.members(), api.events(from, to)]);
      const who = member ? await findMember(member) : null;
      const names = Object.fromEntries(all.map((m) => [m.id, m.name]));
      const lines = [];
      for (let i = 0; i < days; i++) {
        const day = addDays(from, i);
        const rows = events
          .filter((e) => !who || e.member_id === who.id)
          .map((e) => ({ e, r: clipToDay(e, day) }))
          .filter((x) => x.r)
          .map(({ e, r }) => `  ${fmtMin(r[0])}–${fmtMin(r[1])} ${names[e.member_id] ?? '?'}「${e.title}」 (id: ${e.id})`);
        lines.push(`${label(day)}`, ...(rows.length ? rows : ['  予定なし']));
      }
      return lines.join('\n');
    },

    async add_event({ member, title, date, start, end }) {
      let m;
      if (self) {
        m = await selfMember();
        if (member && (await findMember(member)).id !== m.id) throw new Error(ONLY_SELF);
      } else {
        if (!member) throw new Error('member（メンバー名）を指定してください');
        m = await findMember(member);
      }
      const day = dayStartOf(date);
      const s = toMin(start);
      let e = toMin(end);
      if (e <= s) e += 1440; // 終了が開始以前なら翌日
      const ev = await api.addEvent({
        member_id: m.id, title,
        starts_at: addMin(day, s).toISOString(), ends_at: addMin(day, e).toISOString(),
      });
      return `${m.name} さんに「${title}」${label(day)} ${start}–${end} を追加しました (id: ${ev.id})`;
    },

    async delete_event({ id }) {
      if (self) {
        const [me, ev] = await Promise.all([selfMember(), api.event(id)]);
        if (!ev) throw new Error(`予定 ${id} が見つかりません`);
        if (ev.member_id !== me.id) throw new Error(ONLY_SELF);
      }
      await api.deleteEvent(id);
      return `予定 ${id} を削除しました`;
    },

    async find_free_slots({
      date = today(), days = 1, members, min_minutes = 30, work_start = '00:00', work_end = '24:00',
    }) {
      const all = await api.members();
      const targets = members?.length ? await Promise.all(members.map(findMember)) : all;
      const ids = targets.map((m) => m.id);
      const from = dayStartOf(date);
      const events = await api.events(from, addDays(from, days));
      const ws = toMin(work_start);
      const we = toMin(work_end);
      const lines = [];
      for (let i = 0; i < days; i++) {
        const day = addDays(from, i);
        const slots = freeSlots(events, ids, day)
          .map(([s, e]) => [Math.max(s, ws), Math.min(e, we)])
          .filter(([s, e]) => e - s >= Math.max(min_minutes, 1));
        lines.push(`${label(day)}: ${slots.length ? slots.map(([s, e]) => `${fmtMin(s)}–${fmtMin(e)}`).join(' / ') : 'なし'}`);
      }
      return lines.join('\n');
    },
  };
}
