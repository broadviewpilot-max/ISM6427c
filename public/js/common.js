import { h, field, readForm, fmtDate, today, toast } from './ui.js';
import { api } from './api.js';
import { dateNote } from './external.js';

export const ENUMS = {
  enrollmentStatus: ['Inquiry', 'Applicant', 'Enrolled', 'On Hold', 'Completed', 'Withdrawn'],
  scholarshipStatus: ['None', 'Applied', 'Awarded', 'Disbursed', 'Declined'],
  mentorStatus: ['Active', 'On Leave', 'Inactive'],
  sponsorType: ['Individual', 'Corporate', 'Foundation', 'Other'],
  sponsorStatus: ['Prospect', 'Active', 'Lapsed'],
  contactMethod: ['Phone', 'Email', 'Text', 'In person', 'Video', 'Other'],
  contributionKind: ['Cash', 'Pledge', 'In-kind', 'Grant'],
};

export const pageHead = (title, ...actions) => h('div', { class: 'page-head' }, h('h1', {}, title), h('span', { class: 'spacer' }), ...actions);
export const backLink = (href, label) => h('p', {}, h('a', { href }, '← ' + label));

// A date input that shows a weekend/US-holiday note under it (Nager.Date, keyless).
export function dateField(f) {
  const el = field({ ...f, type: 'date' });
  const input = el.querySelector('input');
  const note = h('span', { class: 'hint' });
  el.append(note);
  const update = async () => { note.textContent = await dateNote(input.value); };
  input.addEventListener('change', update);
  update();
  return el;
}

// Shared contact-history card for mentors and sponsors. Saves straight to the record.
export function contactLogCard(collection, getRec, setRec) {
  const card = h('section', { class: 'card' });
  const draw = () => {
    const rec = getRec();
    const log = [...rec.contactLog].sort((a, b) => b.date.localeCompare(a.date));
    const form = h('form', { class: 'inline-form no-print' },
      field({ label: 'Date', name: 'date', type: 'date', value: today(), required: true }),
      field({ label: 'Method', name: 'method', type: 'select', options: ENUMS.contactMethod, value: 'Phone', blank: false }),
      field({ label: 'Summary', name: 'summary', type: 'text', max: 4000, required: true, placeholder: 'What was discussed or agreed' }),
      h('button', { class: 'btn primary', type: 'submit' }, 'Add entry'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        setRec(await api.save(collection, { ...rec, contactLog: [...rec.contactLog, readForm(form)] }));
        toast('Contact entry added');
        draw();
      } catch (err) { toast(err.message, true); }
    });
    card.replaceChildren(
      h('h2', {}, 'Contact history'), form,
      log.length
        ? h('ul', { class: 'log' }, log.map((c) => h('li', {},
            h('strong', {}, fmtDate(c.date)), ' · ', c.method, h('br'), c.summary, ' ',
            h('button', { class: 'btn ghost sm no-print', type: 'button', 'aria-label': 'Remove entry', onclick: async () => {
              try { setRec(await api.save(collection, { ...rec, contactLog: rec.contactLog.filter((x) => x.id !== c.id) })); draw(); } catch (err) { toast(err.message, true); }
            } }, 'Remove'))))
        : h('div', { class: 'empty' }, 'No contact recorded yet.'));
  };
  draw();
  return card;
}

export const lastContact = (rec) => rec.contactLog?.length ? rec.contactLog.map((c) => c.date).sort().at(-1) : '';
