/**
 * router.js — App shell, routing, auth bootstrap, theme control.
 * Module pages are loaded on demand via dynamic import('/modules/<name>/page.js')
 * and receive the shared `App` controller.
 */
import { api, setCsrf } from '/api.js';
import {
  el, icon, toast, openModal, confirmDialog, loadingCenter, emptyState,
  input, field, formatMoney,
} from '/ui.js';

const THEME_LABELS = { light: '浅色', dark: '深色', system: '跟随系统' };

const App = {
  api, el, icon, toast,
  state: { version: null, user: null, nav: [], theme: 'system' },
  navigate, refresh: () => renderRoute(),
  logout, openSettings: () => navigate('/settings'),
};
window.__DM = App; // debug handle

/* ============================================================
   Bootstrap
   ============================================================ */
export async function initRouter() {
  const root = document.getElementById('app');
  try {
    const ver = await api.get('/api/v1/version');
    App.state.version = ver;
    const m = await api.get('/api/v1/modules');
    App.state.nav = m.data || [];
  } catch (e) {
    root.appendChild(el('div', { class: 'auth-wrap' }, [
      el('div', { class: 'auth-card' }, [
        el('div', { class: 'auth-logo' }, [icon('sparkles', { size: 28 })]),
        el('h1', { text: 'DM Life' }),
        el('p', { class: 'sub', text: '无法连接服务器，请确认服务已启动。' }),
      ]),
    ]));
    return;
  }

  if (App.state.version.setup_required) { showAuth('setup'); return; }

  try {
    const me = await api.get('/api/v1/auth/me');
    App.state.user = me.user;
    setCsrf(me.csrfToken);
  } catch { App.state.user = null; }

  let path = location.pathname;
  if (!App.state.user && path !== '/login') history.replaceState({}, '', '/login');
  if (App.state.user && (path === '/login' || path === '/setup')) history.replaceState({}, '', '/daily');

  await renderRoute();

  window.addEventListener('popstate', () => renderRoute());
  window.addEventListener('auth:expired', () => {
    App.state.user = null;
    toast('登录已过期，请重新登录', 'error');
    navigate('/login');
  });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

/* ============================================================
   Routing
   ============================================================ */
function navigate(path) {
  closeNav();
  if (location.pathname === path) { renderRoute(); return; }
  history.pushState({}, '', path);
  renderRoute();
}

async function renderRoute() {
  const path = location.pathname === '/' ? '/daily' : location.pathname;
  if (path === '/login' || path === '/setup') { showAuth(path.slice(1)); return; }
  if (!App.state.user) { history.replaceState({}, '', '/login'); showAuth('login'); return; }

  ensureShell();
  highlightNav(path);
  setTopbarTitle(path);
  const view = App._shell.view;
  view.innerHTML = '';
  view.appendChild(loadingCenter());
  try {
    const node = await resolveView(path);
    view.innerHTML = '';
    view.appendChild(node);
    view.firstChild && view.firstChild.classList.add('fade-in');
  } catch (e) {
    view.innerHTML = '';
    view.appendChild(el('div', {}, [emptyState('加载失败：' + (e && e.message ? e.message : e), 'alert')]));
  }
}

function resolveView(path) {
  if (path === '/settings') return renderSettings();
  const item = App.state.nav.find((n) => n.path === path);
  if (item) return loadModuleView(item.name);
  return loadModuleView('daily-board');
}

const pageCache = {};
async function loadModuleView(modName) {
  let mod = pageCache[modName];
  if (!mod) {
    mod = await import('/modules/' + modName + '/page.js');
    pageCache[modName] = mod;
  }
  const render = mod.default;
  if (typeof render !== 'function') return emptyState('该模块未提供页面', 'box');
  const node = render(App);
  return node instanceof Node ? node : el('div', {}, [String(node)]);
}

/* ============================================================
   Shell
   ============================================================ */
function ensureShell() {
  if (App._shell) return;
  const root = document.getElementById('app');
  root.innerHTML = '';

  const brand = el('div', { class: 'brand' }, [
    el('div', { class: 'brand-logo' }, [icon('sparkles', { size: 22 })]),
    el('div', {}, [
      el('div', { class: 'brand-name', text: App.state.version?.app_name || 'DM Life' }),
      el('div', { class: 'brand-sub', text: '人生管理系统' }),
    ]),
  ]);
  const nav = el('nav', { class: 'nav' });
  const userChip = el('button', { class: 'user-chip', onclick: openUserMenu });
  const foot = el('div', { class: 'sidebar-foot' }, [userChip]);
  const sidebar = el('aside', { class: 'sidebar' }, [brand, nav, foot]);

  const menuBtn = el('button', { class: 'icon-btn menu-btn', 'aria-label': '菜单', onclick: toggleNav }, [icon('menu', { size: 20 })]);
  const titleEl = el('div', { class: 'page-title' });
  const themeBtn = el('button', { class: 'icon-btn', 'aria-label': '切换主题', onclick: cycleTheme }, [icon(themeIcon(), { size: 20 })]);
  const topbar = el('header', { class: 'topbar' }, [menuBtn, titleEl, el('div', { class: 'spacer' }), themeBtn]);
  const view = el('div', { class: 'view' });
  const mainEl = el('main', { class: 'main' }, [topbar, view]);

  const shellWrap = el('div', { class: 'app-shell' }, [sidebar, mainEl]);
  root.appendChild(shellWrap);

  App._shell = { shellWrap, sidebar, nav, userChip, topbar, titleEl, themeBtn, view };
  buildNav();
  updateUserChip();
}

function buildNav() {
  const navEl = App._shell.nav;
  navEl.innerHTML = '';
  navEl.appendChild(el('div', { class: 'nav-section', text: '功能' }));
  for (const item of App.state.nav) {
    navEl.appendChild(el('div', {
      class: 'nav-item', dataset: { path: item.path }, onclick: () => navigate(item.path),
    }, [icon(item.icon || 'box', { size: 20, cls: 'nav-ico' }), el('span', { text: item.label })]));
  }
  navEl.appendChild(el('div', { class: 'nav-section', text: '系统' }));
  navEl.appendChild(el('div', {
    class: 'nav-item', dataset: { path: '/settings' }, onclick: () => navigate('/settings'),
  }, [icon('settings', { size: 20, cls: 'nav-ico' }), el('span', { text: '设置' })]));
}

function highlightNav(path) {
  App._shell.nav.querySelectorAll('.nav-item').forEach((n) => {
    n.classList.toggle('active', n.dataset.path === path);
  });
}

function setTopbarTitle(path) {
  let label = 'DM Life';
  if (path === '/settings') label = '设置';
  else { const item = App.state.nav.find((n) => n.path === path); if (item) label = item.label; }
  App._shell.titleEl.textContent = label;
}

function updateUserChip() {
  const u = App.state.user;
  const chip = App._shell.userChip;
  chip.innerHTML = '';
  if (!u) return;
  const initial = (u.display_name || u.username || '?').slice(0, 1).toUpperCase();
  chip.append(
    el('div', { class: 'avatar', style: { background: u.avatar_color || 'var(--primary)' } }, [initial]),
    el('div', { class: 'user-meta' }, [
      el('div', { class: 'user-name', text: u.display_name || u.username }),
      el('div', { class: 'user-role', text: u.role === 'admin' ? '管理员' : u.role }),
    ]),
  );
}

function toggleNav() {
  const sh = App._shell.shellWrap;
  const open = sh.classList.toggle('nav-open');
  const old = sh.querySelector('.scrim');
  if (open) {
    const scrim = el('div', { class: 'scrim', onclick: () => { sh.classList.remove('nav-open'); const s = sh.querySelector('.scrim'); if (s) s.remove(); } });
    sh.appendChild(scrim);
  } else if (old) old.remove();
}
function closeNav() {
  if (!App._shell) return;
  const sh = App._shell.shellWrap;
  sh.classList.remove('nav-open');
  const s = sh.querySelector('.scrim'); if (s) s.remove();
}

/* ============================================================
   Auth screens
   ============================================================ */
function showAuth(kind) {
  const root = document.getElementById('app');
  root.innerHTML = '';
  const isSetup = kind === 'setup';
  const card = el('div', { class: 'auth-card fade-in' });
  card.append(
    el('div', { class: 'auth-logo' }, [icon('sparkles', { size: 28 })]),
    el('h1', { text: isSetup ? '初始化 ' + (App.state.version?.app_name || 'DM Life') : '登录' }),
    el('p', { class: 'sub', text: isSetup ? '创建你的管理员账户' : (App.state.version?.app_name || 'DM Life') }),
  );
  const errBox = el('div', { class: 'badge badge-danger', style: { display: 'none', marginBottom: '16px', justifyContent: 'center' } });
  card.appendChild(errBox);

  const username = input({ placeholder: '用户名', autocomplete: 'username' });
  const password = input({ type: 'password', placeholder: '密码', autocomplete: isSetup ? 'new-password' : 'current-password' });
  card.appendChild(field('用户名', username));
  card.appendChild(field('密码', password));

  let displayName, confirmPw, appNameField;
  if (isSetup) {
    displayName = input({ placeholder: '显示名称', autocomplete: 'name' });
    confirmPw = input({ type: 'password', placeholder: '确认密码', autocomplete: 'new-password' });
    appNameField = input({ placeholder: '应用名称（可选）', value: App.state.version?.app_name || 'DM Life' });
    card.appendChild(field('显示名称', displayName));
    card.appendChild(field('确认密码', confirmPw));
    card.appendChild(field('应用名称', appNameField));
  }

  const submit = el('button', { class: 'btn btn-primary btn-block', text: isSetup ? '创建账户' : '登录' });
  card.appendChild(submit);

  const showErr = (m) => { errBox.textContent = m; errBox.style.display = 'flex'; };
  const doSubmit = async () => {
    errBox.style.display = 'none';
    const u = username.value.trim();
    const p = password.value;
    if (!u || !p) { showErr('请输入用户名和密码'); return; }
    submit.disabled = true;
    if (isSetup) {
      if (p.length < 8) { showErr('密码至少 8 位'); submit.disabled = false; return; }
      if (p !== confirmPw.value) { showErr('两次密码不一致'); submit.disabled = false; return; }
      submit.textContent = '创建中…';
      try {
        const res = await api.post('/api/v1/auth/setup', {
          username: u, display_name: displayName.value.trim(), password: p,
          app_name: appNameField.value.trim() || undefined,
        });
        onAuthed(res);
      } catch (e) { showErr(e.message); submit.disabled = false; submit.textContent = '创建账户'; }
    } else {
      submit.textContent = '登录中…';
      try {
        const res = await api.post('/api/v1/auth/login', { username: u, password: p });
        onAuthed(res);
      } catch (e) { showErr(e.message); submit.disabled = false; submit.textContent = '登录'; }
    }
  };
  submit.onclick = doSubmit;
  password.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSubmit(); });
  if (isSetup && confirmPw) confirmPw.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSubmit(); });

  function onAuthed(res) {
    App.state.user = res.user;
    setCsrf(res.csrfToken);
    navigate('/daily');
  }

  root.appendChild(el('div', { class: 'auth-wrap' }, [card]));
  setTimeout(() => username.focus(), 50);
}

/* ============================================================
   Theme
   ============================================================ */
function themeIcon() {
  const t = localStorage.getItem('dml-theme') || 'system';
  return t === 'light' ? 'sun' : t === 'dark' ? 'moon' : 'monitor';
}
function setTheme(t) {
  App.state.theme = t;
  localStorage.setItem('dml-theme', t);
  const root = document.documentElement;
  if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t);
  else root.setAttribute('data-theme', (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light');
  if (App._shell) App._shell.themeBtn.replaceChildren(icon(themeIcon(), { size: 20 }));
}
function cycleTheme() {
  const order = ['light', 'dark', 'system'];
  const cur = localStorage.getItem('dml-theme') || 'system';
  const next = order[(order.indexOf(cur) + 1) % 3];
  setTheme(next);
  toast('主题：' + THEME_LABELS[next], 'info', 1300);
}

/* ============================================================
   User menu / logout / settings
   ============================================================ */
function openUserMenu() {
  const u = App.state.user;
  if (!u) { navigate('/login'); return; }
  const body = el('div', { class: 'col', style: { gap: '14px', alignItems: 'center', textAlign: 'center' } }, [
    el('div', { class: 'avatar', style: { width: '64px', height: '64px', fontSize: '26px', background: u.avatar_color || 'var(--primary)' } },
      [(u.display_name || u.username || '?').slice(0, 1).toUpperCase()]),
    el('div', {}, [
      el('div', { style: { fontWeight: '700', fontSize: '17px' }, text: u.display_name || u.username }),
      el('div', { class: 'faint', text: '@' + u.username + ' · ' + (u.role === 'admin' ? '管理员' : u.role) }),
    ]),
  ]);
  const settingsBtn = el('button', { class: 'btn btn-block', text: '设置' });
  const logoutBtn = el('button', { class: 'btn btn-danger btn-block', text: '退出登录' });
  const m = openModal({ title: '账户', body, actions: [el('div', { class: 'grow' }), settingsBtn, logoutBtn] });
  settingsBtn.onclick = () => { m.close(); navigate('/settings'); };
  logoutBtn.onclick = () => { m.close(); logout(); };
}

async function logout() {
  try { await api.post('/api/v1/auth/logout'); } catch {}
  App.state.user = null;
  setCsrf(null);
  navigate('/login');
}

function renderSettings() {
  const wrap = el('div', { class: 'col', style: { gap: '20px', maxWidth: '640px' } });

  // Appearance
  const themeChips = ['light', 'dark', 'system'].map((t) => {
    const b = el('button', {
      class: 'chip' + (localStorage.getItem('dml-theme') === t ? ' on' : ''),
      type: 'button',
      onclick: () => {
        setTheme(t);
        themeChips.forEach((x, i) => x.classList.toggle('on', ['light', 'dark', 'system'][i] === t));
      },
    }, [icon(t === 'light' ? 'sun' : t === 'dark' ? 'moon' : 'monitor', { size: 16 }), el('span', { text: THEME_LABELS[t] })]);
    return b;
  });
  const appearance = el('div', { class: 'card' }, [
    el('div', { class: 'card-title' }, [icon('sun', { size: 18 }), el('span', { text: '外观' })]),
    el('div', { class: 'row', style: { gap: '8px' } }, themeChips),
  ]);
  wrap.appendChild(appearance);

  // Account / password
  const u = App.state.user || {};
  const cur = input({ type: 'password', placeholder: '当前密码', autocomplete: 'current-password' });
  const npw = input({ type: 'password', placeholder: '新密码（至少 8 位）', autocomplete: 'new-password' });
  const npw2 = input({ type: 'password', placeholder: '确认新密码', autocomplete: 'new-password' });
  const errB = el('div', { class: 'badge badge-danger', style: { display: 'none' } });
  const saveBtn = el('button', { class: 'btn btn-primary', text: '更新密码' });
  const account = el('div', { class: 'card' }, [
    el('div', { class: 'card-title' }, [icon('lock', { size: 18 }), el('span', { text: '账户' })]),
    el('div', { class: 'muted tiny mb-3', text: '用户名：' + (u.username || '-') + '　·　显示名：' + (u.display_name || '-') }),
    errB,
    field('当前密码', cur),
    field('新密码', npw),
    field('确认新密码', npw2),
    saveBtn,
  ]);
  saveBtn.onclick = async () => {
    errB.style.display = 'none';
    if (npw.value.length < 8) { errB.textContent = '新密码至少 8 位'; errB.style.display = 'inline-flex'; return; }
    if (npw.value !== npw2.value) { errB.textContent = '两次新密码不一致'; errB.style.display = 'inline-flex'; return; }
    saveBtn.disabled = true;
    try {
      await api.patch('/api/v1/auth/me/password', { current_password: cur.value, new_password: npw.value });
      toast('密码已更新', 'success');
      cur.value = npw.value = npw2.value = '';
    } catch (e) { errB.textContent = e.message; errB.style.display = 'inline-flex'; }
    saveBtn.disabled = false;
  };
  wrap.appendChild(account);

  // About
  const about = el('div', { class: 'card' }, [
    el('div', { class: 'card-title' }, [icon('info', { size: 18 }), el('span', { text: '关于' })]),
    el('div', { class: 'muted tiny' }, [
      el('div', { text: '应用：' + (App.state.version?.app_name || 'DM Life') }),
      el('div', { text: '版本：' + (App.state.version?.version || '-') }),
      el('div', { text: '架构：Yuvomi 单体 Express + 原生 SQLite + 零构建前端' }),
    ]),
  ]);
  wrap.appendChild(about);

  return wrap;
}
