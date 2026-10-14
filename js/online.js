// Partida online em 4 aparelhos, sem servidor próprio.
//
// Quem cria a sala é o ANFITRIÃO: o aparelho dele roda o jogo (GameEngine) e
// os robôs. Os outros aparelhos só mandam jogadas e recebem o que podem ver.
// Tudo passa por um servidor MQTT público. Cada jogador combina uma chave
// com o anfitrião (ECDH) e as mensagens com pedras vão cifradas (AES-GCM),
// então quem espiar o servidor não vê a mão de ninguém.
import { MqttLite } from './mqtt-lite.js';
import { BOT_NAMES, GameEngine } from './engine.js';
import { createMatch } from './game.js';

export const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
const TOPIC_ROOT = 'ddupla/v1';
const NOT_FOUND_MS = 8000;

// Para testes locais: ?broker=ws://localhost:1884
const brokerOverride = new URLSearchParams(location.search).get('broker');

export function brokerForCode(code) {
  if (brokerOverride) return brokerOverride;
  return BROKERS[CODE_ALPHABET.indexOf(code[0]) % BROKERS.length];
}

export function normalizeCode(raw) {
  const code = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== CODE_LENGTH) return null;
  if ([...code].some((c) => !CODE_ALPHABET.includes(c))) return null;
  return code;
}

function newCode(brokerIndex) {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
    const code = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    if (brokerOverride || CODE_ALPHABET.indexOf(code[0]) % BROKERS.length === brokerIndex) return code;
  }
}

export const cleanName = (name) => String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 14) || 'Jogador';

// ---------- Criptografia ----------
const te = new TextEncoder();
const td = new TextDecoder();

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromB64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function loadOrCreateKeys(storage) {
  const saved = storage.get();
  if (saved?.priv && saved?.pub) {
    try {
      const priv = await crypto.subtle.importKey('jwk', saved.priv, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
      return { priv, pubJwk: saved.pub };
    } catch {
      // chave salva inválida: gera outra
    }
  }
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  storage.set({ priv, pub });
  return { priv: pair.privateKey, pubJwk: pub };
}

async function sharedKey(priv, pubJwk) {
  const pub = await crypto.subtle.importKey('jwk', pubJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  return crypto.subtle.deriveKey({ name: 'ECDH', public: pub }, priv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function seal(key, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(data)));
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

async function unseal(key, box) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.ct));
  return JSON.parse(td.decode(plain));
}

function parse(payload) {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

const emptySeat = () => ({ cid: null, kind: null, name: '', online: false });

// ---------- Anfitrião ----------
export class HostSession {
  // saved: dados de uma sala salva no aparelho, para voltar depois de recarregar.
  constructor({ me, keys, saved = null, delay, onUpdate, onSave }) {
    this.role = 'host';
    this.me = me;
    this.keys = keys;
    this.onUpdate = onUpdate;
    this.onSave = onSave;
    this.delay = delay;
    this.boot = Math.random().toString(36).slice(2, 10);
    this.rev = 0;
    this.status = 'connecting';
    this.clients = new Map();
    this.saved = saved;

    if (saved) {
      this.code = saved.code;
      this.phase = saved.phase;
      this.seats = saved.seats.map((s) => ({ ...s, online: s.kind === 'bot' || s.cid === me.id }));
    } else {
      this.code = null;
      this.phase = 'lobby';
      this.seats = [emptySeat(), emptySeat(), emptySeat(), emptySeat()];
      this.seats[0] = { cid: me.id, kind: 'human', name: me.name, online: true };
    }
  }

  get prefix() {
    return `${TOPIC_ROOT}/${this.code}`;
  }

  async start() {
    if (this.saved) {
      for (const [id, c] of Object.entries(this.saved.clients ?? {})) {
        try {
          this.clients.set(id, { pub: c.pub, name: c.name, key: await sharedKey(this.keys.priv, c.pub), online: false });
        } catch {
          // ignora cliente com chave inválida
        }
      }
      await this.connect(brokerForCode(this.code));
      if (this.phase === 'game') this.createEngine(this.saved.match);
      this.saved = null;
    } else {
      const order = brokerOverride ? [0] : BROKERS.map((_, i) => i);
      let lastError = null;
      for (const index of order) {
        this.code = newCode(index);
        try {
          await this.connect(brokerForCode(this.code));
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
        }
      }
      if (lastError) throw lastError;
    }
    this.broadcast();
  }

  async connect(url) {
    this.mqtt?.end();
    this.mqtt = new MqttLite(url, {
      will: { topic: `${this.prefix}/state`, payload: JSON.stringify({ v: 1, hostOffline: true }), retain: true },
      onMessage: (topic, payload) => this.receive(topic, payload),
      onStatus: (status) => {
        this.status = status === 'online' ? 'online' : 'reconnecting';
        if (status === 'online') this.broadcast();
        else this.update();
      },
    });
    await this.mqtt.connect();
    this.status = 'online';
    this.mqtt.subscribe(`${this.prefix}/host`);
  }

  createEngine(match = null) {
    this.engine = new GameEngine({
      match: match ?? createMatch(),
      seats: this.seats,
      delay: this.delay,
      onChange: () => this.broadcast(),
    });
    this.engine.begin();
  }

  mySeat() {
    return this.seats.findIndex((s) => s.cid === this.me.id);
  }

  async receive(topic, payload) {
    if (topic !== `${this.prefix}/host`) return;
    const msg = parse(payload);
    if (!msg || typeof msg.from !== 'string' || msg.from === this.me.id) return;

    if (msg.type === 'hello' && msg.pub) {
      let key;
      try {
        key = await sharedKey(this.keys.priv, msg.pub);
      } catch {
        return;
      }
      const name = cleanName(msg.name);
      this.clients.set(msg.from, { pub: msg.pub, key, name, online: true });
      const seat = this.seats.findIndex((s) => s.cid === msg.from);
      if (seat >= 0) {
        this.seats[seat].name = name;
        if (this.engine && !this.seats[seat].online) {
          this.engine.setOnline(seat, true); // avisa o motor para não jogar no lugar dele
          return;
        }
        this.seats[seat].online = true;
      }
      this.broadcast();
      return;
    }

    if (msg.type === 'bye') {
      this.markOffline(msg.from);
      return;
    }

    const client = this.clients.get(msg.from);
    if (!client || !msg.box) return;
    let cmd;
    try {
      cmd = await unseal(client.key, msg.box);
    } catch {
      return;
    }
    this.command(msg.from, cmd);
  }

  markOffline(cid) {
    const client = this.clients.get(cid);
    if (client) client.online = false;
    const seat = this.seats.findIndex((s) => s.cid === cid);
    if (seat < 0) return this.broadcast();
    if (this.engine) this.engine.setOnline(seat, false);
    else {
      this.seats[seat].online = false;
      this.broadcast();
    }
  }

  command(cid, cmd) {
    const seat = this.seats.findIndex((s) => s.cid === cid);
    switch (cmd?.type) {
      case 'sit':
        this.sit(cid, cmd.seat);
        break;
      case 'stand':
        if (this.phase === 'lobby' && seat >= 0) {
          this.seats[seat] = emptySeat();
          this.broadcast();
        }
        break;
      case 'play':
        if (this.engine && seat >= 0) this.engine.play(seat, cmd.move, cmd.seq);
        break;
      case 'next':
        this.engine?.next(cmd.roundNo);
        break;
      case 'handover':
        if (this.engine && seat >= 0) this.engine.handOver(seat, cmd.seq);
        break;
      case 'leave':
        if (this.phase === 'lobby' && seat >= 0) this.seats[seat] = emptySeat();
        this.markOffline(cid);
        break;
      default:
    }
  }

  sit(cid, seat) {
    if (this.phase !== 'lobby' || !(seat >= 0 && seat < 4)) return;
    if (this.seats[seat].kind === 'human') return;
    const client = cid === this.me.id ? { name: this.me.name } : this.clients.get(cid);
    if (!client) return;
    this.seats.forEach((s, i) => {
      if (s.cid === cid) this.seats[i] = emptySeat();
    });
    this.seats[seat] = { cid, kind: 'human', name: client.name, online: true };
    this.broadcast();
  }

  // ----- ações do próprio anfitrião (chamadas pela interface) -----
  sitMe(seat) {
    this.sit(this.me.id, seat);
  }

  addBot(seat) {
    if (this.phase !== 'lobby' || this.seats[seat].kind) return;
    this.seats[seat] = { cid: null, kind: 'bot', name: BOT_NAMES[seat], online: true };
    this.broadcast();
  }

  clearSeat(seat) {
    if (this.phase !== 'lobby' || this.seats[seat].cid === this.me.id) return;
    this.seats[seat] = emptySeat();
    this.broadcast();
  }

  canStart() {
    return this.phase === 'lobby' && this.seats.every((s) => s.kind) && this.mySeat() >= 0;
  }

  startGame() {
    if (!this.canStart()) return;
    this.phase = 'game';
    this.createEngine();
    if (this.pendingPreset) {
      this.engine.redeal(this.mySeat(), this.pendingPreset.tiles, { keep: this.pendingPreset.keep });
      this.pendingPreset = null;
    }
  }

  play(move, seq) {
    this.engine?.play(this.mySeat(), move, seq);
  }

  next(roundNo) {
    this.engine?.next(roundNo);
  }

  handOver(seq) {
    this.engine?.handOver(this.mySeat(), seq);
  }

  // Modo teste: só o anfitrião, que roda o jogo, pode escolher as próprias pedras.
  // Na sala de espera, a escolha fica guardada para a primeira rodada.
  redealMe(tiles, keep = false) {
    if (this.engine && this.mySeat() >= 0) this.engine.redeal(this.mySeat(), tiles, { keep });
    else {
      this.pendingPreset = { tiles, keep };
      this.update();
    }
  }

  fixedMe() {
    if (this.engine) return this.engine.fixedTiles(this.mySeat());
    return this.pendingPreset?.keep ? this.pendingPreset.tiles.slice() : null;
  }

  releaseFixedMe() {
    if (this.engine) this.engine.releaseFixed();
    else if (this.pendingPreset) this.pendingPreset.keep = false;
    this.update();
  }

  close() {
    this.engine?.pause();
    if (this.mqtt?.connected) this.mqtt.publish(`${this.prefix}/state`, '', { retain: true });
    setTimeout(() => this.mqtt?.end(), 300);
    this.onSave?.(null);
  }

  // Pausa enquanto o app está em segundo plano (o iPhone corta a conexão).
  setPaused(paused) {
    if (!this.engine) return;
    if (paused) this.engine.pause();
    else this.engine.resume();
  }

  lobby() {
    return {
      code: this.code,
      isHost: true,
      phase: this.phase,
      mySeat: this.mySeat(),
      seats: this.seats.map((s) => ({ name: s.name, kind: s.kind, online: s.online, isMe: s.cid === this.me.id })),
      canStart: this.canStart(),
    };
  }

  view() {
    return this.engine && this.mySeat() >= 0 ? this.engine.view(this.mySeat()) : null;
  }

  async broadcast() {
    this.rev += 1;
    const rev = this.rev;
    this.persist();
    this.update();
    if (!this.mqtt?.connected) return;

    const state = {
      v: 1,
      boot: this.boot,
      hostPub: this.keys.pubJwk,
      phase: this.phase,
      seats: this.seats.map((s) => ({ cid: s.cid, kind: s.kind, name: s.name, online: s.online })),
    };
    this.mqtt.publish(`${this.prefix}/state`, JSON.stringify(state), { retain: true });

    for (const [i, s] of this.seats.entries()) {
      if (s.kind !== 'human' || s.cid === this.me.id) continue;
      const client = this.clients.get(s.cid);
      if (!client?.online) continue;
      const view = this.engine ? this.engine.view(i) : null;
      const box = await seal(client.key, { rev, boot: this.boot, view });
      if (rev !== this.rev) return; // já existe um estado mais novo saindo
      this.mqtt.publish(`${this.prefix}/to/${s.cid}`, JSON.stringify({ box }));
    }
  }

  persist() {
    const clients = {};
    for (const [id, c] of this.clients) clients[id] = { pub: c.pub, name: c.name };
    this.onSave?.({
      role: 'host',
      code: this.code,
      phase: this.phase,
      seats: this.seats.map(({ cid, kind, name }) => ({ cid, kind, name })),
      clients,
      match: this.engine?.match ?? null,
    });
  }

  update() {
    this.onUpdate?.(this);
  }
}

// ---------- Convidado ----------
export class ClientSession {
  constructor({ me, keys, code, onUpdate, onSave }) {
    this.role = 'client';
    this.me = me;
    this.keys = keys;
    this.code = code;
    this.onUpdate = onUpdate;
    this.onSave = onSave;
    this.status = 'connecting';
    this.state = null;
    this.currentView = null;
    this.key = null;
    this.helloBoot = null;
    this.lastRev = { boot: null, rev: 0 };
  }

  get prefix() {
    return `${TOPIC_ROOT}/${this.code}`;
  }

  async start() {
    this.mqtt = new MqttLite(brokerForCode(this.code), {
      will: { topic: `${this.prefix}/host`, payload: JSON.stringify({ type: 'bye', from: this.me.id }) },
      onMessage: (topic, payload) => this.receive(topic, payload),
      onStatus: (status) => {
        if (status === 'online') {
          // Reconectou: manda "oi" de novo quando chegar o estado da sala.
          this.helloBoot = null;
          this.status = this.state ? 'online' : 'connecting';
        } else this.status = 'reconnecting';
        this.update();
      },
    });
    this.mqtt.subscribe(`${this.prefix}/state`);
    this.mqtt.subscribe(`${this.prefix}/to/${this.me.id}`);
    await this.mqtt.connect();
    this.onSave?.({ role: 'client', code: this.code });

    this.notFoundTimer = setTimeout(() => {
      if (!this.state) {
        this.status = 'not-found';
        this.update();
      }
    }, NOT_FOUND_MS);
  }

  async receive(topic, payload) {
    if (topic === `${this.prefix}/state`) {
      if (!payload) {
        this.status = 'closed';
        this.onSave?.(null);
        this.update();
        return;
      }
      const msg = parse(payload);
      if (!msg || msg.v !== 1) return;
      if (msg.hostOffline) {
        this.status = 'host-offline';
        this.update();
        return;
      }
      if (!msg.hostPub || !Array.isArray(msg.seats)) return;
      this.state = msg;
      this.status = 'online';
      if (msg.boot !== this.helloBoot) {
        try {
          this.key = await sharedKey(this.keys.priv, msg.hostPub);
        } catch {
          return;
        }
        this.helloBoot = msg.boot;
        this.mqtt.publish(`${this.prefix}/host`, JSON.stringify({
          type: 'hello', from: this.me.id, pub: this.keys.pubJwk, name: this.me.name,
        }));
      }
      this.update();
      return;
    }

    if (topic === `${this.prefix}/to/${this.me.id}`) {
      const msg = parse(payload);
      if (!msg?.box || !this.key) return;
      let data;
      try {
        data = await unseal(this.key, msg.box);
      } catch {
        return;
      }
      if (data.boot === this.lastRev.boot && data.rev <= this.lastRev.rev) return;
      this.lastRev = { boot: data.boot, rev: data.rev };
      this.currentView = data.view;
      this.update();
    }
  }

  async send(cmd) {
    if (!this.key) return;
    const box = await seal(this.key, cmd);
    this.mqtt.publish(`${this.prefix}/host`, JSON.stringify({ from: this.me.id, box }));
  }

  sitMe(seat) { this.send({ type: 'sit', seat }); }
  play(move, seq) { this.send({ type: 'play', move, seq }); }
  next(roundNo) { this.send({ type: 'next', roundNo }); }
  handOver(seq) { this.send({ type: 'handover', seq }); }
  setPaused() {}

  close() {
    clearTimeout(this.notFoundTimer);
    this.send({ type: 'leave' }).finally(() => setTimeout(() => this.mqtt?.end(), 300));
    this.onSave?.(null);
  }

  lobby() {
    const seats = this.state?.seats ?? [];
    return {
      code: this.code,
      isHost: false,
      phase: this.state?.phase ?? 'lobby',
      mySeat: seats.findIndex((s) => s.cid === this.me.id),
      seats: [0, 1, 2, 3].map((i) => ({
        name: String(seats[i]?.name ?? ''),
        kind: seats[i]?.kind ?? null,
        online: !!seats[i]?.online,
        isMe: seats[i]?.cid === this.me.id,
      })),
      canStart: false,
    };
  }

  view() {
    return this.state?.phase === 'game' ? this.currentView : null;
  }

  update() {
    this.onUpdate?.(this);
  }
}
