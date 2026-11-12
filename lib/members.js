// メンバーの名前まわり（純粋関数）
import { pickColor } from './timeline.js';

const MAX = 30;

// ログインした人のメンバーが居なければ、作る内容を返す（居れば null）
export function planSelfMember(members, email, displayName) {
  if (members.some((m) => m.email === email)) return null;
  const base = ((displayName ?? '').trim() || email.split('@')[0]).slice(0, MAX);
  const names = new Set(members.map((m) => m.name));
  let name = base;
  for (let n = 2; names.has(name); n++) name = `${base.slice(0, MAX - ` (${n})`.length)} (${n})`;
  return { name, color: pickColor(members.map((m) => m.color)), email };
}

// 名前のチェック。問題なければ null
export function checkName(name, members, selfId) {
  const n = name.trim();
  if (!n) return '名前を入力してください';
  if (n.length > MAX) return `名前は ${MAX} 文字以内にしてください`;
  if (members.some((m) => m.id !== selfId && m.name === n)) return '同じ名前のメンバーがいます';
  return null;
}
