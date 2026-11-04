import { PlayerPage } from './player-page.mjs?rev=2';

const page = new PlayerPage({
  windowObject: window,
  documentObject: document,
  nodes: {
    shell: document.getElementById('player-shell'),
    status: document.getElementById('player-status'),
    diagnostic: document.getElementById('player-diagnostic'),
    origin: document.getElementById('page-origin'),
    play: document.getElementById('play'),
    close: document.getElementById('close'),
  },
});
page.start();
