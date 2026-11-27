// Chalkboard Word Games: 5-letter Word Guesser (Wordle-style) and Balloon Hangman, drawn on the green chalkboard
// easel in front of Reverie. Uses engine/src/kit/words.js (Words, compare) for the English dictionary and letter
// scoring. Say a word or letter aloud (or use the Hint button) to play.
import gs from '../../engine/src/gamescroll.js';
import { Words, loadWords } from '../../engine/src/kit/words.js';
import { clock, popIn, words as norm } from './parts.js';
import { wordModeOf, makeWordGame } from './words-logic.js';

export { wordModeOf, makeWordGame };

const BOARD = { w: .66, h: .46, tilt: .14, bottom: .33 };
const EASEL = { x: -.28, z: .42, turn: .36 };
const CAMERA = { pos: [-.06, .92, 1.62], look: [-.18, .48, .35] };
const CHALK = "'Chalkboard SE', 'Chalkboard', 'Comic Sans MS', 'Segoe Print', 'Bradley Hand', system-ui, sans-serif";

const FALLBACK_5 = ['apple', 'flame', 'cloud', 'music', 'piano', 'tiger', 'magic', 'smile', 'stone', 'dream', 'earth', 'spark', 'light', 'crown', 'river', 'dance', 'honey', 'plant', 'chess', 'train'];
const FALLBACK_LONG = ['dragon', 'teapot', 'castle', 'rocket', 'wizard', 'garden', 'lantern', 'penguin', 'rainbow', 'volcano', 'pancake', 'dolphin', 'blanket', 'crystal', 'compass'];

export function makeWords(stage) {
  const { THREE, scene, creature } = stage, { decal, wood, sounds } = gs.tabletop, { rbox } = gs.hd;
  const tw = clock();
  let root = null, board = null, game = null, dict = null, mode = 'wordle', level = 2, round = 0;

  function build() {
    root = new THREE.Group();
    const frameMat = wood('#6b4a30');
    const easel = new THREE.Group(); easel.position.set(EASEL.x, 0, EASEL.z); easel.rotation.y = EASEL.turn; root.add(easel);
    const top = BOARD.bottom + BOARD.h + .06;
    for (const [x, z, lean] of [[-.36, 0, .1], [.36, 0, .1], [0, -.2, -.38]]) {
      const len = top / Math.cos(lean), leg = new THREE.Mesh(rbox(.025, len, .025, .006), frameMat);
      leg.position.set(x, top / 2, z + Math.sin(lean) * len / 2 - .03); leg.rotation.x = -lean; leg.rotation.z = x * .12; easel.add(leg);
    }
    const stand = new THREE.Group(); stand.position.set(0, BOARD.bottom, .07); stand.rotation.x = -BOARD.tilt; easel.add(stand);
    const frame = new THREE.Mesh(rbox(BOARD.w + .04, BOARD.h + .04, .02, .008), frameMat); frame.position.set(0, BOARD.h / 2, -.012); stand.add(frame);
    const ledge = new THREE.Mesh(rbox(BOARD.w + .16, .014, .04, .004), frameMat); ledge.position.set(0, -.006, .014); stand.add(ledge);
    board = decal(BOARD.w, BOARD.h, () => {}, { px: 1024, lift: 0, rough: .95, glow: .22 });
    board.rotation.x = Math.PI / 2; board.position.y = BOARD.h / 2; stand.add(board);
    root.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    board.castShadow = false;
  }

  function paint() {
    if (!board || !game) return;
    board.userData.redraw((c, W, H) => {
      const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#335243'); g.addColorStop(1, '#284535');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.textBaseline = 'middle'; c.textAlign = 'center';
      // header
      c.fillStyle = '#d9e6da'; c.font = `600 ${H * .055}px ${CHALK}`;
      c.textAlign = 'left'; c.fillText(game.mode === 'wordle' ? 'Word Guesser' : 'Balloon Hangman', W * .04, H * .065);
      c.textAlign = 'right';
      c.fillText(game.mode === 'wordle' ? `${game.guesses.length}/${game.maxGuesses}` : `${game.maxWrong - game.wrong.length} balloons`, W * .96, H * .065);
      c.strokeStyle = 'rgba(230,240,230,.3)'; c.lineWidth = H * .004; c.beginPath(); c.moveTo(W * .04, H * .115); c.lineTo(W * .96, H * .115); c.stroke();

      if (game.mode === 'wordle') {
        const cols = game.answer.length, rows = game.maxGuesses;
        const tile = Math.min(W * .11, H * .108), gap = tile * .14;
        const gridW = cols * tile + (cols - 1) * gap, x0 = (W - gridW) / 2, y0 = H * .155;
        const fill = { hit: '#4e9c60', near: '#d6a236', miss: '#46544e' };
        for (let r = 0; r < rows; r++) {
          const w = game.guesses[r] || '', mk = game.marks[r] || [];
          for (let col = 0; col < cols; col++) {
            const x = x0 + col * (tile + gap), y = y0 + r * (tile + gap);
            c.fillStyle = mk[col] ? fill[mk[col]] : 'rgba(255,255,255,.06)';
            c.strokeStyle = mk[col] ? 'rgba(255,255,255,.35)' : 'rgba(240,245,240,.35)';
            c.lineWidth = H * .004;
            c.beginPath(); c.roundRect(x, y, tile, tile, tile * .14); c.fill(); c.stroke();
            if (w[col]) {
              c.fillStyle = '#fffcf5'; c.font = `700 ${tile * .58}px ${CHALK}`; c.textAlign = 'center';
              c.fillText(w[col].toUpperCase(), x + tile / 2, y + tile / 2 + tile * .03);
            }
          }
        }
        // alphabet strip
        const kb = game.keyboardStatus(), alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        c.font = `600 ${H * .042}px ${CHALK}`; c.textAlign = 'center';
        for (let i = 0; i < 26; i++) {
          const ch = alpha[i], st = kb[ch.toLowerCase()];
          c.fillStyle = st === 'hit' ? '#7fe896' : st === 'near' ? '#ffd466' : st === 'miss' ? 'rgba(255,255,255,.22)' : '#e8ece6';
          c.fillText(ch, W * (.06 + (i % 13) * .073), H * (i < 13 ? .89 : .945));
        }
      } else {
        // Balloon Hangman: draw remaining balloons at top
        const left = game.maxWrong - game.wrong.length;
        const bCols = ['#ff6b6b', '#ffd166', '#6be585', '#64b5f6', '#c792ea', '#ff9f68'];
        for (let i = 0; i < game.maxWrong; i++) {
          const bx = W * (.22 + i * .112), by = H * .27;
          if (i < left) {
            c.fillStyle = bCols[i % bCols.length]; c.beginPath(); c.ellipse(bx, by, W * .032, H * .07, 0, 0, Math.PI * 2); c.fill();
            c.strokeStyle = '#e8ece6'; c.lineWidth = H * .003; c.beginPath(); c.moveTo(bx, by + H * .07); c.lineTo(bx, by + H * .14); c.stroke();
          } else {
            c.fillStyle = 'rgba(255,255,255,.25)'; c.font = `700 ${H * .06}px ${CHALK}`; c.textAlign = 'center';
            c.fillText('✕', bx, by);
          }
        }
        // masked word
        c.fillStyle = '#fff9e6'; c.font = `700 ${H * .14}px ${CHALK}`; c.textAlign = 'center';
        c.fillText(game.state === 'over' ? [...game.answer.toUpperCase()].join(' ') : game.masked(), W / 2, H * .59);
        // wrong guesses
        c.fillStyle = '#ff9c8a'; c.font = `600 ${H * .058}px ${CHALK}`;
        c.fillText(game.wrong.length ? `Misses: ${game.wrong.map(x => x.toUpperCase()).join('  ')}` : 'Say a letter or guess the word!', W / 2, H * .82);
      }
    });
  }

  async function pickAnswer(m) {
    try { await loadWords(); dict ||= new Words(); } catch { /* fallback list below */ }
    if (dict) {
      const len = m === 'wordle' ? 5 : (level >= 4 ? 7 : 6);
      const w = dict.random({ length: len });
      if (w) return w;
    }
    const pool = m === 'wordle' ? FALLBACK_5 : FALLBACK_LONG;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function applyGuess(raw) {
    const r = game.guess(raw);
    if (!r.ok) return r.text;
    paint();
    if (r.over) {
      if (r.result === 'win') { stage.sparks({ x: EASEL.x, y: .75, z: EASEL.z }, '#8cf09a', 20); creature.gesture('tada'); creature.mood('excited'); sounds.win?.(); }
      else { creature.gesture('shrug'); creature.mood('sad'); sounds.place?.(); }
      stage.news(`[words] ${r.text}`, true);
    } else {
      sounds.place?.();
      stage.news(`[words] ${r.text}`, true);
    }
    return r.text;
  }

  return {
    id: 'words', title: 'Word Game', camera: CAMERA,
    get round() { return round; },
    get level() { return level; },
    async start(o = {}) {
      this.stop();
      mode = wordModeOf(o.mode || 'wordle');
      level = o.level || 2; round++;
      const answer = await pickAnswer(mode);
      game = makeWordGame({ mode, answer, dict });
      build(); scene.add(root);
      paint(); popIn(tw, root, .32);
      sounds.place?.();
      creature.gesture('point');
      return mode === 'wordle'
        ? `Word Guesser is up on the chalkboard! A 5-letter secret word is ready (6 guesses). Ask them for their first 5-letter word.`
        : `Balloon Hangman is up on the chalkboard! A ${answer.length}-letter secret word is ready with 6 balloons. Ask them for their first letter.`;
    },
    stop() {
      tw.stop();
      if (root) { scene.remove(root); root = null; board = null; }
      game = null;
    },
    update(dt) { tw.update(dt); },
    tap() { return false; },
    async command(text) {
      if (!game) return 'No word game is on.';
      const s = norm(text);
      if (/\bhint\b/.test(s)) return game.hint();
      // extract a single word or letter ("letter e", "guess crane", "crane")
      const m = /(?:^|\b)(?:guess|try|word|letter)\s+([a-z]+)\b/.exec(s) || /^([a-z]+)$/.exec(s);
      const token = m ? m[1] : s.split(/\s+/).find(w => /^[a-z]+$/.test(w) && (game.mode === 'wordle' ? w.length === game.answer.length : w.length === 1 || w.length === game.answer.length));
      if (!token) return `Tell me ${game.mode === 'wordle' ? 'a 5-letter word' : 'a letter or word'} to chalk up!`;
      return applyGuess(token);
    },
    context() { return game ? `[words: ${game.summary()}]` : ''; },
    bar() {
      if (!game) return null;
      const buttons = game.state === 'play'
        ? [{ id: 'hint', label: 'Hint' }, { id: 'leave', label: 'Done' }]
        : [{ id: 'again', label: 'New word' }, { id: 'leave', label: 'Done' }];
      return { text: game.mode === 'wordle' ? `Word Guesser · ${game.guesses.length}/${game.maxGuesses}` : `Hangman · ${game.maxWrong - game.wrong.length} balloons`, buttons };
    },
    hint() { if (game) stage.news(`[words] They pressed Hint: ${game.hint()}`, true); },
  };
}
