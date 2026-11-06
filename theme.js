'use strict';
// Apply the saved appearance before the page paints, including after a reload.
try {
  const key = document.documentElement.hasAttribute('data-remote') ? 'sprechzimmer.remote.state' : 'sprechzimmer.state';
  const settings = JSON.parse(localStorage.getItem(key) || 'null')?.settings;
  const theme = settings?.theme;
  document.documentElement.dataset.theme = ['light','dark'].includes(theme) ? theme : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
} catch {document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';}
