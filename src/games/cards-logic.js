// Pure card game logic for Blackjack (Pontoon), Higher or Lower, and 3-card Fortune Teller (no Three.js).
import { Deck, total } from '../../engine/src/kit/cards.js';

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Whimsical Reverie tarot deck for Fortune Teller mode. */
export const TAROT_DECK = [
  { id: 'teapot', name: 'The Grumpy Teapot', icon: '🫖', col: '#d46a4c', upright: 'a warm surprise is brewing', reversed: 'let things cool off before pouring' },
  { id: 'fox', name: 'The Dancing Fox', icon: '🦊', col: '#e88b3a', upright: 'clever footwork wins the day', reversed: 'a cheeky detour brings luck' },
  { id: 'moon', name: 'The Upside-Down Moon', icon: '🌙', col: '#6d78d6', upright: 'a strange dream holds a clue', reversed: 'night-owl energy strikes early' },
  { id: 'dragon', name: 'The Golden Dragon', icon: '🐉', col: '#d9a426', upright: 'bold magic is on your side', reversed: 'guard your favourite treasure' },
  { id: 'cloud', name: 'The Sleepy Cloud', icon: '☁️', col: '#79a8d8', upright: 'a cosy pause will recharge you', reversed: 'sudden inspiration out of the blue' },
  { id: 'compass', name: 'The Brass Compass', icon: '🧭', col: '#b88d44', upright: 'trust the path that feels curious', reversed: 'wandering off-map finds the best bit' },
  { id: 'owl', name: 'The Clockwork Owl', icon: '🦉', col: '#8d6c53', upright: 'a wise answer arrives right on time', reversed: 'you already know more than you think' },
  { id: 'mushroom', name: 'The Bouncing Toadstool', icon: '🍄', col: '#d95454', upright: 'small joys are about to sprout', reversed: 'watch your step around silly traps' },
  { id: 'lantern', name: 'The Starlight Lantern', icon: '🏮', col: '#e39d3b', upright: 'a friendly light guides your evening', reversed: 'shine your own beam first' },
  { id: 'crown', name: 'The Tin Crown', icon: '👑', col: '#cfa636', upright: 'you are the ruler of today', reversed: 'share the throne and double the fun' },
  { id: 'rocket', name: 'The Paper Rocket', icon: '🚀', col: '#4a9cd4', upright: 'a wild idea is ready for lift-off', reversed: 'tighten one bolt before launch' },
  { id: 'cat', name: 'The Velvet Cat', icon: '🐱', col: '#9267b5', upright: 'good fortune lands on its feet', reversed: 'knock something over just to see' },
  { id: 'key', name: 'The Singing Key', icon: '🔑', col: '#c7a048', upright: 'a locked door is about to click open', reversed: 'the secret is hiding in plain sight' },
  { id: 'cake', name: 'The Tall Cupcake', icon: '🧁', col: '#de6f96', upright: 'a sweet treat is well deserved', reversed: 'save room for the best bit' },
  { id: 'wave', name: 'The Glass Wave', icon: '🌊', col: '#3e9eb5', upright: 'ride the momentum without overthinking', reversed: 'calm waters return by sunset' },
  { id: 'star', name: 'The Pocket Star', icon: '⭐', col: '#e5b832', upright: 'a small wish is listening closely', reversed: 'make a wish nobody expects' },
];

const SPOTS = ['Past', 'Present', 'Future'];
const cardLabel = c => c.tarot ? `${c.name}${c.reversed ? ' (reversed)' : ''}` : c.name;

/** Normalises a requested card mode name. */
export function modeOf(raw) {
  const s = norm(raw || '');
  if (/fortune|tarot|future|mystic|read/.test(s)) return 'fortune';
  if (/high|low|hi lo|hilo|streak/.test(s)) return 'higher_lower';
  return 'blackjack';
}

/**
 * Pure card game state (no Three.js), testable in Node.
 * mode: 'blackjack' | 'higher_lower' | 'fortune'
 */
export function makeCardGame(mode = 'blackjack', { seed = null, level = 2 } = {}) {
  mode = modeOf(mode);
  const deck = new Deck({ seed }).shuffle();
  let state = 'play', result = '', player = [], dealer = [], dealerHidden = true;
  let current = null, history = [], streak = 0, target = Math.min(7, 3 + Math.max(1, Math.min(5, level | 0)));
  let fortune = [], revealed = 0;

  if (mode === 'blackjack') {
    player = deck.draw(2);
    dealer = deck.draw(2);
    const pt = total(player);
    if (pt.total === 21) {
      dealerHidden = false;
      const dt = total(dealer);
      state = 'over';
      result = dt.total === 21 ? 'draw' : 'win';
    }
  } else if (mode === 'higher_lower') {
    current = deck.top();
    history = [current];
  } else {
    const R = deck.R;
    const pool = TAROT_DECK.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = (R() * (i + 1)) | 0; [pool[i], pool[j]] = [pool[j], pool[i]]; }
    fortune = pool.slice(0, 3).map((t, i) => ({ ...t, tarot: true, spot: SPOTS[i], reversed: R() < .32, revealed: false }));
  }

  const cardVal = c => c.rank === 1 ? 14 : c.rank;

  function hit() {
    if (mode !== 'blackjack' || state !== 'play') return { ok: false, text: 'Not in a Blackjack hand.' };
    const c = deck.top(); player.push(c);
    const pt = total(player);
    if (pt.bust) { dealerHidden = false; state = 'over'; result = 'lose'; return { ok: true, card: c, over: true, result, text: `Drew ${c.name} (total ${pt.total}, bust!).` }; }
    if (pt.total === 21) return stand();
    return { ok: true, card: c, over: false, text: `Drew ${c.name} (total ${pt.total}).` };
  }

  function stand() {
    if (mode !== 'blackjack' || state !== 'play') return { ok: false, text: 'Not in a Blackjack hand.' };
    dealerHidden = false;
    const stopAt = level <= 1 ? 16 : 17;
    const hitSoft17 = level >= 4;
    while (true) {
      const dt = total(dealer);
      if (dt.total < stopAt || (hitSoft17 && dt.total === 17 && dt.soft)) dealer.push(deck.top());
      else break;
    }
    const pt = total(player), dt = total(dealer);
    state = 'over';
    result = dt.bust || pt.total > dt.total ? 'win' : pt.total < dt.total ? 'lose' : 'draw';
    return { ok: true, over: true, result, text: `You stood on ${pt.total}. Reverie has ${dealer.map(c => c.name).join(' ')} (${dt.bust ? 'bust with ' + dt.total : dt.total}). ${result === 'win' ? 'You win!' : result === 'lose' ? 'Reverie wins!' : 'A draw!'}` };
  }

  function guess(dir) {
    if (mode !== 'higher_lower' || state !== 'play') return { ok: false, text: 'Not in a Higher or Lower round.' };
    const next = deck.top();
    const prev = current;
    current = next; history.push(next);
    const diff = cardVal(next) - cardVal(prev);
    const right = diff === 0 || (dir === 'higher' ? diff > 0 : diff < 0);
    if (right) {
      streak++;
      if (streak >= target) { state = 'over'; result = 'win'; return { ok: true, card: next, over: true, result, text: `Next card is ${next.name}! ${streak} in a row — you win!` }; }
      return { ok: true, card: next, over: false, text: `Next card is ${next.name}${diff === 0 ? ' (same rank, counts!)' : ''}! Streak ${streak}/${target}.` };
    }
    state = 'over'; result = 'lose';
    return { ok: true, card: next, over: true, result, text: `Next card is ${next.name} — wrong guess! Streak ended at ${streak}.` };
  }

  function flip(index = null) {
    if (mode !== 'fortune') return { ok: false, text: 'Not in Fortune Teller mode.' };
    const i = index != null ? index : fortune.findIndex(c => !c.revealed);
    if (i < 0 || i >= fortune.length) return { ok: false, text: 'All three fortune cards are already revealed.' };
    if (fortune[i].revealed) return { ok: false, text: `${fortune[i].spot} (${fortune[i].name}) is already revealed.` };
    fortune[i].revealed = true; revealed++;
    if (revealed >= fortune.length) { state = 'over'; result = 'done'; }
    const f = fortune[i], meaning = f.reversed ? f.reversed : f.upright;
    return { ok: true, index: i, card: f, over: state === 'over', text: `${f.spot}: ${f.name}${f.reversed ? ' (reversed)' : ''} — ${meaning}.` };
  }

  function summary() {
    if (mode === 'blackjack') {
      const pt = total(player), dt = dealerHidden ? `${dealer[0].name} and a hidden card` : `${dealer.map(c => c.name).join(' ')} (${total(dealer).total})`;
      return `Blackjack: their hand ${player.map(c => c.name).join(' ')} (${pt.total}), your hand ${dt}.${state === 'over' ? ` Round over: ${result}.` : ' Their turn (hit or stand).'}`;
    }
    if (mode === 'higher_lower') {
      return `Higher or Lower: showing ${current.name}, streak ${streak}/${target}.${state === 'over' ? ` Round over: ${result}.` : ' Ask higher or lower.'}`;
    }
    const shown = fortune.map(f => f.revealed ? `${f.spot}: ${cardLabel(f)} (${f.reversed ? f.reversed : f.upright})` : `${f.spot}: face-down`).join('; ');
    return `Fortune Teller (3-card spread): ${shown}.`;
  }

  return {
    mode, level,
    get state() { return state; },
    get result() { return result; },
    get player() { return player; },
    get dealer() { return dealer; },
    get dealerHidden() { return dealerHidden; },
    get current() { return current; },
    get history() { return history; },
    get streak() { return streak; },
    get target() { return target; },
    get fortune() { return fortune; },
    get revealed() { return revealed; },
    hit, stand, guess, flip, summary,
  };
}
