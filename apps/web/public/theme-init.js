// The reader's colour mode, applied before the first paint so a Dark choice on
// a light system never flashes paper. A file rather than an inline script: the
// server's CSP allows scripts from 'self' only. shell/theme.ts owns the key.
try {
  var mode = localStorage.getItem('engram.colourMode');
  if (mode === 'light' || mode === 'dark') document.documentElement.dataset.theme = mode;
} catch (e) {}
