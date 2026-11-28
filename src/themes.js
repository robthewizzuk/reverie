// Mood-Reactive Room Themes / Presets: transforms the workshop in one smooth sweep (wall/floor/rug/wood colours,
// Reverie's glow & body, window sky/weather, optional outfit, particle effect, and ambient radio station), and
// lets the user save & restore their own custom room presets.
import { makeThemesState } from './themes-state.js';
import { roomColours } from './room.js';
import { colours as creatureColours } from './looks.js';
import { FUN } from './mood.js';

export { makeThemesState };

Object.assign(FUN, { theme: FUN.theme || [.045, .75] });

export function makeThemes({ world, radio = null }) {
  const state = makeThemesState();

  async function command(input = {}) {
    const a = input.action || 'apply';

    if (a === 'list') return state.list();

    if (a === 'save') {
      const snap = {
        room: roomColours(),
        colours: creatureColours(),
        window: { ...(world.daylight?.state?.asked || { time: 'live', weather: 'live' }) },
      };
      const r = state.savePreset(input.name, snap);
      return r.error ? { text: r.error, error: true } : r.text;
    }

    if (a === 'delete') {
      const r = state.removePreset(input.name);
      return r.error ? { text: r.error, error: true } : r.text;
    }

    // apply
    const found = state.get(input.name);
    if (!found) return { text: `I don't know a theme called "${input.name || ''}". ${state.list()}`, error: true };
    const { key, theme } = found;
    if (theme.room) await world.recolourRoom(theme.room).catch(() => {});
    if (theme.colours) await world.recolour(theme.colours).catch(() => {});
    if (theme.window) world.daylight?.set(theme.window);
    if (theme.wear) await world.wear(theme.wear).catch(() => {});
    if (theme.effect) world.show?.(theme.effect);
    if (theme.radio && radio && !radio.playing) await radio.command({ action: 'play', station: theme.radio }).catch(() => {});
    state.markCurrent(key);
    world.creature?.gesture('tada');
    world.creature?.mood('excited');
    return `Transformed the room into ${theme.name}!`;
  }

  return {
    state,
    command,
    line: () => state.current && state.current !== 'default' ? ` Room theme: ${state.current}.` : '',
  };
}
