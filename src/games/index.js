// The games Claude can play with you on the stage. Each one is made once, the first time it's asked for, from
//   make(stage)   stage: { THREE, scene, creature, physics, sparks(at, colour, n), news(text, loud) }
// and gives back:
//   id, title, camera: { pos, look }     where the camera goes while it's on
//   start(o) -> Promise<string>          set up and begin (o.level...); the sentence tells Claude what happened
//   stop()                               take it all away
//   update(dt)                           every frame while it's on
//   tap(ray) -> boolean                  a tap on the screen as a THREE.Raycaster; true when the game used it
//   command(text) -> Promise<string>     the person's move said out loud, played for them (Claude's game_move tool)
//   context() -> string                  the state of play, sent to Claude with everything the person says
//   bar() -> { text, buttons: [{ id, label }] }   the line above the chat bar ('again' and 'leave' are handled for you)
//   heard(text) -> string                optional: everything the person says while it's on, before Claude hears it;
//                                        a note returned goes along with it (Twenty Questions counts questions this way)
//   undo() and any other button ids      called by name from the bar
// news(text, loud) is how a game tells Claude what just happened: loud news gets a spoken reaction straight away,
// quiet news is passed along with the next thing the person says. The stage also has say(line) (a line in its own
// voice at once, false when busy), make(words) (a prop in its hands), pad (the drawing pad), stopGame() and again()
// (a fresh round, told to Claude). Each game's tag is how its news starts ("[chess] ...").
//
// Starting and stopping cleanly: start() may be called again at any time (a new round, mid-move too) and stop() at any
// time, even while start() is still waiting for something to load; whatever start() puts in the scene after a stop is
// taken away again by the stage. stop() takes every object it added out of the scene and every physics body it made,
// and drops its timers (tweens on a clock whose stop() is called), so no promise of the old round acts later.
//
// To add a game: write it in this folder, add it here, and add its name to the play tool's list in server/persona.js.
// Each game is code-split via dynamic import() so initial boot stays light, then silently prefetched
// during browser idle time (prefetchGames) so opening any game later feels instant.
export const GAMES = {
  chess:          { title: 'Chess',               tag: 'chess',          load: () => import('./chess.js').then(m => m.makeChess) },
  quiz:           { title: 'Quiz',                tag: 'quiz',           load: () => import('./quiz.js').then(m => m.makeQuiz) },
  noughts:        { title: 'Noughts and crosses', tag: 'noughts',        load: () => import('./noughts.js').then(m => m.makeNoughts) },
  twenty:         { title: 'Twenty Questions',    tag: 'twenty',         load: () => import('./twenty.js').then(m => m.makeTwenty) },
  draw_and_guess: { title: 'Draw and Guess',      tag: 'draw and guess', load: () => import('./draw.js').then(m => m.makeDraw) },
  quest:          { title: 'Dice Quest',          tag: 'quest',          load: () => import('./quest.js').then(m => m.makeQuest) },
  // (a lesson is started by the teach tool, with its topic, not by play)
  lesson:         { title: 'Lesson',              tag: 'lesson',         load: () => import('./lesson.js').then(m => m.makeLesson) },
  escape:         { title: 'Escape Room',         tag: 'escape',         load: () => import('./escape.js').then(m => m.makeEscape) },
  cards:          { title: 'Cards',               tag: 'cards',          load: () => import('./cards.js').then(m => m.makeCards) },
  words:          { title: 'Word Game',           tag: 'words',          load: () => import('./words.js').then(m => m.makeWords) },
  battleships:    { title: 'Battleships',         tag: 'battleships',    load: () => import('./battleships.js').then(m => m.makeBattleships) },
};

const makers = new Map();

/** Loads and caches a game's make(stage) factory. Instant once prefetched. */
export function loadGameMaker(name) {
  const def = GAMES[name];
  if (!def) return Promise.resolve(null);
  let p = makers.get(name);
  if (!p) {
    p = Promise.resolve().then(() => def.load()).catch(e => { makers.delete(name); throw e; });
    makers.set(name, p);
  }
  return p;
}

let prefetched = false;
/** Quietly warms all game chunks during browser idle time so they open without any noticeable load later. */
export function prefetchGames(delayMs = 2200) {
  if (prefetched || typeof window === 'undefined') return;
  prefetched = true;
  // Skip aggressive prefetching if user explicitly enabled Save-Data
  if (navigator.connection?.saveData) return;
  const names = Object.keys(GAMES);
  let idx = 0;
  const idle = typeof requestIdleCallback === 'function'
    ? fn => requestIdleCallback(fn, { timeout: 2500 })
    : fn => setTimeout(fn, 250);
  const next = () => {
    if (idx >= names.length) return;
    if (document.hidden) { setTimeout(next, 2000); return; }
    const name = names[idx++];
    loadGameMaker(name).catch(() => {}).finally(() => idle(next));
  };
  setTimeout(() => idle(next), delayMs);
}
