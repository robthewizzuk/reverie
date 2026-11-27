# Reverie

A little 3D creature you talk to. Claude does its thinking. The [Game Scroll](https://github.com/robthewizzuk/game-scroll)
engine does everything else on your device: the voice and lip sync, listening, the 3D room, physics, and the props it
makes for you out of words.

Ask it to make something ("make me a red teapot"), change it ("make it made of gold", "make it bigger"), throw it, or
tidy up. Decorate its room: "make a lamp and put it by the window", "move the teapot onto the shelf", "paint the walls
sky blue". It walks over and sets things down itself, and the room is kept as you left it. Tap it and it giggles. It gets happier the more you play, and can make itself a tiny pet that wanders the room ("make yourself a pet kitten called Mochi"). Talk over it and it stops to listen. Ask it to smash what it's holding (it breaks into real pieces that tumble across the rug) or slice it in half, or for fireworks, confetti, bubbles or an indoor snow flurry. Shake your phone and it gets dizzy while everything on the floor bounces; tilt it and things roll.
Paste a YouTube link (or tap the screen button) and a screen rolls down: Reverie sits down to watch it with you, chips in now and then at the quiet moments, and answers questions about it ("what did she mean?", "go back to the bit about lava").
Play chess, a quiz, noughts and crosses, Twenty Questions, Draw and Guess or a Dice Quest with it, get locked in an escape room together, ask it to roll some dice, or tap the pencil and draw something for it to make real.

Ask it to look into something ("find me the cheapest train to York on Saturday", "compare these three hoovers") and it
sends little helpers off to do the legwork in the background while you keep chatting: you can see them as glowing
wisps over its head and pills on the screen saying what each is doing, ask how they're getting on, and when one comes
back Reverie tells you what it found.

It remembers you. Tell it your name, your birthday or that your dog is called Biscuit, and it brings it up next time, along
with how your chess games went and what it made for you. It also learns from how you chat: what you love, who's in your life, your routines, and plans it will ask you about afterwards ("how did the maths test go?"). Tap the book to see its diary and change, add or forget any of it. On the
first visit of each day it has made you something overnight, gives you a short spoken briefing (the weather, the sun
and moon, anything special about the day) and has a fact, riddle, word scramble or trivia question waiting. Ask for
"my briefing" any time.

Connect your Google account (the button is in the diary, or just ask "what's on today?") and it reads your calendar and
email to you, adds things to your calendar, and drafts replies. It never sends an email or adds an event by itself: a
card shows exactly what will happen, and only your tap on Yes does it. Your day's agenda and new email join the briefing.
It keeps reminders and timers for you: "remind me at 6 to call Mum", "a ten minute timer for the pasta", "every weekday at
8, remind me to take my vitamins". Each shows as a chip at the bottom of the room counting down; when it's time a soft
chime rings and Reverie tells you in its own words. Tap the bell under the chips and you get a notification even with
Reverie closed.

## Run it

```bash
npm run setup                 # fetches the engine (a git submodule) and installs both
cp .env.example .env.local    # then put your Anthropic API key in .env.local
npm run dev                   # opens on http://localhost:5173 (add ?debug to see turn timings)
```

No key yet? `REVERIE_FAKE=1 npm run dev` runs a scripted stand-in for Claude, so the page, speech, tools and props all
work offline.

`node tests/reminders.mjs` and `node tests/push.mjs` test reminders and the Worker's push on their own. `node tests/smoke.mjs`, `node tests/karaoke.mjs`, `node tests/body.mjs`, `node tests/kits.mjs`, `node tests/fun.mjs`, `node tests/games.mjs`, `node tests/escape.mjs`, `node tests/watch.mjs --page` and `node tests/reminders.mjs --page` test the page against that stand-in (`REVERIE_FAKE=1 npm run dev -- --port 5179` first).

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
| Karaoke | `src/karaoke.js`, `src/tune.js`, `src/songs.js`, `src/party.js`, `src/lyrics.js` | It sings: the band is the engine's composer (`gs.sound.compose`), the tune is written over its chords a note a syllable (`tune.js`), and the voice sings each line through the engine (`gs.sound.say` with `sing`: each syllable held on its note and moved to its pitch), started as the band reaches it. The words light up syllable by syllable at the bottom of the screen, a mirror ball comes down on its cord throwing flecks of light round the room, coloured lights wash about on the beat, and it bops along. Its own songs, Twinkle Twinkle and Happy Birthday (public domain), or a new song Claude writes on the spot ("a song about my dog"); sing it, sing a duet (a line each), or you sing and it cheers. For your own Spotify songs, add an LRC file (the mic button on the music bar) and the words show in time whenever it plays; lyrics are never fetched from the web, as no free source is licensed to give them out. While a song plays the mic only takes its name or "stop" |
| The creature | `src/creature.js` | Built in code: plush body, glowing core (pulses when idle, brightens when listening, swirls when thinking), blinking eyes, a mouth the engine's `Face` lip-syncs, arms that wave, point and hold |
| The room | `src/room.js` | The room as you made it: the colours of its walls, floor, rug and woodwork, the spots things can go (by the window, on the shelf, on the workbench...), and the things placed there, kept in the browser and rebuilt from their words next time |
| Toys | `src/fun.js` | Smash a prop into real pieces or slice it in two (`gs.destruction`, with the bits fading away after a while), little shows of fireworks, confetti, magic, bubbles, snow and hearts (`gs.fx3d`), and the phone itself (`gs.device`): a shake makes it dizzy, bounces everything on the floor and tells Claude; a tilt rolls things on the floor that way, settling back upright when the phone is held still |
| Its props moving | `src/motion.js` | Springy squash and stretch (the engine's exact `gs.camera.Spring`, the same at any frame rate): a new prop pops into its hands past full size and back, one set down squashes onto its spot and springs up, the saved room pops back in one thing after another, tapping a thing rocks it (and opens a box's lid or a fridge's door), it rocks when Reverie brushes past, and cleared things swell a touch and shrink away with a twist. Their own small movements come from the engine (`gs.models.bring`): animals breathe, fans and windmills turn, a placed flag flies, ghosts and balloons bob, and up to two placed lamps or candles light the room. A thing at rest costs nothing a frame. `node tests/motion.mjs` |
| The stage | `src/world.js` | A workshop corner in the engine's Next Gen view; props from `gs.models.generate`, held in its hands, thrown with real weight by `gs.physics3d` |
| Dice | `src/dice.js` | Real dice (`gs.tabletop.die`) thrown from its hands onto the rug in the stage's physics, read by which face lands on top (`gs.dice.Dice3D`). Other dice (a d20) are rolled with `gs.dice.roll` and the number floats over its head (`gs.fx3d.text3d`) |
| Drawing pad | `src/doodle.js` | The pencil button (or the `doodle` tool) opens a sheet of paper over the stage. The engine's doodle model (`gs.doodle`, on the device) names what was drawn among 200 things, and it is made with the 3D generator. Only the name goes to Claude |
| The sky outside | `src/place.js` | The device line also says whether the sun is up and the moon's phase, and a low battery (`gs.real`, worked out on the device, no permission) |
| Its diary | `src/memory.js`, `src/diary.js`, `src/recap.js`, `server/recap.js` | What it knows about you, kept only in this browser (`localStorage`): your name and birthday, facts sorted by kind (about you, your people and pets, what's coming up, likes, interests, routines, how you've been, dislikes), plans with a date so it asks how they went, game records (chess with level and winning runs), things it made, recaps of past chats, when you tend to visit and what you play most, and a line or two for each day. It learns two ways: Claude calls `remember` as you talk, and after a quiet spell (or when the page is hidden) the chat so far goes to `/api/recap`, where the quick model boils it down into a one-line recap plus facts to add, change or drop. Claude gets the most useful part at the top of each chat, within about 1600 characters (read once a chat, so the cached prompt never changes under it), and looks up the rest with `recall`. The book button opens the diary sheet: change (✎), forget (✕) or add any fact, forget a recap, turn learning from chats off, and "Forget everything" |
| Watching together | `src/watch.js`, `server/video.js` | Paste a YouTube link in the chat (or tap the screen button and paste it, or pick a video file from the device) and a screen rolls down from the ceiling; the video plays on it in YouTube's own player, fitted onto the screen in 3D, and Reverie walks over and sits down to watch while the camera moves back to a seat behind it. It knows the video only as words: the title, the channel, the start of the description and the captions as timed lines, which `/api/video` fetches from YouTube (a page can't), or with no captions, what its ears catch. Laughs, applause, music and gasps in the captions get a reaction from its body on the spot, on the device. About every minute and a half (or twice as often if they ask it to be chatty, or never if they ask for quiet), at a gap in the captions, what was said since it last spoke goes to Claude for one short line, and the video's sound ducks while it talks. Everything you say while it's on goes with where you are and the last minute of what was said, and Claude can pause, rewind, seek and look through the captions for a part (the `watch` tool). Speech the mic hears that matches the captions is the video, not you (with no captions, say its name). With a `YOUTUBE_API_KEY` set on the server it can also search YouTube from words |
| Its diary | `src/memory.js`, `src/diary.js` | What it remembers about you, kept only in this browser (`localStorage`): your name and birthday, facts it was told to `remember`, game records, things it made, the last few lines you said, and a line or two for each day. Claude gets a short summary at the top of each chat (read once a chat, so the cached prompt never changes under it). The book button opens the diary sheet: a ✕ on each fact, and "Forget everything" |
| Its day | `src/daily.js` | Picked from the date, so a day's surprise is the same on every visit: a thing it made overnight (in its hands when you arrive), and a fun fact, riddle, word scramble or trivia question (`gs.trivia`). The briefing note: the day, birthdays, streaks and fun days, the weather, sunrise, sunset and the moon (`gs.real`), and the surprise, said by Claude in its own words after its hello. Birthdays and streaks get confetti |
| Music and dancing | `src/music.js`, `src/spotify.js`, `src/groove.js` | Your Spotify, by voice: "play some Dua Lipa", "my liked songs", "pause", "skip", "turn it down", "what's this song?" (`music` tool). You sign in once on Spotify's own page (PKCE, so there's no secret and nothing on the server), and the music plays in the page through Spotify's Web Playback SDK (Reverie appears as a speaker called "Reverie" in your Spotify apps), or on a phone or speaker already playing. It's turned down while Reverie talks or listens. Reverie dances whenever its music plays, and to any music in the room when asked (`dance` tool): Spotify no longer gives new apps a song's tempo, and music in the page can't be read, so the beat is heard through the microphone on the device (an audio worklet finds drum hits; the tempo and where the beats fall are worked out from the last eight seconds). Its core and the desk lamp swell on each beat. While music plays, the mic only counts words with its name in them or a music command, so lyrics aren't taken as you talking. Needs Spotify Premium |
| Gmail and calendar | `src/google.js`, `server/google.js` | Google sign-in (the client secret stays on the server; the tokens are kept encrypted in your own HttpOnly cookie, never stored on a server), with three permissions: read email, write drafts, see and add calendar events. Tools `calendar` (list, add) and `email` (inbox, search, read, draft, send). Adding and sending only put a card on the screen showing the event, or the email as Gmail holds it; only a real tap on Yes does it. Email text reaches Claude marked as other people's words, never instructions |
| Shopping | `src/shop.js`, `server/shop.js` | "Find me some wireless headphones under £100": Reverie sends a shopping helper off (Claude Sonnet 5.5 with web search and web fetch, looking across UK shops, prices in pounds) and keeps chatting. About a minute later the offers come back as numbered cards along the bottom of the stage (cheapest and Reverie's pick marked), Reverie tells you the cheapest and its pick, and holds up a little 3D model of the thing. An offer whose link isn't on a site the helper really saw is dropped. Reverie can never buy or pay: "buy number 2" puts a confirm strip on screen, and only your tap opens that shop's page, where you check out yourself. The last search is kept in the browser ("show my shopping") |
| The backend | `server/turn.js` | One small handler that adds the key and streams Claude's reply back. Runs inside the Vite dev server (`server/dev.js`) and as a Cloudflare Worker (`worker/`) |
| Its helpers | `src/helpers.js`, `src/helper-wisps.js`, `server/helpers.js`, `server/helper-agent.js` | Little agents it sends off (`send_helper`) to research or work something out in the background, up to three at once, each on Claude Sonnet 5.5 with web search, web fetch and a sandbox for sums. Each is a Claude Managed Agents session that Anthropic runs, so it keeps going while the page is shut. The page asks after them every few seconds (`/api/helpers`), shows each as a wisp over Reverie's head and a pill saying what it's doing, keeps who went where in the browser (picked up again after a reload), and when one comes back passes its report to Claude as a `[helper]` message for Reverie to retell in its own words. The `helpers` tool says what each is doing, reads a whole report, sends a finished one a follow-up, or calls one back. Helpers only look things up: never buy, book, sign up or message. Each has a hard spend cap ($1 by default) enforced by Anthropic, at most 3 at once and 30 a day (`REVERIE_HELPER_BUDGET_CENTS`, `REVERIE_HELPERS_AT_ONCE`, `REVERIE_HELPERS_PER_DAY`), and a tool call the server can't decide is safe is refused, since nobody is watching to approve it |
| Its personality and tools | `server/persona.js` | The system prompt and its tools: `make`, `change`, `toss`, `clear`, `place`, `room_colours`, `roll`, `effect`, `smash`, `doodle`, `act`, `play`, `game_move`, `stop_game`, `remember`, `recall`, `forget`, `briefing`, `diary`, `pet`, `send_helper`, `helpers`, `shop`, `think_harder` |
| Reminders and timers | `src/reminders.js`, `src/timers.js`, `public/sw.js`, `worker/src/push*.js` | The `reminder` tool sets, cancels, snoozes and lists them, kept only in this browser (`localStorage`). A chip for each counts down at the bottom of the stage (✕ cancels); when one goes off a soft chime rings every few seconds for a minute (Stop, +5, or just say something), it waves, and Claude is told so it says it in its own words. One that went off while the page was closed is mentioned gently next time. Claude sees what is set in the line at the top of each message. With the page in the background it shows a notification; with it closed, once they tap the bell, the Worker sends an empty Web Push at each time (a Durable Object per browser holds only the times, never the words, and signs with a VAPID key it made itself, so there is nothing to set up), and the service worker reads the words from the browser's own copy in IndexedDB |
| Shopping | `src/shop.js`, `server/shop.js` | "Find me some wireless headphones under £100": Reverie sends a shopping helper off (Claude Sonnet 5.5 with web search and web fetch, looking across UK shops, prices in pounds) and keeps chatting. About a minute later the offers come back as numbered cards along the bottom of the stage (cheapest and Reverie's pick marked), Reverie tells you the cheapest and its pick, and holds up a little 3D model of the thing. An offer whose link isn't on a site the helper really saw is dropped. Reverie can never buy or pay: "buy number 2" puts a confirm strip on screen, and only your tap opens that shop's page, where you check out yourself. The last search is kept in the browser ("show my shopping") |
| Games | `src/games/` | Games it plays with you on a table in front of it. Chess: the engine's living stone pieces, rules from chess.js and the engine's chess opponent picking its moves (fast, always legal, levels 1 to 5), while Claude reacts out loud to each move and a stretchy arm moves its pieces. Quiz: ten questions from the engine's bank of about 2,700 (`gs.trivia`, Open Trivia Database, CC BY-SA 4.0) on a card with four buzzers, starting easy and climbing; Reverie hosts, reading each question out and reacting to each answer, and is only told the answer once you've given yours. Noughts and crosses: the engine's game search (`gs.solve.Search`) picks its noughts, with slips at the lower levels and none at 5; tap a square or say it. Twenty Questions: the game picks the secret, counts your questions on twenty lamps and spots a right guess itself, so Reverie only has to answer; guess it and the mystery box opens and the thing is made in its hands. Draw and Guess: you draw a word against the clock on the drawing pad, and the doodle reader (`gs.doodle`) guesses live while Reverie calls its guesses out in its own voice, with no trip to Claude. Dice Quest: a path across the table past four challenges, each a little model from the generator, and real dice thrown from its hands; Reverie tells the story. Escape Room: a magic door appears and locks you both in; its code is on notes hidden round the room, under things you lift, in a chest that needs a key, in a colour box set from a painting, behind a row of lanterns to light all at once, and one note that asks how many candles there are. A new puzzle every round from three stories and five levels; tap the door, box or painting to go up close. The game writes every hint, so they are always true, and Reverie gives them in its own words when you ask, a little stronger each time. `src/games/index.js` says how to add another |

Everyday chat goes to Claude Haiku 5.5 with low effort, for speed. When a question needs real thought, it calls
`think_harder` and the rest of that turn goes to Claude Sonnet 5.5. Either can be changed with `REVERIE_QUICK_MODEL`
and `REVERIE_DEEP_MODEL`.

### Spotify

The page uses the Spotify app whose Client ID is in `src/spotify.js` (or `VITE_SPOTIFY_CLIENT_ID`). Its redirect URIs on
[developer.spotify.com](https://developer.spotify.com/dashboard) must include each address the page runs at, with a / on
the end: `https://reverie.robthewizz.workers.dev/` and `http://127.0.0.1:5173/`. Spotify doesn't accept "localhost", so
on the dev server the page moves itself to 127.0.0.1 to sign in. Spotify's rules: the app's owner needs Premium, and an
app in development mode allows five people (add them under the app's User Management).
`node tests/groove.mjs` tests the beat finder; `node tests/dance.mjs` (a drum loop as the microphone) and
`node tests/spotify.mjs` (a pretend Spotify) test the page against the scripted Claude.
### Helpers

The helpers need a helper agent and an environment for its sandbox on your Anthropic account (both defined in
`server/helper-agent.js`). The deploy workflow makes them the first time and updates them after that, so on GitHub
there's nothing to do. Locally, run `npm run helpers:sync` once (with the key in `.env.local`) and paste the two lines
it prints into `.env.local`. `REVERIE_FAKE=1` fakes the helpers too (`REVERIE_FAKE_HELPER_MS` sets how long one takes).
Watch a helper work in the Console: Managed Agents › Sessions. Helpers bill their tokens, web searches ($10 per 1,000)
and running time (about 8 cents an hour) on top of chat. `node tests/helpers-server.mjs` tests the backend and
`node tests/helpers.mjs` the page.

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

For Gmail and Google Calendar, add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` too (the GitHub secrets, or
`npx wrangler secret put` each, or `.env.local` for `npm run dev`). They come from a "Web application" OAuth client in
Google Cloud, with the Gmail and Calendar APIs turned on and `https://<your address>/api/google/callback` (and
`http://localhost:5173/api/google/callback`) as redirect URIs. Publish the app (Google Auth Platform › Audience):
left in Testing, Google signs it out every 7 days.

Only the Worker's own address may call the API from a browser. To host the page somewhere else, set `ALLOWED_ORIGIN` in
`worker/wrangler.toml` to that page's address and build it with `VITE_API_URL` set to the Worker's address.

## Test

```bash
REVERIE_FAKE=1 npm run dev -- --port 5179
npm run smoke                 # wakes it, makes, changes and throws a prop, asks a deep question; pictures in tests/out/
node tests/chess.mjs          # asks to play chess, taps a move, says a move, puts the board away
node tests/kits.mjs           # rolls dice, plays three quiz questions (tap, button, said), draws a house and has it made
node tests/clean.mjs          # every game set up and put away leaves nothing behind; put away or swapped while loading, a new round mid-move, Again and Done told to Reverie
node tests/memory.mjs --page  # the diary alone (kinds, plans, recall, recaps, the budget), then a second day: the overnight surprise, the briefing, a name kept, a chat recapped, the diary sheet
node tests/google.mjs         # Google sign-in, calendar and email on the server, against a pretend Google (no browser)
node tests/google-page.mjs    # the briefing with the calendar and inbox, a reply sent only by a real tap, the Connect card
node tests/room.mjs           # carries a lamp to the window, a teapot to the shelf, paints the room, reloads it
node tests/shop.mjs           # finds headphones (scripted helper), reads the cards and the news, buys number 2 through the confirm strip, brings the cards back after a reload
node tests/shop-server.mjs    # the shopping backend with a stand-in client: the request, which links it trusts, a paused search carried on
node tests/badges.mjs --page  # makes a teapot: a badge card, a trophy flies to the shelf, the badges tool, the diary, a reload
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
- **Shopping** has only run against a stand-in helper here (no key on the test machine). Each search costs a Sonnet call plus up to six web searches and eight page fetches (web search is $10 per 1,000 searches). Prices are whatever the shops' pages said at that moment.
- **AR mode** is not built yet. Chess is on the stage only, not on your floor.
