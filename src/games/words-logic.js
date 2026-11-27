// Pure word game logic for 5-letter Word Guesser (Wordle-style) and Balloon Hangman (no Three.js).
import { compare } from '../../engine/src/kit/words.js';

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Normalises a requested word game mode. */
export function wordModeOf(raw) {
  return /hang|balloon|letter/.test(norm(raw || '')) ? 'hangman' : 'wordle';
}

/**
 * Pure word game logic (no Three.js), testable in Node.
 * mode: 'wordle' | 'hangman'
 */
export function makeWordGame({ mode = 'wordle', answer, dict = null, maxGuesses = 6 } = {}) {
  mode = wordModeOf(mode);
  answer = String(answer || (mode === 'wordle' ? 'magic' : 'dragon')).toLowerCase().replace(/[^a-z]/g, '');
  let state = 'play', result = '', guesses = [], marks = [], letters = new Set(), wrong = [], hints = 0;
  const maxWrong = 6;

  function guessWord(raw) {
    if (state !== 'play') return { ok: false, text: 'The round is already over.' };
    const w = String(raw || '').toLowerCase().replace(/[^a-z]/g, '');
    if (mode === 'wordle') {
      if (w.length !== answer.length) return { ok: false, text: `Guess a ${answer.length}-letter word (got "${w || raw}").` };
      if (dict && !dict.has(w)) return { ok: false, text: `"${w.toUpperCase()}" isn't in the dictionary — try another word.` };
      const m = compare(w, answer);
      guesses.push(w); marks.push(m);
      if (w === answer) {
        state = 'over'; result = 'win';
        return { ok: true, over: true, result, word: w, mark: m, text: `${w.toUpperCase()} — spot on! Solved in ${guesses.length} ${guesses.length === 1 ? 'guess' : 'guesses'}!` };
      }
      if (guesses.length >= maxGuesses) {
        state = 'over'; result = 'lose';
        return { ok: true, over: true, result, word: w, mark: m, text: `${w.toUpperCase()} wasn't it — out of guesses! The word was ${answer.toUpperCase()}.` };
      }
      const hits = m.filter(x => x === 'hit').length, nears = m.filter(x => x === 'near').length;
      return { ok: true, over: false, word: w, mark: m, text: `Guessed ${w.toUpperCase()}: ${hits} right place, ${nears} in the word elsewhere (${maxGuesses - guesses.length} left).` };
    }
    if (!w) return { ok: false, text: 'Say a letter or try guessing the whole word.' };
    if (w.length > 1) {
      if (w === answer) {
        for (const ch of answer) letters.add(ch);
        state = 'over'; result = 'win';
        return { ok: true, over: true, result, text: `${w.toUpperCase()} — you got the whole word!` };
      }
      wrong.push(w);
      if (wrong.length >= maxWrong) { state = 'over'; result = 'lose'; return { ok: true, over: true, result, text: `Not "${w.toUpperCase()}" — all balloons popped! The word was ${answer.toUpperCase()}.` }; }
      return { ok: true, over: false, text: `Not "${w.toUpperCase()}"! ${maxWrong - wrong.length} balloons left.` };
    }
    const ch = w[0];
    if (letters.has(ch) || wrong.includes(ch)) return { ok: false, text: `You already tried ${ch.toUpperCase()}.` };
    if (answer.includes(ch)) {
      letters.add(ch);
      const solved = [...answer].every(c => letters.has(c));
      if (solved) { state = 'over'; result = 'win'; return { ok: true, over: true, result, letter: ch, text: `Yes, ${ch.toUpperCase()} is in it — you solved ${answer.toUpperCase()}!` }; }
      return { ok: true, over: false, letter: ch, text: `Yes! ${ch.toUpperCase()} is in the word: ${masked()}.` };
    }
    wrong.push(ch);
    if (wrong.length >= maxWrong) { state = 'over'; result = 'lose'; return { ok: true, over: true, result, letter: ch, text: `No ${ch.toUpperCase()} — last balloon popped! The word was ${answer.toUpperCase()}.` }; }
    return { ok: true, over: false, letter: ch, text: `No ${ch.toUpperCase()}! ${maxWrong - wrong.length} balloons left.` };
  }

  function hint() {
    if (state !== 'play') return 'The round is already over.';
    hints++;
    if (mode === 'hangman') {
      const missing = [...new Set(answer)].filter(c => !letters.has(c));
      if (!missing.length) return 'You already have all the letters!';
      return `Hint: try the letter ${missing[0].toUpperCase()}.`;
    }
    const green = new Set();
    for (let r = 0; r < marks.length; r++) for (let i = 0; i < marks[r].length; i++) if (marks[r][i] === 'hit') green.add(i);
    for (let i = 0; i < answer.length; i++) if (!green.has(i)) return `Hint: letter ${i + 1} is ${answer[i].toUpperCase()}.`;
    return `You have all the letters in place!`;
  }

  function masked() { return [...answer].map(c => letters.has(c) ? c.toUpperCase() : '_').join(' '); }

  function keyboardStatus() {
    const out = {};
    if (mode === 'wordle') {
      const rank = { miss: 1, near: 2, hit: 3 };
      for (let r = 0; r < guesses.length; r++) for (let i = 0; i < guesses[r].length; i++) {
        const ch = guesses[r][i], m = marks[r][i];
        if (!out[ch] || rank[m] > rank[out[ch]]) out[ch] = m;
      }
    } else {
      for (const ch of letters) out[ch] = 'hit';
      for (const w of wrong) if (w.length === 1) out[w] = 'miss';
    }
    return out;
  }

  function summary() {
    if (mode === 'wordle') {
      const rows = guesses.map((w, i) => `${w.toUpperCase()}(${marks[i].map(m => m[0].toUpperCase()).join('')})`).join(', ');
      return `Wordle (${answer.length} letters, secret "${answer}" — NEVER say or spell the secret!): ${guesses.length}/${maxGuesses} guesses${rows ? ': ' + rows : ''}.${state === 'over' ? ` Round over: ${result}.` : ''}`;
    }
    return `Hangman (secret "${answer}" — NEVER say or spell the secret!): ${masked()}, wrong: ${wrong.join(',').toUpperCase() || 'none'} (${maxWrong - wrong.length} balloons left).${state === 'over' ? ` Round over: ${result}.` : ''}`;
  }

  return {
    mode, answer, maxGuesses, maxWrong,
    get state() { return state; },
    get result() { return result; },
    get guesses() { return guesses; },
    get marks() { return marks; },
    get letters() { return letters; },
    get wrong() { return wrong; },
    guess: guessWord, hint, masked, keyboardStatus, summary,
  };
}
