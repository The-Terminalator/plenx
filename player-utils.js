'use strict';
(function (root,factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlayerUtils = api;
})(typeof window !== 'undefined' ? window : globalThis,() => {
  const rates = [0.5,0.75,1,1.25,1.5,2];
  function shortcut(event,{watching = false,dialogOpen = false,editing = false,nativeControl = false,rangeControl = false} = {}) {
    if (!watching || dialogOpen || editing || event.ctrlKey || event.altKey || event.metaKey || event.repeat) return null;
    const key = event.key.toLowerCase();
    // Space/Enter keep native button and slider behavior when those controls have focus.
    if (nativeControl && [' ','enter'].includes(key)) return null;
    if (rangeControl && ['arrowleft','arrowright','arrowup','arrowdown'].includes(key)) return null;
    if (key === 'arrowleft') return event.shiftKey ? 'previous' : 'back';
    if (key === 'arrowright') return event.shiftKey ? 'next' : 'forward';
    return {' ':'play',k:'play',r:'replay',s:'save',l:'loop',t:'translation',f:'fullscreen',m:'mute',c:'captions','[':'slower',']':'faster'}[key] || null;
  }
  function seek(time,delta,duration) {return Number.isFinite(duration) && duration > 0 ? Math.max(0,Math.min(duration,(Number(time) || 0)+delta)) : 0;}
  function speed(current,direction) {const at = rates.indexOf(Number(current));return rates[Math.max(0,Math.min(rates.length-1,(at < 0 ? 2 : at)+direction))];}
  function continueEpisode(progress,available,last) {
    const resumable = Object.entries(progress).filter(([id,p]) => available.includes(id) && p.time > 0 && p.duration > 0 && p.time < p.duration*0.95).sort((a,b) => (b[1].updated || 0)-(a[1].updated || 0));
    const unfinished = id => !progress[id]?.duration || progress[id].time < progress[id].duration*0.95;
    return resumable[0]?.[0] || (available.includes(last) && unfinished(last) ? last : available.find(unfinished)) || available[0] || 'demo';
  }
  return {shortcut,seek,speed,continueEpisode};
});
