/* Shared, dependency-free subtitle parsing and indexing. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Subtitles = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function timestamp(value) {
    const match = value.trim().match(/^(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{1,3})$/);
    if (!match || +match[2] > 59 || +match[3] > 59) return NaN;
    return +(match[1] || 0) * 3600 + +match[2] * 60 + +match[3] + +match[4].padEnd(3, '0') / 1000;
  }
  function plain(value) {
    return value.replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '')
      .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, entity => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '})[entity])
      .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => { const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : +code; return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; }).trim();
  }
  function parse(input) {
    if (typeof input !== 'string' || input.length > 10_000_000) throw new Error('Subtitle file is too large or invalid.');
    const blocks = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n\s*\n/);
    const cues = [];
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      if (/^(NOTE(?:\s|$)|STYLE$|REGION$|WEBVTT(?:\s|$))/.test(lines[0])) continue;
      const at = lines.findIndex(line => line.includes('-->'));
      if (at < 0) continue;
      const parts = lines[at].split('-->');
      const start = timestamp(parts[0]);
      const end = timestamp(parts[1].trim().split(/\s/)[0]);
      const text = plain(lines.slice(at + 1).join('\n'));
      if (Number.isFinite(start) && Number.isFinite(end) && end > start && text) cues.push({start, end, text});
    }
    cues.sort((a, b) => a.start - b.start || a.end - b.end);
    if (!cues.length) throw new Error('No valid subtitle cues found. Choose an SRT or WebVTT file.');
    return cues;
  }
  function index(cues) {let max = -Infinity; return {cues, ends:cues.map(c => (max = Math.max(max,c.end)))};}
  function upperBound(cues, time) {
    let lo = 0, hi = cues.length;
    while (lo < hi) {const mid = (lo + hi) >>> 1; if (cues[mid].start <= time) lo = mid + 1; else hi = mid;}
    return lo;
  }
  function at(idx, time) {
    for (let i = upperBound(idx.cues,time) - 1; i >= 0 && idx.ends[i] > time; i--) if (idx.cues[i].end > time) return i;
    return -1;
  }
  function align(primary, secondary) {
    const idx = index(secondary);
    return primary.map(cue => {
      const matches = [];
      for (let i = upperBound(secondary,cue.end - 0.001) - 1; i >= 0 && idx.ends[i] > cue.start; i--) if (secondary[i].end > cue.start) matches.unshift(secondary[i].text);
      return [...new Set(matches)].join('\n');
    });
  }
  function srt(cues) {
    const clock = time => {
      const ms = Math.round(Math.max(0,time) * 1000);
      return `${String(Math.floor(ms / 3600000)).padStart(2,'0')}:${String(Math.floor(ms / 60000) % 60).padStart(2,'0')}:${String(Math.floor(ms / 1000) % 60).padStart(2,'0')},${String(ms % 1000).padStart(3,'0')}`;
    };
    return cues.map((cue,i) => `${i + 1}\n${clock(cue.start)} --> ${clock(cue.end)}\n${cue.text}\n`).join('\n');
  }
  function preferFolderGerman(local,track) {
    return track?.kind === 'audio-transcript' && !['user','user-edited'].includes(local?.deSource);
  }
  function timingForGermanTrack(timing,track) {
    const reference = track?.timingReference || track?.revision;
    if (track?.kind !== 'audio-transcript' || !reference || timing?.deReference === reference) return timing;
    return {...timing,de:0,deReference:reference,tracks:{...timing?.tracks}};
  }
  return {parse,index,at,upperBound,align,srt,timestamp,preferFolderGerman,timingForGermanTrack};
});
