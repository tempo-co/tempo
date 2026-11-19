export function registerOfflineShell() {
  if (!import.meta.env.PROD || !window.isSecureContext || !('serviceWorker' in navigator)) return;
  void navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
      updateViaCache: 'none',
    })
    .catch(() => {
      /* The app still works online if installation is unavailable. */
    });
  // A page whose load began before the worker activated, but which opened after the worker's own
  // claim, would stay uncontrolled until its next load. Ask the worker to claim it.
  void navigator.serviceWorker.ready.then((registration) => {
    if (!navigator.serviceWorker.controller) registration.active?.postMessage('claim');
  });
}
