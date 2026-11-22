/* 担当案件 PWA */
(() => {
  'use strict';

  const ACTIONS = ['投稿', '納品', '社内初稿', '撮影'];
  const ICON = { '投稿': '📤', '納品': '📦', '社内初稿': '✏️', '撮影': '🎥' };
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const BASE = location.pathname.replace(/[^/]*$/, '');
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- 保存領域（使えない環境でも落ちないように） ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  const defaults = window.APP_CONFIG || {};
  const cfg = Object.assign({ api: defaults.API_URL || '', key: '', os: defaults.ONESIGNAL_APP_ID || '' }, store.get('cfg', {}));
  const ui = Object.assign({ action: 'all', client: 'all', view: 'due', overOpen: false }, store.get('ui', {}));
  let data = store.get('data', null);
  let lastFetch = 0;

  /* ---------- 日付 ---------- */
  const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const parse = (s) => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const diffDays = (s) => { const d = parse(s); return d ? Math.round((d - today0()) / 864e5) : null; };
  const md = (s) => { const d = parse(s); return d ? `${d.getMonth() + 1}/${d.getDate()}` : ''; };
  const mdw = (s) => { const d = parse(s); return d ? `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})` : ''; };

  function daysLabel(n) {
    if (n === null) return { t: '日付未定', c: '' };
    if (n < 0) return { t: `${-n}日超過`, c: 'over' };
    if (n === 0) return { t: '今日', c: 'today' };
    if (n === 1) return { t: '明日', c: 'soon' };
    if (n <= 3) return { t: `あと${n}日`, c: 'soon' };
    if (n <= 7) return { t: `あと${n}日`, c: 'week' };
    return { t: `あと${n}日`, c: '' };
  }

  /* ---------- 通信 ---------- */
  async function load({ refresh = false, quiet = false } = {}) {
    if (!cfg.api || !cfg.key) { render(); return; }
    const btn = $('#btnReload');
    btn.classList.add('spin');
    try {
      const url = `${cfg.api}?key=${encodeURIComponent(cfg.key)}${refresh ? '&refresh=1' : ''}&t=${Date.now()}`;
      const res = await fetch(url, { redirect: 'follow' });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error === 'unauthorized' ? 'APIキーが違います（設定を確認）' : (j.error || '読み込みに失敗しました'));
      data = j; data.fetchedAt = Date.now();
      store.set('data', data);
      lastFetch = Date.now();
      if (!quiet) toast(refresh ? 'スプシを再集計しました' : '最新にしました');
    } catch (e) {
      toast(navigator.onLine ? `読み込めませんでした：${e.message}` : 'オフラインです（前回のデータを表示中）');
    } finally {
      btn.classList.remove('spin');
      render();
    }
  }

  /* ---------- 描画 ---------- */
  function enrich(t) { return Object.assign({}, t, { d: diffDays(t.due) }); }

  function render() {
    renderUpdated();
    const list = $('#list');
    if (!cfg.api || !cfg.key) {
      $('#tiles').innerHTML = '';
      $('#actionFilter').innerHTML = ''; $('#clientFilter').innerHTML = '';
      list.innerHTML = `<div class="empty">スプレッドシートとまだ接続されていません。<br>
        スプシの「一括管理 → 📱 アプリと通知の設定」に出る<br>接続コードを貼り付けてください。<br>
        <button class="primary" id="emptySetup">接続コードを入れる</button></div>`;
      $('#emptySetup').onclick = openSettings;
      return;
    }
    if (!data) { list.innerHTML = '<div class="empty">読み込み中…</div>'; return; }

    const all = data.tasks.map(enrich);
    renderTiles(all);
    renderActionFilter(all);
    renderClientFilter(all);

    const shown = all.filter((t) =>
      (ui.action === 'all' || t.next === ui.action) && (ui.client === 'all' || t.client === ui.client));

    if (!shown.length) { list.innerHTML = '<div class="empty">該当するタスクはありません 🎉</div>'; return; }
    list.innerHTML = ui.view === 'client' ? byClient(shown) : byDue(shown);
    list.querySelectorAll('details.g-over').forEach((el) => el.addEventListener('toggle', () => { ui.overOpen = el.open; store.set('ui', ui); }));
  }

  function renderUpdated() {
    const el = $('#updated');
    if (!data) { el.textContent = cfg.api ? '読み込み中…' : '未接続'; return; }
    const off = navigator.onLine ? '' : '・オフライン表示';
    el.textContent = `スプシ集計 ${data.updated || '—'}${off}`;
  }

  function renderTiles(all) {
    const c = { over: 0, today: 0, soon: 0, week: 0 };
    all.forEach((t) => {
      if (t.d === null) return;
      if (t.d < 0) c.over++; else if (t.d === 0) c.today++; else if (t.d <= 3) c.soon++; else if (t.d <= 7) c.week++;
    });
    const tile = (k, label) => `<button class="tile ${k} ${c[k] ? '' : 'zero'}" data-jump="${k}"><b>${c[k]}</b><span>${label}</span></button>`;
    $('#tiles').innerHTML = tile('over', '期限切れ') + tile('today', '今日') + tile('soon', '3日以内') + tile('week', '7日以内');
    $('#tiles').querySelectorAll('[data-jump]').forEach((b) => b.onclick = () => {
      const g = document.querySelector(`.g-${b.dataset.jump}`) || document.querySelector('.group');
      if (g) { if (g.tagName === 'DETAILS') g.open = true; g.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
  }

  function renderActionFilter(all) {
    const base = all.filter((t) => ui.client === 'all' || t.client === ui.client);
    const n = (a) => base.filter((t) => t.next === a).length;
    const btn = (a, label) => `<button data-a="${a}" class="${ui.action === a ? 'on' : ''}">${label}<span class="n">${a === 'all' ? base.length : n(a)}</span></button>`;
    $('#actionFilter').innerHTML = btn('all', 'すべて') + ACTIONS.map((a) => btn(a, `${ICON[a]} ${a}`)).join('');
    $('#actionFilter').querySelectorAll('button').forEach((b) => b.onclick = () => { ui.action = b.dataset.a; store.set('ui', ui); render(); });
  }

  function renderClientFilter(all) {
    const clients = [...new Set(all.map((t) => t.client))];
    if (ui.client !== 'all' && !clients.includes(ui.client)) ui.client = 'all';
    const btn = (c, label) => `<button data-c="${esc(c)}" class="${ui.client === c ? 'on' : ''}">${esc(label)}</button>`;
    $('#clientFilter').innerHTML = btn('all', '全クライアント') + clients.map((c) => btn(c, c)).join('');
    $('#clientFilter').querySelectorAll('button').forEach((b) => b.onclick = () => { ui.client = b.dataset.c; store.set('ui', ui); render(); });
  }

  const sortDue = (a, b) => (a.d ?? 1e6) - (b.d ?? 1e6) || a.client.localeCompare(b.client, 'ja');

  function byDue(tasks) {
    const groups = [
      { k: 'over', label: '期限切れ', hint: 'ステータスの更新もれも含みます', f: (t) => t.d !== null && t.d < 0, collapsible: true },
      { k: 'today', label: '今日', f: (t) => t.d === 0 },
      { k: 'soon', label: '明日〜3日以内', f: (t) => t.d >= 1 && t.d <= 3 },
      { k: 'week', label: '7日以内', f: (t) => t.d >= 4 && t.d <= 7 },
      { k: 'later', label: 'それ以降', f: (t) => t.d > 7 },
      { k: 'none', label: '日付未定', f: (t) => t.d === null },
    ];
    tasks = [...tasks].sort(sortDue);
    return groups.map((g) => {
      const items = tasks.filter(g.f);
      if (!items.length) return '';
      const open = g.collapsible ? (ui.overOpen ? 'open' : '') : 'open';
      return `<details class="group g-${g.k}" ${open}><summary>${g.label}<span class="count">${items.length}</span>${g.hint ? `<span class="hint">${g.hint}</span>` : ''}</summary>
        ${items.map(card).join('')}</details>`;
    }).join('');
  }

  function byClient(tasks) {
    const map = new Map();
    [...tasks].sort(sortDue).forEach((t) => { if (!map.has(t.client)) map.set(t.client, []); map.get(t.client).push(t); });
    return [...map.entries()].map(([c, items]) => {
      const over = items.filter((t) => t.d !== null && t.d < 0).length;
      const counts = ACTIONS.map((a) => [a, items.filter((t) => t.next === a).length]).filter((x) => x[1]).map(([a, n]) => `${a}${n}`).join('・');
      return `<details class="group ${over ? 'g-over' : ''}" open><summary><span class="client-head">${esc(c)}</span><span class="count">${items.length}</span><span class="hint">${counts}${over ? `／超過${over}` : ''}</span></summary>
        ${items.map(card).join('')}</details>`;
    }).join('');
  }

  function card(t) {
    const known = ACTIONS.includes(t.next);
    const a = known ? t.next : 'none';
    const dl = daysLabel(t.d);
    const td = today0();
    const steps = [['撮影', t.shoot], ['社内初稿', t.draft], ['納品', t.deliver], ['投稿', t.post]];
    const pipe = steps.map(([name, date]) => {
      const isNext = name === t.next;
      const done = !isNext && date && parse(date) < td && steps.findIndex((s) => s[0] === t.next) > steps.findIndex((s) => s[0] === name);
      const cls = isNext ? 'next' : done ? 'done' : date ? '' : 'none';
      return `<div class="step ${cls}">${name === '社内初稿' ? '初稿' : name}<b>${date ? md(date) : '—'}</b></div>`;
    }).join('');
    const waiting = /確認/.test(t.status);
    const tag = t.url ? 'a' : 'div';
    const href = t.url ? ` href="${esc(t.url)}" target="_blank" rel="noopener"` : '';
    return `<${tag} class="card a-${a}"${href}>
      <div class="card-top">
        <span class="act">${known ? `${ICON[a]} ${a}` : '工程未定'}</span>
        <span class="due">${t.due ? mdw(t.due) + 'まで' : ''}</span>
        <span class="days ${dl.c}">${dl.t}</span>
      </div>
      <div class="title">${esc(t.title)}</div>
      <div class="meta"><span class="client">${esc(t.client)}</span><span>${esc(t.tab)}${t.no ? ` #${esc(t.no)}` : ''}</span>
        ${t.status ? `<span class="status ${waiting ? 'wait' : ''}">${esc(t.status)}${waiting ? '（先方待ち）' : ''}</span>` : ''}</div>
      <div class="pipe">${pipe}</div>
    </${tag}>`;
  }

  /* ---------- トースト ---------- */
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  /* ---------- 設定 ---------- */
  function openSettings() {
    $('#inApi').value = cfg.api; $('#inKey').value = cfg.key; $('#inOs').value = cfg.os; $('#inCode').value = '';
    $('#iosHint').hidden = !(/iPhone|iPad/.test(navigator.userAgent) && !navigator.standalone);
    updateNotifyState();
    $('#settings').showModal();
  }

  function decodeCode(code) {
    code = code.trim();
    const m = code.match(/[#?&]setup=([\w-]+)/); if (m) code = m[1];
    const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(b64 + '==='.slice((b64.length + 3) % 4))));
    const o = JSON.parse(json);
    return { api: o.a, key: o.k, os: o.o || '' };
  }

  function saveSettings() {
    try {
      const code = $('#inCode').value;
      const next = code.trim() ? decodeCode(code) : { api: $('#inApi').value.trim(), key: $('#inKey').value.trim(), os: $('#inOs').value.trim() };
      if (!next.api || !next.key) throw new Error('URLとキーが必要です');
      const osChanged = next.os !== cfg.os;
      Object.assign(cfg, next); store.set('cfg', cfg);
      data = null; store.set('data', null);
      $('#settings').close();
      toast('接続しました');
      load({ quiet: true });
      if (osChanged) initPush();
    } catch (e) {
      toast(`接続コードを読み取れません：${e.message}`);
    }
  }

  /* ---------- プッシュ通知（OneSignal） ---------- */
  let pushReady = null;
  function initPush() {
    if (!cfg.os || pushReady) return pushReady;
    pushReady = new Promise((resolve) => {
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      const s = document.createElement('script');
      s.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js'; s.defer = true;
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
      window.OneSignalDeferred.push(async (OneSignal) => {
        try {
          await OneSignal.init({
            appId: cfg.os,
            serviceWorkerPath: `${BASE.slice(1)}OneSignalSDKWorker.js`,
            serviceWorkerParam: { scope: BASE },
            notifyButton: { enable: false },
            autoResubscribe: true,
          });
          OneSignal.User.PushSubscription.addEventListener('change', updateNotifyState);
          resolve(OneSignal);
        } catch (e) { console.warn(e); resolve(null); }
      });
    });
    return pushReady;
  }

  async function enableNotify() {
    if (!cfg.os) { toast('先に接続コードを入れてください'); return; }
    if (/iPhone|iPad/.test(navigator.userAgent) && !navigator.standalone) { toast('iPhoneはホーム画面に追加したアプリから設定してください'); return; }
    const OS = await initPush();
    if (!OS) { toast('通知の準備に失敗しました'); return; }
    try {
      await OS.Notifications.requestPermission();
      if (OS.Notifications.permission && !OS.User.PushSubscription.optedIn) await OS.User.PushSubscription.optIn();
    } catch (e) { console.warn(e); }
    updateNotifyState();
  }

  async function updateNotifyState() {
    const el = $('#notifyState'); if (!el) return;
    if (!('Notification' in window)) { el.textContent = 'この画面では通知を使えません（iPhoneはホーム画面のアプリから）'; return; }
    if (Notification.permission === 'denied') { el.textContent = '通知がブロックされています。端末の設定から許可してください。'; return; }
    const OS = cfg.os ? await initPush() : null;
    const on = OS && OS.Notifications.permission && OS.User.PushSubscription.optedIn;
    el.textContent = on ? '✅ この端末で通知を受け取ります' : '通知はまだオフです';
    $('#btnNotify').textContent = on ? '通知はオンです' : '通知をオンにする';
  }

  /* ---------- イベント ---------- */
  $('#btnReload').onclick = () => load();
  $('#btnSettings').onclick = openSettings;
  $('#btnSave').onclick = saveSettings;
  $('#btnNotify').onclick = enableNotify;
  $('#btnRefreshSheet').onclick = () => { $('#settings').close(); toast('元シートから再集計中…（数十秒かかります）'); load({ refresh: true }); };
  document.querySelectorAll('.view-toggle button').forEach((b) => {
    b.classList.toggle('on', b.dataset.view === ui.view);
    b.onclick = () => {
      ui.view = b.dataset.view; store.set('ui', ui);
      document.querySelectorAll('.view-toggle button').forEach((x) => x.classList.toggle('on', x === b));
      render();
    };
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastFetch > 3 * 60 * 1000) load({ quiet: true });
  });
  window.addEventListener('online', () => load({ quiet: true }));
  window.addEventListener('offline', renderUpdated);

  // 接続コード付きリンク（…/#setup=xxxx）で開かれたら自動で設定
  if (location.hash.startsWith('#setup=')) {
    try { Object.assign(cfg, decodeCode(location.hash)); store.set('cfg', cfg); } catch {}
    history.replaceState(null, '', location.pathname);
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('OneSignalSDKWorker.js', { scope: BASE }).catch(() => {});

  render();
  load({ quiet: true });
  if (cfg.os) initPush();
})();
