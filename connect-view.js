// 「AI・API と接続」ダイアログ：接続 URL の発行・無効化と、オーナーによる許可リストの編集
import { mcpUrl, curlExample, normalizeAllowed, inviteUrl } from './lib/connect.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
let ctx;

async function renderTokens() {
  const list = await ctx.api.myTokens(ctx.email);
  $('tokenList').innerHTML = list.length
    ? list.map((t) => `<li data-id="${esc(t.id)}"><span>${esc(t.label)}</span><small class="meta">${t.created_at.slice(0, 10)}</small><button type="button" class="danger">無効化</button></li>`).join('')
    : '<li class="meta">まだありません</li>';
}

async function renderInvites() {
  const list = await ctx.api.invites();
  const md = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };
  $('inviteList').innerHTML = list.map((x) =>
    `<li data-code="${esc(x.id)}"><span>…${esc(x.id.slice(-6))}</span><small class="meta">${md(x.expires_at)} まで</small><button type="button" class="danger">無効化</button></li>`).join('');
}

function showErr(msg, ok = false) {
  const err = $('connectForm').querySelector('.err');
  err.textContent = msg;
  err.hidden = !msg;
  err.classList.toggle('ok', ok);
}

async function submit(e) {
  e.preventDefault();
  const f = e.target;
  const action = e.submitter?.value;
  showErr('');
  try {
    if (action === 'issue') {
      const label = f.label.value.trim() || 'AI';
      const { token } = await ctx.api.createToken(label, ctx.email);
      const url = mcpUrl(ctx.workerUrl, token);
      $('mcpOut').value = url;
      $('ccOut').value = `claude mcp add --transport http team-schedule ${url}`;
      $('curlOut').value = curlExample(ctx.workerUrl, token);
      $('issued').hidden = false;
      f.label.value = '';
      await renderTokens();
    } else if (action === 'invite') {
      const { code } = await ctx.api.createInvite();
      const url = inviteUrl(location.href, ctx.teamKey, code);
      $('inviteUrl').value = url;
      $('inviteOut').hidden = false;
      $('shareBtn').hidden = !navigator.share;
      $('shareBtn').onclick = () => navigator.share({ title: 'チーム予定への招待', url }).catch(() => {});
      await renderInvites();
    } else if (action === 'allow') {
      const r = normalizeAllowed(f.allowed.value.split('\n'), ctx.owner);
      if (r.error) return showErr(r.error);
      await ctx.api.setAllowed(r.list);
      f.allowed.value = r.list.join('\n');
      showErr('保存しました', true);
    } else {
      $('connectDlg').close();
    }
  } catch (err) {
    showErr(`失敗しました：${err.message}`);
  }
}

export async function openConnect(c) {
  ctx = c;
  const f = $('connectForm');
  f.onsubmit = submit;
  $('issued').hidden = true;
  $('ownerBox').hidden = true;
  $('inviteOut').hidden = true;
  showErr('');
  $('connectDlg').showModal();
  $('tokenList').onclick = async (e) => {
    if (!e.target.matches('button')) return;
    if (!confirm('この接続 URL を無効にしますか？使っている AI からは接続できなくなります。')) return;
    await ctx.api.revokeToken(e.target.closest('li').dataset.id);
    renderTokens();
  };
  $('inviteList').onclick = async (e) => {
    if (!e.target.matches('button')) return;
    if (!confirm('この招待リンクを無効にしますか？まだ使っていない人は参加できなくなります。')) return;
    await ctx.api.revokeInvite(e.target.closest('li').dataset.code);
    renderInvites();
  };
  f.onclick = (e) => {
    const id = e.target.dataset.copy;
    if (!id) return;
    navigator.clipboard.writeText($(id).value);
    e.target.textContent = 'コピー済み';
    setTimeout(() => { e.target.textContent = 'コピー'; }, 1500);
  };
  try {
    const team = await ctx.api.team();
    ctx.owner = team.owner;
    if (team.owner?.toLowerCase() === ctx.email) {
      f.allowed.value = team.allowed.join('\n');
      $('ownerBox').hidden = false;
      await renderInvites();
    }
    await renderTokens();
  } catch (err) {
    showErr(`読み込みに失敗しました：${err.message}`);
  }
}
