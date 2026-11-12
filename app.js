import { FIREBASE_PROJECT_ID, FIREBASE_API_KEY, WORKER_URL } from './config.js';
import { createApi } from './lib/api.js';
import { initAuth, signIn, signOut, onChange, getIdToken } from './lib/auth.js';
import { planSelfMember, checkName } from './lib/members.js';
import {
  dayStartOf, toDateStr, clipToDay, freeSlots, fmtMin, pickColor,
} from './lib/timeline.js';
const monthView = () => import('./month-view.js'); // 月表示のときだけ読む
const freeView = () => import('./free-view.js'); // 空き一覧のときだけ読む

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const esc = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const WEEK = '日月火水木金土';

const state = {
  date: toDateStr(new Date()),
  members: [],
  events: [],
  hidden: new Set(store.get('ts-hidden', [])),
  minFree: store.get('ts-minfree', 30),
  view: store.get('ts-view', 'day'), // 'day' | 'month' | 'free'
  free: store.get('ts-free', { sort: 'date', from: 9, to: 18, min: 60 }),
  email: '',
  isOwner: false,
};
let api;

// ---------- 起動 ----------
async function init() {
  darkQuery.addEventListener('change', syncTheme);
  $('themeBtn').onclick = toggleTheme;
  const demo = FIREBASE_PROJECT_ID.startsWith('YOUR-');
  if (demo) {
    api = (await import('./lib/local-api.js')).createLocalApi(); // デモのときだけ読む
    notice('デモモード：データはこのブラウザだけに保存されます');
    return start();
  }
  // 共有リンク #k=チームキー（招待リンクは &i=招待コード 付き）を受け取る
  const m = location.hash.match(/k=([^&]+)/);
  if (m) {
    store.set('ts-key', decodeURIComponent(m[1]));
    store.set('ts-invite', location.hash.match(/i=([A-Za-z0-9]+)/)?.[1] ?? '');
    history.replaceState(null, '', location.pathname + location.search);
  }
  bindGate();
  try {
    await initAuth({ apiKey: FIREBASE_API_KEY, projectId: FIREBASE_PROJECT_ID });
  } catch (e) {
    return gate('ログインの準備に失敗しました。通信状況を確かめて再読み込みしてください', { error: e.message });
  }
  onChange((u) => { user = u; enter(); });
}

// ログイン中のユーザーでチームに入る。未ログイン・許可外・通信エラーはログイン画面に出す
let user = null;
async function enter() {
  api = null;
  const invite = store.get('ts-invite', '');
  if (!user) return gate(invite ? 'チームに招待されています。Google アカウントでログインすると参加できます' : 'Google アカウントでログインしてください', { login: true });
  const email = user.email.toLowerCase();
  gate('チームを確認しています…');
  let r;
  try {
    r = await connect(store.get('ts-key', ''));
  } catch (e) {
    return gate('チームの読み込みに失敗しました。通信状況を確かめてください', { out: true, retry: true, error: e.message });
  }
  if (r === 'logout') return signOut();
  if (invite) {
    store.set('ts-invite', '');
    if (r === 'forbidden') {
      const key = store.get('ts-key', '');
      try {
        await makeApi(key).joinWithInvite(invite, email);
        r = makeApi(key);
      } catch {
        return gate('招待リンクが無効か、期限が切れています。オーナーに新しいリンクをもらってください。', { out: true });
      }
    }
  }
  if (r === 'forbidden') {
    return gate(`このアカウント（${email}）はこのチームに許可されていないか、チームキーが違います。オーナーに追加を頼むか、キーを入れ直してください。`, { out: true, rekey: true });
  }
  api = r;
  state.email = email;
  $('acctBtn').textContent = email[0].toUpperCase();
  $('acctBtn').hidden = false;
  $('acctEmail').textContent = email;
  try {
    // ログインした人を自動でメンバーにする（名前は Google の表示名から。あとでアイコンメニューから変えられる）
    const [team, members] = await Promise.all([api.team(), api.members()]);
    state.isOwner = team.owner === email;
    const plan = planSelfMember(members, email, user.displayName);
    if (plan) await api.addMember(plan);
  } catch (e) {
    notice(`メンバーの登録に失敗しました：${e.message}`);
  }
  start();
}

const me = () => state.members.find((m) => m.email && m.email === state.email);
// 名前を変えられるのは本人・オーナー・メール無しのメンバー（ルールと同じ）
const canRename = (m) => !m.email || m.email === state.email || state.isOwner;

async function rename(id, name) {
  const err = checkName(name, state.members, id);
  if (err) return alert(err);
  await api.updateMember(id, { name: name.trim() });
  await reload();
}

let started = false;
async function start() {
  document.body.dataset.view = 'app';
  $('gate').hidden = true;
  if (started) return reload();
  started = true;
  $('minFree').value = state.minFree;
  bind();
  await reload();
  scrollToNow();
  setInterval(reload, 60000);
  addEventListener('focus', reload);
}

// ログイン画面（未ログイン・許可外・エラー）
function gate(msg, { login = false, out = false, rekey = false, retry = false, error = '' } = {}) {
  document.body.dataset.view = 'gate';
  $('gate').hidden = false;
  $('gateMsg').textContent = msg;
  $('loginBtn').hidden = !login;
  $('gateOut').hidden = !out;
  $('rekeyBtn').hidden = !rekey;
  $('retryBtn').hidden = !retry;
  const err = $('gate').querySelector('.err');
  err.textContent = error;
  err.hidden = !error;
}

function bindGate() {
  $('loginBtn').onclick = () => signIn().catch((e) => gate('ログインに失敗しました', { login: true, error: e.message }));
  $('gateOut').onclick = () => signOut();
  $('logoutBtn').onclick = () => { $('acctMenu').hidePopover(); signOut(); };
  $('rekeyBtn').onclick = () => { store.set('ts-key', ''); enter(); };
  $('retryBtn').onclick = enter;
  $('renameBtn').onclick = () => {
    $('acctMenu').hidePopover();
    const m = me();
    if (!m) return alert('まだメンバーとして登録されていません');
    const name = prompt('表示する名前（30 文字まで）', m.name);
    if (name !== null && name.trim() !== m.name) rename(m.id, name);
  };
  $('connectBtn').onclick = async () => {
    $('acctMenu').hidePopover();
    const { openConnect } = await import('./connect-view.js'); // 開いたときだけ読む
    openConnect({ api, email: state.email, workerUrl: WORKER_URL, teamKey: store.get('ts-key', '') });
  };
}

const authHeader = async () => `Bearer ${await getIdToken()}`;
const makeApi = (key) => createApi({ projectId: FIREBASE_PROJECT_ID, apiKey: FIREBASE_API_KEY, teamKey: key, getAuthHeader: authHeader });

// チームに入れれば api、許可外なら 'forbidden'、キー入力でログアウトを選べば 'logout'。通信エラーは投げる
async function connect(key) {
  if (key) {
    const r = await makeApi(key).checkAccess();
    if (r === 'ok') return makeApi(key);
    if (r === 'forbidden') return 'forbidden';
  }
  const dlg = $('keyDlg');
  const err = dlg.querySelector('.err');
  const showErr = (t) => { err.textContent = t; err.hidden = false; };
  return new Promise((resolve) => {
    dlg.oncancel = (e) => e.preventDefault();
    $('keyOut').onclick = () => { dlg.close(); resolve('logout'); };
    $('keyForm').onsubmit = async (e) => {
      e.preventDefault();
      const k = e.target.key.value.trim();
      let r;
      try {
        r = await makeApi(k).checkAccess();
      } catch (x) {
        return showErr(`通信に失敗しました：${x.message}`);
      }
      if (r === 'missing') return showErr('キーが違います');
      store.set('ts-key', k);
      dlg.close();
      resolve(r === 'ok' ? makeApi(k) : 'forbidden');
    };
    dlg.showModal();
  });
}

function notice(text) {
  $('notice').textContent = text;
  $('notice').hidden = !text;
}

async function reload() {
  if (!api) return;
  const today = toDateStr(new Date());
  const grid = state.view === 'month' ? (await monthView()).monthGrid(state.date)
    : state.view === 'free' ? [today, toDateStr(new Date(Date.now() + ((await freeView()).DAYS - 1) * 86400000))]
    : [state.date];
  const from = dayStartOf(grid[0]);
  const to = dayStartOf(grid[grid.length - 1]); to.setDate(to.getDate() + 1);
  try {
    [state.members, state.events] = await Promise.all([api.members(), api.events(from, to)]);
    if (!api.demo) notice('');
  } catch (e) {
    notice(`読み込みに失敗しました：${e.message}`);
  }
  render();
}

// ---------- 描画 ----------
function visibleMembers() {
  return state.members.filter((m) => !state.hidden.has(m.id));
}

function render() {
  const day = dayStartOf(state.date);
  const isToday = state.date === toDateStr(new Date());
  $('date').value = state.date;
  $('dateLabel').textContent = `${day.getMonth() + 1}/${day.getDate()}（${WEEK[day.getDay()]}）`;
  $('today').setAttribute('aria-pressed', isToday);
  const month = state.view === 'month';
  document.body.dataset.mode = state.view;
  $('month').hidden = !month;
  $('freeView').hidden = state.view !== 'free';
  for (const v of ['Day', 'Month', 'Free']) $(`view${v}`).setAttribute('aria-pressed', state.view === v.toLowerCase());

  $('legend').innerHTML = state.members.map((m) =>
    `<button class="chip${state.hidden.has(m.id) ? ' off' : ''}" data-id="${esc(m.id)}" style="--c:${m.color}"><i></i>${esc(m.name)}</button>`,
  ).join('') + '<button class="chip add" id="membersBtn"><svg class="i"><use href="#i-plus"/></svg>メンバー</button>';

  if (state.view === 'free') {
    $('dateLabel').textContent = '空き時間';
    const { events, free } = state;
    const memberIds = visibleMembers().map((m) => m.id);
    freeView().then(async (m) => {
      await m.ready;
      m.renderFree($('freeView'), { events, memberIds, from: toDateStr(new Date()), opts: free });
    });
    return;
  }
  if (month) {
    $('today').setAttribute('aria-pressed', state.date.slice(0, 7) === toDateStr(new Date()).slice(0, 7));
    const { date, events, members, hidden } = state;
    monthView().then(async (m) => {
      $('dateLabel').textContent = m.monthLabel(date);
      await m.ready;
      m.renderMonth($('month'), { date, today: toDateStr(new Date()), events, members, hidden });
    });
    return;
  }
  const vis = visibleMembers();
  const slots = freeSlots(state.events, vis.map((m) => m.id), day, state.minFree);
  $('freeList').innerHTML = slots.length
    ? slots.map(([s, e]) => `<span class="slot">${fmtMin(s)}–${fmtMin(e)}</span>`).join('')
    : '<span class="free-none">なし</span>';

  $('heads').innerHTML = vis.map((m) => `<div style="--c:${m.color}"><i></i><span>${esc(m.name)}</span></div>`).join('');
  $('hours').innerHTML = Array.from({ length: 25 }, (_, h) =>
    `<span style="top:${(h / 24) * 100}%">${h}:00</span>`).join('');

  const pct = (min) => `${(min / 1440) * 100}%`;
  let html = slots.map(([s, e]) =>
    `<div class="freeband" style="top:${pct(s)};height:${pct(e - s)}">${e - s >= 30 ? `<span>${fmtMin(s)}–${fmtMin(e)}</span>` : ''}</div>`,
  ).join('');
  html += vis.map((m) => {
    const bars = state.events.filter((e) => e.member_id === m.id).map((e) => {
      const r = clipToDay(e, day);
      if (!r) return '';
      const [s, en] = r;
      const t = `${fmtMin(s)}–${fmtMin(en)}`;
      return `<div class="ev${en - s < 45 ? ' short' : ''}" data-ev="${esc(e.id)}" style="--c:${m.color};top:${pct(s)};height:${pct(en - s)}" title="${esc(e.title)} ${t}">`
        + `<b>${esc(e.title)}</b>${en - s >= 45 ? `<small>${t}</small>` : ''}</div>`;
    }).join('');
    return `<div class="lane" data-member="${esc(m.id)}">${bars}</div>`;
  }).join('');
  if (!vis.length) html += '<p class="empty">メンバーを追加すると予定を入れられます</p>';
  if (isToday) {
    const now = new Date();
    html += `<div class="now" style="top:${pct(now.getHours() * 60 + now.getMinutes())}"></div>`;
  }
  $('body').innerHTML = html;
}

function scrollToNow() {
  const min = state.date === toDateStr(new Date())
    ? new Date().getHours() * 60 - 90
    : 8 * 60;
  $('scroller').scrollTop = Math.max(0, (min / 1440) * $('grid').offsetHeight);
}

// ---------- 操作 ----------
async function shiftDay(n) {
  if (state.view === 'month') return setDate((await monthView()).shiftMonth(state.date, n));
  const d = dayStartOf(state.date);
  d.setDate(d.getDate() + n);
  setDate(toDateStr(d));
}
function setView(v, date = state.date) {
  state.view = v;
  store.set('ts-view', v);
  setDate(date);
  if (v === 'day') scrollToNow();
}
function setDate(s) {
  state.date = s;
  render();
  reload();
}

function openEventDialog({ memberId, startMin = 9 * 60, date = state.date } = {}) {
  if (!state.members.length) return openMemberDialog();
  const f = $('eventForm');
  const hhmm = (m) => fmtMin(Math.min(m, 1439)).padStart(5, '0');
  f.member_id.innerHTML = state.members.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
  f.member_id.value = memberId ?? me()?.id ?? store.get('ts-me', state.members[0].id);
  if (!f.member_id.value) f.member_id.value = state.members[0].id;
  f.title.value = '';
  f.date.value = date;
  f.start.value = hhmm(startMin);
  f.end.value = startMin + 60 >= 1440 ? '23:59' : hhmm(startMin + 60);
  f.querySelector('.err').hidden = true;
  $('eventDlg').showModal();
  f.title.focus();
}

async function submitEvent(e) {
  if (e.submitter?.value !== 'ok') return;
  e.preventDefault();
  const f = e.target;
  const err = f.querySelector('.err');
  const start = new Date(`${f.date.value}T${f.start.value}`);
  const end = new Date(`${f.date.value}T${f.end.value}`);
  if (end <= start) end.setDate(end.getDate() + 1); // 終了が開始より前なら翌日扱い
  try {
    await api.addEvent({
      member_id: f.member_id.value, title: f.title.value.trim(),
      starts_at: start.toISOString(), ends_at: end.toISOString(),
    });
    store.set('ts-me', f.member_id.value);
    $('eventDlg').close();
    if (f.date.value !== state.date) setDate(f.date.value); else reload();
  } catch (x) {
    err.textContent = x.message;
    err.hidden = false;
  }
}

function openDetail(id) {
  const ev = state.events.find((e) => e.id === id);
  const m = state.members.find((x) => x.id === ev.member_id);
  const fmt = (d) => new Date(d).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  $('detailTitle').textContent = ev.title;
  $('detailMeta').textContent = `${m?.name ?? ''}・${fmt(ev.starts_at)} 〜 ${fmt(ev.ends_at)}`;
  const dlg = $('detailDlg');
  dlg.onclose = async () => {
    if (dlg.returnValue === 'delete' && confirm('この予定を削除しますか？')) {
      await api.deleteEvent(id);
      reload();
    }
  };
  dlg.showModal();
}

function openMemberDialog() {
  renderMemberList();
  $('memberForm').name.value = '';
  $('memberDlg').showModal();
}
function renderMemberList() {
  $('memberList').innerHTML = state.members.map((m) =>
    `<li data-id="${esc(m.id)}"><input type="color" value="${m.color}" aria-label="色">${canRename(m)
      ? `<input class="name" value="${esc(m.name)}" maxlength="30" aria-label="名前">` : `<span>${esc(m.name)}</span>`}<button type="button" class="danger">削除</button></li>`,
  ).join('');
}

async function memberFormSubmit(e) {
  if (e.submitter?.value !== 'add') return;
  e.preventDefault();
  const name = e.target.name.value.trim();
  if (!name) return;
  try {
    await api.addMember({ name, color: pickColor(state.members.map((m) => m.color)) });
    e.target.name.value = '';
    await reload();
    renderMemberList();
  } catch (x) {
    alert(x.message.includes('duplicate') ? '同じ名前のメンバーがいます' : x.message);
  }
}

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function syncTheme() {
  const t = document.documentElement.dataset.theme;
  document.documentElement.toggleAttribute('data-dark', t ? t === 'dark' : darkQuery.matches);
}
function toggleTheme() {
  const next = document.documentElement.hasAttribute('data-dark') ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  store.set('ts-theme', next);
  syncTheme();
}

function bind() {
  $('prev').onclick = () => shiftDay(-1);
  $('next').onclick = () => shiftDay(1);
  $('today').onclick = () => { setDate(toDateStr(new Date())); scrollToNow(); };
  $('viewDay').onclick = () => setView('day');
  $('viewMonth').onclick = () => setView('month');
  $('viewFree').onclick = () => setView('free');
  $('freeView').onchange = (e) => {
    state.free = { ...state.free, [e.target.dataset.k]: Number(e.target.value) };
    store.set('ts-free', state.free);
    render();
  };
  $('freeView').onclick = (e) => {
    const b = e.target.closest('button');
    if (b?.dataset.sort) {
      state.free = { ...state.free, sort: b.dataset.sort };
      store.set('ts-free', state.free);
      return render();
    }
    if (b?.dataset.date) openEventDialog({ date: b.dataset.date, startMin: Number(b.dataset.start) });
  };
  $('month').onclick = (e) => {
    const c = e.target.closest('.mcell');
    if (c) setView('day', c.dataset.date);
  };
  $('date').onchange = (e) => e.target.value && setDate(e.target.value);
  $('addBtn').onclick = () => openEventDialog();
  $('minFree').onchange = (e) => {
    state.minFree = Number(e.target.value);
    store.set('ts-minfree', state.minFree);
    render();
  };
  $('legend').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'membersBtn') return openMemberDialog();
    const id = b.dataset.id;
    state.hidden.has(id) ? state.hidden.delete(id) : state.hidden.add(id);
    store.set('ts-hidden', [...state.hidden]);
    render();
  };
  $('body').onclick = (e) => {
    const ev = e.target.closest('.ev');
    if (ev) return openDetail(ev.dataset.ev);
    const lane = e.target.closest('.lane');
    if (!lane) return;
    const rect = lane.getBoundingClientRect();
    const min = Math.floor(((e.clientY - rect.top) / rect.height) * 48) * 30;
    openEventDialog({ memberId: lane.dataset.member, startMin: min });
  };
  $('eventForm').onsubmit = submitEvent;
  $('memberForm').onsubmit = memberFormSubmit;
  $('memberList').onchange = async (e) => {
    const id = e.target.closest('li').dataset.id;
    if (e.target.classList.contains('name')) return rename(id, e.target.value).then(renderMemberList);
    if (e.target.type !== 'color') return;
    await api.updateMember(id, { color: e.target.value });
    reload();
  };
  $('memberList').onclick = async (e) => {
    if (!e.target.matches('button')) return;
    const id = e.target.closest('li').dataset.id;
    const m = state.members.find((x) => x.id === id);
    if (!confirm(`${m.name} さんと、その予定をすべて削除しますか？`)) return;
    await api.deleteMember(id);
    await reload();
    renderMemberList();
  };
  addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]') || e.target.matches('input,select')) return;
    if (e.key === 'ArrowLeft') shiftDay(-1);
    if (e.key === 'ArrowRight') shiftDay(1);
    if (e.key === 'n') openEventDialog();
  });
}

init();
