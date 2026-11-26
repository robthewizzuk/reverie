# Reverie

A little 3D creature you talk to. Claude does its thinking. The [Game Scroll](https://github.com/robthewizzuk/game-scroll)
engine does everything else on your device: the voice and lip sync, listening, the 3D room, physics, and the props it
makes for you out of words.

Ask it to make something ("make me a red teapot"), change it ("make it made of gold", "make it bigger"), throw it, or
tidy up. Tap it and it giggles. Talk over it and it stops to listen.

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
| The stage | `src/world.js` | A workshop corner in the engine's Next Gen view; props from `gs.models.generate`, held in its hands, thrown with real weight by `gs.physics3d` |
| The backend | `server/turn.js` | One small handler that adds the key and streams Claude's reply back. Runs inside the Vite dev server (`server/dev.js`) and as a Cloudflare Worker (`worker/`) |
| Its personality and tools | `server/persona.js` | The system prompt and six tools: `make`, `change`, `toss`, `clear`, `act`, `think_harder` |

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
```

## Known gaps

- **The voice downloads on first use.** Its Phonon voice comes from the engine's asset host. Until it has loaded, lines
  are shown as captions only. The voice has not been heard yet in this repo's own tests (the test machine could not
  reach that host).
- **Listening** uses the browser's own speech recognition where there is one (Chrome, Safari, Edge). Elsewhere the mic
  button hides and you type.
- **Talking over it** with the speaker on can pick up its own voice. It needs three or more words heard before it stops,
  which mostly avoids this. Headphones avoid it completely.
- **AR mode** and the mini-game from the plan are not built yet.
