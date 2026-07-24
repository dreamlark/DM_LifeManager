/**
 * 心流 (Focus / Flow) — 前端页面
 * 专注时段记录 + 每日汇总（次数 / 时长 / 平均评分）。
 */
import {
  el, icon, toast, openModal, confirmDialog, emptyState, loadingCenter,
  input, textarea, select, field, formatMoney,
} from '/ui.js';

const API = '/api/v1/focus';
const ATTENTION = [{ value: 'deep', label: '深度' }, { value: 'normal', label: '普通' }, { value: 'light', label: '轻量' }];

function fmtMin(m) {
  if (m < 60) return m + ' 分钟';
  const h = Math.floor(m / 60), mm = m % 60;
  return h + ' 小时' + (mm ? ' ' + mm + ' 分' : '');
}

export default function render(App) {
  const { api } = App;
  const container = el('div', { class: 'col', style: { gap: '20px' } });
  const today = new Date().toISOString().slice(0, 10);
  let focusDate = today;
  let domains = [];

  const dateInput = input({ type: 'date', value: focusDate, style: { width: 'auto' } });
  dateInput.onchange = () => { focusDate = dateInput.value || today; load(); };
  const head = el('div', { class: 'row between' }, [
    el('div', { class: 'row' }, [icon('activity', { size: 18 }), el('div', { class: 'card-title', style: { margin: 0 }, text: '心流' }), dateInput]),
    el('button', { class: 'btn btn-primary btn-sm', onclick: () => openSessionModal(null) }, [icon('plus', { size: 16 }), el('span', { text: '记录专注' })]),
  ]);
  const statsEl = el('div', { class: 'grid grid-3' });
  const listEl = el('div', { class: 'col', style: { gap: '12px' } });
  container.append(head, statsEl, el('div', { class: 'card' }, [el('div', { class: 'card-title' }, [icon('list', { size: 18 }), el('span', { text: '专注记录' })]), listEl]));

  api.get('/api/v1/daily-board/domains').then((r) => { domains = r.data || []; }).catch(() => {});

  async function load() {
    statsEl.innerHTML = ''; statsEl.appendChild(loadingCenter());
    listEl.innerHTML = ''; listEl.appendChild(loadingCenter());
    try {
      const [sum, sess] = await Promise.all([
        api.get(API + '/summary?date=' + focusDate),
        api.get(API + '/sessions?date=' + focusDate),
      ]);
      const d = sum.data;
      statsEl.innerHTML = '';
      statsEl.append(
        statCard('专注次数', String(d.sessions)),
        statCard('总时长', fmtMin(d.totalMinutes)),
        statCard('平均评分', String(d.avgScore)),
      );
      const list = sess.data || [];
      listEl.innerHTML = '';
      if (!list.length) { listEl.appendChild(emptyState('今天还没有专注记录', 'activity')); return; }
      list.forEach((s) => {
        const dom = domains.find((x) => x.key === s.domain_key);
        const att = (ATTENTION.find((a) => a.value === s.attention_type) || {}).label || s.attention_type;
        const start = (s.started_at || '').slice(11, 16), end = (s.ended_at || '').slice(11, 16);
        listEl.appendChild(el('div', { class: 'list-item' }, [
          el('span', { class: 'dot', style: { background: dom ? dom.color : 'var(--primary)' } }),
          el('div', { class: 'li-main' }, [
            el('div', { class: 'li-title', text: (start + ' – ' + end) + (dom ? ' · ' + dom.name : '') }),
            el('div', { class: 'li-sub', text: att + (s.score != null ? ' · 评分 ' + s.score : '') + (s.note ? ' · ' + s.note : '') }),
          ]),
          el('button', { class: 'icon-btn btn-icon', onclick: () => del(s) }, [icon('trash', { size: 15 })]),
        ]));
      });
    } catch (e) {
      statsEl.innerHTML = ''; statsEl.appendChild(emptyState('加载失败：' + e.message, 'alert'));
      listEl.innerHTML = '';
    }
  }

  function statCard(label, value) {
    return el('div', { class: 'stat' }, [el('div', { class: 'stat-label', text: label }), el('div', { class: 'stat-value', text: value })]);
  }

  function openSessionModal(s) {
    const isEdit = !!s;
    const start = input({ type: 'datetime-local', value: s ? s.started_at.slice(0, 16) : (focusDate + 'T09:00') });
    const end = input({ type: 'datetime-local', value: s ? s.ended_at.slice(0, 16) : (focusDate + 'T09:25') });
    const att = select(ATTENTION, { value: s ? s.attention_type : 'deep' });
    const domOpts = [{ value: '', label: '（无领域）' }].concat(domains.map((d) => ({ value: d.key, label: d.name })));
    const domSel = select(domOpts, { value: s && s.domain_key ? s.domain_key : '' });
    const score = input({ type: 'number', min: '1', max: '10', placeholder: '1-10（可选）', value: s && s.score != null ? s.score : '' });
    const note = textarea({ placeholder: '备注（可选）' }); note.value = s ? s.note || '' : '';
    const errB = el('div', { class: 'badge badge-danger', style: { display: 'none' } });
    const form = el('div', {}, [
      errB,
      el('div', { class: 'grid grid-2' }, [field('开始', start), field('结束', end)]),
      el('div', { class: 'grid grid-2' }, [field('注意力类型', att), field('领域', domSel)]),
      field('评分 (1-10)', score), field('备注', note),
    ]);
    const save = el('button', { class: 'btn btn-primary', text: isEdit ? '保存' : '记录' });
    const m = openModal({ title: isEdit ? '编辑专注' : '记录专注', body: form, actions: [el('div', { class: 'grow' }), save] });
    save.onclick = async () => {
      errB.style.display = 'none';
      const payload = {
        started_at: start.value ? start.value + ':00' : null,
        ended_at: end.value ? end.value + ':00' : null,
        attention_type: att.value,
        domain_key: domSel.value || null,
        score: score.value === '' ? null : Number(score.value),
        note: note.value,
      };
      save.disabled = true;
      try {
        if (isEdit) await api.put(API + '/sessions/' + s.id, payload).catch(() => {});
        else await api.post(API + '/sessions', payload);
        toast('已记录', 'success'); m.close(); load();
      } catch (e) { errB.textContent = e.message; errB.style.display = 'inline-flex'; save.disabled = false; }
    };
  }

  function del(s) {
    confirmDialog({ title: '删除', message: '确定删除这条专注记录？', danger: true, confirmText: '删除' }).then((ok) => {
      if (!ok) return;
      api.del(API + '/sessions/' + s.id).then(() => { toast('已删除', 'success'); load(); }).catch((e) => toast(e.message, 'error'));
    });
  }

  load();
  return container;
}
