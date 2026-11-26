// A quiz with Reverie as the host: a little table in front of it with a question card standing on it and four
// big buzzers (A to D, or True and False). The questions come from the engine's bank of about 2,700 (gs.trivia,
// from the Open Trivia Database), seeded so a round never repeats a question, starting easy and climbing a level
// after two right in a row (down one after a miss).
//
// Who does what: the engine picks the questions and knows the answers; Reverie reads each one out in its own words and
// reacts to every answer, from the news it is sent. It is never told the right answer before they've answered.
//
// A game here is an object the stage drives (see ./index.js for the shape every game has).
import gs, { loadParts } from '../../engine/src/gamescroll.js';

const ROUND = 10;                    // questions in a round
const TABLE_H = .3;                  // the table's top, in metres above the floor
const CENTRE = { x: 0, z: .62 };     // the table's middle on the floor (the creature stands at the origin)
const CARD = { w: .52, h: .32, tilt: .95 };   // the question card: metres, and how far it leans back
const BUZZ = ['#ff5a4a', '#3fa2ff', '#4cd07a', '#ffc53a'];   // A, B, C, D
const LETTERS = 'ABCD';
const ease = k => k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;

/** The camera while playing: from your side of the table, the card in front and Reverie behind it. */
export const CAMERA = { pos: [0, 1.02, 1.42], look: [0, .34, .48] };

// splits text into lines that fit a width on a canvas (with its current font)
function wrap(c, text, width) {
  const out = []; let line = '';
  for (const w of String(text).split(/\s+/)) {
    const next = line ? line + ' ' + w : w;
    if (c.measureText(next).width > width && line) { out.push(line); line = w; } else line = next;
  }
  if (line) out.push(line);
  return out;
}

export function makeQuiz(stage) {
  const { THREE, scene, creature } = stage, { decal, disc, wood, sounds } = gs.tabletop, { rbox } = gs.hd;
  let root, card, buzzers = [], body = null;
  let quiz = null, q = null, n = 0, state = 'off', picked = -1, correct = -1, tweens = [], epoch = 0, t = 0, level = 2;

  function build() {
    root = new THREE.Group(); root.position.set(CENTRE.x, 0, CENTRE.z);
    const top = wood('#7a5234', { repeat: [2, 1] }), legs = wood('#5d3d25');
    const tt = new THREE.Mesh(rbox(.72, .04, .46, .015), top); tt.position.y = TABLE_H - .02; root.add(tt);
    for (const [x, z] of [[-.31, -.18], [.31, -.18], [-.31, .18], [.31, .18]]) { const l = new THREE.Mesh(rbox(.04, TABLE_H - .04, .04, .01), legs); l.position.set(x, (TABLE_H - .04) / 2, z); root.add(l); }
    // the card: a wooden frame leaning back on the far half of the table, its face a canvas the question is painted on
    const stand = new THREE.Group(); stand.position.set(0, TABLE_H, -.1); stand.rotation.x = -CARD.tilt; root.add(stand);
    const frame = new THREE.Mesh(rbox(CARD.w + .03, CARD.h + .03, .015, .006), legs); frame.position.set(0, CARD.h / 2, -.009); stand.add(frame);
    card = decal(CARD.w, CARD.h, () => {}, { px: 1024, lift: 0, rough: .8 });
    card.material.color.set('#d9d0c0');   // (a touch darker than white, so the lamp light doesn't wash the words out)
    card.rotation.x = Math.PI / 2; card.position.y = CARD.h / 2; stand.add(card);
    // the buzzers along your edge
    buzzers = BUZZ.map((col, i) => {
      const g = new THREE.Group(), x = (i - 1.5) * .15;
      const base = disc('#2b2b33', { r: .055, h: .02 }); g.add(base);
      const cap = disc(col, { r: .042, h: .028, glow: .35 }); cap.position.y = .018; g.add(cap);
      const label = decal(.05, .05, (c, w, h) => { c.fillStyle = '#ffffff'; c.font = `800 ${h * .7}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(LETTERS[i], w / 2, h * .54); }, { px: 128, lift: .047 });
      g.add(label);
      g.position.set(x, TABLE_H, .14); root.add(g);
      g.userData = { i, cap, label, press: 0 };
      return g;
    });
    root.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    card.castShadow = false;
  }

  // ---- little animations, run from update(dt); a stop() drops them all
  function tween(dur, fn) { const my = epoch; return new Promise(res => tweens.push({ t: 0, dur, fn, done: () => res(my === epoch) })); }
  const wait = s => tween(s, () => {});

  /** Paints the card: the question, its answers (the chosen and the right one marked once answered), and the credit. */
  function paint() {
    card.userData.redraw((c, W, H) => {
      c.fillStyle = '#fbf3e2'; c.fillRect(0, 0, W, H);
      c.fillStyle = '#e9dcc0'; c.fillRect(0, 0, W, H * .12);
      c.fillStyle = '#6b4a33'; c.font = `700 ${H * .06}px system-ui, sans-serif`; c.textBaseline = 'middle'; c.textAlign = 'left';
      c.fillText(q ? `Question ${n} of ${ROUND} · ${q.category}` : 'Quiz', W * .04, H * .062);
      c.textAlign = 'right'; c.fillText(`Score ${quiz?.score ?? 0}`, W * .96, H * .062);
      if (!q) {
        c.textAlign = 'center'; c.fillStyle = '#2a1d16'; c.font = `800 ${H * .12}px system-ui, sans-serif`;
        c.fillText(state === 'done' ? `${quiz.score} out of ${ROUND}!` : 'Get ready…', W / 2, H * .45);
        if (state === 'done') { c.font = `500 ${H * .055}px system-ui, sans-serif`; c.fillStyle = '#6b4a33'; c.fillText(`Best streak: ${quiz.best}`, W / 2, H * .62); }
      } else {
        c.textAlign = 'left'; c.fillStyle = '#2a1d16';
        let size = H * .085; c.font = `700 ${size}px system-ui, sans-serif`;
        let lines = wrap(c, q.text, W * .92);
        while (lines.length > 3 && size > H * .05) { size *= .9; c.font = `700 ${size}px system-ui, sans-serif`; lines = wrap(c, q.text, W * .92); }
        lines.slice(0, 4).forEach((l, i) => c.fillText(l, W * .04, H * .2 + i * size * 1.15));
        // the answers in a grid of two columns (true or false: two big boxes side by side)
        const top = H * .2 + Math.min(4, lines.length) * size * 1.15 + H * .03, rows = Math.ceil(q.answers.length / 2);
        const cellW = W * .46, cellH = Math.min(H * .2, (H * .92 - top) / rows);
        q.answers.forEach((a, i) => {
          const x = W * .03 + (i % 2) * W * .48, y = top + Math.floor(i / 2) * cellH;
          const right = state === 'shown' && i === correct, wrong = state === 'shown' && i === picked && i !== correct;
          c.fillStyle = right ? '#9fe8b0' : wrong ? '#ffc0b4' : '#efe3cc'; c.beginPath(); c.roundRect(x, y, cellW, cellH * .86, cellH * .2); c.fill();
          const r0 = cellH * .28, cx = x + r0 * 1.4, cy = y + cellH * .43;
          c.fillStyle = BUZZ[i]; c.beginPath(); c.arc(cx, cy, r0, 0, Math.PI * 2); c.fill();
          c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.font = `800 ${r0 * 1.2}px system-ui, sans-serif`; c.fillText(q.kind === 'truefalse' ? a[0] : LETTERS[i], cx, cy + r0 * .06);
          c.textAlign = 'left'; c.fillStyle = '#2a1d16'; const room = cellW - r0 * 3;
          let fs = cellH * .42; c.font = `700 ${fs}px system-ui, sans-serif`;
          let ls = wrap(c, a, room);
          while ((ls.length > 2 || ls.some(l => c.measureText(l).width > room)) && fs > cellH * .2) { fs *= .9; c.font = `700 ${fs}px system-ui, sans-serif`; ls = wrap(c, a, room); }
          ls = ls.slice(0, 2); ls.forEach((l, k) => c.fillText(l, cx + r0 * 1.5, cy + (k - (ls.length - 1) / 2) * fs * 1.1));
        });
      }
      c.fillStyle = '#9a8468'; c.font = `400 ${H * .032}px system-ui, sans-serif`; c.textAlign = 'center'; c.fillText(gs.trivia.CREDIT, W / 2, H * .965);
    });
  }
  function showBuzzers() {
    const count = q ? q.answers.length : 0;
    buzzers.forEach((b, i) => {
      b.visible = i < count;
      b.position.x = (i - (count - 1) / 2) * (count === 2 ? .2 : .15);
      b.userData.label.userData.redraw((c, w, h) => {
        c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
        const text = q?.kind === 'truefalse' ? q.answers[i][0] : LETTERS[i];
        c.font = `800 ${h * .7}px system-ui, sans-serif`; c.fillText(text, w / 2, h * .54);
      });
    });
  }

  // ---- what Reverie is told
  const asWords = () => q.kind === 'truefalse' ? 'True or false' : q.answers.map((a, i) => `${LETTERS[i]}) ${a}`).join('  ');
  const askLine = () => `Question ${n} of ${ROUND} (${q.category}, ${q.difficulty}): "${q.text}" ${asWords()}.`;
  const READ = ' Read it out with its choices, in your own playful quiz-host words, then let them answer. Never hint at the answer.';

  function next() {
    q = quiz.next(); n++; picked = correct = -1;
    if (!q) { n--; return finish(); }
    state = 'you'; paint(); showBuzzers();
    for (const b of buzzers) if (b.visible) { b.scale.setScalar(.01); }
    tween(.4, k => { for (const b of buzzers) if (b.visible) b.scale.setScalar(Math.max(.01, 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2))); });
    sounds.flip();
    return askLine();
  }
  function finish() {
    state = 'done'; q = null; paint(); showBuzzers();
    const s = quiz.score, great = s >= ROUND * .7;
    creature.mood(great ? 'excited' : 'happy'); creature.gesture(great ? 'tada' : 'bounce'); sounds.gong();
    stage.news(`[quiz] That was the last question: they scored ${s} out of ${ROUND} (best streak ${quiz.best}). Cheer them on, say how they did, and offer another round.`, true);
    return '';
  }

  /** They answer with answer i: the buzzer goes down, the card shows the right one, and Reverie hears how it went. */
  async function choose(i) {
    if (state !== 'you' || !q || i < 0 || i >= q.answers.length) return null;
    const my = epoch, r = quiz.answer(i), was = q;
    picked = i; correct = r.correct; state = 'shown'; paint();
    const b = buzzers[i]; sounds.clack(1);
    tween(.25, k => { b.userData.cap.position.y = .018 - Math.sin(k * Math.PI) * .012; });
    const at = new THREE.Vector3(); buzzers[r.correct].getWorldPosition(at); at.y += .05;
    if (r.right) { stage.sparks(at, '#7dffa0', 30); sounds.chime(); creature.mood('excited'); creature.gesture(r.streak >= 3 ? 'tada' : 'bounce'); }
    else { sounds.thud(); creature.mood('surprised'); creature.gesture('shake'); }
    const verdict = r.right ? `right! The answer was ${LETTERS[r.correct]}) ${was.answers[r.correct]}.` : `wrong: they said ${LETTERS[i]}) ${was.answers[i]}, but the answer was ${LETTERS[r.correct]}) ${was.answers[r.correct]}.`;
    const streak = r.streak >= 3 ? ` That is ${r.streak} right in a row!` : '';
    const left = n < ROUND;
    if (!await wait(left ? 1.6 : 1.2)) return verdict;
    if (my !== epoch) return verdict;
    if (!left) { const s = `[quiz] They answered question ${n}: ${verdict}${streak} Score: ${quiz.score} of ${n}.`; stage.news(s, false); finish(); return verdict; }
    const ask = next();
    stage.news(`[quiz] They answered question ${n - 1}: ${verdict}${streak} Score: ${quiz.score} of ${n - 1}. React in one short line, then the next question is on the card: ${ask}${READ}`, true);
    return verdict;
  }

  /** "B", "the answer is c", "true", "Paris": the index of their answer, or -1. */
  function parse(text) {
    const s = String(text || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
    if (!q || !s) return -1;
    if (q.kind === 'truefalse') { if (/\b(true|yes|right|correct)\b/.test(s)) return q.answers.indexOf('True'); if (/\b(false|no|wrong|untrue)\b/.test(s)) return q.answers.indexOf('False'); }
    const letter = /^(?:(?:the )?answer(?: is)?|it s|i say|i ll go with|go with|letter|option)?\s*([abcd])$/.exec(s);
    if (letter) return 'abcd'.indexOf(letter[1]);
    const norm = x => String(x).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const exact = q.answers.findIndex(a => norm(a) === s); if (exact >= 0) return exact;
    const inside = q.answers.map((a, i) => [norm(a), i]).filter(([a]) => a.length > 2 && s.includes(a)).sort((x, y) => y[0].length - x[0].length);
    return inside.length ? inside[0][1] : -1;
  }

  const api = {
    id: 'quiz', title: 'Quiz', camera: CAMERA,
    get state() { return state; },
    /** Sets the table up and asks the first question. level: 1 easy only, 2 easy and climbing (the default), 3 starts at medium, 4 hard and climbing down on a miss, 5 hard only. */
    async start({ level: lv } = {}) {
      await loadParts(['trivia']);
      if (lv) level = Math.max(1, Math.min(5, Math.round(lv)));
      const difficulty = level === 1 ? 'easy' : level === 5 ? 'hard' : level === 3 ? ['medium', 'hard'] : level === 4 ? ['hard', 'medium'] : null;
      // the questions load the first time: until they're in, new Quiz() throws with a promise to wait on
      for (let i = 0; ; i++) { try { quiz = new gs.trivia.Quiz({ difficulty, climb: level === 1 || level === 5 ? false : 2, seed: Math.random() * 2 ** 31 >>> 0 }); break; } catch (e) { if (!e?.kitLoading || i > 20) throw e; await e.kitLoading; } }
      if (level === 4) quiz.level = 2;
      if (!root) build();
      epoch++; tweens = []; n = 0; q = null;
      if (!root.parent) { scene.add(root); body = stage.physics?.box(null, .72, TABLE_H, .46, { fixed: true, at: { x: CENTRE.x, y: TABLE_H / 2, z: CENTRE.z } }); }
      root.scale.setScalar(.01); tween(.45, k => root.scale.setScalar(Math.max(.01, 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2))));
      stage.sparks(new THREE.Vector3(CENTRE.x, TABLE_H + .1, CENTRE.z), '#ffd27a', 40);
      const first = next();
      return `The quiz table is set up in front of you: ${ROUND} questions, and you are the host. They answer by tapping a buzzer or saying it. The first one is on the card: ${first}${READ}`;
    },
    stop() {
      epoch++; tweens = []; state = 'off'; q = null;
      if (root?.parent) { root.removeFromParent(); body?.remove?.(); body = null; }
    },
    update(dt) {
      if (state === 'off') return;
      t += dt;
      for (const tw of tweens) { tw.t += dt; tw.fn(Math.min(1, tw.t / tw.dur), tw.t); }
      const done = tweens.filter(tw => tw.t >= tw.dur); tweens = tweens.filter(tw => tw.t < tw.dur); for (const tw of done) tw.done();
      // the buzzers breathe while it's their turn; the right one glows once it's shown
      buzzers.forEach((b, i) => { const m = b.userData.cap.material; m.emissiveIntensity = state === 'you' ? .3 + Math.sin(t * 3 + i) * .15 : state === 'shown' && i === correct ? 1.4 + Math.sin(t * 8) * .5 : .1; });
    },
    tap(ray) {
      if (state === 'off') return false;
      const hits = ray.intersectObjects(buzzers.filter(b => b.visible), true);
      if (hits.length) { let o = hits[0].object; while (o && !buzzers.includes(o)) o = o.parent; if (o) choose(o.userData.i); return true; }
      return ray.intersectObject(root, true).length > 0;
    },
    /** Their answer said out loud ("B", "true", "Paris"). Resolves a sentence for Reverie. */
    async command(text) {
      if (state === 'off') return 'No quiz is on.';
      if (state === 'done') return 'The quiz is over. Start another round with play.';
      if (state !== 'you') return 'The answer is already in: the next question is coming.';
      const i = parse(text);
      if (i < 0) return `"${text}" is not one of the choices. The choices: ${asWords()}.`;
      const v = await choose(i);
      return `Answered ${LETTERS[i]} for them: ${v} You will hear the next question.`;
    },
    context() {
      if (state === 'off') return '';
      if (state === 'done') return `[quiz, on the table: the round is over; they scored ${quiz.score} of ${ROUND}.]`;
      if (!q) return '';
      const now = state === 'you' ? 'Waiting for their answer (they can tap a buzzer or say it; play a spoken answer with game_move).' : 'Their answer is in; the next question is coming.';
      return `[quiz, on the table, you are the host: ${askLine()} Score so far: ${quiz.score} of ${n - (state === 'you' ? 1 : 0)}. ${now} Don't give the answer away.]`;
    },
    bar() {
      if (state === 'off') return null;
      const text = state === 'done' ? `Quiz · ${quiz.score} of ${ROUND}` : `Quiz · ${n} of ${ROUND} · score ${quiz.score}`;
      const buttons = state === 'you' && q ? q.answers.map((a, i) => ({ id: 'pick' + i, label: q.kind === 'truefalse' ? a : LETTERS[i] })) : [];
      if (state === 'done') buttons.push({ id: 'again', label: 'Again' });
      buttons.push({ id: 'leave', label: 'Done' });
      return { text, buttons };
    },
  };
  for (let i = 0; i < 4; i++) api['pick' + i] = () => choose(i);
  return api;
}
