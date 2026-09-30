import { mount, h, field, readForm, table, badge, fullName, isMinor, fmtDate, money, toast, confirmDialog } from './ui.js';
import { api } from './api.js';
import { ENUMS, pageHead, backLink, dateField } from './common.js';
import { lookupZip } from './external.js';

export async function list(root) {
  const [people, mentors, settings] = await Promise.all([api.list('participants'), api.list('mentors'), api.settings()]);
  const mentorName = (id) => mentors.find((m) => m.id === id)?.name || '';
  const q = h('input', { type: 'search', placeholder: 'Search name, email, phone…', 'aria-label': 'Search participants' });
  const sel = (label, opts) => h('select', { 'aria-label': label }, h('option', { value: '' }, label), opts.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v }, l); }));
  const fStatus = sel('All statuses', ENUMS.enrollmentStatus);
  const fStage = sel('All stages', settings.stages);
  const fMentor = sel('All mentors', [['__none', 'No mentor assigned'], ...mentors.map((m) => [m.id, m.name])]);
  const out = h('div');
  const draw = () => {
    const t = q.value.toLowerCase();
    const rows = people.filter((p) =>
      (!t || [fullName(p), p.email, p.phone, p.guardianName].join(' ').toLowerCase().includes(t)) &&
      (!fStatus.value || p.enrollmentStatus === fStatus.value) && (!fStage.value || p.programStage === fStage.value) &&
      (!fMentor.value || (fMentor.value === '__none' ? !p.mentorId : p.mentorId === fMentor.value)))
      .sort((a, b) => fullName(a).localeCompare(fullName(b)));
    out.replaceChildren(h('p', { class: 'muted small' }, `${rows.length} of ${people.length} participants`),
      table([
        { label: 'Name', render: (p) => [fullName(p), ' ', isMinor(p.dob) && badge('Minor')] },
        { label: 'Status', render: (p) => badge(p.enrollmentStatus) },
        { label: 'Stage', render: (p) => p.programStage || '—' },
        { label: 'Mentor', render: (p) => mentorName(p.mentorId) || '—' },
        { label: 'Scholarship', render: (p) => p.scholarshipStatus === 'None' ? '—' : `${p.scholarshipStatus}${p.scholarshipAmount ? ' · ' + money(p.scholarshipAmount) : ''}` },
        { label: 'Contact', render: (p) => (isMinor(p.dob) ? p.guardianPhone || p.guardianEmail : p.phone || p.email) || '—' },
      ], rows, { onRow: (p) => (location.hash = '#/participants/' + p.id), empty: people.length ? 'No participants match these filters.' : 'No participants yet. Select “Add participant” to enter the first record.' }));
  };
  [q, fStatus, fStage, fMentor].forEach((el) => el.addEventListener('input', draw));
  mount(root, pageHead('Participants', h('a', { class: 'btn primary', href: '#/participants/new' }, '+ Add participant')),
    h('div', { class: 'toolbar' }, q, fStatus, fStage, fMentor), out);
  draw();
}

export async function edit(root, id) {
  const [mentors, settings] = await Promise.all([api.list('mentors'), api.settings()]);
  let rec = id === 'new' ? { enrollmentStatus: 'Inquiry', scholarshipStatus: 'None' } : (await api.list('participants', true)).find((p) => p.id === id);
  if (!rec) { mount(root, backLink('#/participants', 'Participants'), h('div', { class: 'empty' }, 'That participant was not found.')); return; }
  const stages = [...new Set([...settings.stages, rec.programStage].filter(Boolean))];
  const mentorOpts = mentors.filter((m) => m.status === 'Active' || m.id === rec.mentorId).map((m) => [m.id, m.name + (m.status !== 'Active' ? ` (${m.status})` : '')]);

  const guardian = h('section', { class: 'card accent' },
    h('h2', {}, 'Parent / guardian'),
    h('p', { class: 'muted small' }, 'Required for participants under 18. Use the guardian’s contact details for all communication with a minor.'),
    h('div', { class: 'form-grid' },
      field({ label: 'Guardian name', name: 'guardianName', value: rec.guardianName }),
      field({ label: 'Relationship', name: 'guardianRelationship', value: rec.guardianRelationship }),
      field({ label: 'Guardian phone', name: 'guardianPhone', type: 'tel', value: rec.guardianPhone, max: 40 }),
      field({ label: 'Guardian email', name: 'guardianEmail', type: 'email', value: rec.guardianEmail, max: 254 }),
      field({ label: 'Guardian consent for participation is on file', name: 'guardianConsent', type: 'checkbox', value: rec.guardianConsent, wide: true })));

  const dob = dateField({ label: 'Date of birth', name: 'dob', value: rec.dob });
  const zip = field({ label: 'ZIP code', name: 'zip', value: rec.zip, max: 10, hint: 'City and state fill in automatically for US ZIP codes.' });
  const city = field({ label: 'City', name: 'city', value: rec.city });
  const state = field({ label: 'State', name: 'state', value: rec.state, max: 40 });
  const form = h('form', {},
    h('section', { class: 'card' }, h('h2', {}, 'Participant'),
      h('div', { class: 'form-grid' },
        field({ label: 'First name', name: 'firstName', value: rec.firstName, required: true }),
        field({ label: 'Last name', name: 'lastName', value: rec.lastName, required: true }),
        dob,
        field({ label: 'Email', name: 'email', type: 'email', value: rec.email, max: 254 }),
        field({ label: 'Phone', name: 'phone', type: 'tel', value: rec.phone, max: 40 }),
        zip, city, state)),
    guardian,
    h('section', { class: 'card' }, h('h2', {}, 'Program'),
      h('div', { class: 'form-grid' },
        field({ label: 'Enrollment status', name: 'enrollmentStatus', type: 'select', options: ENUMS.enrollmentStatus, value: rec.enrollmentStatus, blank: false }),
        field({ label: 'Program stage', name: 'programStage', type: 'select', options: stages, value: rec.programStage, hint: 'Stage names are managed under Settings.' }),
        dateField({ label: 'Enrollment date', name: 'enrollmentDate', value: rec.enrollmentDate }),
        field({ label: 'Assigned mentor', name: 'mentorId', type: 'select', options: mentorOpts, value: rec.mentorId, blank: 'No mentor assigned' }))),
    h('section', { class: 'card' }, h('h2', {}, 'Scholarship'),
      h('div', { class: 'form-grid' },
        field({ label: 'Scholarship status', name: 'scholarshipStatus', type: 'select', options: ENUMS.scholarshipStatus, value: rec.scholarshipStatus, blank: false }),
        field({ label: 'Scholarship / award name', name: 'scholarshipName', value: rec.scholarshipName }),
        field({ label: 'Amount (USD)', name: 'scholarshipAmount', type: 'number', value: rec.scholarshipAmount, inputmode: 'decimal' }),
        field({ label: 'Scholarship notes', name: 'scholarshipNotes', type: 'textarea', value: rec.scholarshipNotes, wide: true }))),
    h('section', { class: 'card' }, h('h2', {}, 'Notes'),
      h('p', { class: 'muted small' }, 'Keep notes factual and limited to what the program needs. Do not record government ID numbers, financial account details or medical information.'),
      field({ label: 'Notes', name: 'notes', type: 'textarea', value: rec.notes, wide: true })),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Save participant'),
      h('a', { class: 'btn', href: '#/participants' }, 'Cancel'),
      rec.id && h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        if (!(await confirmDialog('Delete participant?', `This permanently removes ${fullName(rec)} and cannot be undone.`, 'Delete', true))) return;
        try { await api.remove('participants', rec.id); toast('Participant deleted'); location.hash = '#/participants'; } catch (e) { toast(e.message, true); }
      } }, 'Delete')));

  const syncGuardian = () => { guardian.hidden = !isMinor(form.dob.value) && !form.guardianName.value; };
  form.dob.addEventListener('input', syncGuardian);
  syncGuardian();
  form.zip.addEventListener('blur', async () => {
    const hit = await lookupZip(form.zip.value.trim());
    if (hit) { if (!form.city.value) form.city.value = hit.city; if (!form.state.value) form.state.value = hit.state; }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = readForm(form);
    if (isMinor(data.dob) && !data.guardianName.trim()) { guardian.hidden = false; form.guardianName.focus(); toast('A parent or guardian name is required for participants under 18.', true); return; }
    try {
      rec = await api.save('participants', { ...data, id: rec.id, updatedAt: rec.updatedAt });
      toast('Participant saved');
      location.hash = '#/participants';
    } catch (err) { toast(err.message, true); }
  });
  mount(root, backLink('#/participants', 'Participants'), pageHead(rec.id ? fullName(rec) : 'New participant', rec.id && isMinor(rec.dob) && badge('Minor')),
    rec.id && rec.createdAt ? h('p', { class: 'muted small' }, 'Added ' + fmtDate(rec.createdAt.slice(0, 10))) : null, form);
}
