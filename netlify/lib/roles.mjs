// Roles and permissions. Everything the API allows is decided here, on the
// server; the pages only hide what a person cannot use anyway.
//
//   administrator  full access, plus the Administration page
//   employee       works with participant, mentor and donor records
//   user           own profile only; no access to Foundation records
//   board          the shared board password: full data access as before, no administration
export const ROLES = ['administrator', 'employee', 'user'];

export const ROLE_LABELS = { administrator: 'Administrator', employee: 'Employee', user: 'User', board: 'Board password' };
export const ROLE_INFO = {
  administrator: 'Full access, including the Administration page.',
  employee: 'Can view, add and edit participants, mentors and donors. Cannot delete records, change settings, view the activity log or download backups.',
  user: 'Can sign in and edit their own profile. No access to Foundation records.',
};

const DATA = ['data:read', 'data:write', 'data:delete', 'settings:write', 'audit:read', 'backup'];
const PERMS = {
  administrator: [...DATA, 'admin'],
  board: DATA,
  employee: ['data:read', 'data:write'],
  user: [],
};

export const permissionsFor = (role) => PERMS[role] || [];
export const can = (role, perm) => permissionsFor(role).includes(perm);

const list = (v) => String(v || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
export const adminEmails = (env) => list(env.ADMIN_EMAILS);
// Addresses named in ADMIN_EMAILS are always administrators and cannot be demoted
// from the app, so the Foundation can never lock itself out.
export const lockedAdmin = (env, email) => adminEmails(env).includes(String(email || '').toLowerCase());

export function effectiveRole(env, profile) {
  if (lockedAdmin(env, profile?.email)) return 'administrator';
  return ROLES.includes(profile?.role) ? profile.role : 'user';
}
