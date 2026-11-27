// The diary sheet: everything Reverie knows about you, on a page over the stage (the book button opens it). Facts are
// grouped by kind; each one can be changed (✎) or forgotten (✕), and you can write one in yourself. Below them: what
// you talked about (recaps), your records, your days, and a switch for learning from your chats. "Forget everything"
// (pressed twice) wipes the whole diary. It lives in this browser only: nothing here is sent anywhere, except that
// chat lines are boiled down into recaps by the same thinking that answers you (recap.js), while learning is on.
import { prettyDay, daysBetween, dayOf, KINDS } from './memory.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nice = ymd => new Date(ymd + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const btns = (edit, forget, label) => `<button type="button" data-edit="${esc(edit)}" aria-label="Change ${esc(label)}">✎</button><button type="button" ${forget} aria-label="Forget ${esc(label)}">✕</button>`;

/** el: the #diary element. memory: memory.js. onForget(): after anything is forgotten or changed (so the chat reads it again). */
export function makeDiary({ el, memory, today = () => ({}), onForget = () => {} }) {
  const body = el.querySelector('.pages'), wipe = el.querySelector('[data-id="wipe"]');
  let armed = 0, editing = null;

  function render() {
    const m = memory.all(), v = m.visits, r = m.records, d = dayOf(), t = today();
    const parts = [];
    const who = m.name ? esc(m.name) : 'you', habits = memory.habitLine();
    parts.push(`<section class="hello"><h3>About ${who}</h3>`
      + (v.first ? `<p>We met on ${esc(nice(v.first))}. ${v.days} day${v.days === 1 ? '' : 's'} together${v.streak > 1 ? `, ${v.streak} in a row` : ''}${v.best > v.streak ? ` (best ${v.best})` : ''}.</p>` : '<p>We have only just met.</p>')
      + (habits ? `<p class="soft">I've noticed ${esc(habits.replace(/\btheir\b/g, 'your').replace(/\bthey\b/g, 'you'))}.</p>` : '')
      + '</section>');
    const fu = memory.followUps();
    if (fu.length) parts.push(`<section><h3>I'll ask you about</h3><ul>${fu.map(f => `<li>${esc(f.text)} <span class="when">${esc(f.said)}</span></li>`).join('')}</ul></section>`);
    if (t.surprise) parts.push(`<section><h3>Today</h3><p>${t.holding ? `Made overnight: ${esc(t.holding)}. ` : ''}${esc(t.surprise.show[0].toUpperCase() + t.surprise.show.slice(1))}</p>${t.funDay ? `<p>It's ${esc(t.funDay)}!</p>` : ''}</section>`);
    // what it knows, by kind (newest first in each)
    const row = (id, text, extra, forget, label) => editing === id
      ? `<li class="editing"><input type="text" data-input="${esc(id)}" value="${esc(text)}" maxlength="160" aria-label="Change ${esc(label)}"><button type="button" data-save="${esc(id)}" aria-label="Save">✓</button></li>`
      : `<li><span>${esc(text)}${extra ? ` <span class="when">${esc(extra)}</span>` : ''}</span>${btns(id, forget, label)}</li>`;
    const known = [];
    if (m.name || m.birthday) known.push(`<h4>${esc(KINDS.about.sheet)}</h4><ul class="facts">`
      + (m.name ? row('name', editing === 'name' ? m.name : `Your name is ${m.name}`, '', 'data-forget="name"', 'your name') : '')
      + (m.birthday ? row('birthday', editing === 'birthday' ? prettyDay(m.birthday) : `Your birthday is ${prettyDay(m.birthday)}`, '', 'data-forget="birthday"', 'your birthday') : '')
      + m.facts.filter(f => f.kind === 'about').reverse().map(f => row(f.id, f.text, '', `data-drop="${esc(f.id)}"`, 'this')).join('') + '</ul>');
    for (const [k, { sheet }] of Object.entries(KINDS)) {
      if (k === 'about' && (m.name || m.birthday)) continue;
      const list = m.facts.filter(f => f.kind === k).reverse(); if (!list.length) continue;
      known.push(`<h4>${esc(sheet)}</h4><ul class="facts">${list.map(f => row(f.id, f.text, f.when ? nice(f.when) : '', `data-drop="${esc(f.id)}"`, 'this')).join('')}</ul>`);
    }
    parts.push(`<section><h3>Things I know about you</h3>${known.length ? known.join('') : '<p class="soft">Nothing yet. Tell me about yourself, and I\'ll keep it here.</p>'}`
      + `<form class="add" data-id="add"><input type="text" name="text" maxlength="160" placeholder="Tell me something to remember…" aria-label="Something for Reverie to remember"><select name="kind" aria-label="What sort of thing"><option value="">Any kind</option>${Object.entries(KINDS).map(([k, x]) => `<option value="${k}">${esc(x.sheet)}</option>`).join('')}</select><button type="submit">Add</button></form></section>`);
    if (m.talks.length) parts.push(`<section><h3>What we talked about</h3><ul class="facts talks">${m.talks.map((x, i) => [x, i]).reverse().slice(0, 14).map(([x, i]) => `<li><span><b>${k(x.day, d)}</b> ${esc(x.text)}</span><button type="button" data-talk="${i}" aria-label="Forget this chat">✕</button></li>`).join('')}</ul></section>`);
    const c = r.chess, cg = c.won + c.lost + c.drawn, rec = [];
    if (cg) rec.push(`Chess: you ${c.won}, me ${c.lost}${c.drawn ? `, ${c.drawn} drawn` : ''}${c.run >= 2 ? ` (you've won ${c.run} in a row!)` : c.run <= -2 ? ` (I've won ${-c.run} in a row)` : ''}`);
    if (r.quiz.rounds) rec.push(`Quiz: ${r.quiz.rounds} round${r.quiz.rounds > 1 ? 's' : ''}, best ${r.quiz.best}/10, ${r.quiz.right} right in all`);
    if (r.made) rec.push(`Things I've made you: ${r.made}${m.made.length ? ` (lately ${[...new Set(m.made.slice(-4).map(x => x.what))].join(', ')})` : ''}`);
    if (r.doodles) rec.push(`Drawings turned real: ${r.doodles}`);
    if (r.rolls) rec.push(`Dice rolled: ${r.rolls}`);
    if (rec.length) parts.push(`<section><h3>Records</h3><ul>${rec.map(x => `<li>${esc(x)}</li>`).join('')}</ul><button type="button" class="small" data-forget="records">Reset records</button></section>`);
    const days = Object.keys(m.days).sort().reverse().slice(0, 14);
    if (days.length) parts.push(`<section><h3>Our days</h3>${days.map(x => `<div class="day"><b>${k(x, d)}</b><span>${esc(m.days[x].join(' · '))}</span></div>`).join('')}</section>`);
    if (m.chat.length) parts.push(`<section><h3>What we said lately</h3><ul class="chat">${m.chat.slice(-8).map(x => `<li class="${x.who === 'you' ? 'you' : 'me'}">${esc(x.text)}</li>`).join('')}</ul><button type="button" class="small" data-forget="the chats">Forget our chats</button></section>`);
    parts.push(`<section><label class="learn"><input type="checkbox" data-id="learn"${m.learn ? ' checked' : ''}> Learn about me from our chats</label><p class="soft">${m.learn ? 'Every so often I jot down what we talked about and anything new about you. The diary stays in this browser.' : "I only keep what you ask me to remember, and I don't keep our chats."}</p></section>`);
    body.innerHTML = parts.join('');
    if (editing) body.querySelector(`[data-input="${CSS.escape(editing)}"]`)?.focus();
  }
  const k = (x, d) => x === d ? 'Today' : daysBetween(x, d) === 1 ? 'Yesterday' : esc(nice(x));

  function save(id) {
    const box = body.querySelector(`[data-input="${CSS.escape(id)}"]`); if (!box) return;
    memory.edit(id, box.value);   // (empty: forgotten)
    editing = null; onForget('a change'); render();
  }
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.id === 'close') return hide();
    if (b.dataset.id === 'wipe') {
      // pressed twice within a few seconds: there's no undo
      if (Date.now() - armed > 4000) { armed = Date.now(); wipe.textContent = 'Tap again to forget everything'; wipe.classList.add('armed'); return; }
      memory.wipe(); armed = 0; disarm(); onForget('everything'); render(); return;
    }
    if (b.dataset.edit) { editing = b.dataset.edit; render(); }
    else if (b.dataset.save) save(b.dataset.save);
    else if (b.dataset.drop) { memory.drop(b.dataset.drop); onForget('a fact'); render(); }
    else if (b.dataset.talk) { memory.dropTalk(+b.dataset.talk); onForget('a chat'); render(); }
    else if (b.dataset.forget) { memory.forget({ what: b.dataset.forget }); onForget(b.dataset.forget); render(); }
  });
  el.addEventListener('keydown', e => {
    const box = e.target.closest('[data-input]'); if (!box) return;
    if (e.key === 'Enter') { e.preventDefault(); save(box.dataset.input); } else if (e.key === 'Escape') { editing = null; render(); }
  });
  el.addEventListener('submit', e => {
    if (e.target.dataset.id !== 'add') return;
    e.preventDefault();
    const f = new FormData(e.target), text = String(f.get('text') || '').trim(); if (!text) return;
    memory.remember({ fact: text, kind: String(f.get('kind')) }); document.activeElement?.blur?.(); onForget('a new fact'); render();
  });
  el.addEventListener('change', e => { if (e.target.dataset?.id === 'learn') { memory.learn = e.target.checked; render(); } });
  const disarm = () => { wipe.textContent = 'Forget everything'; wipe.classList.remove('armed'); };
  // (the diary changes as they chat: it shows that, but never under a box they're typing in)
  memory.onChange(() => { if (!el.hidden && !editing && !el.contains(document.activeElement?.closest?.('input[type="text"], select'))) render(); });
  function show() { editing = null; render(); disarm(); el.hidden = false; }
  function hide() { el.hidden = true; editing = null; }
  return { show, hide, get open() { return !el.hidden; } };
}
