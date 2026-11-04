import { PlayerPage } from './player-page.mjs';

const page = new PlayerPage({
  windowObject: window,
  documentObject: document,
  nodes: {
    shell: document.getElementById('player-shell'),
    status: document.getElementById('player-status'),
    origin: document.getElementById('page-origin'),
    play: document.getElementById('play'),
    close: document.getElementById('close'),
  },
});
page.start();
