// A scripted Claude for tests and for trying the page with no key (REVERIE_FAKE=1 npm run dev). It answers in the
// same event stream shape as the real API, a little slowly, so the page's streaming, speech and tools all run.
//   "make a <thing>"  -> says a line and calls make
//   "make it <x>"     -> says a line and calls change
//   "throw it"        -> toss;  "clear"  -> clear;  "think ..." -> think_harder, then a deep answer
//   "play chess"      -> play;  "[chess] ..." (news from the board) -> a quip;  "move e4" -> game_move;  "stop playing" -> stop_game
//   anything else     -> a friendly line with a wave
const wait = ms => new Promise(r => setTimeout(r, ms));
const lastUser = messages => [...messages].reverse().find(m => m.role === 'user');
const textOf = m => typeof m.content === 'string' ? m.content : (m.content.find(b => b.type === 'text')?.text ?? '');
// (without the device's line at the top: where and when they are)
const saidOf = m => textOf(m).replace(/^\[From the device[^\]]*\]\n/, '').replace(/ \(You were interrupted[^)]*\)$/, '');

function plan(body) {
  const u = lastUser(body.messages);
  const results = Array.isArray(u.content) ? u.content.filter(b => b.type === 'tool_result') : [];
  if (results.length) {
    const r = String(results[0].content ?? '');
    if (/^weather in|location is not shared|did not answer/i.test(r)) return { text: 'Looks like a cosy day for staying in with me.', tools: [] };
    if (/^your voice is now/i.test(r)) return { text: 'How do I sound now?', tools: [] };
    if (/^your body is now/i.test(r)) return { text: 'Do you like it?', tools: [] };
    if (/chess board is set up/i.test(r)) return { text: 'Your move. No pressure.', tools: [] };
    if (/^Played /.test(r)) return { text: 'Bold.', tools: [] };
    if (/handed over/i.test(r)) return { text: 'Right, I have thought about it properly. The answer is forty two, give or take.', tools: [] };
    return { text: /fail|could not|nothing/i.test(r) ? 'Hmm, that one fizzled.' : 'Ta-da!', tools: [] };
  }
  const said = saidOf(u).replace(/^\[chess,[^\]]*\]\s*/, '').toLowerCase();
  if (/^\[chess\]/.test(said)) return { text: /taking your/.test(said) ? 'Hey! I needed that.' : /checkmate/.test(said) ? 'Good game!' : 'Hmm, interesting.', tools: [] };
  if (/board was set up straight away/.test(said)) return { text: 'Oh, you are on!', tools: [] };
  if (/play chess|game of chess/.test(said)) return { text: 'Oh, you are on!', tools: [['play', { game: 'chess', level: 1 }]] };
  if (/stop playing|put it away/.test(said)) return { text: 'Fine, fine.', tools: [['stop_game', {}]] };
  let m;
  if ((m = /^move (\S+)/.exec(said))) return { text: 'Ooh.', tools: [['game_move', { move: m[1] }]] };
  if ((m = /make it (.+)/.exec(said))) return { text: 'Watch this.', tools: [['change', { words: m[1] }]] };
  if ((m = /make (?:me )?(an? .+|some .+)/.exec(said))) return { text: 'Ooh, one coming right up!', tools: [['act', { gesture: 'tada', mood: 'excited' }], ['make', { words: m[1] }]] };
  if (/pirate/.test(said)) return { text: 'Arr, give me a moment.', tools: [['voice', { name: 'captain_silas_blackwater' }]] };
  if (/normal voice/.test(said)) return { text: 'Back to me.', tools: [['voice', { reset: true }]] };
  if (/purple|colou?r/.test(said)) return { text: 'Ooh, a new look.', tools: [['colours', { body: '#c8b4ee', glow: '#30a0ff' }]] };
  if (/throw|toss/.test(said)) return { text: 'Catch!', tools: [['toss', {}]] };
  if (/weather|rain|sunny/.test(said)) return { text: 'Let me peek outside.', tools: [['weather', {}]] };
  if (/clear|tidy/.test(said)) return { text: 'Poof, all gone.', tools: [['clear', {}]] };
  if (/think|why|how does/.test(said)) return { text: 'Ooh, let me think about that one.', tools: [['think_harder', {}]] };
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
