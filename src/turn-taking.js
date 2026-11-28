// Pure conversational turn-taking rules (no DOM / Three.js, testable in Node):
//   - Instant 1-2 word barge-in detection while Reverie is speaking
//   - Smart adaptive endpointing (snappy for short commands, patient on trailing hesitations)
//   - Pure hush detection ("stop", "shush", "quiet")

const BARGE_IN = /\b(stop|wait|hold on|hang on|hey reverie|reverie|actually|never\s*mind|shush|quiet|excuse me|pause|hush)\b/i;
const PURE_HUSH = /^\s*(hey\s+)?(reverie\s+)?(stop|stop talking|be quiet|quiet|shush|hush|never\s*mind|that'?s enough)\s*[.!?]*\s*$/i;
const TRAILING_HESITATION = /\b(and|but|or|so|because|like|um+|uh+|er+|erm+|well|if|when|that|which|to|of|for|with|in|on|at|from|a|an|the|my|your)$/i;
const SNAPPY_CMD = /^\s*(yes|yeah|yep|no|nope|ok|okay|sure|stop|wait|hit|stand|higher|lower|flip|hint|skip|next|pause|resume|throw it|clear|roll|roll a die|roll dice|undo|again|done|[a-f]\s*[1-6]|top left|top right|bottom left|bottom right|middle|centre|center)\s*[.!?]*\s*$/i;

/**
 * Should these interim/final words interrupt Reverie while it is speaking?
 * h: { words: string[], yours: string[] } from brain.yours(text)
 */
export function isBargeIn(rawText, h) {
  const t = String(rawText || '').trim();
  if (!t) return false;
  if (BARGE_IN.test(t)) return true;
  if (!h) return false;
  // 2+ words that are 100% new (not Reverie's own echo)
  if (h.words.length >= 2 && h.yours.length === h.words.length) return true;
  // 3+ new words making up at least half of what was heard
  return h.yours.length >= 3 && h.yours.length / Math.max(1, h.words.length) >= .5;
}

/** True when the user just asked Reverie to stop talking (no need to send a new LLM turn). */
export function isPureHush(rawText) {
  return PURE_HUSH.test(String(rawText || ''));
}

/**
 * Adaptive settle delay (ms) before taking an interim transcript as complete:
 *   - 320 ms for snappy, complete short commands
 *   - 1100 ms when ending on a conjunction / filler / preposition (mid-thought)
 *   - 580 ms default
 */
export function settleDelay(rawText) {
  const t = String(rawText || '').trim();
  if (!t) return 580;
  if (SNAPPY_CMD.test(t)) return 320;
  if (TRAILING_HESITATION.test(t)) return 1100;
  const wordCount = t.split(/\s+/).length;
  if (wordCount <= 2) return 420;
  return 580;
}
