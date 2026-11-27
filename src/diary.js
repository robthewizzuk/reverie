// The diary sheet: everything Reverie remembers about you, on a page over the stage (the book button opens it). Each
// fact has a ✕ to forget it, and "Forget everything" (pressed twice) wipes the whole diary. It lives in this browser
// only: nothing here is sent anywhere.
import { prettyDay, daysBetween, dayOf } from './memory.js';
import { FAMILIES, ICONS } from './achievements.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nice = ymd => new Date(ymd + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/** el: the #diary element. memory: memory.js. onForget(): after anything is forgotten (so the chat reads it again). */
export function makeDiary({ el, memory, achievements = null, today = () => ({}), onForget = () => {} }) {
  const body = el.querySelector('.pages'), wipe = el.querySelector('[data-id="wipe"]');
  let armed = 0;

  function render() {
    const m = memory.all(), v = m.visits, r = m.records, d = dayOf(), t = today();
    const parts = [];
    const who = m.name ? esc(m.name) : 'you';
    parts.push(`<section class="hello"><h3>About ${who}</h3>`
      + (v.first ? `<p>We met on ${esc(nice(v.first))}. ${v.days} day${v.days === 1 ? '' : 's'} together${v.streak > 1 ? `, ${v.streak} in a row` : ''}${v.best > v.streak ? ` (best ${v.best})` : ''}.</p>` : '<p>We have only just met.</p>')
      + (m.birthday ? `<p>Birthday: ${esc(prettyDay(m.birthday))}</p>` : '')
      + '</section>');
    if (t.surprise) parts.push(`<section><h3>Today</h3><p>${t.holding ? `Made overnight: ${esc(t.holding)}. ` : ''}${esc(t.surprise.show[0].toUpperCase() + t.surprise.show.slice(1))}</p>${t.funDay ? `<p>It's ${esc(t.funDay)}!</p>` : ''}</section>`);
    parts.push(`<section><h3>Things I remember</h3>${m.facts.length || m.name ? '<ul class="facts">'
      + (m.name ? `<li><span>Your name is ${esc(m.name)}</span><button type="button" data-forget="name" aria-label="Forget your name">✕</button></li>` : '')
      + (m.birthday ? `<li><span>Your birthday is ${esc(prettyDay(m.birthday))}</span><button type="button" data-forget="birthday" aria-label="Forget your birthday">✕</button></li>` : '')
      + [...m.facts].reverse().map(f => `<li><span>${esc(f.text)}</span><button type="button" data-drop="${esc(f.id)}" aria-label="Forget this">✕</button></li>`).join('') + '</ul>'
      : '<p class="soft">Nothing yet. Tell me about yourself, and I\'ll keep it here.</p>'}</section>`);
    const c = r.chess, cg = c.won + c.lost + c.drawn, rec = [];
    if (cg) rec.push(`Chess: you ${c.won}, me ${c.lost}${c.drawn ? `, ${c.drawn} drawn` : ''}`);
    if (r.quiz.rounds) rec.push(`Quiz: ${r.quiz.rounds} round${r.quiz.rounds > 1 ? 's' : ''}, best ${r.quiz.best}/10, ${r.quiz.right} right in all`);
    if (r.made) rec.push(`Things I've made you: ${r.made}`);
    if (r.doodles) rec.push(`Drawings turned real: ${r.doodles}`);
    if (r.rolls) rec.push(`Dice rolled: ${r.rolls}`);
    if (rec.length) parts.push(`<section><h3>Records</h3><ul>${rec.map(x => `<li>${esc(x)}</li>`).join('')}</ul><button type="button" class="small" data-forget="records">Reset records</button></section>`);
    if (achievements) parts.push(badges());
    const days = Object.keys(m.days).sort().reverse().slice(0, 14);
    if (days.length) parts.push(`<section><h3>Our days</h3>${days.map(k => `<div class="day"><b>${k === d ? 'Today' : daysBetween(k, d) === 1 ? 'Yesterday' : esc(nice(k))}</b><span>${esc(m.days[k].join(' · '))}</span></div>`).join('')}</section>`);
    if (m.chat.length) parts.push(`<section><h3>What we said lately</h3><ul class="chat">${m.chat.slice(-8).map(x => `<li class="${x.who === 'you' ? 'you' : 'me'}">${esc(x.text)}</li>`).join('')}</ul><button type="button" class="small" data-forget="the chats">Forget our chats</button></section>`);
    body.innerHTML = parts.join('');
  }

  /** The badges: each family's, earned ones in their metal, the rest faded with how far along they are. */
  function badges() {
    const list = achievements.list(), t = achievements.tally;
    const fams = Object.keys(FAMILIES).filter(f => list.some(a => a.family === f));
    return `<section class="badges"><h3>Badges <small>${t.got} of ${t.of}</small></h3>${fams.map(f => `<h4>${esc(FAMILIES[f].title)}</h4><ul>${list.filter(a => a.family === f).map(a => {
      const hidden = a.secret && !a.got, title = hidden ? 'A secret badge' : a.title, about = hidden ? 'Keep playing to find it' : a.got ? `You ${a.about}` : `${a.about[0].toUpperCase() + a.about.slice(1)}${a.at > 1 ? ` (${a.have} of ${a.at})` : ''}`;
      return `<li class="${a.got ? 'got ' + a.tier : 'locked'}" title="${esc(about)}"><span class="medal" aria-hidden="true">${hidden ? '?' : ICONS[f]}</span><b>${esc(title)}</b><small>${esc(about)}</small>${!a.got && a.at > 1 && !hidden ? `<i style="width:${Math.round(a.have / a.at * 100)}%"></i>` : ''}</li>`;
    }).join('')}</ul>`).join('')}</section>`;
  }

  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.id === 'close') return hide();
    if (b.dataset.id === 'wipe') {
      // pressed twice within a few seconds: there's no undo
      if (Date.now() - armed > 4000) { armed = Date.now(); wipe.textContent = 'Tap again to forget everything'; wipe.classList.add('armed'); return; }
      memory.wipe(); armed = 0; disarm(); onForget('everything'); render(); return;
    }
    if (b.dataset.drop) { memory.drop(b.dataset.drop); onForget('a fact'); render(); }
    else if (b.dataset.forget) { memory.forget({ what: b.dataset.forget }); onForget(b.dataset.forget); render(); }
  });
  const disarm = () => { wipe.textContent = 'Forget everything'; wipe.classList.remove('armed'); };
  memory.onChange(() => { if (!el.hidden) render(); });
  achievements?.onChange(() => { if (!el.hidden) render(); });
  function show() { render(); disarm(); el.hidden = false; }
  function hide() { el.hidden = true; }
  return { show, hide, get open() { return !el.hidden; } };
}
