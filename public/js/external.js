// Free, keyless public APIs. Both are optional conveniences: if a request
// fails the form works exactly as before. Only a ZIP code or a year is sent;
// no participant, mentor or donor data ever leaves the Foundation's app.
//   - Zippopotam.us  https://zippopotam.us      (ZIP code -> city and state)
//   - Nager.Date     https://date.nager.at      (US public holidays)
const holidayCache = {};

export async function lookupZip(zip) {
  if (!/^\d{5}$/.test(zip)) return null;
  try {
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (!res.ok) return null;
    const p = (await res.json()).places?.[0];
    return p ? { city: p['place name'], state: p['state abbreviation'] } : null;
  } catch { return null; }
}

async function holidays(year) {
  if (!holidayCache[year]) {
    holidayCache[year] = fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/US`)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
  }
  return holidayCache[year];
}

// Returns a short note if a date falls on a weekend or US public holiday.
export async function dateNote(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const dow = new Date(iso + 'T00:00:00').getDay();
  const hol = (await holidays(iso.slice(0, 4))).find((x) => x.date === iso);
  if (hol) return `Note: this date is a US public holiday (${hol.name}).`;
  return dow === 0 || dow === 6 ? 'Note: this date falls on a weekend.' : '';
}
