import { mount, h, field, readForm, table, badge, fmtDate, money, toast, confirmDialog, daysFrom, today } from './ui.js';
import { api } from './api.js';
import { ENUMS, pageHead, backLink, dateField, contactLogCard, lastContact } from './common.js';

export const total = (s, from = '', to = '9999-12-31') => s.contributions.filter((c) => c.kind !== 'Pledge' && c.date >= from && c.date <= to).reduce((n, c) => n + (c.amount || 0), 0);

function dueBadge(date) {
  if (!date) return '—';
  const d = daysFrom(date);
  return [fmtDate(date), ' ', d < 0 ? h('span', { class: 'badge bad' }, 'Overdue') : d <= 30 ? h('span', { class: 'badge warn' }, `In ${d} d`) : null];
}

export async function list(root) {
  const sponsors = await api.list('sponsors');
  const q = h('input', { type: 'search', placeholder: 'Search sponsors and donors…', 'aria-label': 'Search sponsors' });
  const sel = (label, opts) => h('select', { 'aria-label': label }, h('option', { value: '' }, label), opts.map((o) => h('option', { value: o }, o)));
  const fStatus = sel('All statuses', ENUMS.sponsorStatus), fType = sel('All types', ENUMS.sponsorType);
  const out = h('div');
  const draw = () => {
    const t = q.value.toLowerCase();
    const rows = sponsors.filter((s) => (!t || [s.name, s.contactName, s.email].join(' ').toLowerCase().includes(t)) && (!fStatus.value || s.status === fStatus.value) && (!fType.value || s.type === fType.value)).sort((a, b) => a.name.localeCompare(b.name));
    out.replaceChildren(table([
      { label: 'Name', render: (s) => s.name },
      { label: 'Type', render: (s) => s.type },
      { label: 'Status', render: (s) => badge(s.status) },
      { label: 'Given to date', num: true, render: (s) => money(total(s)) },
      { label: 'Next follow-up', render: (s) => dueBadge(s.nextFollowUp) },
      { label: 'Renewal', render: (s) => dueBadge(s.renewalDate) },
    ], rows, { onRow: (s) => (location.hash = '#/sponsors/' + s.id), empty: sponsors.length ? 'No sponsors match these filters.' : 'No sponsors or donors yet. Select “Add sponsor / donor” to enter the first record.' }));
  };
  [q, fStatus, fType].forEach((el) => el.addEventListener('input', draw));
  mount(root, pageHead('Sponsors & Donors', h('a', { class: 'btn primary', href: '#/sponsors/new' }, '+ Add sponsor / donor')), h('div', { class: 'toolbar' }, q, fStatus, fType), out);
  draw();
}

export async function edit(root, id) {
  let rec = id === 'new' ? { type: 'Individual', status: 'Prospect', contactLog: [], contributions: [] } : (await api.list('sponsors', true)).find((s) => s.id === id);
  if (!rec) { mount(root, backLink('#/sponsors', 'Sponsors & Donors'), h('div', { class: 'empty' }, 'That record was not found.')); return; }

  const form = h('form', {},
    h('section', { class: 'card' }, h('h2', {}, 'Sponsor / donor'),
      h('div', { class: 'form-grid' },
        field({ label: 'Name (person or organization)', name: 'name', value: rec.name, required: true }),
        field({ label: 'Type', name: 'type', type: 'select', options: ENUMS.sponsorType, value: rec.type, blank: false }),
        field({ label: 'Status', name: 'status', type: 'select', options: ENUMS.sponsorStatus, value: rec.status, blank: false }),
        field({ label: 'Primary contact', name: 'contactName', value: rec.contactName }),
        field({ label: 'Email', name: 'email', type: 'email', value: rec.email, max: 254 }),
        field({ label: 'Phone', name: 'phone', type: 'tel', value: rec.phone, max: 40 }),
        dateField({ label: 'Next follow-up', name: 'nextFollowUp', value: rec.nextFollowUp }),
        dateField({ label: 'Renewal date', name: 'renewalDate', value: rec.renewalDate }),
        field({ label: 'Mailing address', name: 'address', type: 'textarea', value: rec.address, wide: true }),
        field({ label: 'Notes', name: 'notes', type: 'textarea', value: rec.notes, wide: true }))),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Save'),
      h('a', { class: 'btn', href: '#/sponsors' }, 'Cancel'),
      rec.id && h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        if (!(await confirmDialog('Delete record?', `This permanently removes ${rec.name}, including contribution and contact history.`, 'Delete', true))) return;
        try { await api.remove('sponsors', rec.id); toast('Record deleted'); location.hash = '#/sponsors'; } catch (e) { toast(e.message, true); }
      } }, 'Delete')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const saved = await api.save('sponsors', { ...readForm(form), id: rec.id, updatedAt: rec.updatedAt, contactLog: rec.contactLog, contributions: rec.contributions });
      toast('Saved');
      if (rec.id) rec = saved; else location.hash = '#/sponsors/' + saved.id;
    } catch (err) { toast(err.message, true); }
  });

  const contribCard = h('section', { class: 'card' });
  const drawContribs = () => {
    const rows = [...rec.contributions].sort((a, b) => b.date.localeCompare(a.date));
    const f = h('form', { class: 'no-print' },
      h('div', { class: 'inline-form' },
        field({ label: 'Date', name: 'date', type: 'date', value: today(), required: true }),
        field({ label: 'Amount (USD)', name: 'amount', type: 'number', required: true, inputmode: 'decimal' }),
        field({ label: 'Type', name: 'kind', type: 'select', options: ENUMS.contributionKind, value: 'Cash', blank: false }),
        h('button', { class: 'btn primary', type: 'submit' }, 'Add')),
      h('div', { class: 'form-grid', style: 'margin:.75rem 0 1rem' },
        field({ label: 'Designation / purpose', name: 'designation' }), field({ label: 'Notes', name: 'notes' }),
        field({ label: 'Thank-you / receipt sent', name: 'acknowledged', type: 'checkbox' })));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { rec = await api.save('sponsors', { ...rec, contributions: [...rec.contributions, readForm(f)] }); toast('Contribution recorded'); drawContribs(); } catch (err) { toast(err.message, true); }
    });
    contribCard.replaceChildren(h('h2', {}, 'Contributions'),
      h('p', { class: 'muted small' }, 'Pledges are tracked but not counted toward totals until recorded as received.'),
      f,
      table([
        { label: 'Date', render: (c) => fmtDate(c.date) },
        { label: 'Type', render: (c) => c.kind },
        { label: 'Designation', render: (c) => c.designation || '—' },
        { label: 'Acknowledged', render: (c) => (c.acknowledged ? badge('Sent') : h('span', { class: 'badge warn' }, 'Not yet')) },
        { label: 'Amount', num: true, render: (c) => money(c.amount) },
        { label: '', render: (c) => h('button', { class: 'btn ghost sm no-print', type: 'button', onclick: async () => {
          if (!(await confirmDialog('Remove contribution?', 'This removes the entry from this record.', 'Remove', true))) return;
          try { rec = await api.save('sponsors', { ...rec, contributions: rec.contributions.filter((x) => x.id !== c.id) }); drawContribs(); } catch (err) { toast(err.message, true); }
        } }, 'Remove') },
      ], rows, { empty: 'No contributions recorded yet.', foot: rows.length ? ['Total received', '', '', '', money(total(rec)), ''] : null }));
  };
  drawContribs();

  mount(root, backLink('#/sponsors', 'Sponsors & Donors'), pageHead(rec.id ? rec.name : 'New sponsor / donor', rec.id && badge(rec.status)),
    form, rec.id ? [contribCard, contactLogCard('sponsors', () => rec, (r) => (rec = r))] : h('p', { class: 'muted' }, 'Save the record to add contributions and contact history.'));
}
