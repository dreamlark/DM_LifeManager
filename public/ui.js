/**
 * ui.js — DOM helpers, icon set, toasts, modals, form builders.
 * Everything is built with createElement (no innerHTML for user data → XSS-safe).
 * Icons are inline SVG (CSP: imgSrc allows self/data, but SVG-in-DOM avoids any img fetch).
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICONS = {
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M16 12h.01"/><path d="M21 9v6"/>',
  balance: '<path d="M12 3v18"/><path d="M5 7h14"/><path d="M5 7l-3 6h6z"/><path d="M19 7l-3 6h6z"/><path d="M8 21h8"/>',
  note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h8M8 9h2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  activity: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  menu: '<path d="M3 12h18M3 6h18M3 18h18"/>',
  chevronLeft: '<path d="M15 18l-6-6 6-6"/>',
  chevronRight: '<path d="M9 18l6-6-6-6"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  dollar: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  trendingUp: '<path d="M3 17l6-6 4 4 8-8"/><path d="M17 7h4v4"/>',
  pie: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  layers: '<path d="M12 2 2 7l10 5 10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  sparkles: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><path d="M6.5 6.5 8 8M16 16l1.5 1.5M17.5 6.5 16 8M8 16l-1.5 1.5"/>',
  box: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  clock2: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  droplet: '<path d="M12 2.5S5 10 5 14a7 7 0 0 0 14 0c0-4-7-11.5-7-11.5z"/>',
  flame: '<path d="M12 2s4 4 4 8a4 4 0 0 1-8 0c0-1 .5-2 1-3-2 1-3 3-3 5a6 6 0 0 0 12 0c0-5-6-10-6-10z"/>',
  heart: '<path d="M19 14c1.5-1.5 3-3.3 3-5.5A4.5 4.5 0 0 0 12 6 4.5 4.5 0 0 0 2 8.5c0 2.2 1.5 4 3 5.5l7 7z"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M16 8l-2 6-6 2 2-6z"/>',
};

export function icon(name, opts = {}) {
  const size = opts.size || 20;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(opts.stroke || 2));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (opts.cls) svg.setAttribute('class', opts.cls);
  if (opts.fill) { svg.setAttribute('fill', 'currentColor'); svg.setAttribute('stroke', 'none'); }
  svg.innerHTML = ICONS[name] || ICONS.box;
  return svg;
}

/** Create an element. attrs: class|text|html|dataset|style|on* | value|checked | others→setAttribute. */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' && (tag === 'input' || tag === 'textarea' || tag === 'select')) node.value = v;
    else if (k === 'checked' && tag === 'input') node.checked = !!v;
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  append(node, children);
  return node;
}

function append(node, children) {
  if (children == null) return;
  if (Array.isArray(children)) { children.forEach((c) => append(node, c)); return; }
  if (typeof children === 'string' || typeof children === 'number') { node.appendChild(document.createTextNode(String(children))); return; }
  if (children instanceof Node) { node.appendChild(children); return; }
}

/* ---------- Toast ---------- */
export function toast(message, type = 'info', timeout = 3200) {
  const root = document.getElementById('toast-root');
  if (!root) return null;
  const icoName = type === 'success' ? 'check' : type === 'error' ? 'alert' : 'info';
  const node = el('div', { class: 'toast ' + type }, [icon(icoName, { size: 18, cls: 'ic' }), el('span', { text: message })]);
  root.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(10px)';
    node.style.transition = '200ms';
    setTimeout(() => node.remove(), 220);
  }, timeout);
  return node;
}

/* ---------- Modal ---------- */
export function openModal({ title, body, actions, wide }) {
  const root = document.getElementById('modal-root');
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey); };
  const modal = el('div', { class: 'modal' + (wide ? ' wide' : '') }, [
    el('div', { class: 'modal-head' }, [
      el('h3', { text: title || '' }),
      el('button', { class: 'icon-btn btn-icon', 'aria-label': '关闭', onclick: close }, [icon('x', { size: 18 })]),
    ]),
    el('div', { class: 'modal-body' }, [body]),
  ]);
  if (actions && actions.length) modal.appendChild(el('div', { class: 'row mt-5 between' }, actions));
  const backdrop = el('div', { class: 'modal-root' }, [el('div', { class: 'modal-backdrop', onclick: close }), modal]);
  root.appendChild(backdrop);
  document.addEventListener('keydown', onKey);
  return { close, modal };
}

export function confirmDialog({ title, message, danger, confirmText = '确定', cancelText = '取消' }) {
  return new Promise((resolve) => {
    const yes = el('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), text: confirmText });
    const no = el('button', { class: 'btn', text: cancelText });
    const m = openModal({
      title,
      body: el('p', { class: 'muted', style: { margin: '0', lineHeight: '1.6' }, text: message }),
      actions: [el('div', { class: 'grow' }), no, yes],
    });
    yes.onclick = () => { m.close(); resolve(true); };
    no.onclick = () => { m.close(); resolve(false); };
  });
}

/* ---------- Form helpers ---------- */
export function field(labelText, control) {
  return el('div', { class: 'field' }, [el('label', { text: labelText }), control]);
}
export function input(attrs = {}) { return el('input', Object.assign({ class: 'input' }, attrs)); }
export function textarea(attrs = {}) { return el('textarea', Object.assign({ class: 'textarea' }, attrs)); }
export function select(options, attrs = {}) {
  const value = attrs.value;
  const a = Object.assign({}, attrs); delete a.value;
  const sel = el('select', Object.assign({ class: 'select' }, a));
  for (const o of options) {
    const opt = el('option', { value: o.value }, [o.label]);
    if (o.value === value) opt.selected = true;
    sel.appendChild(opt);
  }
  if (value != null) sel.value = value;
  return sel;
}

/** Toggle chip group. options: [{value,label}]; returns {node, get, set}. */
export function chipGroup(options, initial) {
  let current = initial;
  const node = el('div', { class: 'choice-row' });
  const btns = options.map((o) => {
    const b = el('button', { class: 'chip' + (o.value === current ? ' on' : ''), type: 'button', text: o.label });
    b.onclick = () => {
      current = o.value;
      btns.forEach((x) => x.classList.toggle('on', x.textContent === o.label));
    };
    node.appendChild(b);
    return b;
  });
  return {
    node,
    get: () => current,
    set: (v) => { current = v; btns.forEach((x, i) => x.classList.toggle('on', options[i].value === v)); },
  };
}

/* ---------- Money ---------- */
const CUR = { CNY: '¥', USD: '$', EUR: '€', JPY: '¥', GBP: '£' };
export function formatMoney(n, currency = 'CNY') {
  const num = Number(n) || 0;
  const sym = CUR[currency] || (currency + ' ');
  const s = Math.abs(num).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (num < 0 ? '-' : '') + sym + s;
}

/* ---------- States ---------- */
export function spinner(size) { return el('div', { class: 'spinner' + (size === 'sm' ? ' sm' : '') }); }
export function loadingCenter() { return el('div', { class: 'loading-center' }, [spinner()]); }
export function emptyState(text, iconName = 'box') {
  return el('div', { class: 'empty-state' }, [icon(iconName, { size: 46, cls: 'es-ico' }), el('div', { text })]);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
