/* SINAPSE — party game pass & play (Vanilla JS + Canvas 2D + Web Audio, 100% offline) */
'use strict';
(() => {
  // ================= Configuração =================
  const WIN_SCORE = 10;
  const COOP_ROUNDS = 8;
  const SAVE_KEY = 'sinapse.save.v1';
  const SETTINGS_KEY = 'sinapse.settings.v1';
  const TEAM = [
    { name: 'Time Azul', short: 'Azul', color: '#4CC9F0' },
    { name: 'Time Rosa', short: 'Rosa', color: '#F72585' },
  ];
  const COOP_COLOR = '#00F5D4';
  // Pulso do time, em % do eixo (distância ao centro): centro verde ±3 (6% de largura) = 4 pontos;
  // braços amarelos até ±11 (+8% de cada lado) = 2 pontos. O alvo é um ponto (a sinapse rompida).
  const ZONE = [3.5, 13.5];
  const Z_OUT = ZONE[ZONE.length - 1];
  const COL = {
    zone: ['#2F7BFF', '#FFD60A', '#39FF6A'], // 0 base azul, 1 braços (amarelo, 2), 2 centro (verde, 4)
    baseGlow: '#0B2C8C',
    brainL: '#3DDCFF',
    brainR: '#C77DFF',
  };
  const RESULT_TXT = {
    4: ['SINAPSE RESTABELECIDA!', 'r4'],
    2: ['CONEXÃO PARCIAL', 'r2'],
    0: ['CURTO-CIRCUITO!', 'r0'],
  };
  const COOP_TIERS = [
    [26, 'Mente Coletiva', 'Vocês praticamente compartilham um cérebro.'],
    [18, 'Conexão Forte', 'A sinapse do grupo está afiadíssima.'],
    [10, 'Sinapse em Formação', 'Os neurônios ainda estão se conhecendo.'],
    [0, 'Sinal Fraco', 'Alguém desligou o roteador mental.'],
  ];

  // ================= Utilidades =================
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
  const easeOutBack = (u) => 1 + 2.7 * Math.pow(u - 1, 3) + 1.7 * Math.pow(u - 1, 2);
  const hexA = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const buzz = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* sem vibração */ } };
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };

  // ================= Persistência (localStorage) =================
  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* modo privado */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* idem */ } },
  };
  const settings = Object.assign({ isPremiumUnlocked: false, muted: false, mode: 'teams' }, store.get(SETTINGS_KEY, {}));
  const saveSettings = () => store.set(SETTINGS_KEY, settings);

  // ================= Estado =================
  let game = null; // { mode, scores, coopScore, round, turn, deck, deckPos, cardId, roundDone, over }
  let phase = 'home'; // home | guide | guideShown | team | suspense | result | over
  const round = { targetX: 50, guessX: 50, oppPick: null, result: null, touched: false };
  const saveGame = () => { if (game) store.set(SAVE_KEY, game); };
  const savedGame = () => { const s = store.get(SAVE_KEY, null) || game; return s && s.mode && !s.over ? s : null; };

  // ================= Cartas =================
  const allCardIds = () => {
    const ids = FREE_CARDS.map((_, i) => 'f' + i);
    if (settings.isPremiumUnlocked) PREMIUM_CARDS.forEach((_, i) => ids.push('p' + i));
    return ids;
  };
  const cardById = (id) => {
    const src = String(id)[0] === 'p' ? PREMIUM_CARDS : FREE_CARDS;
    return src[+String(id).slice(1)] || FREE_CARDS[0];
  };
  function drawCard() {
    if (!game.deck || game.deckPos >= game.deck.length) {
      game.deck = shuffle(allCardIds());
      if (game.deck.length > 1 && game.deck[0] === game.cardId) game.deck.push(game.deck.shift());
      game.deckPos = 0;
    }
    return game.deck[game.deckPos++];
  }
  // Desbloqueou/bloqueou no meio da partida: refaz só o que ainda não saiu do baralho.
  function refreshDeck() {
    const g = game || savedGame();
    if (!g || !g.deck) return;
    const used = g.deck.slice(0, g.deckPos);
    g.deck = used.concat(shuffle(allCardIds().filter((id) => !used.includes(id))));
    if (game) saveGame(); else store.set(SAVE_KEY, g);
  }

  // ================= Elementos =================
  const els = {
    hudL: $('#hudL'), hudR: $('#hudR'), poleBoxL: $('#poleBoxL'), poleBoxR: $('#poleBoxR'), banner: $('#banner'), card: $('#card'), cardTema: $('#cardTema'), poleL: $('#poleL'), poleR: $('#poleR'),
    instr: $('#instr'), opp: $('.opp'), oppLabel: $('#oppLabel'), result: $('#result'), resTitle: $('#resTitle'),
    resPts: $('#resPts'), resOpp: $('#resOpp'), stage: $('#stage'), canvas: $('#wave'), btnNext: $('#btnNext'),
    btnContinue: $('#btnContinue'), btnMute: $('#btnMute'), btnPremium: $('#btnPremium'), btnInstall: $('#btnInstall'), toast: $('#toast'),
  };

  // ================= Áudio (Web Audio, sintetizado) =================
  const audio = (() => {
    let ac = null, master = null, nbuf = null, drag = null;
    const VOL = 0.7;
    function init() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      const comp = ac.createDynamicsCompressor();
      comp.connect(ac.destination);
      master = ac.createGain();
      master.gain.value = settings.muted ? 0 : VOL;
      master.connect(comp);
      nbuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = nbuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    function env(g, s, vol, a, dur) {
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(vol, s + a);
      g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
    }
    function tone(type, f, f2, delay, dur, vol, a = 0.008) {
      if (!ac) return;
      const s = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, s);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, s + dur);
      env(g, s, vol, a, dur);
      o.connect(g); g.connect(master);
      o.start(s); o.stop(s + dur + 0.05);
    }
    function noise(ftype, f, f2, delay, dur, vol, q = 1, a = 0.005) {
      if (!ac) return;
      const s = ac.currentTime + delay, src = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain();
      src.buffer = nbuf; src.loop = true;
      fl.type = ftype; fl.Q.value = q;
      fl.frequency.setValueAtTime(f, s);
      if (f2) fl.frequency.exponentialRampToValueAtTime(f2, s + dur);
      env(g, s, vol, a, dur);
      src.connect(fl); fl.connect(g); g.connect(master);
      src.start(s, Math.random() * 0.5); src.stop(s + dur + 0.05);
    }
    function boom() {
      noise('lowpass', 2400, 60, 0, 0.8, 0.5, 0.8, 0.004);
      tone('sine', 140, 36, 0, 0.7, 0.5, 0.004);
    }
    return {
      init,
      suspend() { if (ac && ac.state === 'running') ac.suspend(); },
      setMuted(m) { if (master) master.gain.setTargetAtTime(m ? 0 : VOL, ac.currentTime, 0.02); },
      click() { tone('triangle', 880, 1320, 0, 0.07, 0.07, 0.004); },
      tick() { tone('square', 1300, null, 0, 0.03, 0.035, 0.002); },
      zap() { tone('sawtooth', 500, 1900, 0, 0.12, 0.06); noise('highpass', 3000, null, 0, 0.06, 0.12, 1, 0.002); },
      reveal() {
        noise('highpass', 1800, 9000, 0, 0.3, 0.14);
        tone('sawtooth', 200, 1600, 0, 0.3, 0.07);
        tone('sine', 1568, 784, 0.25, 0.5, 0.09);
        tone('sine', 2093, 1046, 0.3, 0.5, 0.05);
      },
      hide() { tone('sine', 1000, 110, 0, 0.4, 0.12); noise('lowpass', 4000, 150, 0, 0.35, 0.1); },
      suspense() { // crescendo de 1 s que termina no "boom" da revelação
        tone('sawtooth', 70, 620, 0, 1.0, 0.06, 0.9);
        tone('sawtooth', 72.5, 641, 0, 1.0, 0.05, 0.9);
        noise('bandpass', 250, 5200, 0, 1.0, 0.16, 5, 0.9);
      },
      score(pts) {
        if (!ac) return;
        boom();
        if (pts === 0) {
          tone('sawtooth', 220, 50, 0.02, 0.7, 0.16);
          tone('square', 233, 52, 0.02, 0.7, 0.07);
          for (let i = 0; i < 7; i++) noise('highpass', 2500, null, 0.05 + i * 0.07 + Math.random() * 0.03, 0.05, 0.25, 1, 0.002);
          return;
        }
        const chords = { 4: [523.25, 659.25, 783.99, 1046.5, 1318.5], 3: [440, 554.37, 659.25, 880], 2: [392, 493.88, 587.33] };
        const vol = pts === 4 ? 0.12 : pts === 3 ? 0.1 : 0.08;
        chords[pts].forEach((f, i) => {
          tone('triangle', f, null, 0.1 + i * 0.07, 1.1, vol);
          tone('sine', f * 2, null, 0.1 + i * 0.07, 0.8, vol * 0.35);
        });
        if (pts === 4) for (let i = 0; i < 6; i++) tone('sine', 2093 + Math.random() * 1500, null, 0.45 + i * 0.06, 0.18, 0.04);
      },
      win() {
        [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98].forEach((f, i) => {
          tone('triangle', f, null, i * 0.09, 0.7, 0.1);
          tone('sine', f / 2, null, i * 0.09, 0.7, 0.06);
        });
        noise('highpass', 5000, null, 0.5, 0.6, 0.06);
      },
      // Sintetizador magnético enquanto o dedo arrasta o pulso: sawtooth + sine levemente desafinados,
      // lowpass, tom de 110 Hz (0%) a 550 Hz (100%) — audível no alto-falante do celular; crepitar elétrico por cima.
      dragStart() {
        if (!ac || drag) return;
        const t = ac.currentTime;
        const o1 = ac.createOscillator(), o2 = ac.createOscillator(), lp = ac.createBiquadFilter(), g = ac.createGain();
        const n = ac.createBufferSource(), hp = ac.createBiquadFilter(), ng = ac.createGain();
        o1.type = 'sawtooth'; o2.type = 'sine'; o2.detune.value = 9;
        lp.type = 'lowpass'; lp.Q.value = 5; lp.frequency.value = 1400;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.11, t + 0.04);
        n.buffer = nbuf; n.loop = true;
        hp.type = 'highpass'; hp.frequency.value = 3000;
        ng.gain.value = 0;
        o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(master);
        n.connect(hp); hp.connect(ng); ng.connect(master);
        o1.start(); o2.start(); n.start();
        drag = { o1, o2, lp, g, n, ng };
        this.dragUpdate(round.guessX, 0);
      },
      dragUpdate(v, speed) {
        if (!drag) return;
        const s = Math.min(1, speed / 80), t = ac.currentTime;
        const f = 110 * Math.pow(5, v / 100); // 110 → 550 Hz, subida suave (exponencial)
        drag.o1.frequency.setTargetAtTime(f, t, 0.03);
        drag.o2.frequency.setTargetAtTime(f * 1.005, t, 0.03);
        drag.lp.frequency.setTargetAtTime(f * 3 + 600 + s * 2200, t, 0.04);
        drag.g.gain.setTargetAtTime(0.09 + 0.07 * s, t, 0.04);
        drag.ng.gain.setTargetAtTime(Math.random() < 0.25 ? 0.03 + 0.08 * s : 0.002, t, 0.008);
      },
      dragStop() {
        if (!drag) return;
        const d = drag, t = ac.currentTime;
        drag = null;
        for (const gn of [d.g.gain, d.ng.gain]) { // fade-out de 80 ms, sem clique
          gn.cancelScheduledValues(t);
          gn.setValueAtTime(gn.value, t);
          gn.linearRampToValueAtTime(0, t + 0.08);
        }
        d.o1.stop(t + 0.1); d.o2.stop(t + 0.1); d.n.stop(t + 0.1);
      },
    };
  })();

  // ================= Canvas: geometria =================
  const canvas = els.canvas;
  const ctx = canvas.getContext('2d');
  const view = { W: 1, H: 1, dpr: 1, cy: 0, r: 30, bxL: 0, bxR: 0, x0: 0, x1: 1, k: 0.05 };
  const fx = { t: 0, dragE: 0, speed: 0, shake: 0, zoneT0: -9, suspT0: -9, flash: 0, flashColor: '#FFD60A', glitch: 0, bolt: 0 };
  const parts = [], rings = [], dust = [];

  function layout() {
    const r = els.stage.getBoundingClientRect();
    view.W = Math.max(1, r.width);
    view.H = Math.max(1, r.height);
    view.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(view.W * view.dpr);
    canvas.height = Math.round(view.H * view.dpr);
    view.cy = view.H * (view.W > view.H * 1.8 ? 0.44 : 0.5); // deitado: onda um pouco acima, polos cabem embaixo
    view.r = clamp(Math.min(view.W * 0.075, view.H * 0.22), 18, 60);
    view.bxL = 8 + view.r * 1.25;
    view.bxR = view.W - 8 - view.r * 1.25;
    view.x0 = view.bxL + view.r * 1.12; // polo 0 (borda do cérebro esquerdo)
    view.x1 = view.bxR - view.r * 1.12; // polo 100 (borda do cérebro direito)
    view.k = (7 * Math.PI * 2) / Math.max(40, view.x1 - view.x0); // ~7 ciclos no axônio
    view.A = Math.min(view.H, (view.x1 - view.x0) * 0.75); // escala de amplitude (celular em pé não vira "agulha")
    placePoles();
    dust.length = 0;
    for (let i = 0; i < 38; i++) {
      dust.push({ x: Math.random() * view.W, y: Math.random() * view.H, vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 8, p: Math.random() * 6.28, s: 0.6 + Math.random() * 1.4 });
    }
  }
  // Polos ancorados embaixo de cada cérebro, centrados no X exato de 0% e 100% (sem vazar da mesa)
  function placePoles() {
    [[els.poleBoxL, view.x0, view.x0], [els.poleBoxR, view.x1, view.W - view.x1]].forEach(([el, x, room]) => {
      el.style.left = x + 'px';
      el.style.maxWidth = Math.max(110, 2 * room - 12) + 'px';
      el.style.top = Math.max(4, Math.min(view.H - el.offsetHeight - 6, view.cy + view.r * 0.95 + 10)) + 'px';
    });
  }
  const vx = (v) => view.x0 + ((view.x1 - view.x0) * v) / 100;
  const valueFromClientX = (cx) => {
    const r = canvas.getBoundingClientRect();
    return clamp(((cx - r.left - view.x0) / (view.x1 - view.x0)) * 100, 0, 100);
  };

  // ================= Canvas: a onda =================
  // Em cada fase: o pulso do time (zonas coloridas + "calombo") e a sinapse rompida (gap = alvo).
  function scene() {
    const zs = easeOutBack(clamp((fx.t - fx.zoneT0) / 0.5, 0, 1));
    const none = { bumps: [], zc: null, zs: 0, gap: null, gs: 0 };
    switch (phase) {
      case 'home': { const c = 50 + 38 * Math.sin(fx.t * 0.45); return { ...none, bumps: [{ c, a: 1 }], zc: c, zs: 1 }; }
      case 'guideShown': return { ...none, gap: round.targetX, gs: zs };
      case 'team':
      case 'suspense': return { ...none, bumps: [{ c: round.guessX, a: 1 }], zc: round.guessX, zs: 1 };
      case 'result':
      case 'over':
        if (round.result) return { bumps: [{ c: round.guessX, a: 1 }], zc: round.guessX, zs: 1, gap: round.targetX, gs: 1 };
        return none;
      default: return none;
    }
  }
  const gapHalf = (gs) => Math.max(1.8, (13 / Math.max(40, view.x1 - view.x0)) * 100) * gs; // meia largura do rompido
  let curGap = null; // { c, h }: a onda "assenta" no eixo perto do rompido para os terminais ficarem frente a frente

  // y da onda no pixel x (v = mesma posição em 0..100). O pulso só existe dentro de [0,100]: sem wrap-around.
  function waveY(x, v, bumps) {
    const H = view.A, t = fx.t;
    let amp = H * 0.07, harm = 0;
    for (const b of bumps) { // o pulso só existe dentro do trecho colorido (±12); fora dele a onda segue normal
      const d = Math.abs(v - b.c);
      if (d >= Z_OUT) continue;
      const g = (0.5 + 0.5 * Math.cos((Math.PI * d) / Z_OUT)) * b.a;
      amp += H * 0.2 * g;
      harm += g;
    }
    let y = Math.sin(x * view.k - t * 2.4) * amp;
    y += Math.sin(x * view.k * 2.3 - t * 5.2) * H * 0.05 * harm; // "pacote de impulso" mais elétrico
    if (fx.dragE > 0.01) y += Math.sin(x * view.k * 5 - t * 18) * H * 0.07 * fx.dragE * Math.exp(-(((v - round.guessX) / 7) ** 2));
    if (fx.shake > 0) y += (Math.random() - 0.5) * H * 0.12 * fx.shake;
    if (curGap) y *= 0.04 + 0.96 * smooth((Math.abs(v - curGap.c) - curGap.h) / (curGap.h * 1.4));
    return view.cy + y * smooth(v / 3) * smooth((100 - v) / 3); // presa nos terminais dos cérebros
  }

  // -1 = rompido (não desenha), 0 = azul, 1 = braço amarelo (2 pts), 2 = centro verde (4 pts)
  function zoneIdx(v, c, s) {
    if (c == null) return 0;
    const d = Math.abs(v - c), k = Math.max(s, 0.001);
    return d <= ZONE[0] * k ? 2 : d <= ZONE[1] * k ? 1 : 0;
  }

  function drawWave(sc) {
    const span = view.x1 - view.x0;
    const n = Math.max(20, Math.ceil(span / 1.5));
    const P = new Array(n + 1);
    const gh = sc.gap == null ? 0 : gapHalf(sc.gs);
    for (let i = 0; i <= n; i++) {
      const v = (i / n) * 100, x = view.x0 + (span * i) / n;
      const inGap = gh > 0 && Math.abs(v - sc.gap) < gh;
      P[i] = [x, waveY(x, v, sc.bumps), inGap ? -1 : zoneIdx(v, sc.zc, sc.zs)];
    }
    // eco espelhado (bainha do axônio)
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = COL.zone[0];
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const y = view.cy - (P[i][1] - view.cy) * 0.6;
      if (i && P[i][2] !== -1 && P[i - 1][2] !== -1) ctx.lineTo(P[i][0], y); else ctx.moveTo(P[i][0], y);
    }
    ctx.stroke();
    ctx.restore();

    // Trechos contínuos de mesma cor (cada um emenda no primeiro ponto do seguinte)
    const runs = [];
    let s = 0;
    for (let i = 1; i <= n; i++) if (i === n || P[i][2] !== P[s][2]) { runs.push([s, i, P[s][2]]); s = i; }
    const path = (a, b) => { ctx.beginPath(); ctx.moveTo(P[a][0], P[a][1]); for (let i = a + 1; i <= b; i++) ctx.lineTo(P[i][0], P[i][1]); };

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'lighter'; // brilho largo
    for (const [a, b, c] of runs) {
      if (c < 0) continue; // rompido
      ctx.strokeStyle = c ? COL.zone[c] : COL.baseGlow;
      ctx.globalAlpha = c ? 0.33 : 0.55;
      ctx.lineWidth = c === 2 ? 14 : c ? 10 : 8;
      path(a, b); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over'; // núcleo
    ctx.globalAlpha = 1;
    for (const [a, b, c] of runs) {
      if (c < 0) continue;
      ctx.strokeStyle = COL.zone[c];
      ctx.lineWidth = c ? 3.4 : 2.4;
      ctx.shadowColor = COL.zone[c];
      ctx.shadowBlur = c ? 14 : 0;
      path(a, b); ctx.stroke();
      if (c === 2) { ctx.strokeStyle = '#EFFFF2'; ctx.lineWidth = 1.2; ctx.shadowBlur = 0; path(a, b); ctx.stroke(); }
    }
    ctx.restore();
  }

  // ================= Canvas: a sinapse rompida (alvo) =================
  // Dois terminais frente a frente no ponto rompido. Faíscas fracas = sem conexão;
  // no resultado: ponte verde (4 pts, restabelecida), ponte amarela piscando (2 pts), faíscas vermelhas (0).
  function drawSynapse(sc) {
    if (sc.gap == null || sc.gs <= 0.01) return;
    const gh = gapHalf(sc.gs);
    const va = clamp(sc.gap - gh, 0, 100), vb = clamp(sc.gap + gh, 0, 100);
    const xa = vx(va), xb = vx(vb);
    const ya = waveY(xa, va, sc.bumps), yb = waveY(xb, vb, sc.bumps);
    const pts = round.result && (phase === 'result' || phase === 'over') ? round.result.pts : null;
    const col = pts === 4 ? COL.zone[2] : pts === 2 ? COL.zone[1] : pts === 0 ? '#FF2E4D' : '#9FD4FF';
    ctx.save();
    ctx.lineCap = 'round';
    // ponte / faíscas entre os terminais
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 12;
    if (pts === 4 || (pts === 2 && Math.random() < 0.55)) {
      ctx.globalAlpha = pts === 4 ? 0.95 : 0.7;
      ctx.lineWidth = pts === 4 ? 4 : 2.5;
      ctx.beginPath(); ctx.moveTo(xa, ya); ctx.lineTo(xb, yb); ctx.stroke();
    } else if (Math.random() < 0.7) {
      ctx.globalAlpha = pts === 0 ? 0.9 : 0.6;
      ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(xa, ya);
      for (let i = 1; i < 4; i++) {
        const u = i / 4;
        ctx.lineTo(xa + (xb - xa) * u, ya + (yb - ya) * u + (Math.random() - 0.5) * 14);
      }
      ctx.lineTo(xb, yb); ctx.stroke();
    }
    // terminais (botões sinápticos) com vesículas
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const knob = (x, y, dir) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, 22);
      g.addColorStop(0, hexA(col, 0.6)); g.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = g; ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(x, y, 22, 0, Math.PI * 2); ctx.fill();
      // botão sináptico: meia-lua virada para o vão
      ctx.fillStyle = '#0B1640'; ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.shadowColor = col; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.ellipse(x, y, 6, 8.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.shadowBlur = 6;
      for (let i = 0; i < 4; i++) { // vesículas pulsando em direção ao vão
        const a = fx.t * 3 + i * 1.7;
        ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(a));
        ctx.beginPath(); ctx.arc(x + dir * (1 + (i % 2) * 2), y + (i - 1.5) * 3, 1.3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    knob(xa, ya, 1);
    knob(xb, yb, -1);
    ctx.restore();
  }

  // ================= Canvas: cérebros =================
  const NEURONS = [[-0.45, -0.25], [0.05, -0.5], [0.42, -0.12], [-0.15, 0.32], [0.3, 0.38], [-0.55, 0.12]];
  function drawBrain(cx, dir, color, glow) {
    const r = view.r, ry = r * 0.8, t = fx.t;
    ctx.save();
    ctx.translate(cx, view.cy);
    ctx.scale(dir, 1);
    const hg = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 2.4);
    hg.addColorStop(0, hexA(color, Math.min(0.5, 0.16 * glow)));
    hg.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = hg;
    ctx.fillRect(-r * 2.4, -r * 2.4, r * 4.8, r * 4.8);
    // contorno em "nuvem" de giros
    const N = 10, off = 0.3;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2 + off;
      const px = Math.cos(a) * r, py = Math.sin(a) * ry;
      if (i === 0) ctx.moveTo(px, py);
      else { const m = ((i - 0.5) / N) * Math.PI * 2 + off; ctx.quadraticCurveTo(Math.cos(m) * r * 1.25, Math.sin(m) * ry * 1.25, px, py); }
    }
    ctx.closePath();
    ctx.fillStyle = hexA(color, 0.06 + 0.06 * Math.min(glow, 1.5));
    ctx.fill();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8 + 16 * Math.min(glow, 1.6);
    ctx.stroke();
    // sulcos
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    [-0.42, 0.02, 0.44].forEach((k, j) => {
      const span = r * 0.78 * Math.sqrt(1 - k * k);
      for (let s = 0; s <= 14; s++) {
        const x = -span + (2 * span * s) / 14;
        const y = k * ry + Math.sin((x / r) * 6.5 + j * 2.1) * ry * 0.11;
        if (s) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
    });
    ctx.moveTo(-r * 0.05, -ry * 0.95);
    ctx.quadraticCurveTo(r * 0.18, -ry * 0.2, -r * 0.02, ry * 0.55);
    ctx.stroke();
    // neurônios piscando
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#fff';
    NEURONS.forEach(([nx, ny], i) => {
      const a = 0.3 + 0.7 * Math.abs(Math.sin(t * 2.6 + i * 1.7));
      ctx.globalAlpha = a * Math.min(1, 0.5 + glow * 0.5);
      ctx.beginPath(); ctx.arc(nx * r, ny * ry, 1.6 + a, 0, Math.PI * 2); ctx.fill();
    });
    if (fx.flash > 0) { // anel de pontuação
      const e = 1.45 + (1 - fx.flash) * 0.6;
      ctx.globalAlpha = fx.flash;
      ctx.strokeStyle = fx.flashColor; ctx.shadowColor = fx.flashColor; ctx.shadowBlur = 24; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(0, 0, r * e, ry * e, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
  function drawTerminal(x, color, glow) {
    const r = (4 + 1.5 * Math.sin(fx.t * 5) + Math.min(glow, 2) * 2) * 3;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, view.cy, 0, x, view.cy, r);
    g.addColorStop(0, hexA(color, 0.9));
    g.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, view.cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function brainGlow() {
    if (phase === 'suspense') return 0.6 + Math.random() * 1.2; // tremulando
    if (fx.glitch > 0 && Math.random() < 0.4) return 0.05; // falha
    return 0.5 + 0.15 * Math.sin(fx.t * 2.2) + fx.dragE * 0.9 + fx.flash * 1.2;
  }

  // ================= Canvas: marcadores, partículas, efeitos =================
  const teamColor = () => (game && game.mode === 'teams' ? TEAM[game.turn].color : COOP_COLOR);
  function node(v, bumps, color) {
    const x = vx(v), y = waveY(x, v, bumps), p = 1 + 0.18 * Math.sin(fx.t * 6);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y, 0, x, y, 14 * p);
    g.addColorStop(0, hexA(color, 0.35));
    g.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, 14 * p, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowColor = color; ctx.shadowBlur = 10;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); // miolo pequeno: não cobre o centro verde
    ctx.restore();
    return [x, y];
  }
  function label(text, x, y, color) {
    ctx.save();
    ctx.font = '700 12px "Chakra Petch", system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(7, 11, 25, .75)';
    const lx = clamp(x, w / 2 + 10, view.W - w / 2 - 10);
    ctx.fillRect(lx - w / 2 - 6, y - 9, w + 12, 18);
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 10;
    ctx.fillText(text, lx, y);
    ctx.restore();
  }
  // Linha laser tracejada ligando a etiqueta ao ponto exato
  function laser(x, y0, y1, color) {
    ctx.save();
    ctx.setLineDash([4, 5]);
    ctx.lineDashOffset = -fx.t * 30;
    ctx.strokeStyle = hexA(color, 0.85); ctx.shadowColor = color; ctx.shadowBlur = 8; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
    ctx.restore();
  }
  const labelTopY = () => Math.max(14, view.cy - view.A * 0.36 - 18);
  const labelBotY = () => Math.min(view.H - 12, view.cy + view.A * 0.36 + 18);
  // Régua neural: trilho no eixo e marcas fixas em 25%, 50% (losango) e 75% para o olho ter referência
  function drawRuler() {
    const cy = view.cy, h = view.A * 0.3;
    ctx.save();
    ctx.strokeStyle = 'rgba(120, 160, 255, .14)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(view.x0, cy); ctx.lineTo(view.x1, cy); ctx.stroke();
    for (const v of [25, 50, 75]) {
      const x = vx(v), mid = v === 50;
      ctx.setLineDash(mid ? [] : [3, 5]);
      ctx.strokeStyle = mid ? 'rgba(159, 212, 255, .28)' : 'rgba(159, 212, 255, .2)';
      ctx.beginPath(); ctx.moveTo(x, cy - h); ctx.lineTo(x, cy + h); ctx.stroke();
      ctx.setLineDash([]);
      const s = mid ? 6 : 3.5; // losango no topo e na base de cada marca
      ctx.fillStyle = mid ? 'rgba(159, 212, 255, .5)' : 'rgba(159, 212, 255, .32)';
      for (const y of [cy - h, cy + h]) {
        ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath(); ctx.fill();
      }
    }
    ctx.strokeStyle = 'rgba(159, 212, 255, .22)'; ctx.lineWidth = 1.2; // anel neural no centro
    ctx.beginPath(); ctx.arc(vx(50), cy, 11, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  function drawMarkers(sc) {
    const col = teamColor();
    if (phase === 'guideShown') {
      const tx = vx(round.targetX), ty = labelTopY();
      laser(tx, ty + 9, view.cy - 12, '#9FD4FF');
      label('▼ ALVO: SINAPSE ROMPIDA', tx, ty, '#9FD4FF');
    }
    if (phase === 'team' || phase === 'suspense') {
      const [x, y] = node(round.guessX, sc.bumps, col);
      if (phase === 'team' && !round.touched) {
        ctx.save();
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(fx.t * 4);
        ctx.fillStyle = '#fff';
        ctx.font = '700 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('‹  ARRASTE  ›', clamp(x, 50, view.W - 50), Math.max(16, y - 36));
        ctx.restore();
      }
    } else if ((phase === 'result' || phase === 'over') && round.result) {
      const gx = vx(round.guessX), tx = vx(round.targetX), ty = labelTopY(), by = labelBotY();
      laser(tx, ty + 9, view.cy - 12, '#9FD4FF');
      laser(gx, by - 9, waveY(gx, round.guessX, sc.bumps) + 8, col);
      label('▼ ALVO', tx, ty, '#9FD4FF');
      label('▲ PALPITE', gx, by, col);
    }
  }
  function drawBolts(sc) { // raios do palpite até os dois cérebros (3 e 4 pontos)
    if (fx.bolt <= 0 || !round.result) return;
    const gx = vx(round.guessX), gy = waveY(gx, round.guessX, sc.bumps);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = fx.flashColor; ctx.shadowColor = fx.flashColor; ctx.shadowBlur = 16;
    ctx.lineWidth = 2; ctx.globalAlpha = Math.min(1, fx.bolt * 2);
    for (const tx of [view.x0, view.x1]) {
      ctx.beginPath(); ctx.moveTo(gx, gy);
      for (let i = 1; i <= 9; i++) {
        const u = i / 9;
        ctx.lineTo(gx + (tx - gx) * u, gy + (view.cy - gy) * u + (i < 9 ? (Math.random() - 0.5) * view.H * 0.25 : 0));
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  function burst(x, y, n, colors, power) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = power * (0.25 + Math.random() * 0.85);
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - power * 0.35, life: 0, max: 0.5 + Math.random() * 0.9, c: colors[(Math.random() * colors.length) | 0], w: 1 + Math.random() * 2 });
    }
  }
  const ring = (x, y, c, delay = 0) => rings.push({ x, y, c, t: -delay });
  function updateFx(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;
      if (p.life >= p.max) { parts.splice(i, 1); continue; }
      p.vy += 700 * dt; // gravidade
      p.vx *= 1 - 1.5 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let i = rings.length - 1; i >= 0; i--) { rings[i].t += dt; if (rings[i].t > 0.8) rings.splice(i, 1); }
    for (const d of dust) {
      d.x = (d.x + d.vx * dt + view.W) % view.W;
      d.y = (d.y + d.vy * dt + view.H) % view.H;
    }
  }
  function drawParticles() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const p of parts) {
      ctx.globalAlpha = 1 - p.life / p.max; // fade-out
      ctx.strokeStyle = p.c; ctx.lineWidth = p.w;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035); ctx.stroke();
    }
    for (const r of rings) {
      if (r.t < 0) continue;
      const u = r.t / 0.8;
      ctx.globalAlpha = (1 - u) * 0.9; ctx.strokeStyle = r.c; ctx.lineWidth = 3 * (1 - u) + 0.5;
      ctx.beginPath(); ctx.arc(r.x, r.y, 10 + u * view.W * 0.35, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
  function drawDust() {
    ctx.save();
    ctx.fillStyle = '#7FA8FF';
    for (const d of dust) { ctx.globalAlpha = 0.15 + 0.25 * Math.abs(Math.sin(fx.t * 0.8 + d.p)); ctx.fillRect(d.x, d.y, d.s, d.s); }
    ctx.restore();
  }
  function drawGlitch() {
    ctx.save();
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = hexA(i % 2 ? '#FF0040' : '#00F5D4', 0.14 * fx.glitch);
      ctx.fillRect(0, Math.random() * view.H, view.W, 2 + Math.random() * 14);
    }
    ctx.restore();
  }

  function draw() {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.W, view.H);
    if (fx.glitch > 0) ctx.translate((Math.random() - 0.5) * 16 * fx.glitch, (Math.random() - 0.5) * 10 * fx.glitch);
    drawDust();
    const sc = scene();
    curGap = sc.gap == null || sc.gs <= 0.01 ? null : { c: sc.gap, h: gapHalf(sc.gs) };
    drawRuler();
    drawWave(sc);
    drawSynapse(sc);
    const glow = brainGlow();
    drawBrain(view.bxL, 1, COL.brainL, glow);
    drawBrain(view.bxR, -1, COL.brainR, glow);
    drawTerminal(view.x0, COL.brainL, glow);
    drawTerminal(view.x1, COL.brainR, glow);
    drawBolts(sc);
    drawMarkers(sc);
    drawParticles();
    if (fx.glitch > 0) drawGlitch();
  }

  let lastTs = 0;
  function loop(ts) {
    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;
    fx.t += dt;
    const want = dragging ? 0.35 + Math.min(0.65, fx.speed / 60) : 0;
    fx.dragE += (want - fx.dragE) * Math.min(1, dt * 8);
    fx.speed *= Math.pow(0.03, dt);
    if (dragging) audio.dragUpdate(round.guessX, fx.speed);
    fx.shake = phase === 'suspense' ? clamp((fx.t - fx.suspT0) / 1.0, 0, 1) : Math.max(0, fx.shake - dt * 2);
    fx.flash = Math.max(0, fx.flash - dt * 1.1);
    fx.glitch = Math.max(0, fx.glitch - dt);
    fx.bolt = Math.max(0, fx.bolt - dt);
    updateFx(dt);
    draw();
    requestAnimationFrame(loop);
  }

  // ================= Entrada (arrastar o pulso) =================
  let dragging = false, lastPT = 0;
  function endDrag() { if (!dragging) return; dragging = false; audio.dragStop(); }
  canvas.addEventListener('pointerdown', (e) => {
    if (phase !== 'team') return;
    e.preventDefault();
    audio.init();
    dragging = true;
    round.touched = true;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
    lastPT = performance.now();
    round.guessX = valueFromClientX(e.clientX);
    audio.dragStart();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const now = performance.now(), v = valueFromClientX(e.clientX);
    fx.speed = Math.max(fx.speed, (Math.abs(v - round.guessX) / Math.max(8, now - lastPT)) * 1000);
    lastPT = now;
    round.guessX = v;
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => canvas.addEventListener(ev, endDrag));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  function nudge(d) {
    if (phase !== 'team') return;
    round.guessX = clamp(round.guessX + d, 0, 100);
    round.touched = true;
    fx.dragE = Math.max(fx.dragE, 0.6);
    audio.tick();
  }

  // ================= Máquina de estados =================
  function setPhase(p) {
    phase = p;
    document.body.dataset.phase = p;
    const mode = game ? game.mode : '';
    $$('[data-show]').forEach((el) => {
      el.hidden = !(el.dataset.show.split(' ').includes(p) && (!el.dataset.only || el.dataset.only === mode));
    });
    render();
  }

  function startGame(mode) {
    game = { mode, scores: [0, 0], coopScore: 0, round: 1, turn: 0, deck: null, deckPos: 0, cardId: null, roundDone: false, over: false };
    settings.mode = mode;
    saveSettings();
    beginRound();
  }
  function resetRound() {
    round.targetX = 50; round.guessX = 50; round.oppPick = null; round.result = null; round.touched = false;
  }
  function beginRound() {
    resetRound();
    game.cardId = drawCard();
    game.roundDone = false;
    saveGame();
    setPhase('guide');
    els.card.classList.remove('flip'); void els.card.offsetWidth; els.card.classList.add('flip');
  }
  function nextRound() {
    if (checkOver()) { showOver(); return; }
    game.round += 1;
    if (game.mode === 'teams') game.turn = 1 - game.turn;
    beginRound();
  }
  function continueGame() {
    const s = savedGame();
    if (!s) return;
    game = s;
    if (game.roundDone) nextRound();
    else { resetRound(); saveGame(); setPhase('guide'); }
  }
  function goHome() { endDrag(); setPhase('home'); }

  // FASE 1 — Mente Brilhante
  function swapCard() {
    game.cardId = drawCard();
    saveGame();
    render();
    els.card.classList.remove('flip'); void els.card.offsetWidth; els.card.classList.add('flip');
  }
  function revealTarget() {
    round.targetX = 5 + Math.random() * 90;
    fx.zoneT0 = fx.t;
    audio.reveal();
    buzz(25);
    setPhase('guideShown');
    burst(vx(round.targetX), view.cy, 26, ['#9FD4FF', '#FFFFFF'], 200);
  }
  function hideTarget() {
    round.guessX = 50; round.oppPick = null; round.touched = false;
    audio.hide();
    setPhase('team');
  }

  // FASE 2/3 — Sintonia e revelação
  function startSuspense() {
    if (phase !== 'team') return;
    endDrag();
    fx.suspT0 = fx.t;
    audio.suspense();
    buzz([40, 60, 40, 60, 90]);
    setPhase('suspense');
    setTimeout(revealResult, 1000);
  }
  // O alvo (ponto rompido) caiu no centro verde do pulso = 4; num braço amarelo = 2; fora = 0.
  const scoreFor = (d) => (d <= ZONE[0] ? 4 : d <= ZONE[1] ? 2 : 0);
  function checkOver() {
    if (!game) return false;
    if (game.mode === 'teams') { const [a, b] = game.scores; return Math.max(a, b) >= WIN_SCORE && a !== b; }
    return game.round >= COOP_ROUNDS;
  }
  function resolveRound() {
    const d = Math.abs(round.targetX - round.guessX), pts = scoreFor(d);
    const r = { d, pts, opp: 0, oppPick: round.oppPick, over: false, tie: false };
    if (game.mode === 'teams') {
      if (round.oppPick && pts < 4) { // pts < 4 garante alvo ≠ palpite
        const side = round.targetX < round.guessX ? 'left' : 'right';
        if (side === round.oppPick) r.opp = 1;
      }
      game.scores[game.turn] += pts;
      game.scores[1 - game.turn] += r.opp;
      r.tie = game.scores[0] === game.scores[1] && game.scores[0] >= WIN_SCORE;
    } else {
      game.coopScore += pts;
    }
    game.roundDone = true;
    r.over = checkOver();
    saveGame();
    return r;
  }
  function revealResult() {
    if (phase !== 'suspense' || !game) return;
    const r = resolveRound();
    round.result = r;
    fx.zoneT0 = fx.t;
    const x = vx(round.guessX), y = view.cy;
    if (r.pts === 4) {
      burst(x, y, 170, ['#39FF6A', '#B6FFC8', '#FFFFFF', '#00F5D4'], 420);
      ring(x, y, '#39FF6A'); ring(x, y, '#FFFFFF', 0.15);
      fx.flash = 1; fx.flashColor = '#39FF6A'; fx.bolt = 0.7;
      buzz([80, 40, 160]);
    } else if (r.pts === 2) {
      burst(x, y, 80, ['#FFD60A', '#FFE66D', '#FFF3B0'], 280);
      ring(x, y, '#FFD60A');
      fx.flash = 0.5; fx.flashColor = '#FFD60A';
      buzz(60);
    } else {
      burst(x, y, 70, ['#FF2E2E', '#D90429', '#FF8C42'], 280);
      fx.glitch = 0.7; fx.shake = 0.8;
      els.stage.classList.remove('glitch'); void els.stage.offsetWidth; els.stage.classList.add('glitch');
      buzz([30, 30, 30, 30, 120]);
    }
    audio.score(r.pts);
    showResult(r);
    setPhase('result');
    renderHud(r);
  }
  function showResult(r) {
    const [title, cls] = RESULT_TXT[r.pts];
    els.result.className = 'result ' + cls;
    els.resTitle.textContent = title;
    const teams = game.mode === 'teams';
    const plural = r.pts === 1 ? 'ponto' : 'pontos';
    els.resPts.textContent = teams ? `${r.pts ? '+' : ''}${r.pts} ${plural} para o ${TEAM[game.turn].name}` : `${r.pts ? '+' : ''}${r.pts} ${plural} para o grupo`;
    let extra = '';
    if (teams && r.oppPick) {
      const opp = TEAM[1 - game.turn].name;
      extra = r.opp ? `+1 de Interferência para o ${opp}` : r.pts === 4 ? `A sincronia perfeita anulou a interferência do ${opp}` : `A interferência do ${opp} errou o lado`;
    }
    if (r.tie) extra += (extra ? ' · ' : '') + 'Empate na meta: rodada extra!';
    els.resOpp.textContent = extra;
    els.resOpp.hidden = !extra;
    els.btnNext.textContent = r.over ? 'Ver Resultado Final' : 'Próxima Rodada';
  }
  function showOver() {
    game.over = true;
    store.del(SAVE_KEY);
    const t = $('#overTitle'), p = $('#overText'), s = $('#overScore');
    if (game.mode === 'teams') {
      const w = game.scores[0] > game.scores[1] ? 0 : 1;
      t.textContent = `${TEAM[w].name} venceu!`;
      t.style.color = TEAM[w].color;
      p.textContent = 'Sincronia total entre as mentes do time.';
      s.textContent = `${TEAM[0].short} ${game.scores[0]} × ${game.scores[1]} ${TEAM[1].short}`;
    } else {
      const tier = COOP_TIERS.find((x) => game.coopScore >= x[0]);
      t.textContent = tier[1];
      t.style.color = COOP_COLOR;
      p.textContent = tier[2];
      s.textContent = `${game.coopScore} de ${COOP_ROUNDS * 4} pontos possíveis`;
    }
    setPhase('over');
    audio.win();
    buzz([60, 40, 60, 40, 200]);
    for (let i = 0; i < 4; i++) {
      setTimeout(() => burst(view.W * (0.2 + Math.random() * 0.6), view.H * 0.4, 70, ['#FFD60A', '#00F5D4', '#C77DFF', '#FFFFFF'], 380), i * 260);
    }
  }

  // ================= Interface =================
  function render() {
    const teams = !!game && game.mode === 'teams';
    const cur = teams ? TEAM[game.turn] : null, opp = teams ? TEAM[1 - game.turn] : null;
    const card = game && game.cardId ? cardById(game.cardId) : null;
    els.cardTema.textContent = card ? card.tema : '—';
    els.poleL.textContent = card ? card.poloEsquerdo : '';
    els.poleR.textContent = card ? card.poloDireito : '';
    placePoles();
    let banner = '', instr = '';
    if (game) {
      switch (phase) {
        case 'guide':
          banner = teams ? `${cur.name} — Passe o celular para a Mente Brilhante` : `Rodada ${game.round}/${COOP_ROUNDS} — Passe o celular para a Mente Brilhante`;
          instr = 'Só a Mente Brilhante olha a tela agora. Toque abaixo para revelar onde está o alvo.';
          break;
        case 'guideShown':
          banner = `Mente Brilhante${teams ? ' do ' + cur.name : ''}: memorize o alvo`;
          instr = 'Pense em uma dica verbal que represente essa posição na onda (sem falar números!). Diga a dica em voz alta e clique abaixo.';
          break;
        case 'team':
          banner = teams ? `${cur.name} — Sintonizem a frequência` : 'Todos — Sintonizem a frequência';
          instr = 'Celular na mesa! Debatam a dica e arrastem o pulso pela onda.';
          break;
        case 'suspense': banner = 'Sincronizando mentes…'; break;
        case 'result': banner = teams ? `Rodada ${game.round} · ${cur.name}` : `Rodada ${game.round}/${COOP_ROUNDS}`; break;
        default: break;
      }
    }
    els.banner.textContent = banner;
    els.banner.style.color = cur ? cur.color : COOP_COLOR;
    els.instr.textContent = instr;
    els.instr.hidden = !instr;
    if (opp) {
      els.oppLabel.textContent = `${opp.name} (adversário): palpite rápido antes de revelar`;
      els.opp.style.setProperty('--opp', opp.color);
    }
    $$('[data-opp]').forEach((b) => b.classList.toggle('sel', b.dataset.opp === round.oppPick));
    renderHud();
    if (phase === 'home') renderHome();
  }
  function renderHud(scored) {
    if (!game) { els.hudL.innerHTML = els.hudR.innerHTML = ''; return; }
    if (game.mode === 'teams') { // placar de cada time no seu canto
      const pop = (i) => scored && ((i === game.turn && scored.pts) || (i !== game.turn && scored.opp));
      const chip = (i) => `<span class="chip${i === game.turn ? ' on' : ''}${pop(i) ? ' pop' : ''}" style="--c:${TEAM[i].color}">${TEAM[i].short} <b>${game.scores[i]}</b><small>/${WIN_SCORE}</small></span>`;
      els.hudL.innerHTML = chip(0);
      els.hudR.innerHTML = chip(1);
    } else {
      els.hudL.innerHTML = `<span class="chip on${scored && scored.pts ? ' pop' : ''}" style="--c:${COOP_COLOR}">Pontos <b>${game.coopScore}</b></span>`;
      els.hudR.innerHTML = `<span class="chip on" style="--c:#C77DFF">Rodada <b>${game.round}</b><small>/${COOP_ROUNDS}</small></span>`;
    }
  }
  function renderHome() {
    $$('[data-pick]').forEach((b) => b.classList.toggle('sel', b.dataset.pick === settings.mode));
    els.btnContinue.hidden = !savedGame();
    els.btnPremium.innerHTML = settings.isPremiumUnlocked
      ? `${ico('i-check')} Pacote Expansão Neural ativo`
      : `${ico('i-cerebro')} Pacote Expansão Neural (+200 Cartas) - R$ 4,99`;
    els.btnInstall.hidden = !installEvt;
  }
  function openPremium() {
    const open = settings.isPremiumUnlocked;
    $('#premiumPreview').innerHTML = PREMIUM_CARDS.slice(0, 6).map((c) =>
      `<div class="pcard${open ? ' open' : ''}"><b>${esc(c.tema)}</b><span>${open ? esc(c.poloEsquerdo) + ' ↔ ' + esc(c.poloDireito) : ico('i-cadeado', 'sm') + ' polos bloqueados'}</span></div>`).join('');
    $('#premiumStatus').textContent = open ? `✓ Pacote ativo: ${PREMIUM_CARDS.length} cartas extras no baralho.` : 'Prévia das cartas bloqueadas';
    $('#btnBuy').hidden = open;
    $('#btnUnlockTest').textContent = open ? 'Bloquear de novo (teste)' : 'Desbloquear (modo teste)';
    $('#modalPremium').hidden = false;
  }
  function togglePremium() {
    settings.isPremiumUnlocked = !settings.isPremiumUnlocked;
    saveSettings();
    refreshDeck();
    openPremium();
    renderHome();
    if (settings.isPremiumUnlocked) audio.reveal();
    toast(settings.isPremiumUnlocked ? 'Pacote Expansão Neural desbloqueado (teste)!' : 'Pacote bloqueado novamente.');
  }
  let toastTimer = 0;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2600);
  }
  function renderMute() { els.btnMute.innerHTML = ico(settings.muted ? 'i-mudo' : 'i-som'); }
  function ico(id, cls = '') { return `<svg class="ic ${cls}"><use href="#${id}"/></svg>`; }

  // Botão "Instalar como app" (Chrome/Android oferece o evento quando o app ainda não está instalado)
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (phase === 'home') renderHome(); });
  window.addEventListener('appinstalled', () => { installEvt = null; toast('SINAPSE instalado! Procure o ícone na tela inicial.'); renderHome(); });
  async function installApp() {
    if (!installEvt) return;
    installEvt.prompt();
    try { await installEvt.userChoice; } catch (e) { /* cancelado */ }
    installEvt = null;
    renderHome();
  }

  // ================= Ligações =================
  $('#btnStart').onclick = () => startGame(settings.mode);
  $$('[data-pick]').forEach((b) => { b.onclick = () => { settings.mode = b.dataset.pick; saveSettings(); renderHome(); }; });
  els.btnContinue.onclick = continueGame;
  els.btnPremium.onclick = openPremium;
  $('#btnRules').onclick = () => { $('#modalRules').hidden = false; };
  $('#btnReveal').onclick = revealTarget;
  $('#btnSwap').onclick = swapCard;
  $('#btnHide').onclick = hideTarget;
  $('#btnSync').onclick = startSuspense;
  $('#btnNext').onclick = () => { if (round.result && round.result.over) showOver(); else nextRound(); };
  $('#btnLeft').onclick = () => nudge(-1);
  $('#btnRight').onclick = () => nudge(1);
  $$('[data-opp]').forEach((b) => {
    b.onclick = () => { round.oppPick = round.oppPick === b.dataset.opp ? null : b.dataset.opp; audio.zap(); render(); };
  });
  $('#btnHome').onclick = goHome;
  els.btnMute.onclick = () => { settings.muted = !settings.muted; saveSettings(); audio.setMuted(settings.muted); renderMute(); };
  $('#btnAgain').onclick = () => startGame(game ? game.mode : settings.mode);
  $('#btnMenu').onclick = () => { game = null; goHome(); };
  $('#btnBuy').onclick = () => toast('Loja ainda não conectada nesta versão. Use o desbloqueio de teste.');
  $('#btnUnlockTest').onclick = togglePremium;
  $$('.modal[data-dismiss]').forEach((m) => m.addEventListener('click', (e) => {
    if (e.target === m || e.target.closest('[data-close]')) m.hidden = true;
  }));
  document.addEventListener('pointerdown', () => { // áudio só liga após um toque
    audio.init();
    // App instalado/tela cheia: tenta travar deitado (o navegador comum ignora; aí vale o aviso de girar)
    try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* sem suporte */ }
  }, true);
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.sfx !== 'none') audio.click();
    buzz(25); // toque "físico" em todo botão
  });
  els.btnInstall.onclick = installApp;
  window.addEventListener('keydown', (e) => {
    if (phase !== 'team') return;
    if (e.key === 'ArrowLeft') nudge(e.shiftKey ? -5 : -1);
    else if (e.key === 'ArrowRight') nudge(e.shiftKey ? 5 : 1);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { endDrag(); audio.suspend(); } });

  if (window.ResizeObserver) new ResizeObserver(layout).observe(els.stage);
  else window.addEventListener('resize', layout);
  layout();
  renderMute();
  setPhase('home');
  requestAnimationFrame(loop);
  const splash = $('#splash'); // abertura: some depois da barrinha encher
  setTimeout(() => { splash.classList.add('out'); setTimeout(() => splash.remove(), 500); }, 1200);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  // Ganchos para teste no console
  window.SINAPSE = { scoreFor, vx, get state() { return { phase, game, round: { ...round } }; } };
})();
