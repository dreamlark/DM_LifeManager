import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);
const GROOT = '/root/.nvm/versions/node/v22.13.1/lib/node_modules';
const { chromium } = require(GROOT + '/playwright');
const { createTRPCProxyClient, httpBatchLink } = require('@trpc/client');

const PORT = fs.readFileSync('/tmp/dm-life.engine.port', 'utf8').trim();
const BASE = `http://127.0.0.1:${PORT}/trpc`;
const today = new Date().toISOString().slice(0, 10);
const OUT = '/workspace/DM_LifeManager/shots';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 与 Web App 完全一致的 tRPC 客户端（httpBatchLink），保证线格式正确
const client = createTRPCProxyClient({
  links: [httpBatchLink({ url: BASE })],
});

async function seed() {
  console.log('== SEED 演示数据 ==');
  try { await client.tasks.ensureDaily.mutate({ date: today }); } catch (e) { console.log('  ensureDaily skip', e.message?.slice(0, 80)); }

  const tasks = [
    { title: '修复生产环境支付故障', domainKey: 'work', importance: true, urgency: true, priority: 'high', description: '线上订单支付回调异常，需立即排查根因' },
    { title: '完成 Q3 财报初稿', domainKey: 'work', importance: true, urgency: true, priority: 'high' },
    { title: '预约年度体检', domainKey: 'health', importance: true, urgency: false, priority: 'medium', description: '三甲医院体检中心，工作日均可预约' },
    { title: '制定年度投资配置计划', domainKey: 'wealth', importance: true, urgency: false, priority: 'medium' },
    { title: '读完《深度工作》', domainKey: 'growth', importance: true, urgency: false, priority: 'low' },
    { title: '周末带家人去郊游', domainKey: 'family', importance: true, urgency: false, priority: 'low' },
    { title: '每日冥想 10 分钟', domainKey: 'spirit', importance: true, urgency: false, priority: 'low' },
    { title: '回复项目群消息', domainKey: 'social', importance: false, urgency: true, priority: 'medium' },
    { title: '确认快递取件', domainKey: 'social', importance: false, urgency: true, priority: 'low' },
    { title: '追更科幻剧集', domainKey: 'leisure', importance: false, urgency: false, priority: 'low' },
    { title: '整理桌面收纳', domainKey: 'quarter', importance: false, urgency: false, priority: 'low' },
    { title: '刷短视频放松', domainKey: 'leisure', importance: false, urgency: false, priority: 'low' },
  ];
  let ok = 0;
  for (const t of tasks) { try { await client.tasks.create.mutate({ ...t, taskDate: today }); ok++; } catch (e) { console.log('  task err', e.message?.slice(0, 80)); } await sleep(40); }
  console.log('  看板任务已种入:', ok, '/', tasks.length);

  const interests = [
    { title: '学习 Rust 异步编程', content: '想用 Rust 重写高频行情采集服务，熟悉 tokio 与 async/await 模型', attention: 3, domainKey: 'growth', effortBudget: 'sustained' },
    { title: '搭建家庭 NAS', content: '利用闲置硬盘做照片与视频的本地备份，摆脱单一云盘', attention: 2, domainKey: 'quarter', effortBudget: '3h' },
    { title: '周末手冲咖啡', content: '买一套 V60 器具，研究水温与研磨度的萃取参数', attention: 2, domainKey: 'leisure', effortBudget: '30min' },
    { title: '练习长板滑板', content: '通勤代步 + 周末刷街，先练刹车与转弯', attention: 1, domainKey: 'leisure', effortBudget: '30min' },
  ];
  let iok = 0;
  for (const i of interests) { try { await client.interests.capture.mutate(i); iok++; } catch (e) { console.log('  interest err', e.message?.slice(0, 80)); } await sleep(40); }
  console.log('  孵化器灵感已种入:', iok, '/', interests.length);

  const assets = [
    { name: '活期存款', assetClass: 'cash', value: 86000, asOf: today },
    { name: '沪深300指数基金', assetClass: 'investment', value: 128000, asOf: today },
    { name: '自住房产', assetClass: 'property', value: 3200000, asOf: today },
    { name: '笔记本与相机', assetClass: 'fixed_asset', value: 35000, asOf: today },
  ];
  for (const a of assets) { try { await client.finance.assets.record.mutate(a); } catch (e) { console.log('  asset err', e.message?.slice(0, 80)); } await sleep(40); }

  const debts = [
    { creditor: '房贷 · 工商银行', principal: 1820000 },
    { creditor: '信用卡 · 招商', principal: 12500 },
  ];
  for (const d of debts) { try { await client.finance.debts.create.mutate(d); } catch (e) { console.log('  debt err', e.message?.slice(0, 80)); } await sleep(40); }

  try { await client.finance.incomes.record.mutate({ source: '月薪', amount: 35000, receivedAt: today, incomeType: 'salary', isFixed: true, monthlyAvg: 35000 }); } catch (e) { console.log('  income err', e.message?.slice(0, 80)); }

  const txns = [
    { kind: 'expense', category: '餐饮', amount: 328, merchant: '楼下小馆', occurredAt: today },
    { kind: 'expense', category: '交通', amount: 45, merchant: '地铁', occurredAt: today },
    { kind: 'expense', category: '购物', amount: 899, merchant: '京东', occurredAt: today },
    { kind: 'expense', category: '居家', amount: 210, merchant: '超市', occurredAt: today },
  ];
  for (const x of txns) { try { await client.finance.transactions.record.mutate(x); } catch (e) { console.log('  txn err', e.message?.slice(0, 80)); } await sleep(40); }
  console.log('  财务数据已种入 (资产/负债/收入/流水)');
  console.log('== SEED 完成 ==');
}

const PAGES = [
  ['每日看板', 900],
  ['财务', 1500],
  ['钟表铺', 900],
  ['灵感·记事', 1100],
  ['脑图', 1500],
  ['日历', 1200],
  ['心流', 1200],
  ['平衡轮', 1300],
  ['孵化器', 1100],
];

async function main() {
  await seed();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message));

  console.log('== 打开预览页面 ==');
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.app-shell', { timeout: 15000 });
  await page.waitForSelector('.app-tab', { timeout: 15000 });
  await sleep(1800);

  let idx = 1;
  for (const [label, wait] of PAGES) {
    const loc = page.locator('.app-tab', { hasText: label });
    await loc.click();
    await sleep(wait);
    const name = String(idx).padStart(2, '0') + '-' + label + '-dark.png';
    await page.screenshot({ path: `${OUT}/${name}` });
    console.log('  截图:', name);
    idx++;
  }

  // 设置抽屉（深色）—— header 右侧「⚙ 设置」按钮
  await page.locator('button', { hasText: '设置' }).first().click();
  await sleep(800);
  await page.screenshot({ path: `${OUT}/13-设置-dark.png` });
  console.log('  截图: 13-设置-dark.png');
  // 关闭设置抽屉
  await page.locator('button[title="关闭"]').click();
  await sleep(400);

  // 浅色模式（header 右侧主题切换按钮）
  await page.locator('button[title^="切换到"]').click();
  await sleep(900);
  await page.locator('.app-tab', { hasText: '每日看板' }).click();
  await sleep(1000);
  await page.screenshot({ path: `${OUT}/10-每日看板-light.png` });
  console.log('  截图: 10-每日看板-light.png');
  await page.locator('.app-tab', { hasText: '财务' }).click();
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/11-财务-light.png` });
  console.log('  截图: 11-财务-light.png');

  // 移动端
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.app-tab', { hasText: '每日看板' }).click();
  await sleep(1200);
  await page.screenshot({ path: `${OUT}/12-每日看板-mobile.png` });
  console.log('  截图: 12-每日看板-mobile.png');

  await browser.close();
  console.log('== 截图完成 ==');
  if (errors.length) { console.log('页面控制台错误(前10):'); errors.slice(0, 10).forEach((e) => console.log('  -', e.slice(0, 160))); }
  else console.log('无控制台错误');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
