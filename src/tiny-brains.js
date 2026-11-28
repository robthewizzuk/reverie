// Reverie's Multi-Brain Suite: 10 specialized on-device Tiny Brains (engine/src/kit/brains.js) working together
// with zero cloud latency and full localStorage persistence (reverie.brain.*):
//   1. idleNet (Brain) + idleCoach (Coach): 8-input body-language brain (tuned for snappy adaptation).
//   2. reactCoach (Coach): 6-input instant zero-latency micro-reactions before Claude streams.
//   3. skillDial (Dial): adaptive game difficulty dial steering tabletop games toward ~60% win rate.
//   4. activityBrain (Predict): learns your session rhythm (chat, make, game, music, focus, room, garden).
//   5. gazeBrain (Brain): 6-input attention & gaze director (user, prop, window, pet, mirror, desk).
//   6. vibeBrain (Brain) + vibeCoach (Coach): 6-input ambient radio/vibe recommender by time, mood & focus.
//   7. pacingDial (Dial): learns your speaking cadence to tune endpointing settleDelay (0.82x..1.35x).
//   8. chatterDial (Dial): tunes how chatty vs. chill Reverie is based on engagement vs. hushes.
//   9. moodBrain (Brain): 6-input emotional resonance & core-glow mood selector between turns.
//  10. rivalBrain (Nemesis): tabletop rivalry & move-style habit tracker (aggressive, safe, corner, center, edge).
//  11. petBrain (Brain): 5-input autonomous workshop pet behaviour selector (follow, chase, nap, zoomies, beg).
import { Brain, Coach, Dial, Predict, Nemesis } from '../engine/src/kit/brains.js';

export const IDLE_ACTIONS = ['rest', 'glance', 'peek', 'sway', 'hop', 'stretch'];
export const REACT_ACTIONS = ['wave', 'bounce', 'nod', 'think', 'tada', 'shrug'];
export const ACTIVITIES = ['chat', 'make', 'game', 'music', 'focus', 'room', 'garden'];
export const GAZE_TARGETS = ['user', 'prop', 'window', 'pet', 'mirror', 'desk'];
export const VIBE_STATIONS = ['lofi_beats', 'rain_window', 'crackling_fire', 'jazz_cafe', 'night_crickets', 'space_drift'];
export const MOOD_STATES = ['happy', 'calm', 'curious', 'excited', 'sleepy', 'playful'];
export const RIVAL_MOVES = ['aggressive', 'safe', 'corner', 'center', 'edge'];
export const PET_MODES = ['follow', 'chase', 'nap', 'zoomies', 'beg'];

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
    hidden: [12],
    teacher: see => {
      if (see[7] > .5) return see[0] > .2 ? 'rest' : 'glance'; // focusMode: calm & quiet
      if (see[6] > .5) return 'sway';       // music / radio playing
      if (see[1] > .5) return 'peek';       // holding a prop
      if (see[3] > .2) return 'hop';        // poked lately
      if (see[4] > .4 && see[0] > .2) return 'stretch'; // late night & quiet
      if (see[5] > .4) return 'hop';        // high cheer
      return 'glance';
    },
    limits: { react: .35, perSecond: 2.5 },
  });

  // 2. Micro-reaction brain: 6 inputs [cheer, night, focusMode, audioOn, holding, streak]
  const reactCoach = new Coach(store, { name: 'react', inputs: 6, actions: REACT_ACTIONS });

  // 3. Adaptive game skill dial (aims for ~60% player win rate)
  const skillDial = new Dial(store, { name: 'skill', target: .6, start: .45, range: [.15, .95], speed: .09 });

  // 4. Activity habit predictor
  const activityBrain = new Predict(store, { name: 'activity', moves: ACTIVITIES });

  // 5. Attention & Gaze Director: 6 inputs [speaking, listening, holding, petNear, night, audioOn]
  const gazeBrain = new Brain(store, {
    name: 'gaze',
    inputs: 6,
    actions: GAZE_TARGETS,
    hidden: [10],
    teacher: see => {
      if (see[0] > .5 || see[1] > .5) return 'user';   // talking or listening: eye contact
      if (see[2] > .5) return 'prop';                  // holding something: admire it
      if (see[3] > .5) return 'pet';                   // pet nearby: watch the pet
      if (see[4] > .5) return 'window';                // night sky: peek out window
      if (see[5] > .5) return 'desk';                  // radio/aquarium on desk
      return 'mirror';                                 // idle check in the new wall mirror
    },
    limits: { react: .4, perSecond: 2 },
  });

  // 6. Ambient Vibe & Radio Recommender: 6 inputs [hourNorm, night, focusMode, cheer, raining, playing]
  const vibeCoach = new Coach(store, { name: 'vibe_coach', inputs: 6, actions: VIBE_STATIONS });
  const vibeBrain = new Brain(store, {
    name: 'vibe_net',
    inputs: 6,
    actions: VIBE_STATIONS,
    hidden: [10],
    teacher: see => {
      if (see[4] > .5) return 'rain_window';           // raining outside
      if (see[2] > .5) return 'lofi_beats';            // focus sprint
      if (see[1] > .5 && see[3] < 0) return 'night_crickets'; // quiet late night
      if (see[1] > .5) return 'crackling_fire';        // cosy night
      if (see[3] > .4) return 'jazz_cafe';             // upbeat cheer
      return 'lofi_beats';
    },
    limits: { react: 1, perSecond: 1 },
  });

  // 7. Conversational Pacing Dial: learns whether the user needs slightly longer or snappier endpointing
  //    smooth=true (wasn't cut off) -> slightly snappier; cutOff=false -> gives more breathing room
  const pacingDial = new Dial(store, { name: 'pacing', target: .85, start: .5, range: [.15, .85], speed: .08 });

  // 8. Proactive Chatter Dial: learns whether user engages with vs. hushes proactive remarks
  const chatterDial = new Dial(store, { name: 'chatter', target: .65, start: .55, range: [.2, .95], speed: .1 });

  // 9. Emotional Resonance & Core Glow Brain: 6 inputs [cheer, quiet, pokes, wins, focusMode, night]
  const moodBrain = new Brain(store, {
    name: 'mood_net',
    inputs: 6,
    actions: MOOD_STATES,
    hidden: [10],
    teacher: see => {
      if (see[4] > .5) return 'calm';                  // focus sprint
      if (see[5] > .5 && see[1] > .3) return 'sleepy'; // late night & quiet
      if (see[3] > .3) return 'excited';               // winning streak
      if (see[2] > .3) return 'playful';               // poked lately
      if (see[0] > .2) return 'happy';
      return 'curious';
    },
    limits: { react: 1.2, perSecond: 1 },
  });

  // 10. Tabletop Rival Brain (Nemesis): tracks rivalry streak, grudge, and move style habits
  const rivalBrain = new Nemesis(store, {
    name: 'rival',
    moves: RIVAL_MOVES,
    target: .6,
    lines: {
      first: ['Ooh, a fresh match! Let us see what you have got.'],
      back: ['Back for another round? I am ready!'],
      habit: ['I have noticed you love playing {move} moves — I am watching for it!'],
      long: ['It has been a few days since our last match!'],
    },
  });

  // 11. Workshop Pet Autonomy Brain: 5 inputs [ownerNear, propsOnFloor, musicOn, night, petEnergy]
  const petBrain = new Brain(store, {
    name: 'pet_net',
    inputs: 5,
    actions: PET_MODES,
    hidden: [8],
    teacher: see => {
      if (see[3] > .5 && see[4] < .2) return 'nap';
      if (see[1] > .3 && see[4] > 0) return 'chase';
      if (see[2] > .5 && see[4] > .3) return 'zoomies';
      if (see[0] > .4 && see[4] < .1) return 'beg';
      return 'follow';
    },
    limits: { react: .8, perSecond: 1.5 },
  });

  const nameOf = (list, v, fallback) => typeof v === 'string' && list.includes(v) ? v : (list[v] ?? fallback);
  const idxOf = (list, v) => typeof v === 'number' ? v : list.indexOf(v);

  /** 1. Picks the next idle body move: Coach corrections > Brain neural blend > rules fallback. */
  function pickIdle(see, rulesList, dt = 1) {
    const netPick = nameOf(IDLE_ACTIONS, idleNet.act(see, dt), rulesList[0] || 'glance');
    const merged = see[7] > .5
      ? ['rest', 'glance']
      : (netPick && rulesList.includes(netPick) ? [netPick, ...rulesList.filter(a => a !== netPick)] : rulesList);
    const chosen = idleCoach.pick(see, merged);
    return { act: chosen, taught: !!idleCoach.recalled && !idleCoach.recalled.not, netPick };
  }

  function rewardIdle(see, act, { strong = true } = {}) {
    if (strong) {
      idleCoach.correct(see, act);
      const i = idxOf(IDLE_ACTIONS, act);
      if (i >= 0) idleNet.correct(see, i);
    }
    idleNet.feel(strong ? 1 : .45);
  }

  /** 2. Picks an instant on-device reaction gesture for an event (poke, greet, tap, win). */
  function pickReaction(see, fallback = ['wave', 'bounce', 'nod']) {
    return reactCoach.pick(see, fallback);
  }
  function rewardReaction(see, act) { reactCoach.correct(see, act); }

  /** 3. Records a game win/loss into both the adaptive skill dial and the rival Nemesis. */
  function recordGameResult(playerWon) {
    skillDial.result(playerWon);
    rivalBrain.won?.(playerWon);
    return skillDial.skill;
  }

  /** 4. Records a user activity so Reverie learns their habits. */
  function noteActivity(kind) { if (ACTIVITIES.includes(kind)) activityBrain.see(kind); }
  function favouriteNext() { return { guess: activityBrain.guess(), sure: activityBrain.sure }; }

  /** 5. Attention & Gaze Director. */
  function pickGaze(see, dt = .5) { return nameOf(GAZE_TARGETS, gazeBrain.act(see, dt), 'user'); }
  function rewardGaze(good = true) { gazeBrain.feel(good ? .6 : -.4); }

  /** 6. Ambient Vibe / Radio Recommender. */
  function pickVibe(see, dt = 1) {
    const netPick = nameOf(VIBE_STATIONS, vibeBrain.act(see, dt), 'lofi_beats');
    return vibeCoach.pick(see, [netPick, ...VIBE_STATIONS.filter(s => s !== netPick)]);
  }
  function rewardVibe(see, station) {
    if (!VIBE_STATIONS.includes(station)) return;
    vibeCoach.correct(see, station);
    const i = idxOf(VIBE_STATIONS, station);
    if (i >= 0) vibeBrain.correct(see, i);
    vibeBrain.feel(1);
  }

  /** 7. Conversational Pacing Dial -> multiplier (0.82x..1.35x) for settleDelay(). */
  function noteTurnPacing(smooth) { pacingDial.result(smooth); }
  function pacingScale() {
    // Higher dial skill (user rarely cut off) -> snappier (0.82x); lower -> more patient (1.35x)
    return +(1.35 - pacingDial.skill * .53).toFixed(2);
  }

  /** 8. Proactive Chatter Dial -> 0.2..0.95 chattiness factor. */
  function noteChatterResponse(engaged) { chatterDial.result(engaged); }
  function chattiness() { return +chatterDial.skill.toFixed(2); }

  /** 9. Emotional Resonance & Core Mood Brain. */
  function pickMood(see, dt = 1) { return nameOf(MOOD_STATES, moodBrain.act(see, dt), 'happy'); }
  function rewardMood(good = true) { moodBrain.feel(good ? .7 : -.4); }

  /** 10. Tabletop Rival Brain: track move style and read spotted habits / grudge. */
  function noteRivalMove(style) { if (RIVAL_MOVES.includes(style)) rivalBrain.habits.see(style); }
  function rivalSummary() {
    return { habit: rivalBrain.habit, grudge: +rivalBrain.grudge.toFixed(2), met: rivalBrain.record.met };
  }

  /** 11. Pet Autonomy Brain. */
  function pickPetMode(see, dt = 1) { return nameOf(PET_MODES, petBrain.act(see, dt), 'follow'); }
  function rewardPet(good = true) { petBrain.feel(good ? .7 : -.3); }

  /** Compact one-line summary for Claude's context so the LLM knows what the tiny brains noticed. */
  function contextLine() {
    const bits = [];
    if (activityBrain.sure >= .55 && activityBrain.guess()) bits.push(`often likes ${activityBrain.guess()} next`);
    if (rivalBrain.habit) bits.push(`tends to play ${rivalBrain.habit.move} moves in games`);
    if (chatterDial.skill < .38) bits.push('prefers Reverie calm and concise');
    return bits.length ? ` Tiny brains note: ${bits.join('; ')}.` : '';
  }

  function stats() {
    return {
      count: 11,
      idleCorrections: idleCoach.fixes?.count || 0,
      reactCorrections: reactCoach.fixes?.count || 0,
      vibeCorrections: vibeCoach.fixes?.count || 0,
      skill: +skillDial.skill.toFixed(2),
      skillLevel: skillDial.level(5),
      rounds: skillDial.rounds,
      pacingScale: pacingScale(),
      chattiness: chattiness(),
      nextActivity: activityBrain.guess(),
      nextSure: +activityBrain.sure.toFixed(2),
      rivalHabit: rivalBrain.habit?.move || null,
      rivalGrudge: +rivalBrain.grudge.toFixed(2),
    };
  }

  function forgetAll() {
    idleCoach.uncorrect?.();
    idleNet.reset?.();
    reactCoach.uncorrect?.();
    skillDial.forget?.();
    activityBrain.forget?.();
    gazeBrain.reset?.();
    vibeCoach.uncorrect?.();
    vibeBrain.reset?.();
    pacingDial.forget?.();
    chatterDial.forget?.();
    moodBrain.reset?.();
    rivalBrain.forget?.();
    petBrain.reset?.();
  }

  return {
    idleCoach, idleNet, reactCoach, skillDial, activityBrain,
    gazeBrain, vibeCoach, vibeBrain, pacingDial, chatterDial, moodBrain, rivalBrain, petBrain,
    pickIdle, rewardIdle, pickReaction, rewardReaction,
    recordGameResult, noteActivity, favouriteNext,
    pickGaze, rewardGaze, pickVibe, rewardVibe,
    noteTurnPacing, pacingScale, noteChatterResponse, chattiness,
    pickMood, rewardMood, noteRivalMove, rivalSummary,
    pickPetMode, rewardPet, contextLine, stats, forgetAll,
    skill: () => skillDial.skill,
  };
}
