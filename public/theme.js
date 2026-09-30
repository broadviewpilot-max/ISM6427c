// Applied before first paint. Default is the light (Bahamian-flag inspired) theme.
try {
  var t = localStorage.getItem('aimsir-theme');
  document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
} catch (e) {
  document.documentElement.setAttribute('data-theme', 'light');
}
