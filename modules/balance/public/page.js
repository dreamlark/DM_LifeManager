/**
 * 领域平衡 (Balance Wheel) — 前端页面
 * 8+1 领域评分雷达图 + 逐领域评分。
 */
import {
  el, icon, toast, openModal, confirmDialog, emptyState, loadingCenter,
  input, textarea, select, field,
} from '/ui.js';

const API = '/api/v1/balance';

function escapeXml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function radarSVG(byDomain) {
  const size = 340, cx = size / 2, cy = size / 2, R = 120;
  const n = byDomain.length || 8;
  const angle = (i) => (-Math.PI / 2) + i * (2 * Math.PI / n);
  let svg = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">`;
  for (let ring = 1; ring <= 4; ring++) {
    const rr = (R * ring) / 4;
    const pts = [];
    for (let i = 0; i < n; i++) { const a = angle(i); pts.push((cx + rr * Math.cos(a)).toFixed(1) + ',' + (cy + rr * Math.sin(a)).toFixed(1)); }
    svg += `<polygon points="${pts.join(' ')}" fill="none" stroke="var(--border)" stroke-width="1"/>`;
  }
  byDomain.forEach((d, i) => {
    const a = angle(i);
    const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
    svg += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1"/>`;
    const lx = cx + (R + 22) * Math.cos(a), ly = cy + (R + 22) * Math.sin(a);
    svg += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="var(--text-muted)" font-size="11" text-anchor="middle" dominant-baseline="middle">${escapeXml(d.name)}</text>`;
  });
  const dpts = byDomain.map((d, i) => { const r = R * ((d.score || 0) / 10); const a = angle(i); return (cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1); });
  if (byDomain.some((d) => d.score != null)) {
    svg += `<polygon points="${dpts.join(' ')}" fill="color-mix(in srgb, var(--primary) 26%, transparent)" stroke="var(--primary)" stroke-width="2"/>`;
    byDomain.forEach((d, i) => { const r = R * ((d.score || 0) / 10); const a = angle(i); svg += `<circle cx="${(cx + r * Math.cos(a)).toFixed(1)}" cy="${(cy + r * Math.sin(a)).toFixed(1)}" r="3.5" fill="var(--primary)"/>`; });
  }
  svg += '</svg>';
  return svg;
}

export default function render(App) {
  const { api } = App;
  const container = el('div', { class: 'col', style: { gap: '20px' } });

  const head = el('div', { class: 'card-title' }, [icon('balance', { size: 18 }), el('span', { text: '领域平衡轮' })]);
  container.appendChild(head);

  const grid = el('div', { class: 'grid', style: { gridTemplateColumns: 'minmax(0, 380px) 1fr' } });
  const radarCard = el('div', { class: 'card' });
  const listCard = el('div', { class: 'card' });
  grid.append(radarCard, listCard);
  container.appendChild(grid);

  async function load() {
    radarCard.innerHTML = ''; radarCard.appendChild(loadingCenter());
    listCard.innerHTML = ''; listCard.appendChild(loadingCenter());
    try {
      const s = (await api.get(API + '/summary')).data;
      const byDomain = s.byDomain || [];
      radarCard.innerHTML = '';
      radarCard.append(
        el('div', { class: 'row between mb-3' }, [
          el('div', { class: 'card-sub', text: '综合平衡度' }),
          el('div', { class: 'stat-value', style: { fontSize: '28px' }, text: String(s.avg) }),
        ]),
        el('div', { style: { display: 'grid', placeItems: 'center' } }, []),
      );
      radarCard.lastChild.innerHTML = radarSVG(byDomain);

      listCard.innerHTML = '';
      listCard.append(el('div', { class: 'card-title' }, [icon('list', { size: 18 }), el('span', { text: '各领域评分' })]));
      const list = el('div', { class: 'list' });
      byDomain.forEach((d) => {
        list.appendChild(el('div', { class: 'list-item' }, [
          el('span', { class: 'dot', style: { background: d.color } }),
          el('div', { class: 'li-main' }, [
            el('div', { class: 'li-title', text: d.name }),
            el('div', { class: 'li-sub', text: d.score != null ? '当前 ' + d.score + ' / 10' : '尚未评分' }),
          ]),
          el('div', { style: { width: '120px' } }, [el('div', { class: 'progress' }, [el('span', { style: { width: (d.score || 0) * 10 + '%' } })])]),
          el('button', { class: 'btn btn-sm', onclick: () => openScoreModal(d) }, [icon('edit', { size: 15 }), el('span', { text: '评分' })]),
        ]));
      });
      listCard.append(list);
    } catch (e) {
      radarCard.innerHTML = ''; radarCard.appendChild(emptyState('加载失败：' + e.message, 'alert'));
      listCard.innerHTML = '';
    }
  }

  function openScoreModal(d) {
    const score = select(
      Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })),
      { value: d.score ? String(d.score) : '7' },
    );
    const reviewed = input({ type: 'date', value: new Date().toISOString().slice(0, 10) });
    const note = textarea({ placeholder: '备注（可选）' });
    const errB = el('div', { class: 'badge badge-danger', style: { display: 'none' } });
    const form = el('div', {}, [
      errB,
      el('div', { class: 'muted tiny mb-3', text: '为「' + d.name + '」评分 (1–10)' }),
      field('评分', score), field('评估日期', reviewed), field('备注', note),
    ]);
    const save = el('button', { class: 'btn btn-primary', text: '保存' });
    const m = openModal({ title: '领域评分', body: form, actions: [el('div', { class: 'grow' }), save] });
    save.onclick = async () => {
      errB.style.display = 'none';
      const payload = { domain_key: d.key, score: Number(score.value), reviewed_at: reviewed.value, note: note.value };
      save.disabled = true;
      try {
        await api.post(API + '/scores', payload);
        toast('已记录评分', 'success'); m.close(); load();
      } catch (e) { errB.textContent = e.message; errB.style.display = 'inline-flex'; save.disabled = false; }
    };
  }

  load();
  return container;
}
