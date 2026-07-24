/**
 * 提醒钟表铺 (Reminder Clocks) — 前端页面
 * 非日常周期提醒 + 提前链 + 逾期标记 + 完成自动顺延。
 */
import {
  el, icon, toast, openModal, confirmDialog, emptyState, loadingCenter,
  input, select, field,
} from '/ui.js';

const API = '/api/v1/reminders';

const PERIODS = [
  { value: 'days:1', label: '每天' },
  { value: 'days:7', label: '每周' },
  { value: 'months:1', label: '每月' },
  { value: 'months:3', label: '每 3 个月' },
  { value: 'months:6', label: '每 6 个月' },
  { value: 'years:1', label: '每年' },
];

function periodLabel(rule) {
  const m = PERIODS.find((p) => p.value === rule);
  return m ? m.label : rule;
}

export default function render(App) {
  const { api } = App;
  const container = el('div', { class: 'col', style: { gap: '20px' } });
  let domains = [];

  const head = el('div', { class: 'row between' }, [
    el('div', { class: 'card-title', style: { margin: 0 } }, [icon('clock', { size: 18 }), el('span', { text: '提醒钟表铺' })]),
    el('button', { class: 'btn btn-primary btn-sm', onclick: () => openModalReminder(null) }, [icon('plus', { size: 16 }), el('span', { text: '新建提醒' })]),
  ]);
  const listEl = el('div', { class: 'col', style: { gap: '12px' } });
  container.append(head, listEl);

  api.get('/api/v1/daily-board/domains').then((r) => { domains = r.data || []; }).catch(() => {});

  async function load() {
    listEl.innerHTML = ''; listEl.appendChild(loadingCenter());
    try {
      const list = (await api.get(API + '/reminders')).data;
      listEl.innerHTML = '';
      if (!list.length) { listEl.appendChild(emptyState('还没有周期提醒', 'clock')); return; }
      list.forEach((r) => {
        const overdue = r.is_overdue;
        const dom = domains.find((d) => d.key === r.domain_key);
        const card = el('div', { class: 'card' + (overdue ? '' : '') }, [
          el('div', { class: 'row between' }, [
            el('div', { class: 'row' }, [
              el('span', { class: 'dot', style: { background: dom ? dom.color : 'var(--border-strong)' } }),
              el('div', { class: 'li-title', text: r.title }),
            ]),
            overdue ? el('span', { class: 'badge badge-danger', text: '已逾期' }) : el('span', { class: 'badge badge-info', text: '待办' }),
          ]),
          el('div', { class: 'li-sub mt-2', text: periodLabel(r.period_rule) + ' · 下次：' + r.next_fire_at }),
          el('div', { class: 'row mt-3' }, [
            el('button', { class: 'btn btn-sm btn-primary', onclick: () => complete(r) }, [icon('check', { size: 15 }), el('span', { text: '完成并顺延' })]),
            el('button', { class: 'btn btn-sm', onclick: () => openModalReminder(r) }, [icon('edit', { size: 15 }), el('span', { text: '编辑' })]),
            el('button', { class: 'btn btn-sm btn-danger', onclick: () => del(r) }, [icon('trash', { size: 15 })]),
          ]),
        ]);
        listEl.appendChild(card);
      });
    } catch (e) { listEl.innerHTML = ''; listEl.appendChild(emptyState('加载失败：' + e.message, 'alert')); }
  }

  function complete(r) {
    api.patch(API + '/reminders/' + r.id + '/complete').then(() => { toast('已顺延至下一周期', 'success'); load(); }).catch((e) => toast(e.message, 'error'));
  }

  function openModalReminder(r) {
    const isEdit = !!r;
    const title = input({ placeholder: '提醒事项', value: r ? r.title : '' });
    const domOpts = [{ value: 'general', label: '通用' }].concat(domains.map((d) => ({ value: d.key, label: d.name })));
    const domSel = select(domOpts, { value: r ? r.domain_key : 'general' });
    const period = select(PERIODS, { value: r ? r.period_rule : 'months:1' });
    const next = input({ type: 'date', value: r ? r.next_fire_at.slice(0, 10) : new Date().toISOString().slice(0, 10) });
    const errB = el('div', { class: 'badge badge-danger', style: { display: 'none' } });
    const form = el('div', {}, [
      errB, field('事项', title),
      el('div', { class: 'grid grid-2' }, [field('领域', domSel), field('周期', period)]),
      field('下次提醒日期', next),
    ]);
    const save = el('button', { class: 'btn btn-primary', text: isEdit ? '保存' : '创建' });
    const m = openModal({ title: isEdit ? '编辑提醒' : '新建提醒', body: form, actions: [el('div', { class: 'grow' }), save] });
    save.onclick = async () => {
      errB.style.display = 'none';
      if (!title.value.trim()) { errB.textContent = '请输入事项'; errB.style.display = 'inline-flex'; return; }
      const payload = { title: title.value.trim(), domain_key: domSel.value, period_rule: period.value, next_fire_at: next.value };
      save.disabled = true;
      try {
        if (isEdit) await api.put(API + '/reminders/' + r.id, payload);
        else await api.post(API + '/reminders', payload);
        toast('已保存', 'success'); m.close(); load();
      } catch (e) { errB.textContent = e.message; errB.style.display = 'inline-flex'; save.disabled = false; }
    };
  }

  function del(r) {
    confirmDialog({ title: '删除', message: '确定删除「' + r.title + '」？', danger: true, confirmText: '删除' }).then((ok) => {
      if (!ok) return;
      api.del(API + '/reminders/' + r.id).then(() => { toast('已删除', 'success'); load(); }).catch((e) => toast(e.message, 'error'));
    });
  }

  load();
  return container;
}
