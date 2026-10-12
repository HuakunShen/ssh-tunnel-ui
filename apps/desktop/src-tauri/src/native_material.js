// Publishes whether the host actually installed native window material.
//
// CSS translucency is only honest once the OS has a material behind the
// webview. This publishes `glass` / `vibrancy` / `none` to the document, and a
// plain browser tab simply never runs it — so the page can only switch to its
// translucent tokens when the desktop shell really provided them.
(() => {
  if (window.__nativeHost) return;
  let current = 'none';
  let observer;
  const apply = (backdrop) => {
    current = backdrop;
    const root = document.documentElement;
    if (!root) {
      // The script runs before the document exists; retry once it does.
      if (!observer) {
        observer = new MutationObserver(() => {
          if (document.documentElement) {
            observer.disconnect();
            observer = undefined;
            apply(current);
          }
        });
        observer.observe(document, { childList: true });
      }
      return;
    }
    root.dataset.backdrop = backdrop;
    window.dispatchEvent(new CustomEvent('nativehost', { detail: { backdrop } }));
  };
  window.__nativeHost = { apply, get backdrop() { return current; } };
  apply(current);
})();
