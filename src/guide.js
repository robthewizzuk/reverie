// Voice-First Recipe / Cooking & DIY Sidekick: step-by-step hands-free walkthroughs on the HUD bar
// with automatic named timers and ingredient recall ("how much flour?", "next step", "start the timer").

export function makeGuide({ timers = null, onNews = () => {} } = {}) {
  let active = null; // { title, ingredients: string[], steps: { text, timerSeconds?, timerLabel? }[], idx }

  const fmtSec = s => {
    s = Math.max(1, Math.round(s));
    const m = Math.floor(s / 60), r = s % 60;
    return m ? (r ? `${m}m ${r}s` : `${m} min`) : `${r}s`;
  };

  function stepText() {
    if (!active) return '';
    const st = active.steps[active.idx];
    const t = st.timerSeconds ? ` (${fmtSec(st.timerSeconds)} timer available)` : '';
    return `Step ${active.idx + 1} of ${active.steps.length}: ${st.text}${t}`;
  }

  function startStepTimer() {
    if (!active) return { text: 'No guide is open.', error: true };
    const st = active.steps[active.idx];
    if (!st?.timerSeconds) return { text: 'This step has no built-in timer. Give a duration to set one.', error: true };
    const label = st.timerLabel || `${active.title} step ${active.idx + 1}`;
    if (timers?.set) {
      const r = timers.set({ seconds: st.timerSeconds, label });
      return typeof r === 'string' ? r : r?.text || `Timer set for ${fmtSec(st.timerSeconds)} (${label}).`;
    }
    return `Timer set for ${fmtSec(st.timerSeconds)} (${label}).`;
  }

  function command(input = {}) {
    const a = String(input.action || '').toLowerCase();
    if (a === 'start') {
      const title = String(input.title || 'Step-by-step guide').trim().slice(0, 80);
      const rawSteps = Array.isArray(input.steps) ? input.steps : [];
      const steps = rawSteps.map(s => typeof s === 'string'
        ? { text: s.trim() }
        : { text: String(s?.text || '').trim(), timerSeconds: Number(s?.timer_seconds || s?.timerSeconds) || 0, timerLabel: String(s?.timer_label || s?.timerLabel || '').trim() }
      ).filter(s => s.text);
      if (!steps.length) return { text: 'Give at least one step to start the guide.', error: true };
      const ingredients = (Array.isArray(input.ingredients) ? input.ingredients : []).map(x => String(x || '').trim()).filter(Boolean).slice(0, 30);
      active = { title, ingredients, steps, idx: 0 };
      return `Started "${title}" (${steps.length} steps${ingredients.length ? `, ${ingredients.length} items` : ''}). ${stepText()}`;
    }
    if (!active) return { text: 'No recipe or DIY guide is open right now.', error: true };
    if (a === 'stop') {
      const t = active.title;
      active = null;
      return `Closed the "${t}" guide.`;
    }
    if (a === 'next') {
      if (active.idx >= active.steps.length - 1) {
        const t = active.title;
        active = null;
        return `That was the final step of "${t}"! All done.`;
      }
      active.idx++;
      return stepText();
    }
    if (a === 'prev') {
      active.idx = Math.max(0, active.idx - 1);
      return stepText();
    }
    if (a === 'goto') {
      const n = Math.round(Number(input.step) || 1);
      active.idx = Math.max(0, Math.min(active.steps.length - 1, n - 1));
      return stepText();
    }
    if (a === 'ingredients') {
      if (!active.ingredients.length) return `No ingredients or materials list was saved for "${active.title}".`;
      return `Ingredients / materials for "${active.title}": ${active.ingredients.join(', ')}.`;
    }
    if (a === 'timer') return startStepTimer();
    return { text: `Unknown guide action "${a}".`, error: true };
  }

  function bar() {
    if (!active) return null;
    const st = active.steps[active.idx];
    const buttons = [];
    if (active.idx > 0) buttons.push({ id: 'prev', label: 'Back' });
    if (st.timerSeconds) buttons.push({ id: 'timer', label: `Timer (${fmtSec(st.timerSeconds)})` });
    buttons.push({ id: 'next', label: active.idx < active.steps.length - 1 ? 'Next step' : 'Finish' });
    buttons.push({ id: 'stop', label: 'Close' });
    return {
      text: `${active.title} · Step ${active.idx + 1}/${active.steps.length}: ${st.text.slice(0, 95)}`,
      buttons,
    };
  }

  function button(id) {
    if (!active) return;
    if (id === 'next') { const r = command({ action: 'next' }); onNews(`[guide] ${typeof r === 'string' ? r : r.text}`, true); }
    else if (id === 'prev') { const r = command({ action: 'prev' }); onNews(`[guide] ${typeof r === 'string' ? r : r.text}`, true); }
    else if (id === 'timer') { const r = startStepTimer(); onNews(`[guide] ${typeof r === 'string' ? r : r.text}`, true); }
    else if (id === 'stop') { command({ action: 'stop' }); }
  }

  function line() {
    if (!active) return '';
    const st = active.steps[active.idx];
    const ing = active.ingredients.length ? ` Items: ${active.ingredients.slice(0, 12).join(', ')}.` : '';
    return ` Active guide "${active.title}" (${stepText()}).${ing}`;
  }

  return {
    get on() { return !!active; },
    get state() { return active ? { ...active } : null; },
    command,
    bar,
    button,
    line,
  };
}
