/**
 * 财务 (Finance) — P1 前端页面
 * 概览 / 债务 / 收入 / 流水 / 资产 / 预算 六个标签页。
 */
import {
  el, icon, toast, openModal, confirmDialog, emptyState, loadingCenter,
  input, textarea, select, field, formatMoney,
} from '/ui.js';

const API = '/api/v1/finance';
const CUR = ['CNY', 'USD', 'EUR', 'JPY', 'GBP'];
const DEBT_TYPES = ['credit', 'loan', 'mortgage', 'other'];
const REPAY = ['equal_installment', 'equal_principal', 'interest_only', 'bullet'];
const ASSET_CLASSES = ['cash', 'investment', 'property', 'other', 'fixed_asset', 'income_source'];
const INCOME_TYPES = ['salary', 'bonus', 'investment', 'business', 'other'];
const INCOME_MODES = ['monthly', 'yearly', 'one_time'];

function money(n, cur) { return formatMoney(n, cur || 'CNY'); }
function statusBadge(s) {
  const map = { active: ['badge-info', '进行中'], paid: ['badge-success', '已结清'], frozen: ['badge-warning', '冻结'] };
  const [cls, label] = map[s] || ['badge', s];
  return el('span', { class: 'badge ' + cls, text: label });
}

export default function render(App) {
  const { api } = App;
  const container = el('div', { class: 'col', style: { gap: '20px' } });
  const tabsEl = el('div', { class: 'tabs' });
  const content = el('div', { class: 'col', style: { gap: '16px' } });
  container.append(tabsEl, content);

  const TABS = [
    { key: 'summary', label: '概览' },
    { key: 'debts', label: '债务' },
    { key: 'incomes', label: '收入' },
    { key: 'txns', label: '流水' },
    { key: 'assets', label: '资产' },
    { key: 'budgets', label: '预算' },
  ];
  let active = 'summary';

  const tabEls = {};
  TABS.forEach((t) => {
    const b = el('div', { class: 'tab' + (t.key === active ? ' active' : ''), text: t.label, onclick: () => switchTab(t.key) });
    tabEls[t.key] = b;
    tabsEl.appendChild(b);
  });

  function switchTab(key) {
    active = key;
    TABS.forEach((t) => tabEls[t.key].classList.toggle('active', t.key === key));
    renderTab();
  }

  function renderTab() {
    content.innerHTML = '';
    if (active === 'summary') return renderSummary();
    if (active === 'debts') return renderDebts();
    if (active === 'incomes') return renderIncomes();
    if (active === 'txns') return renderTxns();
    if (active === 'assets') return renderAssets();
    if (active === 'budgets') return renderBudgets();
  }

  // ---------- Summary ----------
  async function renderSummary() {
    content.appendChild(loadingCenter());
    try {
      const s = (await api.get(API + '/summary')).data;
      content.innerHTML = '';
      const stats = el('div', { class: 'grid grid-3' });
      const cards = [
        ['净资产', money(s.netWorth), 'trendingUp'],
        ['总债务', money(s.totalDebt), 'wallet'],
        ['最低月供', money(s.minMonthly), 'calendar'],
        ['月收入', money(s.monthlyIncome), 'dollar'],
        ['月支出', money(s.monthlyExpense), 'pie'],
        ['月盈余', money(s.monthlyNet), 'sparkles'],
      ];
      cards.forEach(([l, v]) => stats.appendChild(el('div', { class: 'stat' }, [
        el('div', { class: 'stat-label', text: l }), el('div', { class: 'stat-value', text: v }),
      ])));
      content.appendChild(stats);

      const bc = el('div', { class: 'card' }, [el('div', { class: 'card-title' }, [icon('pie', { size: 18 }), el('span', { text: '预算执行 (' + s.month + ')' })]])]);
      if (!s.budgetStatus.length) bc.append(emptyState('还没有设置预算', 'pie'));
      else {
        const list = el('div', { class: 'list' });
        s.budgetStatus.forEach((b) => {
          list.appendChild(el('div', { class: 'list-item' }, [
            el('div', { class: 'li-main' }, [
              el('div', { class: 'li-title', text: b.name + (b.scope === 'category' ? ' · ' + b.category : '') }),
              el('div', { class: 'li-sub', text: '已用 ' + money(b.spent) + ' / ' + money(b.monthly_limit) }),
            ]),
            el('div', { style: { width: '160px' } }, [
              el('div', { class: 'progress' }, [el('span', { style: { width: Math.min(100, b.pct) + '%' } })]),
              el('div', { class: 'faint tiny mt-2', text: b.pct + '% · 余 ' + money(b.remaining) }),
            ]),
          ]));
        });
        bc.append(list);
      }
      content.appendChild(bc);
    } catch (e) { content.innerHTML = ''; content.appendChild(emptyState('加载失败：' + e.message, 'alert')); }
  }

  // ---------- Debts ----------
  async function renderDebts() {
    const head = el('div', { class: 'row between' }, [
      el('div', { class: 'card-title', style: { margin: 0 } }, [icon('wallet', { size: 18 }), el('span', { text: '债务' })]),
      el('button', { class: 'btn btn-primary btn-sm', onclick: () => openDebtModal(null) }, [icon('plus', { size: 16 }), el('span', { text: '添加债务' })]),
    ]);
    content.append(head, loadingCenter());
    try {
      const list = (await api.get(API + '/debts')).data;
      content.innerHTML = ''; content.appendChild(head);
      if (!list.length) { content.appendChild(emptyState('还没有债务记录', 'wallet')); return; }
      const grid = el('div', { class: 'grid grid-2' });
      list.forEach((d) => {
        const card = el('div', { class: 'card' }, [
          el('div', { class: 'row between mb-3' }, [
            el('div', { class: 'row' }, [icon('wallet', { size: 18 }), el('div', { class: 'li-title', text: d.creditor })]),
            statusBadge(d.status),
          ]),
          el('div', { class: 'grid grid-2', style: { gap: '10px' } }, [
            kv('本金', money(d.principal)),
            kv('剩余', money(d.remaining)),
            kv('年利率', d.apr != null ? d.apr + '%' : '—'),
            kv('最低月供', d.min_payment != null ? money(d.min_payment) : '—'),
          ]),
          el('div', { class: 'row mt-4' }, [
            el('button', { class: 'btn btn-sm', onclick: () => openDebtModal(d) }, [icon('edit', { size: 15 }), el('span', { text: '编辑' })]),
            el('button', { class: 'btn btn-sm', onclick: () => cycleDebtStatus(d) }, [icon('refresh', { size: 15 }), el('span', { text: '状态' })]),
            el('button', { class: 'btn btn-sm btn-danger', onclick: () => delItem('/debts', d.id, d.creditor, renderDebts) }, [icon('trash', { size: 15 })]),
          ]),
        ]);
        grid.appendChild(card);
      });
      content.appendChild(grid);
    } catch (e) { content.innerHTML = ''; content.appendChild(emptyState('加载失败：' + e.message, 'alert')); }
  }

  function cycleDebtStatus(d) {
    const order = ['active', 'paid', 'frozen'];
    const next = order[(order.indexOf(d.status) + 1) % 3];
    api.patch(API + '/debts/' + d.id + '/status', { status: next })
      .then(() => { toast('状态已更新', 'success'); renderDebts(); })
      .catch((e) => toast(e.message, 'error'));
  }

  function openDebtModal(d) {
    const isEdit = !!d;
    const creditor = input({ placeholder: '债权人 / 机构', value: d ? d.creditor : '' });
    const principal = input({ type: 'number', step: '0.01', placeholder: '本金', value: d ? d.principal : '' });
    const apr = input({ type: 'number', step: '0.01', placeholder: '年利率 %', value: d && d.apr != null ? d.apr : '' });
    const minP = input({ type: 'number', step: '0.01', placeholder: '最低月供', value: d && d.min_payment != null ? d.min_payment : '' });
    const dueDay = input({ type: 'number', placeholder: '还款日 (1-31)', value: d && d.due_day != null ? d.due_day : '' });
    const status = select([{ value: 'active', label: '进行中' }, { value: 'paid', label: '已结清' }, { value: 'frozen', label: '冻结' }], { value: d ? d.status : 'active' });
    const dtype = select(DEBT_TYPES.map((x) => ({ value: x, label: x })), { value: d ? d.debt_type : 'other' });
    const repay = select(REPAY.map((x) => ({ value: x, label: x })), { value: d ? d.repayment_method : 'equal_installment' });
    const startDate = input({ type: 'date', value: d && d.start_date ? d.start_date.slice(0, 10) : '' });
    const note = textarea({ placeholder: '备注（可选）' }); note.value = d ? d.note || '' : '';
    const errB = el('div', { class: 'badge badge-danger', style: { display: 'none' } });
    const body = el('div', {}, [
      errB, field('债权人', creditor),
      el('div', { class: 'grid grid-2' }, [field('本金', principal), field('年利率 %', apr)]),
      el('div', { class: 'grid grid-2' }, [field('最低月供', minP), field('还款日', dueDay)]),
      el('div', { class: 'grid grid-2' }, [field('状态', status), field('类型', dtype)]),
      el('div', { class: 'grid grid-2' }, [field('还款方式', repay), field('起始日', startDate)]),
      field('备注', note),
    ]);
    const save = el('button', { class: 'btn btn-primary', text: isEdit ? '保存' : '添加' });
    const m = openModal({ title: isEdit ? '编辑债务' : '添加债务', body, actions: [el('div', { class: 'grow' }), save] });
    save.onclick = async () => {
      errB.style.display = 'none';
      if (!creditor.value.trim()) { errB.textContent = '请输入债权人'; errB.style.display = 'inline-flex'; return; }
      const payload = {
        creditor: creditor.value.trim(),
        principal: Number(principal.value) || 0,
        apr: apr.value === '' ? null : Number(apr.value),
        min_payment: minP.value === '' ? null : Number(minP.value),
        due_day: dueDay.value === '' ? null : Number(dueDay.value),
        status: status.value,
        debt_type: dtype.value,
        repayment_method: repay.value,
        start_date: startDate.value ? startDate.value + 'T00:00:00' : null,
        note: note.value,
      };
      save.disabled = true;
      try {
        if (isEdit) await api.put(API + '/debts/' + d.id, payload);
        else await api.post(API + '/debts', payload);
        toast('已保存', 'success'); m.close(); renderDebts();
      } catch (e) { errB.textContent = e.message; errB.style.display = 'inline-flex'; save.disabled = false; }
    };
  }

  // ---------- Incomes ----------
  async function renderIncomes() {
    const head = el('div', { class: 'row between' }, [
      el('div', { class: 'card-title', style: { margin: 0 } }, [icon('dollar', { size: 18 }), el('span', { text: '收入' })]),
      el('button', { class: 'btn btn-primary btn-sm', onclick: () => openIncomeModal(null) }, [icon('plus', { size: 16 }), el('span', { text: '添加收入' })]),
    ]);
    content.append(head, loadingCenter());
    try {
      const list = (await api.get(API + '/incomes')).data;
      content.innerHTML = ''; content.appendChild(head);
      if (!list.length) { content.appendChild(emptyState('还没有收入记录', 'dollar')); return; }
      const grid = el('div', { class: 'grid grid-2' });
      list.forEach((r) => {
        grid.appendChild(el('div', { class: 'card' }, [
          el('div', { class: 'row between mb-3' }, [
            el('div', { class: 'li-title', text: r.source }),
            el('span', { class: 'badge ' + (r.recurring ? 'badge-success' : ''), text: r.recurring ? '经常性' : '一次性' }),
          ]),
          el('div', { class: 'stat-value sm', text: money(r.amount, r.currency) }),
          el('div', { class: 'li-sub mt-2', text: r.income_type + ' · ' + r.income_mode + (r.pay_day ? ' · 每月' + r.pay_day + '日' : '') }),
          el('div', { class: 'row mt-3' }, [
            el('button', { class: 'btn btn-sm', onclick: () => openIncomeModal(r) }, [icon('edit', { size: 15 }), el('span', { text: '编辑' })]),
            el('button', { class: 'btn btn-sm btn-danger', onclick: () => delItem('/incomes', r.id, r.source, renderIncomes) }, [icon('trash', { size: 15 })]),
          ]),
        ]));
      });
      content.appendChild(grid);
    } catch (e) { content.innerHTML = ''; content.appendChild(emptyState('加载失败：' + e.message, 'alert')); }
  }

  function openIncomeModal(r) {
    const isEdit = !!r;
    const source = input({ placeholder: '来源', value: r ? r.source : '' });
    const amount = input({ type: 'number', step: '0.01', placeholder: '金额', value: r ? r.amount : '' });
    const currency = select(CUR.map((c) => ({ value: c, label: c })), { value: r ? r.currency : 'CNY' });
    const recurring = select([{ value: '1', label: '经常性' }, { value: '0', label: '一次性' }], { value: r && r.recurring ? '1' : '0' });
    const itype = select(INCOME_TYPES.map((x) => ({ value: x, label: x })), { value: r ? r.income_type : 'salary' });
    const imode = select(INCOME_MODES.map((x) => ({ value: x, label: x })), { value: r ? r.income_mode : 'monthly' });
    const payDay = input({ type: 'number', placeholder: '发放日 (1-31)', value: r && r.pay_day != null ? r.pay_day : '' });
    const note = textarea({ placeholder: '备注（可选）' }); note.value = r ? r.note || '' : '';
    const errB = el('div', { class: 'badge badge-danger', style: { display: 'none' } });
    const body = el('div', {}, [
      errB, field('来源', source),
      el('div', { class: 'grid grid-2' }, [field('金额', amount), field('币种', currency)]),
      el('div', { class: 'grid grid-2' }, [field('性质', recurring), field('类型', itype)]),
      el('div', { class: 'grid grid-2' }, [field('频次', imode), field('发放日', payDay)]),
      field('备注', note),
    ]);
    const save = el('button', { class: 'btn btn-primary', text: isEdit ? '保存' : '添加' });
    const m = openModal({ title: isEdit ? '编辑收入' : '添加收入', body, actions: [el('div', { class: 'grow' }), save] });
    save.onclick = async () => {
      errB.style.display = 'none';
      if (!source.value.trim()) { errB.textContent = '请输入来源'; errB.style.display = 'inline-flex'; return; }
      const payload = {
        source: source.value.trim(), amount: Number(amount.value) || 0, currency: currency.value,
        recurring: recurring.value === '1', income_type: itype.value, income_mode: imode.value,
        pay_day: payDay.value === '' ? null : Number(payDay.value), note: note.value,
      };
      save.disabled = true;
      try {
        if (isEdit) await api.put(API + '/incomes/' + r.id, payload);
        else await api.post(API + '/incomes', payload);
        toast('已保存', 'success'); m.close(); renderIncomes();
      } catch (e) { errB.textContent = e.message; errB.style.display = 'inline-flex'; save.disabled = false; }
    };
  }

  // ---------- Transactions ----------
  let txnMonth = new Date().toISOString().slice(0, 7);
  async function renderTxns() {
    const monthInput = input({ type: 'month', value: txnMonth, style: { width: 'auto' } });
    monthInput.onchange = () => { txnMonth = monthInput.value; renderTxns(); };
    const head = el('div', { class: 'row between row-wrap' }, [
      el('div', { class: 'row' }, [
        el('div', { class: 'card-title', style: { margin: 0 } }, [icon('list', { size: 18 }), el('span', { text: '流水' })]),
        monthInput,
      ]),
      el('button', { class: 'btn btn-primary btn-sm', onclick: () => openTxnModal(null) }, [icon('plus', { size: 16 }), el('span', { text: '记一笔' })]),
    ]);
    content.append(head, loadingCenter());
    try {
      const list = (await api.get(API + '/transactions?month=' + txnMonth)).data;
      content.innerHTML = ''; content.appendChild(head);
      if (!list.length) { content.appendChild(emptyState('本月还没有流水', 'list')); return; }
      const rows = el('div', { class: 'list' });
      list.forEach((t) => {
        const kindCls = t.kind === 'expense' ? 'badge-danger' : t.kind === 'income' ? 'badge-success' : 'badge-warning';
        const kindLabel = t.kind === 'expense' ? '支出' : t.kind === 'income' ? '收入' : '还款';
        rows.appendChild(el('div', { class: 'list-item' }, [
          el('span', { class: 'badge ' + kindCls, text: kindLabel }),
          el('div', { class: 'li-main' }, [
            el('div', { class: 'li-title', text: (t.merchant || t.category || '—') }),
            el('div', { class: 'li-sub', text: (t.occurred_at || '').slice(0, 10) + (t.note ? ' · ' + t.note : '') }),
          ]),
          el('div', { class: 'li-sub', text: money(t.amount) }),
          el('button', { class: 'icon-btn btn-icon', onclick: () => delItem('/transactions', t.id, '该流水', renderTxns) }, [icon('trash', { size: 15 })]),
        ]));
      });
      content.appendChild(rows);
    } catch (e) { content.innerHTML = ''; content.appendChild(emptyState('加载失败：' + e.message, 'alert')); }
  }

  function openTxnModal(t) {
    const isEdit = !!t;
    const kind = select([{ value: 'expense', label: '支出' }, { value: 'income', label: '收入' }, { value: 'debt_payment', label: '债务还款' }], { value: t ? t.kind : 'expense' });
    const amount = input({ type: 'number', step: '0.01', placeholder: '金额', value: t ? t.amount : '' });
    const category = input({ placeholder: '分类', value: t ? t.category : '' });
    const merchant = input({ placeholder: '商户 / 对象', value: t ? t.merchant || '' : '' });
    const occurred = input({ type: 'datetime-local', value: t && t.occurred_at ? t.occurred_at.slice(0, 16) : new Date().toISOString().slice(0, 16) });
    const note = textarea({ placeholder: '备注（可选）' }); note.value = t ? t.note || '' : '';
    const debtSel = select([{ value: '', label: '（无）' }], { value: t && t.debt_id ? t.debt_id : '' });
    const debtWrap = el('div', {}, [field('关联债务', debtSel)]);
    const errB = el('div', { class: 'badge badge-danger', style: { display: 'none' } });
    api.get(API + '/debts').then((r) => {
      r.data.forEach((d) => debtSel.appendChild(el('option', { value: d.id }, [d.creditor])));
      if (t && t.debt_id) debtSel.value = t.debt_id;
    }).catch(() => {});
    const body = el('div', {}, [
      errB, field('类型', kind),
      el('div', { class: 'grid grid-2' }, [field('金额', amount), field('分类', category)]),
      field('商户 / 对象', merchant),
      field('时间', occurred),
      debtWrap,
      field('备注', note),
    ]);
    const updateDebtVisibility = () => { debtWrap.style.display = kind.value === 'debt_payment' ? '' : 'none'; };
    kind.onchange = updateDebtVisibility; updateDebtVisibility();
    const save = el('button', { class: 'btn btn-primary', text: isEdit ? '保存' : '记一笔' });
    const m = openModal({ title: isEdit ? '编辑流水' : '记一笔', body, actions: [el('div', { class: 'grow' }), save] });
    save.onclick = async () => {
      errB.style.display = 'none';
      if (!amount.value || Number(amount.value) <= 0) { errB.textContent = '请输入有效金额'; errB.style.display = 'inline-flex'; return; }
      const payload = {
        kind: kind.value, amount: Number(amount.value), category: category.value.trim() || 'other',
        merchant: merchant.value.trim() || null, occurred_at: occurred.value ? occurred.value + ':00' : null,
        note: note.value, debt_id: kind.value === 'debt_payment' ? (debtSel.value || null) : null,
      };
      save.disabled = true;
      try {
        if (isEdit) await api.put(API + '/transactions/' + t.id, payload).catch(() => {});
        else await api.post(API + '/transactions', payload);
        toast('已记录', 'success'); m.close(); renderTxns();
      } catch (e) { errB.textContent = e.message; errB.style.display = 'inline-flex'; save.disabled = false; }
    };
  }

  // ---------- Assets ----------
  async function renderAssets() {
    const head = el('div', { class: 'row between' }, [
      el('div', { class: 'card-title', style: { margin: 0 } }, [icon('layers', { size: 18 }), el('span', { text: '资产' })]),
      el('button', { class: 'btn btn-primary btn-sm', onclick: () => openAssetModal(null) }, [icon('plus', { size: 16 }), el('span', { text: '添加资产' })]),
    ]);
    content.append(head, loadingCenter());
    try {
      const list = (await api.get(API + '/assets')).data;
      content.innerHTML = ''; content.appendChild(head);
      if (!list.length) { content.appendChild(emptyState('还没有资产记录', 'layers')); return; }
      const grid = el('div', { class: 'grid grid-3' });
      list.forEach((a) => {
        grid.appendChild(el('div', { class: 'card' }, [
          el('div', { class: 'row between mb-2' }, [el('div', { class: 'li-title', text: a.name }), el('span', { class: 'badge', text: a.asset_class })]),
          el('div', { class: 'stat-value sm', text: money(a.value) }),
          el('div', { class: 'li-sub mt-2', text: '截至 ' + (a.as_of || '—').slice(0, 10) }),
          el('div', { class: 'row mt-3' }, [
            el('button', { class: 'btn btn-sm', onclick: () => openAssetModal(a) }, [icon('edit', { size: 15 }), el('span', { text: '编辑' })]),
            el('button', { class: 'btn btn-sm btn-danger', onclick: () => delItem('/assets', a.id, a.name, renderAssets) }, [icon('trash', { size: 15 })]),
          ]),
        ]));
      });
      content.appendChild(grid);
    } catch (e) { content.innerHTML = ''; content.appendChild(emptyState('加载失败：' + e.message, 'alert')); }
  }

  function openAssetModal(a) {
    const isEdit = !!a;
    const name = input({ placeholder: '名称', value: a ? a.name : '' });
    const aclass = select(ASSET_CLASSES.map((x) => ({ value: x, label: x })), { value: a ? a.asset_class : 'cash' });
    const value = input({ type: 'number', step: '0.01', placeholder: '价值', value: a ? a.value : '' });
    const asOf = input({ type: 'date', value: a && a.as_of ? a.as_of.slice(0, 10) : new Date().toISOString().slice(0, 10) });
    const note = textarea({ placeholder: '备注（可选）' }); note.value = a ? a.note || '' : '';
    const errB = el('div', { class: 'badge badge-danger', style: { display: 'none' } });
    const body = el('div', {}, [
      errB, field('名称', name),
      el('div', { class: 'grid grid-2' }, [field('类别', aclass), field('价值', value)]),
      field('估值日期', asOf), field('备注', note),
    ]);
    const save = el('button', { class: 'btn btn-primary', text: isEdit ? '保存' : '添加' });
    const m = openModal({ title: isEdit ? '编辑资产' : '添加资产', body, actions: [el('div', { class: 'grow' }), save] });
    save.onclick = async () => {
      errB.style.display = 'none';
      if (!name.value.trim()) { errB.textContent = '请输入名称'; errB.style.display = 'inline-flex'; return; }
      const payload = { name: name.value.trim(), asset_class: aclass.value, value: Number(value.value) || 0, as_of: asOf.value, note: note.value };
      save.disabled = true;
      try {
        if (isEdit) await api.put(API + '/assets/' + a.id, payload);
        else await api.post(API + '/assets', payload);
        toast('已保存', 'success'); m.close(); renderAssets();
      } catch (e) { errB.textContent = e.message; errB.style.display = 'inline-flex'; save.disabled = false; }
    };
  }

  // ---------- Budgets ----------
  async function renderBudgets() {
    const head = el('div', { class: 'row between' }, [
      el('div', { class: 'card-title', style: { margin: 0 } }, [icon('pie', { size: 18 }), el('span', { text: '预算' })]),
      el('button', { class: 'btn btn-primary btn-sm', onclick: () => openBudgetModal(null) }, [icon('plus', { size: 16 }), el('span', { text: '添加预算' })]),
    ]);
    content.append(head, loadingCenter());
    try {
      const list = (await api.get(API + '/budgets')).data;
      content.innerHTML = ''; content.appendChild(head);
      if (!list.length) { content.appendChild(emptyState('还没有预算', 'pie')); return; }
      const rows = el('div', { class: 'list' });
      list.forEach((b) => {
        rows.appendChild(el('div', { class: 'list-item' }, [
          el('div', { class: 'li-main' }, [
            el('div', { class: 'li-title', text: b.name + (b.scope === 'category' ? ' · ' + b.category : ' · 总览') }),
            el('div', { class: 'li-sub', text: '限额 ' + money(b.monthly_limit) }),
          ]),
          el('button', { class: 'icon-btn btn-icon', onclick: () => openBudgetModal(b) }, [icon('edit', { size: 15 })]),
          el('button', { class: 'icon-btn btn-icon', onclick: () => delItem('/budgets', b.id, b.name, renderBudgets) }, [icon('trash', { size: 15 })]),
        ]));
      });
      content.appendChild(rows);
    } catch (e) { content.innerHTML = ''; content.appendChild(emptyState('加载失败：' + e.message, 'alert')); }
  }

  function openBudgetModal(b) {
    const isEdit = !!b;
    const name = input({ placeholder: '名称', value: b ? b.name : '' });
    const scope = select([{ value: 'overall', label: '总览' }, { value: 'category', label: '分类' }], { value: b ? b.scope : 'overall' });
    const category = input({ placeholder: '分类名', value: b && b.scope === 'category' ? b.category : '' });
    const catWrap = el('div', { style: { display: b && b.scope === 'category' ? '' : 'none' } }, [field('分类名', category)]);
    const limit = input({ type: 'number', step: '0.01', placeholder: '月度限额', value: b ? b.monthly_limit : '' });
    const note = textarea({ placeholder: '备注（可选）' }); note.value = b ? b.note || '' : '';
    const errB = el('div', { class: 'badge badge-danger', style: { display: 'none' } });
    scope.onchange = () => { catWrap.style.display = scope.value === 'category' ? '' : 'none'; };
    const body = el('div', {}, [
      errB, field('名称', name), field('范围', scope), catWrap, field('月度限额', limit), field('备注', note),
    ]);
    const save = el('button', { class: 'btn btn-primary', text: isEdit ? '保存' : '添加' });
    const m = openModal({ title: isEdit ? '编辑预算' : '添加预算', body, actions: [el('div', { class: 'grow' }), save] });
    save.onclick = async () => {
      errB.style.display = 'none';
      if (!name.value.trim()) { errB.textContent = '请输入名称'; errB.style.display = 'inline-flex'; return; }
      const payload = {
        name: name.value.trim(), scope: scope.value,
        category: scope.value === 'category' ? category.value.trim() || 'other' : null,
        monthly_limit: Number(limit.value) || 0, note: note.value,
      };
      save.disabled = true;
      try {
        if (isEdit) await api.put(API + '/budgets/' + b.id, payload);
        else await api.post(API + '/budgets', payload);
        toast('已保存', 'success'); m.close(); renderBudgets();
      } catch (e) { errB.textContent = e.message; errB.style.display = 'inline-flex'; save.disabled = false; }
    };
  }

  // ---------- helpers ----------
  function kv(k, v) {
    return el('div', {}, [el('div', { class: 'faint tiny', text: k }), el('div', { style: { fontWeight: 600 }, text: v })]);
  }
  function delItem(path, id, name, after) {
    confirmDialog({ title: '删除', message: '确定删除「' + name + '」？', danger: true, confirmText: '删除' }).then((ok) => {
      if (!ok) return;
      api.del(API + path + '/' + id).then(() => { toast('已删除', 'success'); after(); }).catch((e) => toast(e.message, 'error'));
    });
  }

  renderTab();
  return container;
}
