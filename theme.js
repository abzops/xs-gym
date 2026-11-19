// Applies the saved appearance before first paint (see src/lib/theme.ts).
(function () {
  var p = null;
  try { p = localStorage.getItem('xs-theme'); } catch (e) { /* storage blocked */ }
  var dark = p === 'dark' || (p !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var t = dark ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  document.documentElement.style.colorScheme = t;
})();
