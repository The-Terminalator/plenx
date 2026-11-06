'use strict';

importScripts('secure-format.js');
const format = self.SecureFormat;
const prefix = new URL('secure-media/',self.registration.scope);

self.addEventListener('install',event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event => event.waitUntil(self.clients.claim()));

async function playbackContext(clientID,id,rejectedToken) {
  const page = await self.clients.get(clientID);
  if (!page) throw new Error('The library tab is closed.');
  const channel = new MessageChannel();
  return new Promise((resolve,reject) => {
    const done = () => {clearTimeout(timer);channel.port1.close();};
    const timer = setTimeout(() => {done();reject(new Error('The library session is unavailable.'));},20000);
    channel.port1.onmessage = ({data}) => {
      done();
      if (!data?.key || !data.asset) reject(new Error('Connect to your library first.'));
      else resolve(data);
    };
    page.postMessage({type:'secure-media-context',id,rejectedToken},[channel.port2]);
  });
}

async function serve(event,id) {
  const request = event.request;
  if (!['GET','HEAD'].includes(request.method)) return new Response(null,{status:405});
  let context;
  try {context = await playbackContext(event.clientId,id);}
  catch {return new Response('Connect to your encrypted library.',{status:401});}
  const {asset} = context;
  const range = format.byteRange(request.headers.get('Range'),asset.size);
  if (!range) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${asset.size}`}});
  const headers = {
    'Content-Type':asset.type,'Content-Length':String(range.end-range.start+1),
    'Cache-Control':'no-store','Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff'
  };
  if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${asset.size}`;
  const status = range.partial ? 206 : 200;
  if (request.method === 'HEAD') return new Response(null,{status,headers});

  const abort = new AbortController();
  let index = Math.floor(range.start/format.chunkBytes);
  const last = Math.floor(range.end/format.chunkBytes);
  async function block(blockIndex) {
    const chunk = format.chunkRange(asset.size,blockIndex);
    const get = () => fetch(new URL(`v1/assets/${id}`,context.gateway),{
      headers:{Authorization:`Bearer ${context.token}`,Range:`bytes=${chunk.start}-${chunk.end}`},
      cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',
      signal:AbortSignal.any([abort.signal,request.signal,AbortSignal.timeout(30000)])
    });
    let response = await get();
    if (response.status === 401) {
      await response.body?.cancel();
      context = await playbackContext(event.clientId,id,context.token);
      response = await get();
    }
    if (response.status !== 206 || response.headers.get('Content-Range') !== `bytes ${chunk.start}-${chunk.end}/${chunk.total}` ||
        Number(response.headers.get('Content-Length')) !== chunk.length+format.overhead) {
      await response.body?.cancel();
      throw new Error('Invalid encrypted media range.');
    }
    const bytes = await format.open(context.key,id,blockIndex,await response.arrayBuffer());
    if (bytes.length !== chunk.length) throw new Error('Invalid decrypted media length.');
    const offset = blockIndex*format.chunkBytes;
    return bytes.subarray(Math.max(0,range.start-offset),Math.min(bytes.length,range.end-offset+1));
  }

  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const bytes = await block(index++);
        if (abort.signal.aborted) return;
        controller.enqueue(bytes);
        if (index > last) controller.close();
      } catch (error) {if (!abort.signal.aborted) controller.error(error);}
    },
    cancel() {abort.abort();}
  });
  return new Response(stream,{status,headers});
}

self.addEventListener('fetch',event => {
  const url = new URL(event.request.url);
  if (url.origin !== prefix.origin || !url.pathname.startsWith(prefix.pathname)) return;
  const id = url.pathname.slice(prefix.pathname.length);
  event.respondWith(format.assetID.test(id) ? serve(event,id) : new Response(null,{status:404}));
});
