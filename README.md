# Reverie

A little 3D creature you talk to. Claude does its thinking. The [Game Scroll](https://github.com/robthewizzuk/game-scroll)
engine does everything else on your device: the voice and lip sync, listening, the 3D room, physics, and the props it
makes for you out of words.

Ask it to make something ("make me a red teapot"), change it ("make it made of gold", "make it bigger"), throw it, or
tidy up. Decorate its room: "make a lamp and put it by the window", "move the teapot onto the shelf", "paint the walls
sky blue". It walks over and sets things down itself, and the room is kept as you left it. Tap it and it giggles. Talk over it and it stops to listen.

## Run it

```bash
npm run setup                 # fetches the engine (a git submodule) and installs both
cp .env.example .env.local    # then put your Anthropic API key in .env.local
npm run dev                   # opens on http://localhost:5173 (add ?debug to see turn timings)
```

No key yet? `REVERIE_FAKE=1 npm run dev` runs a scripted stand-in for Claude, so the page, speech, tools and props all
work offline.

`node tests/smoke.mjs` and `node tests/body.mjs` test the page against that stand-in (`REVERIE_FAKE=1 npm run dev -- --port 5179` first).

The key only ever lives on the server side: `.env.local` is gitignored, the Vite dev server reads it for `/api/turn`,
and nothing with a `VITE_` prefix holds it, so it never reaches the page.

## How it works

| Part | Where | What it does |
| --- | --- | --- |
| The page | `src/main.js` | Runs the stage, the chat bar, the mic and the caption |
| The turn loop | `src/brain.js` | Sends what you said to `/api/turn`, speaks each sentence as soon as it has streamed in, starts each tool the moment its words are complete, and stops at once when you talk over it |
| Its body language | `src/body.js` | On the device, between replies: simple rules pick a little move every few seconds (glance about, peek at what it holds, sway, hop, stretch and yawn), it gets drowsy when left alone, and it perks up the moment you start talking or typing, before anything goes to Claude. A Tiny Brains `Coach` from the engine sits on the rules: poke it just after a move you like and it does that more in moments like that one (kept in the browser) |
| The creature | `src/creature.js` | Built in code: plush body, glowing core (pulses when idle, brightens when listening, swirls when thinking), blinking eyes, a mouth the engine's `Face` lip-syncs, arms that wave, point and hold |
| The room | `src/room.js` | The room as you made it: the colours of its walls, floor, rug and woodwork, the spots things can go (by the window, on the shelf, on the workbench...), and the things placed there, kept in the browser and rebuilt from their words next time |
| The stage | `src/world.js` | A workshop corner in the engine's Next Gen view; props from `gs.models.generate`, held in its hands, thrown with real weight by `gs.physics3d` |
| The backend | `server/turn.js` | One small handler that adds the key and streams Claude's reply back. Runs inside the Vite dev server (`server/dev.js`) and as a Cloudflare Worker (`worker/`) |
| Its personality and tools | `server/persona.js` | The system prompt and its tools: `make`, `change`, `toss`, `clear`, `place`, `room_colours`, `act`, `play`, `game_move`, `stop_game`, `think_harder` |
| Games | `src/games/` | Games it plays with you on a table in front of it. Chess: the engine's living stone pieces, rules from chess.js and the engine's chess opponent picking its moves (fast, always legal, levels 1 to 5), while Claude reacts out loud to each move and a stretchy arm moves its pieces. `src/games/index.js` says how to add another |

Everyday chat goes to Claude Haiku 5.5 with low effort, for speed. When a question needs real thought, it calls
`think_harder` and the rest of that turn goes to Claude Sonnet 5.5. Either can be changed with `REVERIE_QUICK_MODEL`
and `REVERIE_DEEP_MODEL`.

## Put it online

One Cloudflare Worker serves both the built page (`dist/`, as static assets) and the `/api/turn` backend, at one
address, so there is no CORS or `VITE_API_URL` to set. From the repo root, after `npm run setup`:

```bash
npx wrangler login                                        # once: opens Cloudflare in the browser
cd worker && npx wrangler secret put ANTHROPIC_API_KEY    # once: paste the key; stored by Cloudflare, never in the repo
cd .. && npm run deploy                                   # builds the page, then deploys it and the backend
```

It prints the address (`https://reverie.<your-subdomain>.workers.dev`). Run `npm run deploy` again after each change.
`npm run worker:dev` tries the same Worker locally at http://localhost:8787, with the key in `worker/.dev.vars`
(gitignored): `ANTHROPIC_API_KEY=...`.

Or let GitHub deploy it: `.github/workflows/deploy.yml` builds and deploys on every push to `main` (or by hand from the
Actions tab). Add the repository secrets `CLOUDFLARE_API_TOKEN` (the "Edit Cloudflare Workers" token template),
`CLOUDFLARE_ACCOUNT_ID` and `ANTHROPIC_API_KEY` under Settings › Secrets and variables › Actions.

Only the Worker's own address may call the API from a browser. To host the page somewhere else, set `ALLOWED_ORIGIN` in
`worker/wrangler.toml` to that page's address and build it with `VITE_API_URL` set to the Worker's address.

## Test

```bash
REVERIE_FAKE=1 npm run dev -- --port 5179
npm run smoke                 # wakes it, makes, changes and throws a prop, asks a deep question; pictures in tests/out/
node tests/chess.mjs          # asks to play chess, taps a move, says a move, puts the board away
node tests/room.mjs           # carries a lamp to the window, a teapot to the shelf, paints the room, reloads it
node tests/perf.mjs --gpu --tier 2 --idle   # CPU time a frame, draw calls and triangles (the GPU here is software)
node tests/look.mjs --seats front,top       # pictures of the light from the usual seat and from above, in tests/out/
```

The light is `src/light.js`: a low sun through the window in the left wall, the bench lamp, the core's glow, bounce
light and the room's own reflections, with an indoor mood set by hand. The page draws at the engine's frame rate for a
Next Gen game (60 on a phone or a browser, not every refresh of a 120 Hz screen) and tells its speed kit what is
playing, so the quality it settles on is remembered between visits.

## Known gaps

- **The voice downloads on first use.** Its Phonon voice comes from the engine's asset host. Until it has loaded, lines
  are shown as captions only. The voice has not been heard yet in this repo's own tests (the test machine could not
  reach that host).
- **Listening** uses the browser's own speech recognition where there is one (Chrome, Safari, Edge). It tries the best
  way first (Chrome: an echo-cancelled mic track, on the device) and steps down by itself if a browser ignores that
  (Edge goes straight to the plain way). Every recogniser event is logged as `[reverie] mic: …` in the console (and on
  the page with `?debug`). If none works, it says so and you type. Elsewhere the mic button hides and you type.
- **Talking over it** with the speaker on can pick up its own voice. It needs three or more words heard before it stops,
  which mostly avoids this. Headphones avoid it completely.
- **AR mode** is not built yet. Chess is on the stage only, not on your floor.
