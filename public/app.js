/**
 * app.js — SPA entry point.
 * Boots the router once the DOM is ready. Stays tiny on purpose: all app
 * logic lives in router.js / ui.js / api.js / modules/<name>/page.js.
 */
import { initRouter } from '/router.js';

function boot() {
  initRouter().catch((err) => {
    console.error('[DM] boot failed', err);
    const root = document.getElementById('app');
    if (root) {
      root.innerHTML =
        '<div class="auth-wrap"><div class="auth-card">' +
        '<div class="auth-logo">⚠️</div>' +
        '<h1>启动失败</h1>' +
        '<p class="sub">应用初始化出错，请查看控制台日志。</p>' +
        '</div></div>';
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
