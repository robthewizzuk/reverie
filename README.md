# Reverie

A little 3D creature you talk to. Claude does its thinking. The [Game Scroll](https://github.com/robthewizzuk/game-scroll)
engine does everything else on your device: the voice and lip sync, listening, the 3D room, physics, and the props it
makes for you out of words.

Ask it to make something ("make me a red teapot"), change it ("make it made of gold", "make it bigger"), throw it, or
tidy up. Decorate its room: "make a lamp and put it by the window", "move the teapot onto the shelf", "paint the walls
sky blue". It walks over and sets things down itself, and the room is kept as you left it. Tap it and it giggles. It gets happier the more you play, and can make itself a tiny pet that wanders the room ("make yourself a pet kitten called Mochi"). Talk over it and it stops to listen. Ask it to smash what it's holding (it breaks into real pieces that tumble across the rug) or slice it in half, or for fireworks, confetti, bubbles or an indoor snow flurry. Shake your phone and it gets dizzy while everything on the floor bounces; tilt it and things roll.
Play chess, a quiz, noughts and crosses, Twenty Questions, Draw and Guess or a Dice Quest with it, ask it to roll some dice, or tap the pencil and draw something for it to make real.

It remembers you. Tell it your name, your birthday or that your dog is called Biscuit, and it brings it up next time, along
with how your chess games went and what it made for you. Tap the book to see its diary and forget any of it. On the
first visit of each day it has made you something overnight, gives you a short spoken briefing (the weather, the sun
and moon, anything special about the day) and has a fact, riddle, word scramble or trivia question waiting. Ask for
"my briefing" any time.

## Run it

```bash
npm run setup                 # fetches the engine (a git submodule) and installs both
cp .env.example .env.local    # then put your Anthropic API key in .env.local
npm run dev                   # opens on http://localhost:5173 (add ?debug to see turn timings)
```

No key yet? `REVERIE_FAKE=1 npm run dev` runs a scripted stand-in for Claude, so the page, speech, tools and props all
work offline.

`node tests/smoke.mjs`, `node tests/body.mjs`, `node tests/kits.mjs`, `node tests/fun.mjs` and `node tests/games.mjs` test the page against that stand-in (`REVERIE_FAKE=1 npm run dev -- --port 5179` first).

The key only ever lives on the server side: `.env.local` is gitignored, the Vite dev server reads it for `/api/turn`,
and nothing with a `VITE_` prefix holds it, so it never reaches the page.

## How it works

| Part | Where | What it does |
| --- | --- | --- |
| The page | `src/main.js` | Runs the stage, the chat bar, the mic and the caption |
| The turn loop | `src/brain.js` | Sends what you said to `/api/turn`, speaks each sentence as soon as it has streamed in, starts each tool the moment its words are complete, and stops at once when you talk over it |
| Its body language | `src/body.js` | On the device, between replies: simple rules pick a little move every few seconds (glance about, peek at what it holds, sway, hop, stretch and yawn), it gets drowsy when left alone, and it perks up the moment you start talking or typing, before anything goes to Claude. A Tiny Brains `Coach` from the engine sits on the rules: poke it just after a move you like and it does that more in moments like that one (kept in the browser) |
| Its mood | `src/mood.js` | It gets happier the more you play: making things, games, dice, drawings, patting it or its pet, just chatting. Each bit lifts it a little (less the happier it already is), and it drifts slowly back to content while you're away. Happier, it hops and sways more, bobs on the spot, smiles readily, its core glows brighter and pulses quicker, and its voice is livelier; low, it droops a little. Claude is told how it feels each turn, a level up sends up hearts, and after a long time away it tells Claude it missed you. Kept in the browser |
| Its pet | `src/pet.js` | A tiny animal it makes for you (`pet` tool: a kitten, a fox, a bunny, an owl, a bee, a baby dragon... any of the engine's `gs.models.creature` animals that walk or fly), with real gaits on its own skeleton. On the device it wanders the room (mostly where you can see it), does zoomies when Reverie is happy, trots after Reverie when it walks, chases anything thrown and noses it along, runs to say hello when you arrive, and curls up asleep beside Reverie (with floating z's) when it gets drowsy. Tap it and it hops, with hearts and its name floating over it (`gs.fx3d.text3d`). Tricks on request: sit, jump, spin, come, sleep, play dead, zoomies, dance. What it is and its name are kept in the browser |
| The creature | `src/creature.js` | Built in code: plush body, glowing core (pulses when idle, brightens when listening, swirls when thinking), blinking eyes, a mouth the engine's `Face` lip-syncs, arms that wave, point and hold |
| The room | `src/room.js` | The room as you made it: the colours of its walls, floor, rug and woodwork, the spots things can go (by the window, on the shelf, on the workbench...), and the things placed there, kept in the browser and rebuilt from their words next time |
| Toys | `src/fun.js` | Smash a prop into real pieces or slice it in two (`gs.destruction`, with the bits fading away after a while), little shows of fireworks, confetti, magic, bubbles, snow and hearts (`gs.fx3d`), and the phone itself (`gs.device`): a shake makes it dizzy, bounces everything on the floor and tells Claude; a tilt rolls things on the floor that way, settling back upright when the phone is held still |
| The stage | `src/world.js` | A workshop corner in the engine's Next Gen view; props from `gs.models.generate`, held in its hands, thrown with real weight by `gs.physics3d` |
| Dice | `src/dice.js` | Real dice (`gs.tabletop.die`) thrown from its hands onto the rug in the stage's physics, read by which face lands on top (`gs.dice.Dice3D`). Other dice (a d20) are rolled with `gs.dice.roll` and the number floats over its head (`gs.fx3d.text3d`) |
| Drawing pad | `src/doodle.js` | The pencil button (or the `doodle` tool) opens a sheet of paper over the stage. The engine's doodle model (`gs.doodle`, on the device) names what was drawn among 200 things, and it is made with the 3D generator. Only the name goes to Claude |
| The sky outside | `src/place.js` | The device line also says whether the sun is up and the moon's phase, and a low battery (`gs.real`, worked out on the device, no permission) |
| Its diary | `src/memory.js`, `src/diary.js` | What it remembers about you, kept only in this browser (`localStorage`): your name and birthday, facts it was told to `remember`, game records, things it made, the last few lines you said, and a line or two for each day. Claude gets a short summary at the top of each chat (read once a chat, so the cached prompt never changes under it). The book button opens the diary sheet: a ✕ on each fact, and "Forget everything" |
| Its day | `src/daily.js` | Picked from the date, so a day's surprise is the same on every visit: a thing it made overnight (in its hands when you arrive), and a fun fact, riddle, word scramble or trivia question (`gs.trivia`). The briefing note: the day, birthdays, streaks and fun days, the weather, sunrise, sunset and the moon (`gs.real`), and the surprise, said by Claude in its own words after its hello. Birthdays and streaks get confetti |
| The backend | `server/turn.js` | One small handler that adds the key and streams Claude's reply back. Runs inside the Vite dev server (`server/dev.js`) and as a Cloudflare Worker (`worker/`) |
| Its personality and tools | `server/persona.js` | The system prompt and its tools: `make`, `change`, `toss`, `clear`, `place`, `room_colours`, `roll`, `effect`, `smash`, `doodle`, `act`, `play`, `game_move`, `stop_game`, `remember`, `forget`, `briefing`, `diary`, `pet`, `think_harder` |
| Games | `src/games/` | Games it plays with you on a table in front of it. Chess: the engine's living stone pieces, rules from chess.js and the engine's chess opponent picking its moves (fast, always legal, levels 1 to 5), while Claude reacts out loud to each move and a stretchy arm moves its pieces. Quiz: ten questions from the engine's bank of about 2,700 (`gs.trivia`, Open Trivia Database, CC BY-SA 4.0) on a card with four buzzers, starting easy and climbing; Reverie hosts, reading each question out and reacting to each answer, and is only told the answer once you've given yours. Noughts and crosses: the engine's game search (`gs.solve.Search`) picks its noughts, with slips at the lower levels and none at 5; tap a square or say it. Twenty Questions: the game picks the secret, counts your questions on twenty lamps and spots a right guess itself, so Reverie only has to answer; guess it and the mystery box opens and the thing is made in its hands. Draw and Guess: you draw a word against the clock on the drawing pad, and the doodle reader (`gs.doodle`) guesses live while Reverie calls its guesses out in its own voice, with no trip to Claude. Dice Quest: a path across the table past four challenges, each a little model from the generator, and real dice thrown from its hands; Reverie tells the story. `src/games/index.js` says how to add another |

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
node tests/kits.mjs           # rolls dice, plays three quiz questions (tap, button, said), draws a house and has it made
node tests/memory.mjs --page  # the diary alone, then a second day: the overnight surprise, the briefing, a name kept, the diary sheet
node tests/room.mjs           # carries a lamp to the window, a teapot to the shelf, paints the room, reloads it
node tests/pet.mjs            # its mood rises with play; makes a fox called Pip that wanders, is patted, chases a ball, plays dead, naps, and is still there after a reload
node tests/fluid.mjs          # turn-taking with a stand-in recogniser: answered at the pause, a mid-sentence pause kept as one question, first clause first, a dropped connection retried
npm run latency               # with your key: time to the first words from Claude, cold cache, warm cache and without thinking (a few pennies)
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
