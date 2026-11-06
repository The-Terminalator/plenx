'use strict';

((root) => {
  const chunkBytes = 1024 * 1024;
  const overhead = 12 + 16; // AES-GCM nonce followed by ciphertext and authentication tag.
  const filenameBytes = 48;
  const encryptedNameLength = 2 * (filenameBytes + overhead);
  const assetID = new RegExp(`^(?:[a-f0-9]{32}|[a-f0-9]{${encryptedNameLength}})$`);
  const catalogFilename = new RegExp(`^[a-f0-9]{${encryptedNameLength}}\\.szi$`);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', {fatal:true});

  function sftpAddress(value) {
    const url = new URL(value);
    if (url.protocol !== 'sftp:' || !url.hostname || url.username || url.password ||
        (url.pathname && url.pathname !== '/') || url.search || url.hash) {
      throw new Error('Enter an SFTP address such as sftp://media.example.com:22.');
    }
    const port = Number(url.port || 22);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SFTP port.');
    return {address:`sftp://${url.hostname.toLowerCase()}:${port}`, host:url.hostname.replace(/^\[|\]$/g,''), port};
  }

  async function importKey(text) {
    if (!/^[a-f0-9]{64}$/i.test(text)) throw new Error('Enter the 64-character media key produced by the pack command.');
    const bytes = Uint8Array.from(text.match(/../g), part => parseInt(part,16));
    return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);
  }

  function parameters(id,index,iv) {
    return {name:'AES-GCM',iv,additionalData:encoder.encode(`sprechzimmer/1/${id}/${index}`)};
  }

  async function seal(key,id,index,value) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(parameters(id,index,iv),key,value);
    const bytes = new Uint8Array(iv.length + cipher.byteLength);
    bytes.set(iv);bytes.set(new Uint8Array(cipher),iv.length);
    return bytes;
  }

  async function open(key,id,index,value) {
    const bytes = new Uint8Array(value);
    if (bytes.length < overhead) throw new Error('Encrypted data is incomplete.');
    return new Uint8Array(await crypto.subtle.decrypt(parameters(id,index,bytes.subarray(0,12)),key,bytes.subarray(12)));
  }

  async function openJSON(key,id,bytes) {
    return JSON.parse(decoder.decode(await open(key,id,0,bytes)));
  }

  function sealJSON(key,id,value) {
    return seal(key,id,0,encoder.encode(JSON.stringify(value)));
  }

  function byteRange(header,size) {
    if (!Number.isSafeInteger(size) || size < 1) return null;
    if (!header) return {start:0,end:size-1,partial:false};
    const match = /^bytes=(\d*)-(\d*)$/i.exec(header);
    if (!match || (!match[1] && !match[2])) return null;
    const from = match[1] ? Number(match[1]) : null;
    const to = match[2] ? Number(match[2]) : null;
    if ((from !== null && !Number.isSafeInteger(from)) || (to !== null && !Number.isSafeInteger(to))) return null;
    const start = from === null ? Math.max(0,size-to) : from;
    const end = from === null || to === null ? size-1 : Math.min(size-1,to);
    return start <= end ? {start,end,partial:true} : null;
  }

  function chunkRange(size,index) {
    const length = Math.min(chunkBytes,size-index*chunkBytes);
    const start = index*(chunkBytes+overhead);
    return {start,end:start+length+overhead-1,length,total:size+Math.ceil(size/chunkBytes)*overhead};
  }

  const api = {chunkBytes,overhead,filenameBytes,assetID,catalogFilename,sftpAddress,importKey,seal,open,sealJSON,openJSON,byteRange,chunkRange};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SecureFormat = api;
})(globalThis);
