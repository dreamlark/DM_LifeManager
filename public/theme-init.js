/**
 * theme-init.js — Classic (synchronous) head script.
 * Sets data-theme BEFORE first paint to avoid FOUC.
 * CSP allows external same-origin scripts (scriptSrc: ['self']).
 */
(function () {
  try {
    var stored = localStorage.getItem('dml-theme') || 'system';
    var root = document.documentElement;
    function resolve(theme) {
      if (theme === 'light' || theme === 'dark') return theme;
      var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      return dark ? 'dark' : 'light';
    }
    root.setAttribute('data-theme', resolve(stored));
    if (stored === 'system' && window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var handler = function () { root.setAttribute('data-theme', resolve('system')); };
      if (mq.addEventListener) mq.addEventListener('change', handler);
      else if (mq.addListener) mq.addListener(handler);
    }
  } catch (e) { /* no-op */ }
})();
