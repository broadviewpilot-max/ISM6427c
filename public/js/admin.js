// Administration page: system health, people and roles, activity. Administrator-only;
// the server refuses everything here for anyone else.
import { h, mount, table, field, toast, confirmDialog, formDialog, toCSV, download, today } from './ui.js';
import { api, session } from './api.js';
import { pageHead } from './common.js';

const ROLES = [['administrator', 'Administrator'], ['employee', 'Employee'], ['user', 'User']];
const ROLE_LABEL = Object.fromEntries(ROLES);
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const dot = (tone, text) => h('span', {}, h('span', { class: 'dot ' + tone }), text);
const badge = (tone, text) => h('span', { class: 'badge ' + tone }, text);
const stat = (n, l) => h('div', { class: 'stat' }, h('div', { class: 'n' }, n), h('div', { class: 'l' }, l));

const ACTIONS = {
  login: ['Signed in (board password)', 'in'], 'login-email': ['Signed in (email)', 'in'],
  'login-failed': ['Failed sign-in (board password)', 'fail'], 'login-email-failed': ['Failed sign-in (email)', 'fail'],
  created: ['Record created', 'change'], updated: ['Record updated', 'change'], deleted: ['Record deleted', 'change'],
  'settings-updated': ['Settings changed', 'change'], 'backup-downloaded': ['Backup downloaded', 'change'], export: ['Report exported', 'change'],
  'profile-updated': ['Profile updated', 'change'],
  'role-changed': ['Role changed', 'admin'], 'user-created': ['User created', 'admin'], 'user-deleted': ['User deleted', 'admin'],
  'user-disabled': ['User deactivated', 'admin'], 'user-enabled': ['User reactivated', 'admin'], 'password-set': ['Password set by administrator', 'admin'],
};
const FILTERS = [['all', 'Everything'], ['in', 'Sign-ins'], ['fail', 'Failed sign-ins'], ['change', 'Record changes'], ['admin', 'Administration']];

// ---------- Overview ----------
async function overview() {
  const o = await api.request('GET', 'admin/overview');
  const bad = o.services.filter((s) => s.status === 'fail');
  const missing = o.config.filter((c) => !c.ok && !c.optional);
  const svcTone = { ok: 'ok', fail: 'bad', off: 'warn' };
  const svcText = { ok: 'Working', fail: 'Problem', off: 'Not set up' };
  return [
    bad.length
      ? h('div', { class: 'banner err' }, `${bad.length} problem${bad.length > 1 ? 's' : ''} found: ${bad.map((s) => s.name.split(' (')[0]).join(', ')}. See details below.`)
      : h('div', { class: 'banner', style: 'background:var(--ok-bg);color:var(--ok)' }, 'All connected services are working.'),
    h('section', { class: 'card' }, h('h2', {}, 'System status'),
      h('p', { class: 'muted small' }, 'Live checks run each time you open or refresh this page.'),
      table([
        { label: 'Service', render: (r) => r.name },
        { label: 'Status', render: (r) => dot(svcTone[r.status], svcText[r.status]) },
        { label: 'Response', render: (r) => (r.status === 'off' ? '—' : `${r.ms} ms`) },
        { label: 'Details', render: (r) => r.detail || '' },
      ], o.services),
      h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => select('overview') }, 'Run checks again'))),
    h('div', { class: 'grid' },
      stat(o.activity.signIns24h, 'Sign-ins, last 24 hours'),
      stat(o.activity.failedSignIns24h, 'Failed sign-ins, last 24 hours'),
      stat(o.activity.changes24h, 'Record changes, last 24 hours'),
      stat(o.people.signedIn, `People who have signed in (${o.people.roles.administrator} admin, ${o.people.roles.employee} employee, ${o.people.roles.user} user${o.people.disabled ? `, ${o.people.disabled} deactivated` : ''})`),
      stat(o.records.participants, 'Participants on file'), stat(o.records.mentors, 'Mentors on file'), stat(o.records.sponsors, 'Sponsors & donors on file')),
    h('section', { class: 'card', style: 'margin-top:1rem' }, h('h2', {}, 'Configuration'),
      h('p', { class: 'muted small' }, 'Shows whether each setting exists in Netlify. Values are never displayed.'),
      table([
        { label: 'Setting', render: (r) => r.name },
        { label: 'Status', render: (r) => (r.ok ? badge('ok', 'Set') : r.optional ? badge('', 'Not set (optional)') : badge('warn', 'Not set')) },
        { label: 'Note', render: (r) => (r.ok && r.note) || '' },
      ], o.config),
      missing.length ? h('p', { class: 'muted small' }, 'To fix a missing setting: Netlify → Site configuration → Environment variables, then Deploys → Trigger deploy. The README lists each variable.') : null),
    h('section', { class: 'card' }, h('h2', {}, 'Housekeeping'),
      h('ul', { class: 'log' },
        h('li', {}, 'Last backup downloaded: ', o.lastBackup ? when(o.lastBackup) : h('strong', {}, 'never'), ' · ', h('a', { href: '#/settings' }, 'Download a backup')),
        o.links.supabase && h('li', {}, h('a', { href: o.links.supabase, target: '_blank', rel: 'noopener' }, 'Open the Supabase dashboard ↗'), ' (database, logs, sign-in settings)'),
        h('li', {}, 'To sign everyone out at once, change SESSION_SECRET in Netlify and redeploy.'))),
  ];
}

// ---------- Users ----------
const isMe = (u) => u.email === (session.me.email || '').toLowerCase();

async function users() {
  const data = await api.request('GET', 'admin/users');
  const reload = () => select('users');
  const run = async (fn, ok) => { try { const r = await fn(); toast(r?.warning || ok, !!r?.warning); } catch (e) { toast(e.message, true); } reload(); };

  const addUser = () => formDialog({
    title: 'Add a person', submitLabel: 'Create account',
    intro: 'Creates their sign-in and sets their role. Give them the email and password yourself; they can sign in right away.',
    fields: [
      { label: 'Email address', name: 'email', type: 'email', required: true },
      { label: 'Name', name: 'displayName' },
      { label: 'Role', name: 'role', type: 'select', blank: false, options: ROLES, value: 'user', hint: 'Employee can work with records. User has their own profile only.' },
      { label: 'Temporary password (at least 10 characters)', name: 'password', type: 'text', required: true, generate: true, max: 72 },
    ],
    submit: async (v) => { const r = await api.request('POST', 'admin/users', v); if (r.warning) toast(r.warning, true); else toast('Account created'); },
  }).then((saved) => saved && reload());

  const setPassword = (u) => formDialog({
    title: `Set a new password for ${u.email}`, submitLabel: 'Set password',
    intro: 'Replaces their current password immediately. Tell them the new one securely.',
    fields: [{ label: 'New password (at least 10 characters)', name: 'password', type: 'text', required: true, generate: true, max: 72 }],
    submit: async (v) => { await api.request('POST', `admin/users/${u.id}/password`, { password: v.password }); toast('Password updated'); },
  });

  const roleCell = (u) => {
    if (u.roleLocked) return h('span', {}, ROLE_LABEL[u.role], ' ', badge('', 'set in Netlify'));
    if (isMe(u)) return h('span', {}, ROLE_LABEL[u.role], ' ', badge('', 'you'));
    const sel = h('select', { 'aria-label': `Role for ${u.email}` }, ROLES.map(([v, l]) => h('option', { value: v, selected: v === u.role }, l)));
    sel.addEventListener('change', () => run(() => api.request('PUT', `admin/users/${u.id}`, { role: sel.value }), 'Role updated'));
    return sel;
  };

  const actions = (u) => {
    if (isMe(u)) return '—';
    const out = [];
    if (data.userManagement) out.push(h('button', { class: 'btn sm', type: 'button', onclick: () => setPassword(u) }, 'Set password'));
    if (!u.roleLocked) {
      out.push(h('button', { class: 'btn sm', type: 'button', onclick: async () => {
        const off = !u.disabled;
        if (off && !(await confirmDialog('Deactivate this account?', `${u.email} will be signed out immediately and will not be able to sign in until you reactivate them.`, 'Deactivate', true))) return;
        run(() => api.request('PUT', `admin/users/${u.id}`, { disabled: off }), off ? 'Account deactivated' : 'Account reactivated');
      } }, u.disabled ? 'Reactivate' : 'Deactivate'));
      if (data.userManagement) out.push(h('button', { class: 'btn sm danger', type: 'button', onclick: async () => {
        if (await confirmDialog('Delete this account?', `This permanently deletes the sign-in for ${u.email} and their profile. Records they created are kept. This cannot be undone. (To pause someone, use Deactivate instead.)`, 'Delete account', true)) run(() => api.request('DELETE', `admin/users/${u.id}`), 'Account deleted');
      } }, 'Delete'));
    }
    return h('div', { class: 'row-actions' }, out);
  };

  return [
    data.warning && h('div', { class: 'banner' }, data.warning),
    !data.userManagement && h('section', { class: 'card accent' }, h('h2', {}, 'Turn on full user management'),
      h('p', {}, 'Right now you can see everyone who has signed in and change roles. To also add people, set passwords and delete accounts from this page, give the site the Supabase secret key:'),
      h('ol', {},
        h('li', {}, 'Supabase → your project → Project Settings → API Keys → Secret keys → copy the key (it starts with ', h('code', {}, 'sb_secret_'), ').'),
        h('li', {}, 'Netlify → Site configuration → Environment variables → add ', h('code', {}, 'SUPABASE_SECRET_KEY'), ' with that value.'),
        h('li', {}, 'Deploys → Trigger deploy.')),
      h('p', { class: 'muted small' }, 'The key stays on the server, is never shown on any page, and is used only by this administrator-only area. Never share it or paste it into chat or email.')),
    h('section', { class: 'card' }, h('h2', {}, 'People'),
      h('div', { class: 'actions', style: 'margin-top:0;margin-bottom:.8rem' }, data.userManagement && h('button', { class: 'btn primary', type: 'button', onclick: addUser }, 'Add a person'), h('button', { class: 'btn', type: 'button', onclick: reload }, 'Refresh')),
      table([
        { label: 'Name', render: (u) => u.displayName || '—' },
        { label: 'Email', render: (u) => u.email },
        { label: 'Role', render: roleCell },
        { label: 'Status', render: (u) => (u.disabled ? badge('bad', 'Deactivated') : u.removedInSupabase ? badge('warn', 'Removed in Supabase') : u.signedInBefore ? badge('ok', 'Active') : badge('warn', 'Not signed in yet')) },
        { label: 'Last sign-in', render: (u) => when(u.lastLoginAt) },
        { label: 'Actions', render: actions },
      ], data.users, { empty: 'No one has signed in yet.' })),
    h('section', { class: 'card' }, h('h2', {}, 'What each role can do'),
      table([{ label: 'Role', render: (r) => r[0] }, { label: 'Access', render: (r) => r[1] }], [
        ['Administrator', 'Everything, including this page: people, roles, passwords, system status and the activity log.'],
        ['Employee', 'View, add and edit participants, mentors, sponsors and donors, and run reports. Cannot delete records, change settings, view the activity log or download backups.'],
        ['User', 'Sign in and edit their own profile. No access to Foundation records.'],
        ['Board password', 'The shared board sign-in keeps its original access to all records and settings. It cannot use this page.'],
      ]),
      h('p', { class: 'muted small' }, 'Anyone listed in ADMIN_EMAILS in Netlify is always an administrator and cannot be demoted here, so the Foundation cannot lock itself out. You cannot change your own role.')),
  ].filter(Boolean);
}

// ---------- Activity ----------
async function activity() {
  const rows = await api.request('GET', 'audit?limit=300');
  const box = h('div', {});
  const pick = h('select', { 'aria-label': 'Filter activity' }, FILTERS.map(([v, l]) => h('option', { value: v }, l)));
  const paint = () => {
    const kind = pick.value;
    const shown = rows.filter((r) => kind === 'all' || (ACTIONS[r.action]?.[1] || 'change') === kind);
    box.replaceChildren(table([
      { label: 'When', render: (r) => when(r.at) },
      { label: 'Who', render: (r) => r.by || '—' },
      { label: 'What', render: (r) => ACTIONS[r.action]?.[0] || r.action },
      { label: 'Detail', render: (r) => r.detail || '—' },
    ], shown, { empty: 'Nothing matches that filter.' }));
  };
  pick.addEventListener('change', paint);
  paint();
  const csv = () => download(`aimsir-activity-${today()}.csv`, toCSV(['When', 'Who', 'What', 'Detail'], rows.map((r) => [r.at, r.by || '', ACTIONS[r.action]?.[0] || r.action, r.detail || ''])));
  return [h('section', { class: 'card' }, h('h2', {}, 'Activity log'),
    h('p', { class: 'muted small' }, 'The most recent 300 events. Records are identified by ID only, never by name. A burst of failed sign-ins can mean someone is guessing passwords.'),
    h('div', { class: 'actions', style: 'margin-top:0;margin-bottom:.8rem' }, pick, h('button', { class: 'btn', type: 'button', onclick: () => select('activity') }, 'Refresh'), h('button', { class: 'btn', type: 'button', onclick: csv }, 'Download as CSV')),
    box)];
}

// ---------- Page shell ----------
const VIEWS = { overview, users, activity };
const TABS = [['overview', 'Overview'], ['users', 'People & roles'], ['activity', 'Activity']];
let body;
let bar;
let current = 'overview';

async function select(id) {
  current = id;
  for (const b of bar.children) b.setAttribute('aria-selected', String(b.dataset.tab === id));
  body.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
  try { body.replaceChildren(...(await VIEWS[id]())); } catch (e) { body.replaceChildren(h('div', { class: 'banner err' }, e.message || 'Could not load this section.')); }
}

export async function render(root) {
  body = h('div', {});
  bar = h('div', { class: 'tabbar', role: 'tablist' }, TABS.map(([id, label]) => h('button', { class: 'btn sm', type: 'button', role: 'tab', 'data-tab': id, 'aria-selected': String(id === current), onclick: () => select(id) }, label)));
  mount(root, pageHead('Administration'), bar, body);
  await select(current);
}
