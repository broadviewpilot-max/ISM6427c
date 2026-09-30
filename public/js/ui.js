// Small DOM helpers. All content is built with textContent, never innerHTML,
// so record data can never be interpreted as markup.
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const money = (n) => (n == null || n === '' ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n));
export const fmtDate = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
export const today = () => new Date().toLocaleDateString('en-CA');
export const daysFrom = (d) => Math.round((new Date(d + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 86400000);
export const fullName = (p) => `${p.firstName} ${p.lastName}`.trim();
export function isMinor(dob) {
  if (!dob) return false;
  const d = new Date(dob + 'T00:00:00'), n = new Date();
  let age = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) age--;
  return age < 18;
}

const STATUS_TONE = { Enrolled: 'ok', Active: 'ok', Completed: 'ok', Awarded: 'ok', Disbursed: 'ok', 'On Hold': 'warn', 'On Leave': 'warn', Applicant: 'warn', Applied: 'warn', Prospect: 'warn', Withdrawn: 'bad', Inactive: 'bad', Lapsed: 'bad', Declined: 'bad' };
export const badge = (text) => h('span', { class: 'badge ' + (STATUS_TONE[text] || '') }, text);

let toastTimer;
export function toast(msg, isErr) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast' + (isErr ? ' err' : ''), role: 'status' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), isErr ? 6000 : 3000);
}

export function confirmDialog(title, message, confirmLabel = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    const dlg = h('dialog', {},
      h('h2', {}, title), h('p', {}, message),
      h('div', { class: 'actions' },
        h('button', { class: 'btn' + (danger ? ' danger' : ' primary'), onclick: () => { dlg.close('ok'); } }, confirmLabel),
        h('button', { class: 'btn', onclick: () => dlg.close('cancel') }, 'Cancel')));
    dlg.addEventListener('close', () => { resolve(dlg.returnValue === 'ok'); dlg.remove(); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

// field({label, name, type, value, options, required, hint, wide})
export function field(f) {
  const id = 'f-' + f.name;
  let input;
  if (f.type === 'select') {
    input = h('select', { id, name: f.name, required: f.required }, (f.blank !== false ? [h('option', { value: '' }, f.blank || '—')] : []),
      f.options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: v === f.value }, l); }));
  } else if (f.type === 'textarea') {
    input = h('textarea', { id, name: f.name, maxlength: 4000 }, f.value || '');
  } else if (f.type === 'checkbox') {
    input = h('input', { id, name: f.name, type: 'checkbox', checked: !!f.value });
    return h('div', { class: 'field check' + (f.wide ? ' wide' : '') }, input, h('label', { for: id }, f.label), f.hint && h('span', { class: 'hint' }, f.hint));
  } else {
    input = h('input', { id, name: f.name, type: f.type || 'text', value: f.value ?? '', required: f.required, maxlength: f.max || 200, step: f.type === 'number' ? '0.01' : null, min: f.type === 'number' ? '0' : null, autocomplete: 'off', inputmode: f.inputmode, placeholder: f.placeholder });
  }
  return h('div', { class: 'field' + (f.wide ? ' wide' : '') }, h('label', { for: id }, f.label + (f.required ? ' *' : '')), input, f.hint && h('span', { class: 'hint', id: id + '-hint' }, f.hint));
}

export function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return out;
}

export function table(cols, rows, { onRow, empty = 'Nothing to show yet.', foot } = {}) {
  if (!rows.length) return h('div', { class: 'empty' }, empty);
  return h('div', { class: 'table-wrap' }, h('table', { class: 'stack' },
    h('thead', {}, h('tr', {}, cols.map((c) => h('th', { class: c.num ? 'num' : '' }, c.label)))),
    h('tbody', {}, rows.map((r) => h('tr', onRow ? { class: 'link', tabindex: 0, onclick: () => onRow(r), onkeydown: (e) => { if (e.key === 'Enter') onRow(r); } } : {},
      cols.map((c) => h('td', { class: c.num ? 'num' : '', 'data-label': c.label }, c.render(r)))))),
    foot && h('tfoot', {}, h('tr', {}, foot.map((cell, i) => h('td', { class: cols[i]?.num ? 'num' : '', 'data-label': cols[i]?.label || '' }, cell))))));
}

export function bars(items, fmt = String) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return h('div', { class: 'empty' }, 'No data yet.');
  return h('div', { class: 'bars' }, items.map((i) => {
    const fill = h('span');
    fill.style.width = `${Math.round((i.value / max) * 100)}%`;
    return h('div', { class: 'bar-row' }, h('span', {}, i.label), h('div', { class: 'bar', role: 'img', 'aria-label': `${i.label}: ${fmt(i.value)}` }, fill), h('strong', {}, fmt(i.value)));
  }));
}

// CSV export with spreadsheet-formula neutralisation.
export function toCSV(headers, rows) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}
export function download(filename, text, type = 'text/csv') {
  const a = h('a', { href: URL.createObjectURL(new Blob(['﻿' + text], { type: type + ';charset=utf-8' })), download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Replace a container's content, flattening arrays and skipping null/false.
export function mount(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
}
