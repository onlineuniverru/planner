/* Проверка: в прошлых версиях здесь был Service Worker.
   Он вызывал проблемы с устаревшим кэшем (пользователь вечно видел старый интерфейс).
   Этот воркер существует только чтобы корректно УДАЛИТЬ себя и кэши у всех клиентов. */
self.addEventListener('install', e => {
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll())
      .then(clients => clients.forEach(c => c.navigate(c.url)))
  );
});
