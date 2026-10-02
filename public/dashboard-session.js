'use strict';
(() => {
  const nativeFetch = window.fetch.bind(window);
  const key = 'slidesDashboardSession';
  const ready = (async () => {
    const launchToken = new URLSearchParams(location.hash.slice(1)).get('launch');
    if (!launchToken) return;
    history.replaceState(null, '', location.pathname + location.search);
    sessionStorage.removeItem(key);
    const response = await nativeFetch('/api/dashboard/session', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({launchToken}),
    });
    if (!response.ok) throw new Error('Dashboard launch expired or was already used. Restart Slides for a new launch URL.');
    const session = await response.json();
    if (!/^[a-f0-9]{64}$/.test(session.token)) throw new Error('Invalid dashboard session response');
    sessionStorage.setItem(key, session.token);
  })();
  ready.catch(error => {
    const notice = document.createElement('p');
    notice.setAttribute('role', 'alert');
    notice.textContent = error.message;
    document.body.prepend(notice);
  });
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return nativeFetch(input, options);
    await ready;
    const token = sessionStorage.getItem(key);
    const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
    if (token) headers.set('X-Slides-Session', token);
    return nativeFetch(input, {...options, headers});
  };
})();
