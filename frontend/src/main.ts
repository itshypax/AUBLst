import { mount } from 'svelte';
import './styles/app.css';
import App from './App.svelte';

const app = mount(App, { target: document.getElementById('app')! });

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register('./sw.js');
    });
  } else {
    // A previously installed production worker can otherwise keep an old editor
    // bundle alive on localhost, even though Vite itself is already up to date.
    window.addEventListener('load', () => {
      void (async () => {
        const wasControlled = navigator.serviceWorker.controller !== null;
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));

        if ('caches' in window) {
          const cacheNames = await caches.keys();
          await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
        }

        const resetKey = 'emdispatch-dev-worker-reset';
        if (wasControlled && sessionStorage.getItem(resetKey) !== 'done') {
          sessionStorage.setItem(resetKey, 'done');
          window.location.reload();
          return;
        }
        sessionStorage.removeItem(resetKey);
      })();
    });
  }
}

export default app;
