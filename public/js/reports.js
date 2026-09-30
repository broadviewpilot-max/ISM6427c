import { mount, h, field, table, bars, badge, money, fmtDate, daysFrom, today, fullName, isMinor, toCSV, download, confirmDialog, toast } from './ui.js';
import { api } from './api.js';
import { ENUMS, pageHead, lastContact } from './common.js';
import { total } from './sponsors.js';

const countBy = (arr, key, order = []) => {
  const m = new Map();
  for (const x of arr) m.set(key(x) || 'Unspecified', (m.get(key(x) || 'Unspecified') || 0) + 1);
  const rows = [...m].map(([label, value]) => ({ label, value }));
  return rows.sort((a, b) => (order.indexOf(a.label) + 99 * (order.indexOf(a.label) < 0)) - (order.indexOf(b.label) + 99 * (order.indexOf(b.label) < 0)) || b.value - a.value);
};
const stat = (n, l) => h('div', { class: 'stat' }, h('div', { class: 'n' }, n), h('div', { class: 'l' }, l));
const section = (title, ...kids) => h('section', { class: 'card' }, h('h2', {}, title), ...kids);

export async function render(root) {
  const [people, mentors, sponsors, settings] = await Promise.all([api.list('participants', true), api.list('mentors', true), api.list('sponsors', true), api.settings()]);
  const year = new Date().getFullYear();
  const from = h('input', { type: 'date', id: 'from', value: `${year}-01-01`, 'aria-label': 'Giving period start' });
  const to = h('input', { type: 'date', id: 'to', value: today(), 'aria-label': 'Giving period end' });
  const out = h('div');
  const mentorName = (id) => mentors.find((m) => m.id === id)?.name || '';
  const activeMentee = (p) => ['Enrolled', 'On Hold', 'Applicant'].includes(p.enrollmentStatus);

  const gifts = () => sponsors.flatMap((s) => s.contributions.map((c) => ({ ...c, sponsor: s.name, sponsorId: s.id }))).filter((c) => c.date >= from.value && c.date <= to.value);
  const received = () => gifts().filter((c) => c.kind !== 'Pledge');

  function draw() {
    const minors = people.filter((p) => isMinor(p.dob));
    const enrolled = people.filter((p) => p.enrollmentStatus === 'Enrolled');
    const awarded = people.filter((p) => ['Awarded', 'Disbursed'].includes(p.scholarshipStatus));
    const rc = received();
    const soon = sponsors.flatMap((s) => [['Follow-up', s.nextFollowUp], ['Renewal', s.renewalDate]].filter(([, d]) => d && daysFrom(d) <= 60).map(([kind, d]) => ({ s, kind, d }))).sort((a, b) => a.d.localeCompare(b.d));
    const byDesignation = countBy(rc, (c) => c.designation).map((r) => ({ label: r.label, value: rc.filter((c) => (c.designation || 'Unspecified') === r.label).reduce((n, c) => n + (c.amount || 0), 0) }));
    const byKind = ENUMS.contributionKind.map((k) => ({ label: k, value: gifts().filter((c) => c.kind === k).reduce((n, c) => n + (c.amount || 0), 0) })).filter((r) => r.value);

    out.replaceChildren(
      section('Participants',
        h('div', { class: 'grid' }, stat(people.length, 'Total participants'), stat(enrolled.length, 'Currently enrolled'), stat(minors.length, 'Under 18'),
          stat(people.filter((p) => activeMentee(p) && !p.mentorId).length, 'Active without a mentor')),
        h('div', { class: 'grid', style: 'margin-top:1rem' },
          h('div', {}, h('h3', {}, 'By enrollment status'), bars(countBy(people, (p) => p.enrollmentStatus, ENUMS.enrollmentStatus))),
          h('div', {}, h('h3', {}, 'By program stage'), bars(countBy(people, (p) => p.programStage, settings.stages))),
          h('div', {}, h('h3', {}, 'By scholarship status'), bars(countBy(people, (p) => p.scholarshipStatus, ENUMS.scholarshipStatus)))),
        h('div', { class: 'grid', style: 'margin-top:1rem' },
          stat(money(awarded.reduce((n, p) => n + (p.scholarshipAmount || 0), 0)), `Scholarships awarded or disbursed (${awarded.length})`),
          stat(money(people.filter((p) => p.scholarshipStatus === 'Disbursed').reduce((n, p) => n + (p.scholarshipAmount || 0), 0)), 'Scholarships disbursed'),
          stat(minors.filter((p) => !p.guardianConsent).length, 'Minors without guardian consent on file'))),
      section('Mentors',
        h('div', { class: 'grid' }, stat(mentors.filter((m) => m.status === 'Active').length, 'Active mentors'),
          stat(people.filter((p) => p.mentorId && activeMentee(p)).length, 'Active pairings'),
          stat(mentors.filter((m) => m.status === 'Active').reduce((n, m) => n + (m.maxMentees || 0), 0) || '—', 'Declared capacity (active mentors)')),
        table([
          { label: 'Mentor', render: (m) => m.name }, { label: 'Status', render: (m) => badge(m.status) },
          { label: 'Mentees', render: (m) => String(people.filter((p) => p.mentorId === m.id && activeMentee(p)).length) + (m.maxMentees ? ` of ${m.maxMentees}` : '') },
          { label: 'Last contact', render: (m) => { const l = lastContact(m); return l ? [fmtDate(l), ' ', daysFrom(l) < -90 && m.status === 'Active' ? h('span', { class: 'badge warn' }, '90+ days') : null] : 'None recorded'; } },
        ], [...mentors].sort((a, b) => a.name.localeCompare(b.name)), { empty: 'No mentors recorded yet.' })),
      section(`Giving, ${fmtDate(from.value)} to ${fmtDate(to.value)}`,
        h('div', { class: 'grid' }, stat(money(rc.reduce((n, c) => n + (c.amount || 0), 0)), 'Received'), stat(rc.length, 'Contributions received'),
          stat(money(gifts().filter((c) => c.kind === 'Pledge').reduce((n, c) => n + (c.amount || 0), 0)), 'Pledged (not yet received)'),
          stat(rc.filter((c) => !c.acknowledged).length, 'Received, not yet acknowledged')),
        h('div', { class: 'grid', style: 'margin-top:1rem' },
          h('div', {}, h('h3', {}, 'By type'), bars(byKind, money)), h('div', {}, h('h3', {}, 'Received by designation'), bars(byDesignation, money))),
        h('h3', { style: 'margin-top:1rem' }, 'By sponsor / donor'),
        table([{ label: 'Sponsor / donor', render: (r) => r.name }, { label: 'Status', render: (r) => badge(r.status) }, { label: 'Received in period', num: true, render: (r) => money(r.amt) }],
          sponsors.map((s) => ({ name: s.name, status: s.status, amt: total(s, from.value, to.value) })).filter((r) => r.amt).sort((a, b) => b.amt - a.amt), { empty: 'No contributions received in this period.' })),
      section('Follow-ups and renewals due within 60 days',
        table([{ label: 'Sponsor / donor', render: (r) => r.s.name }, { label: 'Type', render: (r) => r.kind }, { label: 'Date', render: (r) => fmtDate(r.d) },
          { label: 'Timing', render: (r) => (daysFrom(r.d) < 0 ? h('span', { class: 'badge bad' }, `${-daysFrom(r.d)} days overdue`) : `In ${daysFrom(r.d)} days`) }],
          soon, { onRow: (r) => (location.hash = '#/sponsors/' + r.s.id), empty: 'Nothing due in the next 60 days.' })));
  }
  [from, to].forEach((el) => el.addEventListener('change', draw));

  async function exportCSV(name, headers, rows, personal) {
    if (personal && !(await confirmDialog('Export personal information?', 'This file contains personal information, which may include minors. Store it only in secure locations, share it only with people who need it, and delete it when finished. This export will be recorded in the activity log.', 'Download', false))) return;
    download(`aimsir-${name}-${today()}.csv`, toCSV(headers, rows));
    api.logExport(name);
    toast('Export downloaded');
  }
  const exports = h('div', { class: 'no-print' },
    h('div', { class: 'actions', style: 'margin-top:0' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => window.print() }, 'Print / save as PDF'),
      h('button', { class: 'btn', type: 'button', onclick: () => exportCSV('summary', ['Section', 'Measure', 'Value'], [
        ...countBy(people, (p) => p.enrollmentStatus).map((r) => ['Participants by status', r.label, r.value]),
        ...countBy(people, (p) => p.programStage).map((r) => ['Participants by stage', r.label, r.value]),
        ['Participants', 'Under 18', people.filter((p) => isMinor(p.dob)).length],
        ['Mentors', 'Active mentors', mentors.filter((m) => m.status === 'Active').length],
        ['Giving (selected period)', 'Received (USD)', received().reduce((n, c) => n + (c.amount || 0), 0)],
        ['Giving (selected period)', 'Contributions received', received().length],
      ], false) }, 'Summary CSV (no personal details)')),
    h('details', {}, h('summary', { class: 'small muted' }, 'Detailed exports (contain personal information)'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => exportCSV('participants', ['First name', 'Last name', 'Date of birth', 'Under 18', 'Email', 'Phone', 'City', 'State', 'ZIP', 'Guardian', 'Guardian phone', 'Guardian email', 'Guardian consent', 'Status', 'Stage', 'Enrollment date', 'Mentor', 'Scholarship status', 'Scholarship', 'Scholarship amount'],
          people.map((p) => [p.firstName, p.lastName, p.dob, isMinor(p.dob) ? 'Yes' : 'No', p.email, p.phone, p.city, p.state, p.zip, p.guardianName, p.guardianPhone, p.guardianEmail, p.guardianConsent ? 'Yes' : 'No', p.enrollmentStatus, p.programStage, p.enrollmentDate, mentorName(p.mentorId), p.scholarshipStatus, p.scholarshipName, p.scholarshipAmount]), true) }, 'Participants'),
        h('button', { class: 'btn', type: 'button', onclick: () => exportCSV('mentors', ['Name', 'Status', 'Email', 'Phone', 'Max mentees', 'Active mentees', 'Availability', 'Last contact'],
          mentors.map((m) => [m.name, m.status, m.email, m.phone, m.maxMentees, people.filter((p) => p.mentorId === m.id && activeMentee(p)).length, m.availability, lastContact(m)]), true) }, 'Mentors'),
        h('button', { class: 'btn', type: 'button', onclick: () => exportCSV('sponsors', ['Name', 'Type', 'Status', 'Contact', 'Email', 'Phone', 'Next follow-up', 'Renewal', 'Received to date'],
          sponsors.map((s) => [s.name, s.type, s.status, s.contactName, s.email, s.phone, s.nextFollowUp, s.renewalDate, total(s)]), true) }, 'Sponsors & donors'),
        h('button', { class: 'btn', type: 'button', onclick: () => exportCSV('contributions', ['Sponsor / donor', 'Date', 'Type', 'Amount', 'Designation', 'Acknowledged'],
          gifts().map((c) => [c.sponsor, c.date, c.kind, c.amount, c.designation, c.acknowledged ? 'Yes' : 'No']), true) }, 'Contributions (selected period)'))));

  mount(root, pageHead('Reporting'),
    h('p', { class: 'muted' }, 'Generated on demand from current records. Generated ' + new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) + '.'),
    h('div', { class: 'card no-print' }, h('h2', {}, 'Giving period'), h('div', { class: 'form-grid' }, h('div', { class: 'field' }, h('label', { for: 'from' }, 'From'), from), h('div', { class: 'field' }, h('label', { for: 'to' }, 'To'), to))),
    exports, out);
  draw();
}
