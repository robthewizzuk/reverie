// Learning together: a little chalkboard on the table in front of Reverie, which is the teacher. Claude writes the
// lesson as it goes with the teach tool (a board of a few short lines, a new word for a language, a quiz question with
// buzzers to answer it, and the end of the lesson), and makes props in its hands as visual aids (a volcano while it
// explains eruptions). The engine draws the board and runs the buzzers; Claude decides what to teach.
// Progress is kept by ../learn.js: every board, word and answer the moment it happens, so leaving early keeps it.
//
// A game here is an object the stage drives (see ./index.js for the shape every game has); it also has teach(input).
import gs from '../../engine/src/gamescroll.js';
import { table, clock, popIn, words as norm } from './parts.js';

const TABLE_H = .3;
const CENTRE = { x: -.1, z: .64 };
const BOARD = { w: .62, h: .42, tilt: .16, bottom: .34 };   // metres: its size, how far it leans back, its lower edge
const EASEL = { x: -.4, z: .36, turn: .55 };         // the easel on the floor at Reverie's side, turned to face you
const BUZZ = ['#ff5a4a', '#3fa2ff', '#4cd07a', '#ffc53a'];
const LETTERS = 'ABCD';
const CHALK = "'Chalkboard SE', 'Chalkboard', 'Comic Sans MS', 'Segoe Print', 'Bradley Hand', system-ui, sans-serif";
const MAX_LINES = 5;
/** The camera while learning: from your side of the table, Reverie behind it and the board on its easel beside it. */
export const CAMERA = { pos: [-.12, .92, 1.66], look: [-.24, .45, .3] };

// the learning book (../learn.js) and a line for today's diary page, set by the page (main.js)
let book = null, diaryLine = () => {};
/** The page hands over the learning book, and how to write a line in today's diary. */
export function useLearning(learning, { onDay = () => {} } = {}) { book = learning; diaryLine = onDay; }

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
const clean = (s, n = 140) => String(s ?? '').replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Their answer to a quiz question ("B", "the second one", "true", "Paris"): its index, or -1. */
export function answerOf(text, choices) {
  const s = norm(text); if (!s || !choices?.length) return -1;
  const letter = /^(?:(?:the )?answer(?: is)?|its|it s|i say|ill go with|i ll go with|go with|letter|option)?\s*([abcd])$/.exec(s);
  if (letter) { const i = 'abcd'.indexOf(letter[1]); return i < choices.length ? i : -1; }
  const nth = ['first', 'second', 'third', 'fourth'].findIndex(w => new RegExp(`\\b${w}\\b`).test(s));
  if (nth >= 0 && nth < choices.length && /\b(one|answer|option|choice)\b/.test(s)) return nth;
  const exact = choices.findIndex(a => norm(a) === s); if (exact >= 0) return exact;
  const inside = choices.map((a, i) => [norm(a), i]).filter(([a]) => a.length > 1 && new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(s)).sort((x, y) => y[0].length - x[0].length);
  if (inside.length) return inside[0][1];
  if (choices.length === 2 && choices.every(a => /^(true|false)$/i.test(a))) {
    if (/\b(true|yes|right|correct)\b/.test(s)) return choices.findIndex(a => /true/i.test(a));
    if (/\b(false|no|wrong|untrue)\b/.test(s)) return choices.findIndex(a => /false/i.test(a));
  }
  return -1;
}

export function makeLesson(stage) {
  const { THREE, scene, creature } = stage, { decal, disc, wood, sounds } = gs.tabletop, { rbox } = gs.hd;
  const tw = clock();
  let root = null, board, buzzers = [], bodies = [], pieces = [], t = 0;
  // the lesson: its subject, and what the board shows now
  let subject = null, state = 'off', show = { kind: 'title' }, q = null, picked = -1, asked = 0, right = 0, boards = 0, newWords = 0;

  function build() {
    root = new THREE.Group();
    // the table in front, for the quiz buzzers
    const desk = table(THREE, { w: .64, d: .36, h: TABLE_H }); desk.position.set(CENTRE.x, 0, CENTRE.z); root.add(desk);
    const frameMat = wood('#6b4a30');
    // the easel: three legs on the floor and the board resting on its pegs, its face a canvas written in chalk
    const easel = new THREE.Group(); easel.position.set(EASEL.x, 0, EASEL.z); easel.rotation.y = EASEL.turn; root.add(easel);
    const top = BOARD.bottom + BOARD.h + .06;
    for (const [x, z, lean] of [[-.35, 0, .1], [.35, 0, .1], [0, -.2, -.38]]) {
      const len = top / Math.cos(lean), leg = new THREE.Mesh(rbox(.025, len, .025, .006), frameMat);
      leg.position.set(x, top / 2, z + Math.sin(lean) * len / 2 - .03); leg.rotation.x = -lean; leg.rotation.z = x * .12; easel.add(leg);
    }
    const stand = new THREE.Group(); stand.position.set(0, BOARD.bottom, .07); stand.rotation.x = -BOARD.tilt; easel.add(stand);
    const frame = new THREE.Mesh(rbox(BOARD.w + .04, BOARD.h + .04, .02, .008), frameMat); frame.position.set(0, BOARD.h / 2, -.012); stand.add(frame);
    const ledge = new THREE.Mesh(rbox(BOARD.w + .16, .014, .04, .004), frameMat); ledge.position.set(0, -.006, .014); stand.add(ledge);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(.005, .005, .045, 8), new THREE.MeshStandardMaterial({ color: '#f4f1e8', roughness: .9 }));
    stick.rotation.z = Math.PI / 2; stick.position.set(BOARD.w * .3, .006, .018); stand.add(stick);
    board = decal(BOARD.w, BOARD.h, () => {}, { px: 1024, lift: 0, rough: .95, glow: .22 });
    board.rotation.x = Math.PI / 2; board.position.y = BOARD.h / 2; stand.add(board);
    buzzers = BUZZ.map((col, i) => {
      const g = new THREE.Group();
      g.add(disc('#2b2b33', { r: .05, h: .02 }));
      const cap = disc(col, { r: .038, h: .026, glow: .35 }); cap.position.y = .017; g.add(cap);
      const label = decal(.045, .045, () => {}, { px: 128, lift: .044 }); g.add(label);
      g.position.set((i - 1.5) * .14, TABLE_H, .02); desk.add(g);
      g.userData = { i, cap, label }; g.visible = false;
      return g;
    });
    pieces = [desk, easel];
    root.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    board.castShadow = false;
  }

  /** Writes the board: chalk on green, whatever it shows now. */
  function paint() {
    board.userData.redraw((c, W, H) => {
      // the slate: deep green, a little uneven, with the ghost of old chalk rubbed out
      const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#355445'); g.addColorStop(1, '#2b4a38');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.globalAlpha = .05; c.fillStyle = '#ffffff';
      for (let i = 0; i < 7; i++) { c.beginPath(); c.ellipse(W * ((i * .37) % 1), H * ((i * .61) % 1), W * .18, H * .05, i, 0, Math.PI * 2); c.fill(); }
      c.globalAlpha = 1;
      const chalk = (size, weight = 600) => { c.font = `${weight} ${size}px ${CHALK}`; };
      c.textBaseline = 'middle'; c.shadowColor = 'rgba(255,255,255,.35)'; c.shadowBlur = H * .006;
      // the top line: the subject, and how the lesson is going
      c.fillStyle = '#d9e6da'; chalk(H * .05, 500); c.textAlign = 'left';
      c.fillText(subject ? subject.name + (subject.focus ? ` · ${subject.focus}` : '') : 'Lesson', W * .04, H * .065);
      c.textAlign = 'right'; c.fillText(asked ? `quiz ${right}/${asked}` : subject?.lessons > 1 ? `lesson ${subject.lessons}` : '', W * .96, H * .065);
      c.strokeStyle = 'rgba(230,240,230,.35)'; c.lineWidth = H * .004; c.beginPath(); c.moveTo(W * .04, H * .11); c.lineTo(W * .96, H * .11); c.stroke();
      c.fillStyle = '#f5f3ea';
      const s = show;
      if (s.kind === 'title' || s.kind === 'done') {
        c.textAlign = 'center';
        let size = H * .14; chalk(size, 700);
        const big = s.kind === 'done' ? 'Well done!' : (subject?.name || 'Lesson');
        while (c.measureText(big).width > W * .88 && size > H * .06) { size *= .9; chalk(size, 700); }
        c.fillText(big, W / 2, H * .38);
        chalk(H * .06, 500); c.fillStyle = '#ffe9a8';
        const sub = s.kind === 'done' ? [s.line || '', asked ? `Quiz: ${right} out of ${asked}` : ''].filter(Boolean) : [subject?.kind === 'language' ? "Let's learn some words!" : "Let's learn together!"];
        sub.forEach((l, i) => wrap(c, l, W * .86).slice(0, 2).forEach((x, k) => c.fillText(x, W / 2, H * (.58 + i * .12 + k * .08))));
        if (s.emoji) { c.font = `${H * .16}px system-ui, sans-serif`; c.fillText(s.emoji, W / 2, H * .82); }
      } else if (s.kind === 'board') {
        let top = H * .2;
        c.textAlign = 'left'; c.fillStyle = '#ffe9a8';
        let size = H * .085; chalk(size, 700);
        const room = s.emoji ? W * .72 : W * .92;
        let head = wrap(c, s.title, room); while (head.length > 2 && size > H * .055) { size *= .9; chalk(size, 700); head = wrap(c, s.title, room); }
        head.slice(0, 2).forEach((l, i) => c.fillText(l, W * .04, top + i * size * 1.1));
        top += Math.min(2, head.length) * size * 1.1 + H * .03;
        if (s.emoji) { c.textAlign = 'center'; c.font = `${H * .17}px system-ui, sans-serif`; c.fillText(s.emoji, W * .87, H * .26); c.textAlign = 'left'; }
        // the lines, as chalk bullets, shrunk until they fit
        c.fillStyle = '#f5f3ea';
        let fs = H * .068, lay;
        const layout = () => { chalk(fs, 500); return s.lines.map(l => wrap(c, l, W * .86)); };
        for (lay = layout(); lay.flat().length * fs * 1.2 > H * .94 - top && fs > H * .036; lay = layout()) fs *= .92;
        let y = top + fs * .5;
        for (const ls of lay) {
          c.beginPath(); c.arc(W * .055, y, fs * .14, 0, Math.PI * 2); c.fill();
          for (const l of ls) { if (y > H * .96) break; c.fillText(l, W * .09, y); y += fs * 1.18; }
          y += fs * .12;
        }
      } else if (s.kind === 'word') {
        c.textAlign = 'center';
        let size = H * .17; chalk(size, 700);
        while (c.measureText(s.word).width > W * .9 && size > H * .07) { size *= .9; chalk(size, 700); }
        c.fillStyle = '#ffffff'; c.fillText(s.word, W / 2, H * .34);
        if (s.sounds) { chalk(H * .058, 500); c.fillStyle = '#bfe3ff'; c.fillText(`say: "${s.sounds}"`, W / 2, H * .5); }
        c.strokeStyle = 'rgba(230,240,230,.3)'; c.beginPath(); c.moveTo(W * .3, H * .59); c.lineTo(W * .7, H * .59); c.stroke();
        c.fillStyle = '#ffe9a8'; let ms = H * .085; chalk(ms, 600);
        let ml = wrap(c, s.meaning, W * .86); while (ml.length > 2 && ms > H * .05) { ms *= .9; chalk(ms, 600); ml = wrap(c, s.meaning, W * .86); }
        ml.slice(0, 2).forEach((l, i) => c.fillText(l, W / 2, H * .7 + i * ms * 1.15));
        if (s.example) { chalk(H * .045, 500); c.fillStyle = '#d9e6da'; wrap(c, s.example, W * .9).slice(0, 2).forEach((l, i) => c.fillText(l, W / 2, H * (.86 + i * .06))); }
      } else if (s.kind === 'quiz' && q) {
        c.textAlign = 'left'; c.fillStyle = '#ffe9a8';
        let size = H * .078; chalk(size, 700);
        let lines = wrap(c, q.question, W * .92); while (lines.length > 3 && size > H * .048) { size *= .9; chalk(size, 700); lines = wrap(c, q.question, W * .92); }
        lines.slice(0, 3).forEach((l, i) => c.fillText(l, W * .04, H * .19 + i * size * 1.12));
        const top = H * .19 + Math.min(3, lines.length) * size * 1.12 + H * .02, rows = Math.ceil(q.choices.length / 2);
        const cellW = W * .46, cellH = Math.min(H * .2, (H * .95 - top) / rows);
        q.choices.forEach((a, i) => {
          const x = W * .03 + (i % 2) * W * .48, y = top + Math.floor(i / 2) * cellH;
          const isRight = state === 'shown' && i === q.answer, isWrong = state === 'shown' && i === picked && i !== q.answer;
          c.strokeStyle = isRight ? '#9fffb5' : isWrong ? '#ffb0a0' : 'rgba(240,240,230,.45)'; c.lineWidth = H * (isRight || isWrong ? .008 : .004);
          c.beginPath(); c.roundRect(x, y, cellW, cellH * .86, cellH * .18); c.stroke();
          const r0 = cellH * .24, cx = x + r0 * 1.5, cy = y + cellH * .43;
          c.fillStyle = BUZZ[i]; c.beginPath(); c.arc(cx, cy, r0, 0, Math.PI * 2); c.fill();
          c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.font = `800 ${r0 * 1.2}px system-ui, sans-serif`; c.fillText(LETTERS[i], cx, cy + r0 * .06);
          c.textAlign = 'left'; c.fillStyle = isRight ? '#c8ffd4' : '#f5f3ea'; const room = cellW - r0 * 3.2;
          let fs = cellH * .36; chalk(fs, 600);
          let ls = wrap(c, a, room);
          while ((ls.length > 2 || ls.some(l => c.measureText(l).width > room)) && fs > cellH * .18) { fs *= .9; chalk(fs, 600); ls = wrap(c, a, room); }
          ls = ls.slice(0, 2); ls.forEach((l, k) => c.fillText(l, cx + r0 * 1.6, cy + (k - (ls.length - 1) / 2) * fs * 1.1));
        });
      }
      c.shadowBlur = 0;
    });
  }
  function showBuzzers() {
    const n = state === 'quiz' && q ? q.choices.length : 0;
    buzzers.forEach((b, i) => {
      const was = b.visible; b.visible = i < n;
      b.position.x = (i - (n - 1) / 2) * (n === 2 ? .2 : .14);
      b.userData.label.userData.redraw((c, w, h) => { c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `800 ${h * .7}px system-ui, sans-serif`; c.fillText(LETTERS[i], w / 2, h * .54); });
      if (b.visible && !was) { b.scale.setScalar(.01); tw.tween(.4, k => b.scale.setScalar(popIn(k))); }
    });
  }
  const wipe = () => { sounds.flip?.(); };
  const choicesWords = () => q.choices.map((a, i) => `${LETTERS[i]}) ${a}`).join('  ');
  const askLine = () => `"${q.question}" ${choicesWords()}`;

  /** They answer quiz choice i: the board shows the right one, Reverie hears how it went, the progress is kept. */
  async function choose(i) {
    if (state !== 'quiz' || !q || i < 0 || i >= q.choices.length) return null;
    const ok = i === q.answer, was = q;
    picked = i; state = 'shown'; asked++; if (ok) right++;
    book?.answered(subject.name, ok, q.word);
    paint();
    const b = buzzers[i]; sounds.clack?.(1);
    tw.tween(.25, k => { b.userData.cap.position.y = .017 - Math.sin(k * Math.PI) * .012; });
    const at = new THREE.Vector3(); buzzers[q.answer].getWorldPosition(at); at.y += .05;
    if (ok) { stage.sparks(at, '#7dffa0', 30); sounds.chime?.(); creature.mood('excited'); creature.gesture(right >= 3 && right === asked ? 'tada' : 'bounce'); }
    else { sounds.thud?.(); creature.mood('surprised'); creature.gesture('shake'); }
    const verdict = ok ? `right! They said ${LETTERS[i]}) ${was.choices[i]}.` : `not quite: they said ${LETTERS[i]}) ${was.choices[i]}, and the answer is ${LETTERS[was.answer]}) ${was.choices[was.answer]}.`;
    const word = was.word ? ok ? ` "${was.word}" moves up a box, so it comes back later.` : ` "${was.word}" goes back in the first box, to come round again tomorrow.` : '';
    stage.news(`[lesson] They answered the quiz question ${verdict}${word} Quiz so far: ${right} of ${asked}. React warmly in a line${ok ? '' : ' and explain the right answer simply'}, then carry on the lesson with teach (another board, a word, a question, or end when it's a good place to stop).`, true);
    return verdict;
  }

  const api = {
    id: 'lesson', title: 'Lesson', camera: CAMERA,
    get state() { return state; },
    get subject() { return subject?.name || ''; },
    /** A lesson begins on a subject: { topic, language, level }. With no topic, the last subject again. */
    async start({ topic, language, level } = {}) {
      topic = clean(topic, 60); language = clean(language, 30); level = clean(level, 30);
      if (!topic && !language) { if (!subject) return 'Not started: say what the lesson is about.'; topic = subject.focus || subject.name; language = subject.kind === 'language' ? subject.name : ''; }
      const before = book?.begin({ topic, language, level });
      subject = book?.get(language || topic) || { name: language || topic, kind: language ? 'language' : 'topic', lessons: 1, focus: language && topic ? topic : '' };
      if (!root) build();
      tw.stop(); state = 'board'; show = { kind: 'title' }; q = null; picked = -1; asked = right = boards = newWords = 0;
      if (!root.parent) {
        scene.add(root);
        bodies = [stage.physics?.box(null, .64, TABLE_H, .36, { fixed: true, at: { x: CENTRE.x, y: TABLE_H / 2, z: CENTRE.z } }),
          stage.physics?.box(null, .5, .8, .3, { fixed: true, at: { x: EASEL.x, y: .4, z: EASEL.z } })];
      }
      for (const p of pieces) p.scale.setScalar(.01);
      tw.tween(.45, k => { for (const p of pieces) p.scale.setScalar(popIn(k)); });
      stage.sparks(new THREE.Vector3(EASEL.x, BOARD.bottom + BOARD.h / 2, EASEL.z + .1), '#ffe9a8', 36);
      paint(); showBuzzers(); wipe();
      diaryLine(`had a ${language ? language + ' ' : ''}lesson${!language || topic !== language ? ` on ${topic}` : ''}`.replace(/ on (.+) on /, ' on $1 '));
      const recap = book?.recap(language || topic) || '';
      return `The chalkboard is up on the table and you are the teacher${before ? ', carrying on from before' : ''}: a ${language ? `${language} lesson${topic && topic !== language ? ` about ${topic}` : ''}` : `lesson on ${topic}`}${level ? ` (${level})` : ''}. ${recap ? recap + ' ' : ''}Teach it in little steps: a board of a few short lines (teach board), ${language ? 'new words with how to say them (teach word), ' : ''}a prop in your hands to show what you mean (make), and a quick question now and then (teach quiz). Talk it through out loud, ask them things, and keep it fun and short.`;
    },
    /** The teach tool, once the lesson is on: board, word, quiz or end. Resolves a sentence for Claude. */
    async teach(input = {}) {
      if (state === 'off' || !subject) return { text: 'No lesson is on: start one with teach action start and a topic.', error: true };
      const a = input.action;
      if (a === 'board') {
        const title = clean(input.title, 80), lines = [].concat(input.lines || []).map(l => clean(l, 120)).filter(Boolean).slice(0, MAX_LINES);
        if (!title && !lines.length) return { text: 'Not written: give a title and a few short lines.', error: true };
        show = { kind: 'board', title: title || subject.name, lines, emoji: clean(input.emoji, 8) };
        state = 'board'; q = null; boards++; paint(); showBuzzers(); wipe();
        book?.covered(subject.name, title || lines[0]);
        creature.gesture('point');
        let made = '';
        if (input.picture) made = ' ' + await stage.make(clean(input.picture, 60)).catch(() => 'The picture prop did not come out.');
        return `Written on the board: "${show.title}"${lines.length ? `: ${lines.join(' / ')}` : ''}.${made} Talk them through it in your own words; don't read it out word for word.`;
      }
      if (a === 'word') {
        const word = clean(input.word, 40), meaning = clean(input.meaning, 60);
        if (!word || !meaning) return { text: 'Not written: a word needs the word and its meaning.', error: true };
        show = { kind: 'word', word, meaning, sounds: clean(input.sounds_like, 40), example: clean(input.example, 90) };
        state = 'board'; q = null; paint(); showBuzzers(); wipe();
        const isNew = book?.word(subject.name, { word, meaning, sounds: show.sounds }); if (isNew) newWords++;
        creature.gesture('point');
        return `"${word}" (${meaning}) is on the board${show.sounds ? `, with how to say it: ${show.sounds}` : ''}${isNew ? ', and in their word list' : ' (they have met it before)'}. Say it slowly using the "say" spelling, then get them to say it back.`;
      }
      if (a === 'quiz') {
        const question = clean(input.question, 160), choices = [].concat(input.choices || []).map(x => clean(x, 50)).filter(Boolean).slice(0, 4), answer = input.answer | 0;
        if (!question || choices.length < 2 || answer < 0 || answer >= choices.length) return { text: 'Not asked: a quiz needs a question, two to four choices, and the right one\'s number (0 is the first).', error: true };
        q = { question, choices, answer, word: clean(input.word, 40) }; picked = -1;
        show = { kind: 'quiz' }; state = 'quiz'; paint(); showBuzzers(); wipe();
        creature.gesture('think');
        return `The question is on the board with ${choices.length} buzzers: ${askLine()}. Ask it out loud with its choices, then wait: they tap a buzzer or say it (play a spoken answer with game_move), and you hear [lesson] news when they answer. Don't give it away.`;
      }
      if (a === 'end') {
        const learned = [].concat(input.learned || []).map(l => clean(l, 90)).filter(Boolean).slice(0, 6), next = clean(input.next, 120);
        book?.end(subject.name, { learned, next });
        show = { kind: 'done', line: learned.length ? `Today: ${learned.slice(0, 2).join(', ')}` : '', emoji: '⭐' };
        state = 'done'; q = null; paint(); showBuzzers();
        stage.sparks(new THREE.Vector3(EASEL.x, BOARD.bottom + BOARD.h, EASEL.z + .1), '#ffe9a8', 50); sounds.gong?.();
        creature.mood('excited'); creature.gesture('tada');
        diaryLine(`learned about ${subject.focus || subject.name}${asked ? ` (quiz ${right} of ${asked})` : ''}`);
        return `The lesson is over and kept in your diary${learned.length ? `: ${learned.join('; ')}` : ''}${next ? `. Next time: ${next}` : ''}. Quiz: ${right} of ${asked}. Cheer them in a line; the board stays up until they press Done or you use stop_game.`;
      }
      return { text: 'Not done: action must be start, board, word, quiz or end.', error: true };
    },
    stop() {
      tw.stop(); state = 'off'; q = null;
      if (root?.parent) { root.removeFromParent(); for (const b of bodies) b?.remove?.(); bodies = []; }
    },
    update(dt) {
      if (state === 'off') return;
      t += dt; tw.update(dt);
      buzzers.forEach((b, i) => { const m = b.userData.cap.material; m.emissiveIntensity = state === 'quiz' ? .3 + Math.sin(t * 3 + i) * .15 : state === 'shown' && q && i === q.answer ? 1.4 + Math.sin(t * 8) * .5 : .1; });
    },
    tap(ray) {
      if (state === 'off') return false;
      const hits = ray.intersectObjects(buzzers.filter(b => b.visible), true);
      if (hits.length) { let o = hits[0].object; while (o && !buzzers.includes(o)) o = o.parent; if (o) choose(o.userData.i); return true; }
      return ray.intersectObject(root, true).length > 0;
    },
    /** Their quiz answer said out loud. */
    async command(text) {
      if (state === 'off') return 'No lesson is on.';
      if (state !== 'quiz' || !q) return state === 'shown' ? 'They have already answered that one.' : 'There is no question on the board just now.';
      const i = answerOf(text, q.choices);
      if (i < 0) return `"${text}" is not one of the choices: ${choicesWords()}.`;
      const v = await choose(i);
      return `Answered ${LETTERS[i]} for them: ${v}`;
    },
    context() {
      if (state === 'off' || !subject) return '';
      const s = show, on = s.kind === 'board' ? `the board shows "${s.title}"` : s.kind === 'word' ? `the board shows the word "${s.word}" (${s.meaning})` : s.kind === 'quiz' && q ? `a quiz question is up: ${askLine()}; the right one is ${LETTERS[q.answer]}, ${state === 'quiz' ? 'waiting for their answer (they tap or say it; play a spoken answer with game_move), so don\'t give it away' : 'answered'}` : s.kind === 'done' ? 'the lesson is finished' : 'the title is up';
      return `[lesson, you are the teacher: ${subject.kind === 'language' ? `${subject.name}${subject.focus ? ` (${subject.focus})` : ''}` : subject.name}; ${on}. Boards so far ${boards}${newWords ? `, new words ${newWords}` : ''}, quiz ${right} of ${asked}.]`;
    },
    bar() {
      if (state === 'off') return null;
      const text = `${subject.kind === 'language' ? subject.name : 'Lesson · ' + subject.name}${asked ? ` · quiz ${right}/${asked}` : ''}`;
      const buttons = state === 'quiz' && q ? q.choices.map((a, i) => ({ id: 'pick' + i, label: LETTERS[i] })) : [];
      buttons.push({ id: 'leave', label: 'Done' });
      return { text, buttons };
    },
  };
  for (let i = 0; i < 4; i++) api['pick' + i] = () => choose(i);
  return api;
}
