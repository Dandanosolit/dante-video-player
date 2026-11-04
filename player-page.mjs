export const IFRAME_API_URL = 'https://www.youtube.com/iframe_api';
const ID = /^[A-Za-z0-9_-]{11}$/;
const STATES = new Map([
  [-1, ['unstarted', 'YouTube aún no ha iniciado el video. Pulsa Reproducir.']],
  [0, ['ended', 'YouTube informó que terminó el video.']],
  [1, ['playing', 'YouTube informó PLAYING en este reproductor. Esto no confirma captura ni imagen en los lentes.']],
  [2, ['paused', 'YouTube informó que el video está pausado.']],
  [3, ['buffering', 'YouTube está cargando datos. Reproducción continua sin confirmar.']],
  [5, ['cued', 'YouTube preparó el video. Pulsa Reproducir.']],
]);
const ERRORS = new Map([
  [2, 'YouTube rechazó un parámetro del video. [YOUTUBE_2]'],
  [5, 'YouTube informó un error de reproducción HTML5. [YOUTUBE_5]'],
  [100, 'Video no disponible: puede haberse retirado o ser privado. [YOUTUBE_100]'],
  [101, 'El propietario no permite reproducir este video incrustado. [YOUTUBE_101]'],
  [150, 'El propietario no permite reproducir este video incrustado. [YOUTUBE_150]'],
  [153, 'YouTube indicó que falta Referer o identificación equivalente. No se cambiará ni inventará esa identidad. [YOUTUBE_153]'],
]);
const fail = code => Object.assign(new Error(code), { code });

export function parseVideoQuery(search) {
  if (typeof search !== 'string' || search.length > 128) throw fail('INVALID_VIDEO');
  const entries = [...new URLSearchParams(search)];
  if (entries.length !== 1 || entries[0][0] !== 'v' || entries[0][1].length !== 11 || !ID.test(entries[0][1])) throw fail('INVALID_VIDEO');
  return entries[0][1];
}

export function actualPageOrigin(location) {
  const raw = location?.origin;
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== raw || location.protocol !== url.protocol) throw fail('INVALID_ORIGIN');
    return raw;
  } catch { throw fail('INVALID_ORIGIN'); }
}

export class PlayerPage {
  constructor({ windowObject, documentObject, nodes, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id) }) {
    Object.assign(this, { window: windowObject, document: documentObject, nodes, setTimer, clearTimer });
    this.started = false; this.closed = false; this.apiPending = false; this.playerPending = false; this.playerReady = false;
    this.player = null; this.script = null; this.timer = null; this.generation = 0;
    this.phase = 'idle'; this.errorCode = null; this.origin = null;
    this.playClick = () => this.playFromClick();
    this.closeClick = () => this.close();
    nodes.play.onclick = this.playClick; nodes.close.onclick = this.closeClick;
    this.pagehide = () => this.close();
    this.window.addEventListener('pagehide', this.pagehide, { once: true });
    this.publish('idle', 'Preparando el reproductor…');
  }
  snapshot() {
    return Object.freeze({ phase: this.phase, playerReady: this.playerReady, errorCode: this.errorCode,
      playingReported: this.phase === 'playing', closed: this.closed,
      physicalVideoVerified: false, captureVerified: false });
  }
  publish(phase, message, errorCode = null) {
    this.phase = phase; this.errorCode = errorCode; this.nodes.status.textContent = message;
    this.nodes.play.disabled = this.closed || !this.playerReady;
    this.nodes.close.disabled = this.closed;
  }
  clearTimeout() { if (this.timer !== null) this.clearTimer(this.timer); this.timer = null; }
  current(generation) { return !this.closed && this.generation === generation; }
  start() {
    if (this.started || this.closed) return false;
    this.started = true;
    try {
      this.videoId = parseVideoQuery(this.window.location.search);
      this.origin = actualPageOrigin(this.window.location);
    } catch (error) {
      this.publish('invalid', error.code === 'INVALID_ORIGIN'
        ? 'Esta página necesita un origen web HTTP(S) real. No funciona abierta como archivo local.'
        : 'Enlace no válido. Usa únicamente ?v= seguido del ID de YouTube de 11 caracteres.');
      return false;
    }
    this.nodes.origin.textContent = `Origen real de esta página: ${this.origin}`;
    const generation = ++this.generation;
    this.apiPending = true;
    this.publish('loading-api', 'Cargando la API oficial de YouTube…');
    this.apiReady = () => {
      if (!this.current(generation) || !this.apiPending) return;
      this.apiPending = false; this.clearTimeout();
      this.mountPlayer(generation);
    };
    this.window.onYouTubeIframeAPIReady = this.apiReady;
    if (typeof this.window.YT?.Player === 'function') { this.apiReady(); return true; }
    const script = this.document.createElement('script'); this.script = script;
    script.src = IFRAME_API_URL; script.async = true;
    script.referrerPolicy = 'strict-origin-when-cross-origin';
    script.onerror = () => this.apiFailure(generation);
    this.timer = this.setTimer(() => this.apiFailure(generation), 15000);
    this.document.head.append(script);
    return true;
  }
  apiFailure(generation) {
    if (!this.current(generation) || !this.apiPending) return;
    this.apiPending = false; this.clearTimeout();
    this.publish('api-error', 'No se pudo cargar la API oficial de YouTube. No se reintentará automáticamente.');
  }
  mountPlayer(generation) {
    if (!this.current(generation)) return;
    const accept = event => this.current(generation) && this.player !== null && event?.target === this.player;
    this.playerPending = true;
    this.publish('loading-player', 'API lista; esperando que el reproductor de YouTube esté listo…');
    this.timer = this.setTimer(() => {
      if (!this.current(generation) || !this.playerPending || this.playerReady) return;
      this.playerPending = false; this.clearTimeout();
      this.publish('player-timeout', 'El reproductor no informó que estuviera listo en 15 segundos. Puedes esperar o cerrarlo; no se reintentará automáticamente. [PLAYER_READY_TIMEOUT]', 'PLAYER_READY_TIMEOUT');
    }, 15000);
    try {
      this.player = new this.window.YT.Player('youtube-player', {
        width: '100%', height: '100%', videoId: this.videoId,
        playerVars: { autoplay: 1, controls: 1, playsinline: 1, origin: this.origin },
        events: {
          onReady: event => {
            if (!accept(event)) return;
            this.playerReady = true; this.playerPending = false; this.clearTimeout();
            if (!['error', 'playing', 'autoplay-blocked'].includes(this.phase)) this.publish('ready', 'Reproductor listo. Se solicitó el inicio automático; si no comienza, pulsa Reproducir.');
            else this.nodes.play.disabled = false;
          },
          onStateChange: event => {
            if (!accept(event) || !STATES.has(event.data)) return;
            if (this.phase === 'error' && event.data !== 1) return;
            const [phase, message] = STATES.get(event.data); this.publish(phase, message);
          },
          onError: event => {
            if (!accept(event)) return;
            this.playerPending = false; this.clearTimeout();
            const code = Number.isInteger(event.data) && event.data > 0 && event.data < 10000 ? event.data : null;
            this.publish('error', ERRORS.get(code) || 'YouTube informó un error del reproductor no reconocido.', code);
          },
          onAutoplayBlocked: event => {
            if (!accept(event) || this.phase === 'error') return;
            this.publish('autoplay-blocked', 'El navegador bloqueó el inicio automático. Pulsa Reproducir o el control de YouTube.');
          },
        },
      });
    } catch {
      this.playerPending = false; this.clearTimeout();
      this.publish('api-error', 'No se pudo crear el reproductor oficial. No se reintentará automáticamente.');
    }
  }
  playFromClick() {
    if (this.closed || !this.playerReady || !this.player) return false;
    this.publish('play-requested', 'Reproducción solicitada con tu toque; esperando la respuesta de YouTube.');
    try { this.player.playVideo(); return true; }
    catch { this.publish('error', 'YouTube no aceptó la solicitud de reproducción.'); return false; }
  }
  close() {
    if (this.closed) return;
    this.closed = true; this.generation++; this.apiPending = false; this.playerPending = false; this.playerReady = false; this.clearTimeout();
    if (this.window.onYouTubeIframeAPIReady === this.apiReady) delete this.window.onYouTubeIframeAPIReady;
    if (this.script) { this.script.onerror = null; this.script.remove(); this.script = null; }
    const player = this.player; this.player = null;
    try { player?.destroy(); } catch { /* The local container is cleared regardless. */ }
    this.nodes.shell.replaceChildren();
    this.publish('closed', 'Reproductor cerrado. No se volverá a cargar automáticamente.');
    this.nodes.play.onclick = null; this.nodes.close.onclick = null;
    this.window.removeEventListener('pagehide', this.pagehide);
  }
}
