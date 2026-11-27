// Card Table Games: Blackjack (Pontoon), Higher or Lower, and Silly Fortune Teller (3-card Reverie tarot), played on
// a felt-topped card table in front of Reverie. Uses engine/src/kit/cards.js (Deck, total, SUIT_SIGN) for real decks
// and hand totals; draws crisp cards onto 3D decals with smooth flip/slide animations.
import gs from '../../engine/src/gamescroll.js';
import { total, SUIT_SIGN } from '../../engine/src/kit/cards.js';
import { table, clock, popIn, words as norm } from './parts.js';
import { TAROT_DECK, modeOf, makeCardGame } from './cards-logic.js';

export { TAROT_DECK, modeOf, makeCardGame };

const TABLE_H = .3;
const CENTRE = { x: 0, z: .62 };
const CARD_W = .074, CARD_H = .106, CARD_T = .003;
const CAMERA = { pos: [0, 1.02, 1.56], look: [0, .34, .48] };
const RANK_LABEL = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
const rankText = r => RANK_LABEL[r] || String(r);

export function makeCards(stage) {
  const { THREE, scene, creature } = stage, { decal, wood, sounds } = gs.tabletop, { rbox, pbr } = gs.hd;
  const tw = clock();
  let root = null, cardGroup = null, game = null, mode = 'blackjack', level = 2, round = 0;
  let cardMeshes = [], tapTargets = [];

  function drawBack(c, W, H, mystic = false) {
    c.fillStyle = mystic ? '#2c1e4a' : '#25446b';
    c.fillRect(0, 0, W, H);
    c.strokeStyle = mystic ? '#e8c468' : '#d6c7a1';
    c.lineWidth = W * .05;
    c.strokeRect(W * .08, H * .06, W * .84, H * .88);
    c.fillStyle = mystic ? '#f3d47c' : '#e6d8b5';
    c.font = `${W * .38}px system-ui, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(mystic ? '✦' : '❖', W / 2, H / 2);
  }

  function drawFace(c, W, H, card) {
    if (card.tarot) {
      c.fillStyle = '#fbf3e0'; c.fillRect(0, 0, W, H);
      c.strokeStyle = card.col || '#b88d44'; c.lineWidth = W * .045;
      c.strokeRect(W * .06, H * .05, W * .88, H * .9);
      c.fillStyle = '#6c523b'; c.font = `700 ${W * .1}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(card.spot.toUpperCase(), W / 2, H * .13);
      c.save(); c.translate(W / 2, H * .47); if (card.reversed) c.rotate(Math.PI);
      c.font = `${W * .42}px system-ui, sans-serif`; c.fillText(card.icon, 0, 0);
      c.restore();
      c.fillStyle = '#2d1f16'; c.font = `700 ${W * .105}px Georgia, serif`;
      const parts = card.name.split(' ');
      const l1 = parts.slice(0, 2).join(' '), l2 = parts.slice(2).join(' ');
      c.fillText(l1, W / 2, H * (l2 ? .77 : .82));
      if (l2) c.fillText(l2, W / 2, H * .87);
      return;
    }
    c.fillStyle = '#fcfaf2'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#ddd3c0'; c.lineWidth = W * .02; c.strokeRect(W * .02, H * .02, W * .96, H * .96);
    const col = card.red ? '#c9332b' : '#222229', r = rankText(card.rank), s = SUIT_SIGN[card.suit] || '';
    c.fillStyle = col; c.textAlign = 'left'; c.textBaseline = 'top';
    c.font = `700 ${W * .24}px system-ui, sans-serif`;
    c.fillText(r, W * .1, H * .07);
    c.font = `${W * .2}px system-ui, sans-serif`;
    c.fillText(s, W * .1, H * .25);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `${W * .44}px system-ui, sans-serif`;
    c.fillText(s, W / 2, H * .56);
  }

  function makeCardMesh(card, faceUp, x, z, rotY = 0, tapAction = null) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(rbox(CARD_W, CARD_T, CARD_H, .0015), pbr('#f7f3e8', { rough: .55 }));
    body.castShadow = true; body.receiveShadow = true; g.add(body);
    const face = decal(CARD_W * .94, CARD_H * .94, (c, W, H) => faceUp ? drawFace(c, W, H, card) : drawBack(c, W, H, !!card.tarot), { px: 256, lift: CARD_T * .6, rough: .5 });
    g.add(face);
    g.position.set(x, TABLE_H + .004, z);
    g.rotation.y = rotY;
    g.userData = { card, faceUp, face, tapAction };
    cardGroup.add(g);
    cardMeshes.push(g);
    if (tapAction) tapTargets.push(g);
    popIn(tw, g, .22);
    return g;
  }

  function rebuildTableCards() {
    if (!cardGroup || !game) return;
    for (const m of cardMeshes) cardGroup.remove(m);
    cardMeshes = []; tapTargets = [];
    if (game.mode === 'blackjack') {
      const spread = (arr, z, hideSecond) => arr.forEach((c, i) => {
        const x = (i - (arr.length - 1) / 2) * .085;
        makeCardMesh(c, !(hideSecond && i === 1), x, z, (i - (arr.length - 1) / 2) * .04);
      });
      spread(game.dealer, -.1, game.dealerHidden);
      spread(game.player, .11, false);
    } else if (game.mode === 'higher_lower') {
      // deck on left, current card in centre
      makeCardMesh({ suit: 's', rank: 1, name: '' }, false, -.15, 0, .03);
      if (game.current) makeCardMesh(game.current, true, .05, 0, -.02);
    } else {
      // 3 tarot cards across the table
      game.fortune.forEach((f, i) => {
        const x = (i - 1) * .135;
        makeCardMesh(f, f.revealed, x, .02, (i - 1) * -.06, f.revealed ? null : () => doFlip(i));
      });
    }
  }

  function build() {
    root = new THREE.Group();
    const desk = table(THREE, { w: .62, d: .44, h: TABLE_H }); desk.position.set(CENTRE.x, 0, CENTRE.z); root.add(desk);
    // green/plum felt mat on top of the table
    const felt = new THREE.Mesh(rbox(.54, .006, .36, .003), pbr(mode === 'fortune' ? '#462c5c' : '#26593b', { rough: .95 }));
    felt.position.set(0, TABLE_H + .001, 0); felt.receiveShadow = true; desk.add(felt);
    cardGroup = new THREE.Group(); desk.add(cardGroup);
    root.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  }

  function celebrate(win) {
    if (win) { stage.sparks({ x: CENTRE.x, y: TABLE_H + .12, z: CENTRE.z }, '#ffd85a', 18); creature.gesture('tada'); creature.mood('excited'); sounds.win?.(); }
    else { creature.gesture('bounce'); creature.mood('happy'); sounds.place?.(); }
  }

  function doHit() {
    const r = game.hit(); if (!r.ok) return r.text;
    sounds.place?.(); rebuildTableCards();
    if (r.over) { celebrate(r.result === 'win'); stage.news(`[cards] ${r.text}`, true); }
    else stage.news(`[cards] ${r.text}`, false);
    return r.text;
  }
  function doStand() {
    const r = game.stand(); if (!r.ok) return r.text;
    sounds.place?.(); rebuildTableCards();
    celebrate(r.result === 'win');
    stage.news(`[cards] ${r.text}`, true);
    return r.text;
  }
  function doGuess(dir) {
    const r = game.guess(dir); if (!r.ok) return r.text;
    sounds.place?.(); rebuildTableCards();
    if (r.over) { celebrate(r.result === 'win'); stage.news(`[cards] ${r.text}`, true); }
    else { stage.sparks({ x: CENTRE.x, y: TABLE_H + .08, z: CENTRE.z }, '#7fe3a0', 8); stage.news(`[cards] ${r.text}`, false); }
    return r.text;
  }
  function doFlip(i = null) {
    const r = game.flip(i); if (!r.ok) return r.text;
    sounds.place?.(); rebuildTableCards();
    stage.sparks({ x: CENTRE.x + ((r.index - 1) * .135), y: TABLE_H + .1, z: CENTRE.z }, '#f3c969', 14);
    creature.gesture(r.over ? 'tada' : 'point');
    stage.news(`[cards] Fortune card flipped — ${r.text}${r.over ? ' All three cards are revealed: weave them into one playful fortune!' : ''}`, true);
    return r.text;
  }

  const ray = new THREE.Raycaster();
  return {
    id: 'cards', title: 'Cards', camera: CAMERA,
    get round() { return round; },
    get level() { return level; },
    async start(o = {}) {
      this.stop();
      mode = modeOf(o.mode || 'blackjack');
      level = o.level || 2; round++;
      game = makeCardGame(mode, { level });
      build(); scene.add(root);
      popIn(tw, root, .32);
      rebuildTableCards();
      sounds.place?.();
      creature.gesture('wave');
      const intro = mode === 'blackjack'
        ? `Blackjack dealt! ${game.summary()}`
        : mode === 'higher_lower'
          ? `Higher or Lower started! First card is ${game.current.name} (get ${game.target} in a row to win).`
          : `Fortune Teller table ready! Three face-down cards (Past, Present, Future) are on the table — tap one or say "flip" to reveal.`;
      return intro;
    },
    stop() {
      tw.stop();
      if (root) { scene.remove(root); root = null; cardGroup = null; cardMeshes = []; tapTargets = []; }
      game = null;
    },
    update(dt) { tw.update(dt); },
    tap(r) {
      if (!root || !tapTargets.length) return false;
      const hits = r.intersectObjects(tapTargets, true);
      if (!hits.length) return false;
      let o = hits[0].object; while (o && !o.userData?.tapAction) o = o.parent;
      if (o?.userData?.tapAction) { o.userData.tapAction(); return true; }
      return false;
    },
    async command(text) {
      if (!game) return 'No card game is on.';
      const s = norm(text);
      if (game.mode === 'blackjack') {
        if (/\b(hit|twist|card|another|draw|more)\b/.test(s)) return doHit();
        if (/\b(stand|stick|hold|stay|stop|enough)\b/.test(s)) return doStand();
      } else if (game.mode === 'higher_lower') {
        if (/\b(high|higher|up|bigger|more)\b/.test(s)) return doGuess('higher');
        if (/\b(low|lower|down|smaller|less)\b/.test(s)) return doGuess('lower');
      } else {
        if (/\b(past|first|1|one)\b/.test(s)) return doFlip(0);
        if (/\b(present|second|middle|2|two)\b/.test(s)) return doFlip(1);
        if (/\b(future|third|last|3|three)\b/.test(s)) return doFlip(2);
        if (/\b(flip|turn|reveal|next|show|read)\b/.test(s)) return doFlip();
      }
      return `Say ${game.mode === 'blackjack' ? '"hit" or "stand"' : game.mode === 'higher_lower' ? '"higher" or "lower"' : '"flip" to turn the next card'}.`;
    },
    context() { return game ? `[cards: ${game.summary()}]` : ''; },
    bar() {
      if (!game) return null;
      if (game.mode === 'blackjack') {
        const pt = total(game.player).total;
        const buttons = game.state === 'play'
          ? [{ id: 'hit', label: 'Hit' }, { id: 'stand', label: 'Stand' }, { id: 'leave', label: 'Done' }]
          : [{ id: 'again', label: 'Deal again' }, { id: 'leave', label: 'Done' }];
        return { text: `Blackjack · You: ${pt}${game.state === 'over' ? ` · ${game.result === 'win' ? 'You win!' : game.result === 'lose' ? 'Reverie wins' : 'Draw'}` : ''}`, buttons };
      }
      if (game.mode === 'higher_lower') {
        const buttons = game.state === 'play'
          ? [{ id: 'higher', label: 'Higher ↑' }, { id: 'lower', label: 'Lower ↓' }, { id: 'leave', label: 'Done' }]
          : [{ id: 'again', label: 'Play again' }, { id: 'leave', label: 'Done' }];
        return { text: `Higher or Lower · ${game.current.name} · Streak ${game.streak}/${game.target}`, buttons };
      }
      const buttons = game.state === 'play'
        ? [{ id: 'flip', label: 'Flip card' }, { id: 'leave', label: 'Done' }]
        : [{ id: 'again', label: 'New reading' }, { id: 'leave', label: 'Done' }];
      return { text: `Fortune Teller · ${game.revealed}/3 revealed`, buttons };
    },
    hit() { doHit(); },
    stand() { doStand(); },
    higher() { doGuess('higher'); },
    lower() { doGuess('lower'); },
    flip() { doFlip(); },
  };
}
