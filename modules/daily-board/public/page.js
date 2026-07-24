/**
 * 每日看板 (Daily Board) — P0 前端页面
 * MIT / 四象限 / 时间块 / 今日回顾 / 任务增删改。
 */
import {
  el, icon, toast, openModal, confirmDialog, emptyState, loadingCenter,
  input, textarea, select, field, chipGroup,
} from '/ui.js';

const API = '/api/v1/daily-board';

function addDays(str, n) {
  const d = new Date(str + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function render(App) {
  const { api } = App;
  const today = new Date().toISOString().slice(0, 10);
  let boardDate = today;
  let domains = [];

  const container = el('div', { class: 'col', style: { gap: '20px' } });

  // ---------- Toolbar ----------
  const dateInput = input({ type: 'date', value: boardDate, style: { width: 'auto' } });
  dateInput.onchange = () => { boardDate = dateInput.value || today; load(); };
  const prevBtn = el('button', { class: 'icon-btn btn-icon', 'aria-label': '前一天', onclick: () => shiftDate(-1) }, [icon('chevronLeft', { size: 18 })]);
  const nextBtn = el('button', { class: 'icon-btn btn-icon', 'aria-label': '后一天', onclick: () => shiftDate(1) }, [icon('chevronRight', { size: 18 })]);
  const todayBtn = el('button', { class: 'btn btn-sm', text: '今天', onclick: () => { boardDate = today; dateInput.value = boardDate; load(); } });
  const ensureBtn = el('button', { class: 'btn btn-sm', onclick: ensureDaily }, [icon('refresh', { size: 16 }), el('span', { text: '实例化每日' })]);
  const addBtn = el('button', { class: 'btn btn-primary', onclick: () => openTaskModal(null) }, [icon('plus', { size: 18 }), el('span', { text: '添加任务' })]);

  container.appendChild(el('div', { class: 'card card-pad-sm' }, [
    el('div', { class: 'row row-wrap between' }, [
      el('div', { class: 'row' }, [prevBtn, dateInput, nextBtn, todayBtn]),
      el('div', { class: 'row' }, [ensureBtn, addBtn]),
    ]),
  ]));

  const statsEl = el('div', { class: 'grid grid-4' });
  container.appendChild(statsEl);

  const board = el('div', { class: 'grid', style: { gridTemplateColumns: 'minmax(0, 420px) 1fr' } });
  const mitCard = el('div', { class: 'card' });
  const quadCard = el('div', { class: 'card' });
  board.append(mitCard, quadCard);
  container.appendChild(board);

  const tbCard = el('div', { class: 'card' });
  container.appendChild(tbCard);

  function shiftDate(n) {
    boardDate = addDays(boardDate, n);
    dateInput.value = boardDate;
    load();
  }

  async function ensureDaily() {
    try {
      const r = await api.post(API + '/ensure-daily', { date: boardDate });
      toast(r.created > 0 ? `已实例化 ${r.created} 个每日例行` : '没有新的每日例行', 'info');
      load();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ---------- Loading ----------
  async function load() {
    statsEl.innerHTML = ''; statsEl.appendChild(loadingCenter());
    mitCard.innerHTML = ''; mitCard.appendChild(loadingCenter());
    quadCard.innerHTML = ''; quadCard.appendChild(loadingCenter());
    tbCard.innerHTML = ''; tbCard.appendChild(loadingCenter());
    try {
      const [tasksR, quadR, mitR, tbR, revR, domR] = await Promise.all([
        api.get(API + '/tasks?date=' + boardDate),
        api.get(API + '/quadrant?date=' + boardDate),
        api.get(API + '/mit?date=' + boardDate),
        api.get(API + '/timeblocks?date=' + boardDate),
        api.get(API + '/review?date=' + boardDate),
        api.get(API + '/domains'),
      ]);
      domains = domR.data || [];
      renderStats(revR.data);
      renderMIT(mitR.data);
      renderQuadrant(quadR.data);
      renderTimeblocks(tbR.data);
    } catch (e) {
      toast('加载失败：' + e.message, 'error');
      statsEl.innerHTML = ''; mitCard.innerHTML = ''; quadCard.innerHTML = ''; tbCard.innerHTML = '';
    }
  }

  // ---------- Stats ----------
  function statCard(label, value) {
    return el('div', { class: 'stat' }, [
      el('div', { class: 'stat-label', text: label }),
      el('div', { class: 'stat-value', text: value }),
    ]);
  }
  function renderStats(d) {
    statsEl.innerHTML = '';
    statsEl.append(
      statCard('完成率', d.completionRate + '%'),
      statCard('任务', `${d.done} / ${d.total}`),
      statCard('MIT', `${d.mitDone} / ${d.mit}`),
      statCard('专注', `${d.focusSessions} 次`),
    );
  }

  // ---------- Task row ----------
  function taskRow(task) {
    const done = task.status === 'done';
    const check = el('div', { class: 'check' + (done ? ' on' : ''), onclick: (e) => { e.stopPropagation(); toggleStatus(task); } },
      done ? [icon('check', { size: 13 })] : []);
    const domain = domains.find((d) => d.key === task.domain_key);
    const dot = el('span', { class: 'dot', style: { background: domain ? domain.color : 'var(--border-strong)' } });
    const title = el('div', { class: 'task-title', text: task.title });
    const row = el('div', { class: 'task' + (done ? ' done' : '') }, [check, dot, title]);
    if (done) row.appendChild(starRow(task));
    row.onclick = () => openTaskModal(task);
    return row;
  }

  function starRow(task) {
    const wrap = el('div', { class: 'stars' });
    const q = task.completion_quality || 0;
    for (let i = 1; i <= 5; i++) {
      wrap.appendChild(el('span', { class: 'star' + (i <= q ? ' on' : ''), onclick: (e) => { e.stopPropagation(); setQuality(task, i); } },
        [icon('star', { size: 15, fill: i <= q })]));
    }
    return wrap;
  }

  async function toggleStatus(task) {
    const newStatus = task.status === 'done' ? 'todo' : 'done';
    try {
      await api.patch(API + '/tasks/' + task.id + '/status', {
        status: newStatus,
        completion_quality: newStatus === 'done' ? (task.completion_quality || null) : null,
      });
      load();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function setQuality(task, q) {
    try {
      await api.patch(API + '/tasks/' + task.id + '/status', { status: 'done', completion_quality: q });
      load();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ---------- MIT ----------
  function renderMIT(list) {
    mitCard.innerHTML = '';
    mitCard.append(el('div', { class: 'card-title' }, [
      icon('target', { size: 18 }), el('span', { text: '今日最重要 (MIT)' }),
      el('span', { class: 'badge', text: list.length }),
    ]));
    if (!list.length) { mitCard.append(emptyState('还没有标记最重要的事', 'target')); return; }
    const body = el('div', { class: 'q-body' });
    list.forEach((t) => body.appendChild(taskRow(t)));
    mitCard.append(body);
  }

  // ---------- Quadrant ----------
  function renderQuadrant(q) {
    quadCard.innerHTML = '';
    quadCard.append(el('div', { class: 'card-title' }, [icon('layers', { size: 18 }), el('span', { text: '四象限' })]));
    const grid = el('div', { class: 'quadrant' });
    const cells = [
      { cls: 'q1', title: '重要 & 紧急', list: q.q1 },
      { cls: 'q2', title: '重要 & 不紧急', list: q.q2 },
      { cls: 'q3', title: '紧急 & 不重要', list: q.q3 },
      { cls: 'q4', title: '其他', list: q.q4 },
    ];
    cells.forEach((c) => {
      const body = el('div', { class: 'q-body' });
      if (c.list.length) c.list.forEach((t) => body.appendChild(taskRow(t)));
      else body.appendChild(el('div', { class: 'faint tiny', text: '—' }));
      grid.appendChild(el('div', { class: 'q-cell ' + c.cls }, [el('h4', { text: c.title }), body]));
    });
    quadCard.append(grid);
  }

  // ---------- Time blocks ----------
  function renderTimeblocks(list) {
    tbCard.innerHTML = '';
    tbCard.append(el('div', { class: 'card-title' }, [
      icon('clock', { size: 18 }), el('span', { text: '时间块' }),
      el('span', { class: 'badge', text: list.length }),
    ]));
    if (!list.length) { tbCard.append(emptyState('今天没有安排时间块', 'clock')); return; }
    const body = el('div', { class: 'list' });
    list.forEach((t) => {
      const tm = (t.scheduled_start || '').slice(11, 16);
      const tm2 = (t.scheduled_end || '').slice(11, 16);
      const domain = domains.find((d) => d.key === t.domain_key);
      body.appendChild(el('div', { class: 'list-item' }, [
        el('span', { class: 'dot', style: { background: domain ? domain.color : 'var(--border-strong)' } }),
        el('div', { class: 'li-main' }, [
          el('div', { class: 'li-title', text: t.title }),
          el('div', { class: 'li-sub', text: (tm || '—') + (tm2 ? ' – ' + tm2 : '') }),
        ]),
        el('button', { class: 'icon-btn btn-icon', onclick: (e) => { e.stopPropagation(); openTaskModal(t); } }, [icon('edit', { size: 16 })]),
      ]));
    });
    tbCard.append(body);
  }

  // ---------- Task modal ----------
  function openTaskModal(task) {
    const isEdit = !!task;
    const domOpts = [{ value: 'general', label: '通用' }].concat((domains || []).map((d) => ({ value: d.key, label: d.name })));
    const domSel = select(domOpts, { value: task ? (task.domain_key || 'general') : 'general' });
    const titleIn = input({ placeholder: '任务标题', value: task ? task.title : '' });
    const imp = chipGroup([{ value: true, label: '重要' }, { value: false, label: '不重要' }], task ? !!task.importance : false);
    const urg = chipGroup([{ value: true, label: '紧急' }, { value: false, label: '不紧急' }], task ? !!task.urgency : false);
    const mit = chipGroup([{ value: true, label: '是 MIT' }, { value: false, label: '否' }], task ? !!task.is_mit : false);
    const prio = select([{ value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }], { value: task ? (task.priority || 'medium') : 'medium' });
    const startT = input({ type: 'time', value: task && task.scheduled_start ? task.scheduled_start.slice(11, 16) : '' });
    const endT = input({ type: 'time', value: task && task.scheduled_end ? task.scheduled_end.slice(11, 16) : '' });
    const dueD = input({ type: 'date', value: task && task.due_at ? task.due_at.slice(0, 10) : '' });
    const rep = select([{ value: 'none', label: '不重复' }, { value: 'daily', label: '每天（每日例行）' }, { value: 'weekly', label: '每周' }, { value: 'monthly', label: '每月' }], { value: task ? (task.repeat || 'none') : 'none' });
    const desc = textarea({ placeholder: '描述（可选）' }); desc.value = task ? (task.description || '') : '';
    const errB = el('div', { class: 'badge badge-danger', style: { display: 'none' } });

    const body = el('div', {}, [
      errB,
      field('标题', titleIn),
      field('领域', domSel),
      el('div', { class: 'grid grid-2' }, [field('重要度', imp.node), field('紧急度', urg.node)]),
      field('今日最重要', mit.node),
      el('div', { class: 'grid grid-2' }, [field('优先级', prio), field('重复', rep)]),
      el('div', { class: 'grid grid-2' }, [field('开始时间', startT), field('结束时间', endT)]),
      field('截止日期', dueD),
      field('描述', desc),
    ]);

    const saveBtn = el('button', { class: 'btn btn-primary', text: isEdit ? '保存' : '添加' });
    const actions = [el('div', { class: 'grow' })];
    if (isEdit) {
      const del = el('button', { class: 'btn btn-danger', text: '删除' });
      del.onclick = async () => {
        if (await confirmDialog({ title: '删除任务', message: '确定删除「' + task.title + '」？', danger: true, confirmText: '删除' })) {
          try { await api.del(API + '/tasks/' + task.id); toast('已删除', 'success'); m.close(); load(); }
          catch (e) { toast(e.message, 'error'); }
        }
      };
      actions.push(del);
    }
    actions.push(saveBtn);
    const m = openModal({ title: isEdit ? '编辑任务' : '添加任务', body, actions, wide: true });

    saveBtn.onclick = async () => {
      errB.style.display = 'none';
      const title = titleIn.value.trim();
      if (!title) { errB.textContent = '请输入标题'; errB.style.display = 'inline-flex'; return; }
      const payload = {
        title,
        domain_key: domSel.value,
        importance: imp.get() ? 1 : 0,
        urgency: urg.get() ? 1 : 0,
        is_mit: mit.get() ? 1 : 0,
        priority: prio.value,
        repeat: rep.value,
        task_date: boardDate,
        description: desc.value,
        scheduled_start: startT.value ? boardDate + 'T' + startT.value + ':00' : null,
        scheduled_end: endT.value ? boardDate + 'T' + endT.value + ':00' : null,
        due_at: dueD.value ? dueD.value + 'T00:00:00' : null,
      };
      saveBtn.disabled = true;
      try {
        if (isEdit) await api.put(API + '/tasks/' + task.id, payload);
        else await api.post(API + '/tasks', payload);
        toast(isEdit ? '已保存' : '已添加', 'success');
        m.close(); load();
      } catch (e) { errB.textContent = e.message; errB.style.display = 'inline-flex'; saveBtn.disabled = false; }
    };
  }

  load();
  return container;
}
