/**
 * 灵感记事 (Notes / Ideas) — 前端页面
 * 标签页：灵感 (idea) / 记事本 (notebook)
 */
import {
  el, icon, toast, openModal, confirmDialog, emptyState, loadingCenter,
  input, textarea, field,
} from '/ui.js';

const API = '/api/v1/notes';

export default function render(App) {
  const { api } = App;
  const container = el('div', { class: 'col', style: { gap: '20px' } });
  const tabsEl = el('div', { class: 'tabs' });
  const content = el('div', { class: 'col', style: { gap: '16px' } });
  container.append(tabsEl, content);

  const TABS = [{ key: 'idea', label: '灵感' }, { key: 'notebook', label: '记事本' }];
  let active = 'idea';
  const tabEls = {};
  TABS.forEach((t) => {
    const b = el('div', { class: 'tab' + (t.key === active ? ' active' : ''), text: t.label, onclick: () => { active = t.key; TABS.forEach((x) => tabEls[x.key].classList.toggle('active', x.key === active)); renderList(); } });
    tabEls[t.key] = b; tabsEl.appendChild(b);
  });

  async function renderList() {
    const head = el('div', { class: 'row between' }, [
      el('div', { class: 'card-title', style: { margin: 0 } }, [icon('note', { size: 18 }), el('span', { text: active === 'idea' ? '灵感' : '记事本' })]),
      el('button', { class: 'btn btn-primary btn-sm', onclick: () => openModalNote(null) }, [icon('plus', { size: 16 }), el('span', { text: '新建' })]),
    ]);
    content.innerHTML = ''; content.append(head, loadingCenter());
    try {
      const list = (await api.get(API + '/notes?kind=' + active)).data;
      content.innerHTML = ''; content.appendChild(head);
      if (!list.length) { content.appendChild(emptyState(active === 'idea' ? '还没有灵感记录' : '记事本为空', 'note')); return; }
      const grid = el('div', { class: 'grid grid-2' });
      list.forEach((n) => {
        const preview = (n.body_markdown || '').replace(/\n/g, ' ').slice(0, 80) || '（无内容）';
        grid.appendChild(el('div', { class: 'card' }, [
          el('div', { class: 'row between mb-2' }, [el('div', { class: 'li-title', text: n.title })]),
          el('div', { class: 'muted tiny', style: { minHeight: '34px' }, text: preview }),
          el('div', { class: 'row mt-3' }, [
            el('button', { class: 'btn btn-sm', onclick: () => openModalNote(n) }, [icon('edit', { size: 15 }), el('span', { text: '编辑' })]),
            el('button', { class: 'btn btn-sm btn-danger', onclick: () => del(n) }, [icon('trash', { size: 15 })]),
          ]),
        ]));
      });
      content.appendChild(grid);
    } catch (e) { content.innerHTML = ''; content.appendChild(emptyState('加载失败：' + e.message, 'alert')); }
  }

  function openModalNote(n) {
    const isEdit = !!n;
    const title = input({ placeholder: '标题', value: n ? n.title : '' });
    const body = textarea({ placeholder: '内容（支持 Markdown 文本）' }); body.value = n ? n.body_markdown || '' : '';
    const errB = el('div', { class: 'badge badge-danger', style: { display: 'none' } });
    const form = el('div', {}, [
      errB, field('标题', title), field('内容', body),
      el('div', { class: 'faint tiny', text: '类型：' + (active === 'idea' ? '灵感' : '记事本') }),
    ]);
    const save = el('button', { class: 'btn btn-primary', text: isEdit ? '保存' : '创建' });
    const m = openModal({ title: isEdit ? '编辑' : '新建', body: form, actions: [el('div', { class: 'grow' }), save] });
    save.onclick = async () => {
      errB.style.display = 'none';
      if (!title.value.trim()) { errB.textContent = '请输入标题'; errB.style.display = 'inline-flex'; return; }
      const payload = { title: title.value.trim(), body_markdown: body.value, kind: active };
      save.disabled = true;
      try {
        if (isEdit) await api.put(API + '/notes/' + n.id, payload);
        else await api.post(API + '/notes', payload);
        toast('已保存', 'success'); m.close(); renderList();
      } catch (e) { errB.textContent = e.message; errB.style.display = 'inline-flex'; save.disabled = false; }
    };
  }

  function del(n) {
    confirmDialog({ title: '删除', message: '确定删除「' + n.title + '」？', danger: true, confirmText: '删除' }).then((ok) => {
      if (!ok) return;
      api.del(API + '/notes/' + n.id).then(() => { toast('已删除', 'success'); renderList(); }).catch((e) => toast(e.message, 'error'));
    });
  }

  renderList();
  return container;
}
