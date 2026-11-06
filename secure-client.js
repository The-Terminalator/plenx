'use strict';

(() => {
  const format = window.SecureFormat;
  const catalog = window.StoryCatalog;
  const workerURL = new URL('secure-worker.js',document.baseURI);
  let active, workerReady, onConnection, onOpen, onSync;
  let busy = false;
  const $ = id => document.getElementById(id);

  function openVault() {
    return new Promise((resolve,reject) => {
      const request = indexedDB.open('sprechzimmer-credentials',1);
      request.onupgradeneeded = () => request.result.createObjectStore('vault');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function vault(action,value) {
    const db = await openVault();
    try {
      return await new Promise((resolve,reject) => {
        const tx = db.transaction('vault',action === 'get' ? 'readonly' : 'readwrite');
        const store = tx.objectStore('vault');
        let request;
        if (action === 'get') request = store.get('profile');
        else if (action === 'put') request = store.put(value,'profile');
        else request = store.delete('profile');
        tx.oncomplete = () => resolve(request.result);
        tx.onabort = () => reject(tx.error);
      });
    } finally {db.close();}
  }

  async function remember(profile) {
    const key = await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    await vault('put',{key,encrypted:await format.sealJSON(key,'browser-profile',profile)});
  }

  function gatewayURL(value) {
    const url = new URL(value);
    const local = ['localhost','127.0.0.1','[::1]'];
    const localPreview = local.includes(location.hostname) && local.includes(url.hostname) && url.protocol === 'http:';
    if ((url.protocol !== 'https:' && !localPreview) || url.username || url.password || url.search || url.hash) {
      throw new Error('Use the HTTPS address of your SFTP bridge.');
    }
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url.href;
  }

  async function startWorker() {
    if (!navigator.serviceWorker || !crypto.subtle) throw new Error('Encrypted playback requires HTTPS and service worker support.');
    if (!workerReady) workerReady = (async () => {
      await navigator.serviceWorker.register(workerURL);
      if (navigator.serviceWorker.controller?.scriptURL === workerURL.href) return;
      await new Promise((resolve,reject) => {
        const listener = () => {
          if (navigator.serviceWorker.controller?.scriptURL !== workerURL.href) return;
          cleanup();resolve();
        };
        const cleanup = () => {clearTimeout(timer);navigator.serviceWorker.removeEventListener('controllerchange',listener);};
        const timer = setTimeout(() => {cleanup();reject(new Error('The secure player could not start. Reload this page and try again.'));},12000);
        navigator.serviceWorker.addEventListener('controllerchange',listener);
        listener();
      });
    })().catch(error => {workerReady = null;throw error;});
    await workerReady;
  }

  function bridge(session,path,options = {}) {
    return fetch(new URL(path,session.profile.gateway),{
      ...options,cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',
      signal:AbortSignal.timeout(15000)
    });
  }

  async function authorize(session,rejectedToken) {
    if (session.token && session.token !== rejectedToken) return session.token;
    if (!session.authorizing) session.authorizing = (async () => {
      const {address,username,password} = session.profile;
      const response = await bridge(session,'v1/session',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address,username,password})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'SFTP sign-in failed.');
      if (!/^[A-Za-z0-9_-]{43}$/.test(data.token)) throw new Error('The bridge returned an invalid session.');
      session.token = data.token;
      return data.token;
    })().finally(() => {session.authorizing = null;});
    return session.authorizing;
  }

  async function request(session,path,options = {}) {
    let token = await authorize(session);
    const get = () => bridge(session,path,{...options,headers:{...options.headers,Authorization:`Bearer ${token}`}});
    let response = await get();
    if (response.status === 401) {
      await response.body?.cancel();
      token = await authorize(session,token);
      response = await get();
    }
    return response;
  }

  async function loadIndex(session) {
    const response = await request(session,'v1/assets/library');
    if (!response.ok) throw new Error('The encrypted library index is missing or inaccessible.');
    const encrypted = await response.arrayBuffer();
    if (encrypted.byteLength > format.chunkBytes) throw new Error('The encrypted library index is too large.');
    let index;
    try {index = await format.openJSON(session.key,'library',encrypted);}
    catch {throw new Error('The media key did not unlock this library.');}
    if (index?.version !== 1 || !Array.isArray(index.episodes) || index.episodes.length > catalog.episodes.length) throw new Error('Unsupported encrypted library index.');
    const assets = new Map(), ids = new Set();
    function assetURL(asset,types) {
      if (!asset || !format.assetID.test(asset.id) || !Number.isSafeInteger(asset.size) || asset.size < 1 ||
          asset.size > 64 * 1024**3 || !types.includes(asset.type) || assets.has(asset.id)) throw new Error('Invalid encrypted media entry.');
      assets.set(asset.id,asset);
      return new URL(`secure-media/${asset.id}`,document.baseURI).href;
    }
    const episodes = index.episodes.map(episode => {
      const entry = catalog.get(episode?.id);
      if (!entry || ids.has(entry.id) || !Array.isArray(episode.tracks) || episode.tracks.length > 20) throw new Error('Invalid encrypted episode entry.');
      ids.add(entry.id);
      const video = assetURL(episode.video,['video/mp4','video/webm']);
      const tracks = episode.tracks.map(({asset,code,name,source,kind,revision,timingReference,humanVerified}) => {
        if (!/^[a-z]{2}$/.test(code) || typeof name !== 'string' || typeof source !== 'string' || asset?.size > 10_000_000) throw new Error('Invalid encrypted subtitle entry.');
        return {code,name,source,kind,revision,timingReference,humanVerified,url:assetURL(asset,['text/plain'])};
      });
      return {...entry,video,tracks};
    });
    session.assets = assets;session.episodes = episodes;
  }

  function cleanProgress(entries) {
    const result = {};
    for (const [id,value] of Object.entries(entries || {})) {
      if (!catalog.get(id) || !value || !Number.isFinite(value.time) || !Number.isFinite(value.duration) ||
          value.time < 0 || value.duration < value.time || value.duration > 86400 || !Number.isSafeInteger(value.updated)) continue;
      result[id] = {time:value.time,duration:value.duration,updated:value.updated};
    }
    return result;
  }

  function mergeProgress(first,second) {
    const merged = {...first};
    for (const [id,progress] of Object.entries(second)) if (!merged[id] || merged[id].updated < progress.updated) merged[id] = progress;
    return merged;
  }

  function localProgress(session) {
    try {return cleanProgress(JSON.parse(localStorage.getItem(session.storageKey) || '{}'));}
    catch {return {};}
  }

  function cacheProgress(session) {
    try {localStorage.setItem(session.storageKey,JSON.stringify(session.progress));} catch {}
  }

  async function remoteProgress(session) {
    const response = await request(session,'v1/progress');
    const etag = response.headers.get('ETag');
    if (!response.ok || !etag) throw new Error('Could not read progress from SFTP.');
    if (response.status === 204) return {etag,progress:{}};
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 256 * 1024) throw new Error('Encrypted progress is too large.');
    const data = await format.openJSON(session.key,session.progressID,bytes);
    if (data?.version !== 1 || !data.progress || typeof data.progress !== 'object') throw new Error('Unsupported progress file.');
    return {etag,progress:cleanProgress(data.progress)};
  }

  function syncStatus(session,text) {
    if (session !== active) return;
    session.status = text;
    $('secure-sync-status').textContent = text;
    onSync(text);
  }

  async function flush(session) {
    if (!session?.dirty) return;
    if (session.flushing) return session.flushing;
    const revision = session.revision;
    session.flushing = (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const remote = await remoteProgress(session);
        const progress = mergeProgress(remote.progress,session.progress);
        const changed = Object.entries(progress).some(([id,item]) => remote.progress[id]?.updated !== item.updated);
        if (changed) {
          const encrypted = await format.sealJSON(session.key,session.progressID,{version:1,progress});
          const response = await request(session,'v1/progress',{
            method:'PUT',headers:{'Content-Type':'application/octet-stream','If-Match':remote.etag},body:encrypted
          });
          if (response.status === 412) continue;
          if (!response.ok) throw new Error('Could not save progress to SFTP.');
        }
        session.progress = mergeProgress(progress,session.progress);
        session.dirty = revision !== session.revision;
        cacheProgress(session);syncStatus(session,'Progress synced to SFTP');
        return;
      }
      throw new Error('Progress changed on another device.');
    })().catch(() => syncStatus(session,'Progress waiting to sync')).finally(() => {
      session.flushing = null;
      if (session === active && session.dirty && revision !== session.revision) {
        clearTimeout(session.timer);
        session.timer = setTimeout(() => flush(session),900);
      }
    });
    return session.flushing;
  }

  function saveProgress(value) {
    const session = active;
    if (!session) return;
    const updated = cleanProgress(value);
    if (!Object.entries(updated).some(([id,item]) => !session.progress[id] || session.progress[id].updated < item.updated)) return;
    session.progress = mergeProgress(session.progress,updated);
    session.revision++;session.dirty = true;cacheProgress(session);
    clearTimeout(session.timer);
    session.timer = setTimeout(() => flush(session),900);
  }

  async function closeSession(session) {
    if (!session) return;
    clearTimeout(session.timer);
    await flush(session);
    if (session.token) await bridge(session,'v1/session',{method:'DELETE',headers:{Authorization:`Bearer ${session.token}`}}).catch(() => {});
  }

  async function connect(profile,save) {
    if (busy) return;
    busy = true;
    $('secure-connect').disabled = true;
    $('secure-forget').disabled = true;
    $('secure-status').textContent = 'Unlocking your library…';
    let session;
    try {
      profile = {...profile,address:format.sftpAddress(profile.address).address,gateway:gatewayURL(profile.gateway)};
      const key = await format.importKey(profile.mediaKey);
      const identity = new TextEncoder().encode(`${profile.address}\0${profile.username}`);
      const id = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',identity)),b => b.toString(16).padStart(2,'0')).join('');
      session = {profile,key,progressID:`progress-${id}`,storageKey:`sprechzimmer.remote.progress.${id}`,revision:0,dirty:false};
      await startWorker();
      await loadIndex(session);
      session.progress = localProgress(session);
      session.status = 'Progress connected';
      try {
        const remote = await remoteProgress(session);
        session.progress = mergeProgress(remote.progress,session.progress);
        session.dirty = Object.entries(session.progress).some(([episode,value]) => !remote.progress[episode] || remote.progress[episode].updated < value.updated);
        session.status = session.dirty ? 'Syncing progress…' : 'Progress synced to SFTP';
      } catch {session.status = 'Progress waiting to sync';}
      cacheProgress(session);
      let persistenceMessage = '';
      try {if (save) await remember(profile);else await vault('delete');}
      catch {persistenceMessage = 'Browser storage is unavailable. This connection will last until you close the tab.';}
      if (active) await closeSession(active);
      active = session;
      $('secure-password').value = '';$('secure-key').value = '';
      $('secure-dialog').close();
      $('secure-state').textContent = 'SFTP connected';
      syncStatus(session,session.status);
      await onConnection(session.progress,persistenceMessage);
      if (session.dirty) void flush(session);
    } catch (error) {
      if (session !== active) void closeSession(session);
      $('secure-status').textContent = error.name === 'TypeError' || error.name === 'TimeoutError' ? 'Could not reach the bridge. Check its HTTPS URL and allowed site origin.' : error.message;
      if (!$('secure-dialog').open) $('secure-dialog').showModal();
    } finally {busy = false;$('secure-connect').disabled = false;$('secure-forget').disabled = false;}
  }

  function show(profile) {
    if (profile) {
      $('secure-address').value = profile.address;$('secure-bridge').value = profile.gateway;$('secure-user').value = profile.username;
    }
    $('secure-password').value = '';$('secure-key').value = '';
    $('secure-status').textContent = '';
    if (!$('secure-dialog').open) $('secure-dialog').showModal();
  }

  async function start(callbacks) {
    ({onConnection,onOpen,onSync} = callbacks);
    navigator.serviceWorker?.addEventListener('message',async event => {
      const {type,id,rejectedToken} = event.data || {};
      if (type !== 'secure-media-context' || event.source?.scriptURL !== workerURL.href || !event.ports[0]) return;
      const session = active, port = event.ports[0];
      try {
        const asset = session?.assets.get(id);
        if (!asset) throw new Error('Unknown asset.');
        const token = await authorize(session,rejectedToken);
        if (session !== active) throw new Error('Session changed.');
        port.postMessage({asset,token,key:session.key,gateway:session.profile.gateway});
      } catch {port.postMessage(null);}
      finally {port.close();}
    });
    $('secure-open').onclick = () => {onOpen();show(active?.profile);};
    $('secure-form').onsubmit = event => {
      event.preventDefault();
      connect({address:$('secure-address').value.trim(),gateway:$('secure-bridge').value.trim(),username:$('secure-user').value.trim(),password:$('secure-password').value,mediaKey:$('secure-key').value.trim()},$('secure-remember').checked);
    };
    $('secure-forget').onclick = async () => {
      if (busy) return;
      try {await vault('delete');}
      catch {$('secure-status').textContent = 'Could not clear browser credentials. Clear this site’s data in your browser.';return;}
      const previous = active;active = null;
      $('secure-state').textContent = 'Connect SFTP';$('secure-sync-status').textContent = '';
      await onConnection({});
      void closeSession(previous);
      show();$('secure-status').textContent = 'Disconnected. Saved credentials cleared.';
    };
    window.addEventListener('online',() => void flush(active));
    document.addEventListener('visibilitychange',() => {if (document.hidden) void flush(active);});
    let profile;
    try {
      const saved = await vault('get');
      if (saved) profile = await format.openJSON(saved.key,'browser-profile',saved.encrypted);
    } catch {}
    show(profile);
    if (profile) void connect(profile,true);
  }

  async function list(refresh) {
    if (!active) return [];
    if (refresh) await loadIndex(active);
    return active.episodes;
  }

  window.SecureLibrary = {start,list,saveProgress};
})();
