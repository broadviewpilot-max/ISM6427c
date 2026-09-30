import { mount, h, field, readForm, table, badge, fullName, fmtDate, toast, confirmDialog, daysFrom } from './ui.js';
import { api } from './api.js';
import { ENUMS, pageHead, backLink, contactLogCard, lastContact } from './common.js';

export async function list(root) {
  const [mentors, people] = await Promise.all([api.list('mentors'), api.list('participants')]);
  const count = (m) => people.filter((p) => p.mentorId === m.id && ['Enrolled', 'On Hold', 'Applicant'].includes(p.enrollmentStatus)).length;
  const q = h('input', { type: 'search', placeholder: 'Search mentors…', 'aria-label': 'Search mentors' });
  const fStatus = h('select', { 'aria-label': 'Status' }, h('option', { value: '' }, 'All statuses'), ENUMS.mentorStatus.map((s) => h('option', { value: s }, s)));
  const out = h('div');
  const draw = () => {
    const t = q.value.toLowerCase();
    const rows = mentors.filter((m) => (!t || [m.name, m.email, m.phone].join(' ').toLowerCase().includes(t)) && (!fStatus.value || m.status === fStatus.value)).sort((a, b) => a.name.localeCompare(b.name));
    out.replaceChildren(table([
      { label: 'Name', render: (m) => m.name },
      { label: 'Status', render: (m) => badge(m.status) },
      { label: 'Mentees', render: (m) => (m.maxMentees ? `${count(m)} of ${m.maxMentees}` : String(count(m))) },
      { label: 'Availability', render: (m) => (m.availability ? m.availability.slice(0, 60) + (m.availability.length > 60 ? '…' : '') : '—') },
      { label: 'Last contact', render: (m) => (lastContact(m) ? fmtDate(lastContact(m)) : '—') },
    ], rows, { onRow: (m) => (location.hash = '#/mentors/' + m.id), empty: mentors.length ? 'No mentors match these filters.' : 'No mentors yet. Select “Add mentor” to enter the first record.' }));
  };
  [q, fStatus].forEach((el) => el.addEventListener('input', draw));
  mount(root, pageHead('Mentors', h('a', { class: 'btn primary', href: '#/mentors/new' }, '+ Add mentor')), h('div', { class: 'toolbar' }, q, fStatus), out);
  draw();
}

export async function edit(root, id) {
  let rec = id === 'new' ? { status: 'Active', contactLog: [] } : (await api.list('mentors', true)).find((m) => m.id === id);
  if (!rec) { mount(root, backLink('#/mentors', 'Mentors'), h('div', { class: 'empty' }, 'That mentor was not found.')); return; }
  const people = await api.list('participants');
  const mentees = people.filter((p) => p.mentorId === rec.id);

  const form = h('form', {},
    h('section', { class: 'card' }, h('h2', {}, 'Mentor'),
      h('div', { class: 'form-grid' },
        field({ label: 'Full name', name: 'name', value: rec.name, required: true }),
        field({ label: 'Status', name: 'status', type: 'select', options: ENUMS.mentorStatus, value: rec.status, blank: false }),
        field({ label: 'Email', name: 'email', type: 'email', value: rec.email, max: 254 }),
        field({ label: 'Phone', name: 'phone', type: 'tel', value: rec.phone, max: 40 }),
        field({ label: 'Maximum mentees', name: 'maxMentees', type: 'number', value: rec.maxMentees, hint: 'Leave blank if there is no set limit.' }),
        field({ label: 'Availability', name: 'availability', type: 'textarea', value: rec.availability, wide: true, hint: 'For example: days, times, time zone, seasonal limits.' }),
        field({ label: 'Background and expertise', name: 'background', type: 'textarea', value: rec.background, wide: true }),
        field({ label: 'Notes', name: 'notes', type: 'textarea', value: rec.notes, wide: true }))),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Save mentor'),
      h('a', { class: 'btn', href: '#/mentors' }, 'Cancel'),
      rec.id && h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        if (!(await confirmDialog('Delete mentor?', `This permanently removes ${rec.name}. ${mentees.length ? `${mentees.length} paired participant(s) will be left without a mentor.` : ''}`, 'Delete', true))) return;
        try { await api.remove('mentors', rec.id); toast('Mentor deleted'); location.hash = '#/mentors'; } catch (e) { toast(e.message, true); }
      } }, 'Delete')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const saved = await api.save('mentors', { ...readForm(form), id: rec.id, updatedAt: rec.updatedAt, contactLog: rec.contactLog });
      toast('Mentor saved');
      if (rec.id) rec = saved; else location.hash = '#/mentors/' + saved.id;
    } catch (err) { toast(err.message, true); }
  });

  const pairings = h('section', { class: 'card' }, h('h2', {}, 'Student pairings'),
    table([
      { label: 'Participant', render: (p) => fullName(p) },
      { label: 'Status', render: (p) => badge(p.enrollmentStatus) },
      { label: 'Stage', render: (p) => p.programStage || '—' },
    ], mentees, { onRow: (p) => (location.hash = '#/participants/' + p.id), empty: 'No participants are paired with this mentor. Assign a mentor from the participant’s record.' }));

  const quiet = rec.id && rec.status === 'Active' && (!lastContact(rec) || daysFrom(lastContact(rec)) < -90);
  mount(root, backLink('#/mentors', 'Mentors'), pageHead(rec.id ? rec.name : 'New mentor', rec.id && badge(rec.status)),
    quiet && h('div', { class: 'banner' }, lastContact(rec) ? `No contact recorded since ${fmtDate(lastContact(rec))}.` : 'No contact has been recorded with this mentor yet.'),
    form, rec.id ? [pairings, contactLogCard('mentors', () => rec, (r) => (rec = r))] : h('p', { class: 'muted' }, 'Save the mentor to add pairings and contact history.'));
}
