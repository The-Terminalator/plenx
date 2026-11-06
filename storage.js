'use strict';
window.LibraryStore = (() => {
  let database;
  const request = task => new Promise((resolve,reject) => {task.onsuccess = () => resolve(task.result); task.onerror = () => reject(task.error);});
  async function open() {
    if (database) return database;
    const task = indexedDB.open('sprechzimmer',1);
    task.onupgradeneeded = () => {
      task.result.createObjectStore('episodes',{keyPath:'id'});
      task.result.createObjectStore('videos');
    };
    database = await request(task);
    database.onversionchange = () => {database.close(); database = null;};
    return database;
  }
  async function all() {const db = await open(); return request(db.transaction('episodes').objectStore('episodes').getAll());}
  async function video(id) {const db = await open(); return request(db.transaction('videos').objectStore('videos').get(id));}
  async function save(episode,blob) {
    const db = await open();
    return new Promise((resolve,reject) => {
      const transaction = db.transaction(blob ? ['episodes','videos'] : ['episodes'],'readwrite');
      transaction.objectStore('episodes').put(episode);
      if (blob) transaction.objectStore('videos').put(blob,episode.id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Storage was interrupted.'));
    });
  }
  async function saveMany(episodes) {
    const db = await open();
    return new Promise((resolve,reject) => {
      const transaction = db.transaction('episodes','readwrite');
      for (const episode of episodes) transaction.objectStore('episodes').put(episode);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Restore was interrupted.'));
    });
  }
  return {open,all,video,save,saveMany};
})();
