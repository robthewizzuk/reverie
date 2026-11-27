// A scripted Claude for tests and for trying the page with no key (REVERIE_FAKE=1 npm run dev). It answers in the
// same event stream shape as the real API, a little slowly, so the page's streaming, speech and tools all run.
//   "make a <thing>"  -> says a line and calls make
//   "make it <x>"     -> says a line and calls change
//   "throw it"        -> toss;  "clear"  -> clear;  "think ..." -> think_harder, then a deep answer
//   "show me a sunset [with rain]" / "make it snow|rain|storm|night" / "the real sky" -> window
//   "make <x> and put it <spot>" / "put it <spot>" / "move the <x> <spot>" -> place;  "paint the walls <c>" -> room_colours
//   "play chess"      -> play;  "[chess] ..." (news from the board) -> a quip;  "move e4" -> game_move;  "stop playing" -> stop_game
//   "show me something" / "show find a cup" -> show;  "[show] ..." -> a quip (a copy: place on the shelf)
//   "roll ..."        -> roll;  "quiz me" -> play quiz;  "[quiz] ..." -> a quip;  "answer b" -> game_move;  "draw" -> doodle;  "[doodle] ..." -> a quip
//   "square <x>"      -> game_move (noughts);  "[noughts|twenty|draw and guess] ..." -> a quip;  a counted question -> "Nope!"
//   "make me a pet fox called pip" -> pet make;  "pet sit" -> pet trick;  "[pet] ..." / "[mood] ..." -> a quip
//   "tell me a joke" -> a line with sound cues;  "a ghost in a cave" / "helium" -> voice with an effect, echo, pitch and speed
//   anything else     -> a friendly line with a wave
const wait = ms => new Promise(r => setTimeout(r, ms));
const lastUser = messages => [...messages].reverse().find(m => m.role === 'user');
const textOf = m => typeof m.content === 'string' ? m.content : (m.content.find(b => b.type === 'text')?.text ?? '');
// (without the device's line at the top: where and when they are)
const saidOf = m => textOf(m).replace(/^\[(Your diary|From the device)[^\]]*\]\n/gm, '').replace(/ \(You were interrupted[^)]*\)$/, '');

function plan(body) {
  const u = lastUser(body.messages);
  const results = Array.isArray(u.content) ? u.content.filter(b => b.type === 'tool_result') : [];
  if (results.length) {
    const r = String(results[0].content ?? '');
    if (/^weather in|location is not shared|did not answer/i.test(r)) return { text: 'Looks like a cosy day for staying in with me.', tools: [] };
    if (/^your voice is now/i.test(r)) return { text: 'How do I sound now?', tools: [] };
    if (/^your body is now/i.test(r)) return { text: 'Do you like it?', tools: [] };
    if (/^(Carried|Fetched|Took)/.test(r)) return { text: 'There we go.', tools: [] };
    if (/^The room's/.test(r)) return { text: 'So cosy!', tools: [] };
    if (/chess board is set up/i.test(r)) return { text: 'Your move. No pressure.', tools: [] };
    if (/quiz table is set up/i.test(r)) return { text: 'First question, here we go!', tools: [] };
    if (/^Threw |^Rolled /.test(r)) return { text: 'There we go!', tools: [] };
    if (/camera window is open/i.test(r)) return { text: 'Go on, show me something!', tools: [] };
    if (/drawing pad is open/i.test(r)) return { text: 'Go on, draw me something!', tools: [] };
    if (/^Made .*as your pet|does |is now called|gone off/.test(r)) return { text: 'Aww, look at it!', tools: [] };
    if (/^Written in your diary/.test(r)) return { text: 'Got it, I will remember that.', tools: [] };
    if (/^Forgot /.test(r)) return { text: 'Poof, forgotten.', tools: [] };
    if (/^\[Their daily briefing/.test(r)) return { text: 'Here is your briefing: it is a lovely day for making things.', tools: [] };
    if (/diary is open/i.test(r)) return { text: 'There it is, my diary.', tools: [] };
    if (/^Answered /.test(r)) return { text: 'Ooh.', tools: [] };
    if (/noughts and crosses board is set up/i.test(r)) return { text: 'Crosses, your move.', tools: [] };
    if (/Twenty Questions is set up/.test(r)) return { text: "I'm thinking of something. Twenty questions, go!", tools: [] };
    if (/Draw and Guess is on/.test(r)) return { text: 'Draw, draw, draw!', tools: [] };
    if (/Dice Quest is set up/.test(r)) return { text: 'Once upon a time, a brave little hero set off. Roll!', tools: [] };
    if (/^Put their cross/.test(r)) return { text: 'Hmm.', tools: [] };
    if (/^(They got it|You showed them)/.test(r)) return { text: 'Ta-da!', tools: [] };
    if (/^Played /.test(r)) return { text: 'Bold.', tools: [] };
    if (/handed over/i.test(r)) return { text: 'Right, I have thought about it properly. The answer is forty two, give or take.', tools: [] };
    return { text: /fail|could not|nothing/i.test(r) ? 'Hmm, that one fizzled.' : 'Ta-da!', tools: [] };
  }
  let m0;
  const said = saidOf(u).replace(/^\[[a-z ]+[,:][^\]]*\]\s*/, '').toLowerCase().replace(/^(\[(pet|mood|game)\][^\n]*\n+)+(?=\S)/, '');
  if (/^\[(noughts|twenty|draw and guess|quest)\]/.test(said)) return { text: /they won/.test(said) ? 'No fair!' : /you won/.test(said) ? 'Three in a row!' : /round is over/.test(said) ? 'What a round of drawings!' : /treasure chest with/.test(said) ? 'And they lived happily ever after!' : /last heart/.test(said) ? 'And the owl flew them home.' : 'Hmm, interesting.', tools: [] };
  if (/\(they guessed it|\(they gave up/.test(said)) return { text: 'Ta-da, there it is!', tools: [] };
  if (/\(question \d+ of 20/.test(said)) return { text: 'Nope!', tools: [] };
  if (/\(the die is being thrown/.test(said)) return { text: 'Here it goes...', tools: [] };
  if (/^\[chess\]/.test(said)) return { text: /taking your/.test(said) ? 'Hey! I needed that.' : /checkmate/.test(said) ? 'Good game!' : 'Hmm, interesting.', tools: [] };
  if (/^\[quiz\]/.test(said)) return { text: /: right!/.test(said) ? 'Correct, you clever thing!' : /last question/.test(said) ? 'What a round!' : 'Ooh, so close.', tools: [] };
  if (/^\[show\]/.test(said)) return /want a 3d copy/.test(said) ? { text: 'Ooh, one for the shelf!', tools: [['place', { item: 'a yellow rubber duck', spot: 'on the shelf' }]] }
    : { text: /surprise hatched/.test(said) ? 'A surprise, from a barcode!' : /photo is attached/.test(said) ? 'Ooh, what a lovely thing.' : 'Ha!', tools: [] };
  const sm = /^(?:show|look)(?: at)?(?: me)?(?: something)?(?: find (?:me )?(.+))?$/.exec(said);
  if (sm) return { text: 'Show me!', tools: [['show', sm[1] ? { find: sm[1] } : {}]] };
  if (/^\[doodle\]/.test(said)) return { text: 'What a lovely drawing!', tools: [] };
  if (/^\[a new day/.test(said)) return { text: /in your hands now/.test(said) ? 'Good morning! I made you something overnight. Here is your briefing, and a puzzle.' : 'Good morning! Here is your briefing.', tools: [] };
  if ((m0 = /my name is (\w+)/.exec(said))) return { text: `Lovely to meet you, ${m0[1]}!`, tools: [['remember', { name: m0[1][0].toUpperCase() + m0[1].slice(1) }]] };
  if ((m0 = /^remember (?:that )?i (.+)/.exec(said))) return { text: 'Ooh, noted.', tools: [['remember', { fact: m0[1] }]] };
  if ((m0 = /^forget (?:about )?(.+)/.exec(said))) return { text: 'Okay.', tools: [['forget', { what: m0[1].replace(/^(that|my|the) /, s => s === 'my ' ? 'my ' : '') }]] };
  if (/briefing/.test(said)) return { text: 'Ooh, briefing time.', tools: [['briefing', {}]] };
  if (/diary/.test(said)) return { text: 'Here you go.', tools: [['diary', {}]] };
  if (/was set up straight away/.test(said)) return { text: 'Oh, you are on!', tools: [] };
  if (/play chess|game of chess/.test(said)) return { text: 'Oh, you are on!', tools: [['play', { game: 'chess', level: 1 }]] };
  if (/stop playing|put it away/.test(said)) return { text: 'Fine, fine.', tools: [['stop_game', {}]] };
  let m;
  if ((m = /^answer (.+)/.exec(said))) return { text: 'Locking it in.', tools: [['game_move', { move: m[1] }]] };
  if ((m = /^square (.+)/.exec(said))) return { text: 'Brave.', tools: [['game_move', { move: m[1] }]] };
  if (/^i give up/.test(said)) return { text: 'Ha!', tools: [['game_move', { move: 'give up' }]] };
  if ((m = /^roll (.+)/.exec(said))) return { text: 'Rolling!', tools: [['roll', { dice: m[1].replace(/^(a|the) /, '') }]] };
  if (/^draw/.test(said)) return { text: 'Ooh, a drawing!', tools: [['doodle', {}]] };
  if ((m = /^move (?!the )(\S+)/.exec(said))) return { text: 'Ooh.', tools: [['game_move', { move: m[1] }]] };
  if ((m = /(?:get|make) (?:me )?an? (?:pet )?(\w+)(?: called (\w+))?/.exec(said)) && /pet|called/.test(said)) return { text: 'A pet! Hold on.', tools: [['pet', { action: 'make', animal: m[1], ...(m[2] ? { name: m[2] } : {}) }]] };
  if ((m = /^pet (sit|jump|spin|come|sleep|play_dead|zoomies|dance)/.exec(said))) return { text: 'Watch this.', tools: [['pet', { action: 'trick', trick: m[1] }]] };
  const SPOT = /(by the window|on the windowsill|on the workbench|on the shelf|on the rug|left of you|right of you|in front of you|back left corner|by the barrel|front left|front right|your hands|away)/;
  if ((m = /make (?:me )?(an? .+?) and put it (.+)/.exec(said))) return { text: 'Coming right up, and I know just where.', tools: [['place', { item: m[1], spot: SPOT.exec(m[2])?.[1] || m[2] }]] };
  if ((m = /^put it (.+)/.exec(said))) return { text: 'Hup, over we go.', tools: [['place', { item: 'it', spot: SPOT.exec(m[1])?.[1] || m[1] }]] };
  if ((m = /^(?:move|bring) the (\w+) (.+)/.exec(said))) return { text: 'On it.', tools: [['place', { item: m[1], spot: /back|me/.test(m[2]) ? 'your hands' : SPOT.exec(m[2])?.[1] || m[2] }]] };
  if ((m = /^paint the (walls|floor|rug|wood) (.+)/.exec(said))) return { text: 'Ooh, redecorating.', tools: [['room_colours', { [m[1]]: m[2] }]] };
  if ((m = /^show me (?:a |an |the )?(sunset|sunrise|night|midnight|dawn|dusk|noon|morning|evening|golden hour)(?: with (\w+))?/.exec(said))) return { text: 'Ooh, watch the window.', tools: [['window', { time: m[1], ...(m[2] ? { weather: m[2] } : {}) }]] };
  if ((m = /^make it (snow|rain|storm|foggy|cloudy|night)\b/.exec(said))) return { text: 'Ooh, watch the window.', tools: [['window', m[1] === 'night' ? { time: 'night' } : { weather: { foggy: 'fog' }[m[1]] || m[1] }]] };
  if (/real sky/.test(said)) return { text: 'Back to the real sky.', tools: [['window', { time: 'live', weather: 'live' }]] };
  if ((m = /make it (.+)/.exec(said))) return { text: 'Watch this.', tools: [['change', { words: m[1] }]] };
  if ((m = /make (?:me )?(an? .+|some .+)/.exec(said))) return { text: 'Ooh, one coming right up!', tools: [['act', { gesture: 'tada', mood: 'excited' }], ['make', { words: m[1] }]] };
  if (/joke/.test(said)) return { text: 'Why did the cookie go to the doctor? It felt crumby. [rimshot] And the winner of worst joke is [drumroll] me! [Tada]', tools: [] };
  if (/ghost in a cave/.test(said)) return { text: 'Ooooh, spooky.', tools: [['voice', { effect: 'ghost', echo: 'cave' }]] };
  if (/helium/.test(said)) return { text: 'Breathe in!', tools: [['voice', { pitch: 1.5, speed: 1.1, effect: 'walkie talkie' }]] };
  if (/pirate/.test(said)) return { text: 'Arr, give me a moment.', tools: [['voice', { name: 'captain_silas_blackwater' }]] };
  if (/normal voice/.test(said)) return { text: 'Back to me.', tools: [['voice', { reset: true }]] };
  if (/purple|colou?r/.test(said)) return { text: 'Ooh, a new look.', tools: [['colours', { body: '#c8b4ee', glow: '#30a0ff' }]] };
  if (/throw|toss/.test(said)) return { text: 'Catch!', tools: [['toss', {}]] };
  if (/weather|rain|sunny/.test(said)) return { text: 'Let me peek outside.', tools: [['weather', {}]] };
  if (/clear|tidy/.test(said)) return { text: 'Poof, all gone.', tools: [['clear', {}]] };
  if (/think|why|how does/.test(said)) return { text: 'Ooh, let me think about that one.', tools: [['think_harder', {}]] };
  if (/^\[(pet|mood|game)\]/.test(said)) return { text: 'Aww.', tools: [] };
  return { text: 'Hello! I am a little test version of me. Ask me to make you something.', tools: [['act', { gesture: 'wave', mood: 'happy' }]] };
}

export async function fakeTurn(request) {
  const body = await request.json();
  const p = plan(body), enc = new TextEncoder();
  const content = [];
  const stream = new ReadableStream({
    async start(ctl) {
      const send = o => ctl.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      send({ type: 'message_start', message: { id: 'msg_fake', type: 'message', role: 'assistant', model: body.tier === 'deep' ? 'fake-deep' : 'fake-quick', content: [], stop_reason: null } });
      await wait(250);
      let i = 0;
      send({ type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } });
      for (const word of p.text.split(/(?<= )/)) { send({ type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: word } }); await wait(40); }
      send({ type: 'content_block_stop', index: i }); content.push({ type: 'text', text: p.text });
      for (const [name, input] of p.tools) {
        i++; const id = 'toolu_fake_' + Math.random().toString(36).slice(2, 10);
        send({ type: 'content_block_start', index: i, content_block: { type: 'tool_use', id, name, input: {} } });
        send({ type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } });
        send({ type: 'content_block_stop', index: i }); content.push({ type: 'tool_use', id, name, input });
      }
      const stop = p.tools.length ? 'tool_use' : 'end_turn';
      send({ type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 20 } });
      send({ type: 'message_stop' });
      send({ type: 'final', message: { id: 'msg_fake', type: 'message', role: 'assistant', content, stop_reason: stop }, ms: 400 });
      ctl.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
}
