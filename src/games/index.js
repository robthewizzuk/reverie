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
//   undo() and any other button ids      called by name from the bar
// news(text, loud) is how a game tells Claude what just happened: loud news gets a spoken reaction straight away,
// quiet news is passed along with the next thing the person says.
//
// To add a game: write it in this folder, add it here, and add its name to the play tool's list in server/persona.js.
import { makeChess } from './chess.js';

export const GAMES = {
  chess: { title: 'Chess', make: makeChess },
};
