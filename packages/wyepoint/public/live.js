// Hot reload, when the server offers it (local runs): reload on a change to the page's files, swap the stylesheet when
// only CSS changed, and reload once the server is back after it restarted for a change to its own code.
(async () => {
  const health = await fetch('/api/health').then(r => r.json()).catch(() => ({}));
  if (!health.live) return;
  const swapCss = () => document.querySelectorAll('link[rel="stylesheet"]').forEach(l => { const u = new URL(l.href); u.searchParams.set('v', Date.now()); l.href = u.href; });
  const es = new EventSource('/__reload');
  let down = false;
  es.onopen = () => { if (down) location.reload(); };
  es.onerror = () => { down = true; };       // the stream reconnects by itself; when it is back, the server restarted
  es.onmessage = e => { if (e.data === 'css') swapCss(); else location.reload(); };
})();
