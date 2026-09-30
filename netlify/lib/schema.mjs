// Server-side validation: only whitelisted fields are ever stored.
export const COLLECTIONS = ['participants', 'mentors', 'sponsors'];

export const ENUMS = {
  enrollmentStatus: ['Inquiry', 'Applicant', 'Enrolled', 'On Hold', 'Completed', 'Withdrawn'],
  scholarshipStatus: ['None', 'Applied', 'Awarded', 'Disbursed', 'Declined'],
  mentorStatus: ['Active', 'On Leave', 'Inactive'],
  sponsorType: ['Individual', 'Corporate', 'Foundation', 'Other'],
  sponsorStatus: ['Prospect', 'Active', 'Lapsed'],
  contactMethod: ['Phone', 'Email', 'Text', 'In person', 'Video', 'Other'],
  contributionKind: ['Cash', 'Pledge', 'In-kind', 'Grant'],
};

const str = (max = 200) => ({ t: 'str', max });
const text = () => ({ t: 'str', max: 4000 });
const date = () => ({ t: 'date' });
const bool = () => ({ t: 'bool' });
const num = () => ({ t: 'num' });
const oneOf = (list, dflt) => ({ t: 'enum', list, dflt });

const contactLog = {
  t: 'array',
  max: 500,
  of: { date: date(), method: oneOf(ENUMS.contactMethod, 'Other'), summary: text() },
};

export const SCHEMAS = {
  participants: {
    required: ['firstName', 'lastName'],
    fields: {
      firstName: str(), lastName: str(), dob: date(),
      email: str(254), phone: str(40), city: str(), state: str(40), zip: str(10),
      guardianName: str(), guardianRelationship: str(), guardianPhone: str(40), guardianEmail: str(254),
      guardianConsent: bool(),
      enrollmentStatus: oneOf(ENUMS.enrollmentStatus, 'Inquiry'),
      programStage: str(80), enrollmentDate: date(), mentorId: str(64),
      scholarshipStatus: oneOf(ENUMS.scholarshipStatus, 'None'),
      scholarshipName: str(), scholarshipAmount: num(), scholarshipNotes: text(),
      notes: text(),
    },
  },
  mentors: {
    required: ['name'],
    fields: {
      name: str(), email: str(254), phone: str(40),
      status: oneOf(ENUMS.mentorStatus, 'Active'),
      availability: text(), maxMentees: num(), background: text(), notes: text(),
      contactLog,
    },
  },
  sponsors: {
    required: ['name'],
    fields: {
      name: str(), type: oneOf(ENUMS.sponsorType, 'Individual'),
      status: oneOf(ENUMS.sponsorStatus, 'Prospect'),
      contactName: str(), email: str(254), phone: str(40), address: text(),
      nextFollowUp: date(), renewalDate: date(), notes: text(),
      contributions: {
        t: 'array', max: 1000,
        of: {
          date: date(), amount: num(), kind: oneOf(ENUMS.contributionKind, 'Cash'),
          designation: str(), notes: text(), acknowledged: bool(),
        },
      },
      contactLog,
    },
  },
};

export class ValidationError extends Error {}

function clean(def, v, path) {
  switch (def.t) {
    case 'str': {
      const s = v == null ? '' : String(v).trim();
      if (s.length > def.max) throw new ValidationError(`${path} is too long`);
      return s;
    }
    case 'date': {
      const s = v == null ? '' : String(v).trim();
      if (s && (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s)))) throw new ValidationError(`${path} must be a valid date`);
      return s;
    }
    case 'bool': return v === true;
    case 'num': {
      if (v === '' || v == null) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1e10) throw new ValidationError(`${path} must be a non-negative number`);
      return n;
    }
    case 'enum': {
      if (v == null || v === '') return def.dflt;
      if (!def.list.includes(v)) throw new ValidationError(`${path} has an unsupported value`);
      return v;
    }
    case 'array': {
      if (v == null) return [];
      if (!Array.isArray(v) || v.length > def.max) throw new ValidationError(`${path} is invalid`);
      return v.map((item, i) => {
        const out = { id: /^[\w-]{1,64}$/.test(item?.id || '') ? item.id : crypto.randomUUID() };
        for (const [k, d] of Object.entries(def.of)) out[k] = clean(d, item?.[k], `${path}[${i}].${k}`);
        return out;
      });
    }
  }
}

export function sanitize(collection, body) {
  const schema = SCHEMAS[collection];
  if (!body || typeof body !== 'object') throw new ValidationError('Invalid request body');
  const out = {};
  for (const [k, def] of Object.entries(schema.fields)) out[k] = clean(def, body[k], k);
  for (const k of schema.required) if (!out[k]) throw new ValidationError(`${k} is required`);
  if (collection === 'participants' && isMinor(out.dob) && !out.guardianName) {
    throw new ValidationError('A parent or guardian name is required for participants under 18');
  }
  return out;
}

export function isMinor(dob, now = new Date()) {
  if (!dob) return false;
  const d = new Date(dob + 'T00:00:00');
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age < 18;
}

export const DEFAULT_SETTINGS = {
  // Editable starting values, not Foundation program facts. Change them under Settings.
  stages: ['Introduction', 'Foundations', 'Development', 'Advanced', 'Program Complete'],
};

export function sanitizeSettings(body) {
  const list = Array.isArray(body?.stages) ? body.stages.map((s) => String(s).trim()).filter(Boolean) : [];
  if (!list.length || list.length > 20 || list.some((s) => s.length > 80)) throw new ValidationError('Provide between 1 and 20 stage names (80 characters max each)');
  return { stages: [...new Set(list)] };
}
