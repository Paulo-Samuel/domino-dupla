// Conduz uma partida: aplica jogadas, faz os robôs jogarem e gera a "visão"
// de cada lugar (o que aquele jogador pode ver). Usado no jogo local e pelo
// anfitrião da sala online, que é quem manda no jogo.
import {
  TARGET_SCORE,
  canPlay,
  createMatch,
  passTurn,
  playMove,
  sortHand,
  startRound,
} from './game.js';
import { chooseMove } from './ai.js';

export const BOT_NAMES = ['Beto', 'Lia', 'Duda', 'Zé'];

export class GameEngine {
  // seats: [{ kind: 'human' | 'bot', name, online }]
  constructor({ match = null, seats, botLevel = 2, delay = 900, offlineGrace = 8000, onChange }) {
    this.match = match ?? createMatch();
    this.seats = seats;
    this.botLevel = botLevel;
    this.delay = delay;
    this.offlineGrace = offlineGrace;
    this.onChange = onChange;
    this.timer = null;
    this.paused = false;
  }

  begin() {
    if (!this.match.round) startRound(this.match);
    this.changed();
  }

  changed() {
    this.onChange?.(this);
    this.schedule();
  }

  pause() {
    this.paused = true;
    clearTimeout(this.timer);
  }

  resume() {
    this.paused = false;
    this.schedule();
  }

  schedule() {
    clearTimeout(this.timer);
    const round = this.match.round;
    if (this.paused || !round || round.result) return;

    const seat = round.turn;
    const info = this.seats[seat];
    const isBot = info.kind === 'bot';
    const away = info.kind === 'human' && info.online === false;

    if (!canPlay(round, seat)) {
      // Sem pedra que sirva: passa sozinho, com uma pausa para todos verem.
      this.timer = setTimeout(() => this.act(seat, null), this.delay + (isBot ? 0 : 600));
      return;
    }
    if (isBot || away) {
      const wait = isBot ? this.delay : this.offlineGrace;
      this.timer = setTimeout(() => {
        this.act(seat, chooseMove(round, seat, { level: this.botLevel }));
      }, wait);
    }
  }

  act(seat, move) {
    try {
      if (move) playMove(this.match, seat, move);
      else passTurn(this.match, seat);
    } catch {
      return false;
    }
    this.changed();
    return true;
  }

  // Jogada de um humano. `seq` evita aplicar duas vezes um clique repetido.
  play(seat, move, seq = null) {
    const round = this.match.round;
    if (!round || round.result || round.turn !== seat) return false;
    if (this.seats[seat].kind !== 'human') return false;
    if (seq !== null && seq !== round.seq) return false;
    return this.act(seat, move);
  }

  next(roundNo = null) {
    if (!this.match.round?.result) return false;
    if (roundNo !== null && roundNo !== this.match.roundNo) return false;
    if (this.match.winner !== null) this.match = createMatch();
    startRound(this.match);
    this.changed();
    return true;
  }

  // Modo teste: distribui de novo, dando ao lugar `seat` as pedras escolhidas.
  // Uma rodada em andamento é descartada sem pontuar; depois do fim da
  // rodada (ou da partida) já vale como a próxima.
  redeal(seat, tiles) {
    const { match } = this;
    if (match.winner !== null) this.match = createMatch();
    else if (match.round && !match.round.result) match.roundNo -= 1;
    startRound(this.match, Math.random, { preset: { seat, tiles } });
    this.changed();
    return true;
  }

  setOnline(seat, online) {
    if (this.seats[seat].online === online) return;
    this.seats[seat].online = online;
    this.changed();
  }

  view(seat) {
    const { match } = this;
    const round = match.round;
    return {
      seat,
      players: this.seats.map((s) => ({ name: s.name, kind: s.kind, online: s.online !== false })),
      scores: match.scores.slice(),
      target: TARGET_SCORE,
      roundNo: match.roundNo,
      winner: match.winner,
      board: round.board,
      counts: round.hands.map((h) => h.length),
      hand: sortHand(round.hands[seat]),
      turn: round.turn,
      mustOpenWith: round.mustOpenWith,
      lastAction: round.lastAction,
      seq: round.seq,
      result: round.result ? { ...round.result, hands: round.hands.map((h) => h.slice()) } : null,
      test: !!round.test,
    };
  }
}
