import { mount, h, badge, fullName, isMinor, daysFrom, fmtDate, money, toast, table, field, readForm, today } from './ui.js';
import { api } from './api.js';
import { pageHead } from './common.js';
import * as participants from './participants.js';
import * as mentors from './mentors.js';
import * as sponsors from './sponsors.js';
import * as reports from './reports.js';

// Greeting shown on the dashboard.
const USER = { name: 'Sean Smith', first: 'Sean', title: 'Executive Director' };
const IDLE_MS = 30 * 60 * 1000;

const NAV = [
  ['#/', 'Dashboard'],
  ['group', 'Modules'],
  ['#/participants', 'Participants'],
  ['#/mentors', 'Mentors'],
  ['#/sponsors', 'Sponsors & Donors'],
  ['#/reports', 'Reporting'],
  ['group', 'Planned'],
  ['#/grants', 'Grant Tracking', true],
  ['#/events', 'Event Management', true],
  ['group', 'Administration'],
  ['#/settings', 'Settings'],
];

const view = document.getElementById('view');
const navEl = document.getElementById('navlinks');

function greeting() {
  const hr = new Date().getHours();
  return hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
}

function stat(n, l) { return h('div', { class: 'stat' }, h('div', { class: 'n' }, n), h('div', { class: 'l' }, l)); }

async function dashboard(root) {
  const [people, mentorList, sponsorList] = await Promise.all([api.list('participants', true), api.list('mentors', true), api.list('sponsors', true)]);
  const year = String(new Date().getFullYear());
  const givenThisYear = sponsorList.reduce((n, s) => n + sponsors.total(s, `${year}-01-01`, `${year}-12-31`), 0);
  const empty = !people.length && !mentorList.length && !sponsorList.length;
  const due = sponsorList.flatMap((s) => [['Follow-up', s.nextFollowUp], ['Renewal', s.renewalDate]].filter(([, d]) => d && daysFrom(d) <= 30).map(([kind, d]) => ({ s, kind, d }))).sort((a, b) => a.d.localeCompare(b.d));
  const unpaired = people.filter((p) => p.enrollmentStatus === 'Enrolled' && !p.mentorId);
  const noConsent = people.filter((p) => isMinor(p.dob) && !p.guardianConsent && !['Withdrawn', 'Completed'].includes(p.enrollmentStatus));

  const attention = [];
  for (const r of due) attention.push(h('li', {}, h('a', { href: '#/sponsors/' + r.s.id }, r.s.name), ` · ${r.kind} `, daysFrom(r.d) < 0 ? h('span', { class: 'badge bad' }, `${-daysFrom(r.d)} days overdue`) : `on ${fmtDate(r.d)}`));
  for (const p of unpaired) attention.push(h('li', {}, h('a', { href: '#/participants/' + p.id }, fullName(p)), ' · enrolled, no mentor assigned'));
  for (const p of noConsent) attention.push(h('li', {}, h('a', { href: '#/participants/' + p.id }, fullName(p)), ' · minor, guardian consent not marked on file'));

  mount(root, 
    h('section', { class: 'hero' },
      h('h1', {}, `${greeting()}, ${USER.first}.`),
      h('p', {}, `Welcome back, ${USER.name}, ${USER.title} of The Aimsir Foundation. Inspiring the skies, changing lives.`)),
    empty && h('div', { class: 'card accent' }, h('h2', {}, 'Getting started'),
      h('p', {}, 'No records have been entered yet. Begin with the module you use most.'),
      h('div', { class: 'actions' },
        h('a', { class: 'btn primary', href: '#/participants/new' }, 'Add a participant'), h('a', { class: 'btn', href: '#/mentors/new' }, 'Add a mentor'), h('a', { class: 'btn', href: '#/sponsors/new' }, 'Add a sponsor / donor'))),
    h('div', { class: 'grid' },
      stat(people.filter((p) => p.enrollmentStatus === 'Enrolled').length, `Enrolled participants (${people.length} total)`),
      stat(mentorList.filter((m) => m.status === 'Active').length, `Active mentors (${mentorList.length} total)`),
      stat(sponsorList.filter((s) => s.status === 'Active').length, `Active sponsors & donors (${sponsorList.length} total)`),
      stat(money(givenThisYear), `Received in ${year}`)),
    h('section', { class: 'card', style: 'margin-top:1rem' }, h('h2', {}, 'Needs attention'),
      attention.length ? h('ul', { class: 'log' }, attention) : h('div', { class: 'empty' }, 'Nothing needs attention right now.')));
}

function planned(name, points) {
  return async (root) => mount(root, pageHead(name, badge('Planned')),
    h('div', { class: 'card accent' }, h('h2', {}, 'Coming in a later phase'),
      h('p', {}, `${name} is not available yet. This page reserves its place in the navigation so it can be added without changing how the rest of the tool works.`),
      h('p', { class: 'muted small' }, points)));
}

async function settings(root) {
  const s = await api.settings(true);
  const ta = field({ label: 'Program stages (one per line, in order)', name: 'stages', type: 'textarea', value: s.stages.join('\n'), wide: true, hint: 'These are the stage names offered on participant records. The starting list is a neutral default, so replace it with the Foundation’s own stages.' });
  const form = h('form', { class: 'card' }, h('h2', {}, 'Program stages'), ta, h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save stages')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api.saveSettings({ stages: readForm(form).stages.split('\n') }); toast('Stages saved'); } catch (err) { toast(err.message, true); }
  });
  const backup = h('section', { class: 'card' }, h('h2', {}, 'Backup'),
    h('p', {}, 'Download a complete copy of all records as a JSON file. It is unencrypted and contains personal information, so store it securely.'),
    h('button', { class: 'btn', type: 'button', onclick: async () => {
      try {
        const data = await api.request('GET', 'backup');
        const { download } = await import('./ui.js');
        download(`aimsir-backup-${today()}.json`, JSON.stringify(data, null, 2), 'application/json');
      } catch (err) { toast(err.message, true); }
    } }, 'Download backup'));
  const logBox = h('div', {}, h('div', { class: 'empty' }, 'Loading…'));
  api.request('GET', 'audit').then((rows) => logBox.replaceChildren(table([
    { label: 'When', render: (r) => new Date(r.at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) },
    { label: 'Action', render: (r) => r.action }, { label: 'Detail', render: (r) => r.detail || '—' }], rows, { empty: 'No activity yet.' }))).catch(() => logBox.replaceChildren('Could not load the activity log.'));
  mount(root, pageHead('Settings'), form, backup,
    h('section', { class: 'card' }, h('h2', {}, 'Recent activity'), h('p', { class: 'muted small' }, 'Sign-ins, changes and exports. Records are identified by ID only, never by name.'), logBox),
    h('section', { class: 'card' }, h('h2', {}, 'Changing the shared password'),
      h('p', {}, 'In Netlify, open Site configuration → Environment variables, change APP_PASSWORD, then trigger a redeploy (Deploys → Trigger deploy). Everyone is signed out and must use the new password. No code changes are needed.')));
}

const ROUTES = {
  '': dashboard,
  participants: (r, id) => (id ? participants.edit(r, id) : participants.list(r)),
  mentors: (r, id) => (id ? mentors.edit(r, id) : mentors.list(r)),
  sponsors: (r, id) => (id ? sponsors.edit(r, id) : sponsors.list(r)),
  reports: reports.render,
  grants: planned('Grant Tracking', 'Intended to track funders, applications, deadlines, awards and reporting obligations.'),
  events: planned('Event Management', 'Intended to manage Foundation events, registrations and volunteers.'),
  settings,
};

async function route() {
  document.body.classList.remove('nav-open');
  const [, seg, id] = (location.hash || '#/').split('/');
  const hash = seg ? '#/' + seg : '#/';
  for (const a of navEl.querySelectorAll('a')) a.toggleAttribute('aria-current', a.getAttribute('href') === hash) && a.setAttribute('aria-current', 'page');
  const fn = ROUTES[seg || ''];
  if (!fn) { view.replaceChildren(h('div', { class: 'empty' }, 'Page not found.')); return; }
  view.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
  try { await fn(view, id); } catch (e) { view.replaceChildren(h('div', { class: 'banner err' }, e.message || 'Could not load this page.')); }
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

// Shell wiring
navEl.replaceChildren(...NAV.map(([href, label, soon]) => (href === 'group' ? h('div', { class: 'group' }, label) : h('a', { href }, label, soon && h('span', { class: 'soon' }, 'Planned')))));
const menu = document.getElementById('menu');
menu.addEventListener('click', () => { const o = document.body.classList.toggle('nav-open'); menu.setAttribute('aria-expanded', String(o)); });
document.getElementById('scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));

const themeBtn = document.getElementById('theme');
const paintTheme = () => { themeBtn.textContent = document.documentElement.dataset.theme === 'dark' ? '☀ Light' : '☾ Dark'; };
themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('aimsir-theme', next); } catch {}
  paintTheme();
});
paintTheme();

async function signOut() { await api.logout(); location.replace('/login.html'); }
document.getElementById('signout').addEventListener('click', signOut);

// Automatic sign-out after inactivity protects shared or unattended devices.
let idle;
const resetIdle = () => { clearTimeout(idle); idle = setTimeout(signOut, IDLE_MS); };
['click', 'keydown', 'touchstart', 'scroll'].forEach((ev) => addEventListener(ev, resetIdle, { passive: true }));
resetIdle();

addEventListener('hashchange', route);
route();
