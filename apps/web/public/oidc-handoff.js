(() => {
  if (window.location.pathname !== '/auth/oidc/callback' || !window.location.hash) return;
  Object.defineProperty(window, '__ezrepoOidcHandoffFragment', {
    configurable: true,
    value: window.location.hash.slice(1),
  });
  window.history.replaceState({}, '', '/auth/oidc/callback');
})();
