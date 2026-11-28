// Reverie's Multi-Brain Suite: 4 specialized on-device Tiny Brains (engine/src/kit/brains.js) working together
// with zero cloud latency and full localStorage persistence:
//   1. idleBrain (Brain neural net) + idleCoach (Coach): 8-input body-language brain that learns your ambient vibe
//      gradually via feel() and instantly via poke-to-teach Coach corrections.
//   2. reactBrain (Coach): 6-input instant micro-reaction brain picking lively gestures before Claude even responds.
//   3. skillDial (Dial): adaptive difficulty dial steering turn-based games (like Battleships) toward ~60% win rate.
//   4. activityBrain (Predict): learns your interaction rhythm (chat, make, game, music, focus, room, garden) so
//      Reverie anticipates what you enjoy next.
import { Brain, Coach, Dial, Predict } from '../engine/src/kit/brains.js';

export const IDLE_ACTIONS = ['rest', 'glance', 'peek', 'sway', 'hop', 'stretch'];
export const REACT_ACTIONS = ['wave', 'bounce', 'nod', 'think', 'tada', 'shrug'];
export const ACTIVITIES = ['chat', 'make', 'game', 'music', 'focus', 'room', 'garden'];

const memBrains = () => {
  const m = new Map();
  return { brains: { load: k => m.get(k) ?? null, save: (k, v) => m.set(k, v) } };
};

export function localBrainStore() {
  if (typeof localStorage === 'undefined') return memBrains();
  return {
    brains: {
      load: name => { try { return localStorage.getItem('reverie.brain.' + name); } catch { return null; } },
      save: (name, text) => { try { localStorage.setItem('reverie.brain.' + name, text); } catch { /* private */ } },
    },
  };
}

export function makeTinyBrains({ store = localBrainStore() } = {}) {
  // 1. Body-language brain: 8 inputs [quiet, holding, props, pokes, night, cheer, audioOn, focusMode]
  const idleCoach = new Coach(store, { name: 'idle_v2', inputs: 8, actions: IDLE_ACTIONS });
  const idleNet = new Brain(store, {
    name: 'idle_net',
    inputs: 8,
    actions: IDLE_ACTIONS,
    teacher: see => {
      // focusMode (see[7] > 0.5): stay calm & quiet
      if (see[7] > .5) return see[0] > .2 ? 'rest' : 'glance';
      if (see[6] > .5) return 'sway';       // music / radio playing
      if (see[1] > .5) return 'peek';       // holding a prop
      if (see[3] > .2) return 'hop';        // poked lately
      if (see[4] > .4 && see[0] > .2) return 'stretch'; // late night & quiet
      return 'glance';
    },
    limits: { react: .5, perSecond: 2 },
  });

  // 2. Micro-reaction brain: 6 inputs [cheer, night, focusMode, audioOn, holding, streak]
  const reactCoach = new Coach(store, { name: 'react', inputs: 6, actions: REACT_ACTIONS });

  // 3. Adaptive game skill dial (aims for ~60% player win rate)
  const skillDial = new Dial(store, { name: 'skill', target: .6, start: .45, range: [.15, .95] });

  // 4. Activity habit predictor
  const activityBrain = new Predict(store, { name: 'activity', moves: ACTIVITIES });

  /** Picks the next idle body move: Coach corrections > Brain neural blend > rules fallback. */
  function pickIdle(see, rulesList, dt = 1) {
    const netPick = idleNet.act(see, dt);
    // Put neural net's suggestion near the front of the rules list when not in focus mode
    const merged = see[7] > .5
      ? ['rest', 'glance']
      : (netPick && rulesList.includes(netPick) ? [netPick, ...rulesList.filter(a => a !== netPick)] : rulesList);
    const chosen = idleCoach.pick(see, merged);
    return { act: chosen, taught: !!idleCoach.recalled && !idleCoach.recalled.not, netPick };
  }

  /** Teaches the idle brains when the user pokes/likes a move (or engages right after it). */
  function rewardIdle(see, act, { strong = true } = {}) {
    if (strong) {
      idleCoach.correct(see, act);
      idleNet.correct(see, act);
    }
    idleNet.feel(strong ? 1 : .45);
  }

  /** Picks an instant on-device reaction gesture for an event (poke, greet, tap, win). */
  function pickReaction(see, fallback = ['wave', 'bounce', 'nod']) {
    return reactCoach.pick(see, fallback);
  }

  function rewardReaction(see, act) {
    reactCoach.correct(see, act);
  }

  /** Records a game win/loss/draw into the adaptive skill dial. */
  function recordGameResult(playerWon) {
    skillDial.result(playerWon);
    return skillDial.skill;
  }

  /** Records a user activity so Reverie learns their habits. */
  function noteActivity(kind) {
    if (ACTIVITIES.includes(kind)) activityBrain.see(kind);
  }

  function favouriteNext() {
    return { guess: activityBrain.guess(), sure: activityBrain.sure };
  }

  function stats() {
    return {
      idleCorrections: idleCoach.fixes?.count || 0,
      reactCorrections: reactCoach.fixes?.count || 0,
      skill: +skillDial.skill.toFixed(2),
      skillLevel: skillDial.level(5),
      rounds: skillDial.rounds,
      nextActivity: activityBrain.guess(),
      nextSure: +activityBrain.sure.toFixed(2),
    };
  }

  function forgetAll() {
    idleCoach.uncorrect?.();
    idleNet.reset?.();
    reactCoach.uncorrect?.();
    skillDial.forget?.();
    activityBrain.forget?.();
  }

  return {
    idleCoach, idleNet, reactCoach, skillDial, activityBrain,
    pickIdle, rewardIdle, pickReaction, rewardReaction,
    recordGameResult, noteActivity, favouriteNext, stats, forgetAll,
    skill: () => skillDial.skill,
  };
}
