/**
 * access.ts: who may use the SOF Engine, and which country they work in.
 *
 *   Admins (ankitrihal@gmail.com, ankit.rihal@netcore.ai)
 *       → every SOF (master history list), deleting SOFs, and free switching between Indonesia and Philippines
 *   Any verified @netcore.ai account → the app automatically, own SOFs only (no allowlist to maintain)
 *       Philippines team (don.gonzales, yuvraj.bhattee) → locked to Philippines: 12% VAT, SOF_Template_PH.docx
 *       Indonesia team (mohd.pakzad, prathamesh.borkar) → locked to Indonesia: 11% VAT, SOF_Template_ID.docx
 *       Everyone else at Netcore → can choose either country
 *   Everyone else → signed out with "Unauthorized: Only Netcore accounts are allowed."
 *
 * Keep in sync with supabase/schema.sql (is_netcore_email, is_admin_email, has_app_access).
 * The database enforces the same rules; the app uses them to show the right screen and lock the country.
 */

const norm = (email: string | null | undefined) => (email ?? '').trim().toLowerCase();

/** Unrestricted access to all SOFs. */
export const ADMIN_EMAILS = ['ankitrihal@gmail.com', 'ankit.rihal@netcore.ai'];


/** Netcore signatory printed in the SOF signature block, by the signed-in user's email. */
export interface NetcoreSignatory { name: string; title: string }
export const NETCORE_SIGNATORIES: Record<string, NetcoreSignatory> = {
  'ankitrihal@gmail.com': { name: 'Ankit Rihal', title: 'Regional Director' },
  'ankit.rihal@netcore.ai': { name: 'Ankit Rihal', title: 'Regional Director' },
  'prathamesh.borkar@netcore.ai': { name: 'Prathamesh Borkar', title: 'Senior Account Executive' },
  'mohd.pakzad@netcore.ai': { name: 'Mohammad Pakzad', title: 'Senior Account Executive' },
  'don.gonzales@netcore.ai': { name: 'Don Gonzales', title: 'Account Executive' },
  'yuvraj.bhattee@netcore.ai': { name: 'Yuvraj Bhattee', title: 'Senior Account Executive' },
};
/** Signatory for this email, or null (block left blank to fill in by hand). */
export function getNetcoreSignatory(email: string | null | undefined): NetcoreSignatory | null {
  return NETCORE_SIGNATORIES[(email ?? '').trim().toLowerCase()] ?? null;
}

/** SOF countries: picks the Word template, entity details and VAT. */
export type Country = 'ID' | 'PH';

export const COUNTRY_VAT: Record<Country, string> = { ID: '11', PH: '12' };
export const COUNTRY_NAME: Record<Country, string> = { ID: 'Indonesia', PH: 'Philippines' };

/** Country teams: these Account Executives can only create SOFs for their own country. */
export const COUNTRY_TEAMS: Record<Country, string[]> = {
  PH: ['don.gonzales@netcore.ai', 'yuvraj.bhattee@netcore.ai'],
  ID: ['mohd.pakzad@netcore.ai', 'prathamesh.borkar@netcore.ai'],
};

/** The country this user is locked to, or null if they can choose (admins). */
export function getUserCountryLock(email: string | null | undefined): Country | null {
  const e = norm(email);
  if (ADMIN_EMAILS.includes(e)) return null;
  for (const c of Object.keys(COUNTRY_TEAMS) as Country[]) if (COUNTRY_TEAMS[c].includes(e)) return c;
  return null;
}

/** Country from the VAT dropdown value ('12' → Philippines, otherwise Indonesia). */
export const countryFromVat = (vat: string | number | null | undefined): Country => (String(vat) === '12' ? 'PH' : 'ID');

/** Company domain: any verified account here gets in automatically. */
export const NETCORE_DOMAIN = 'netcore.ai';

export const UNAUTHORIZED_MESSAGE = 'Unauthorized: Only Netcore accounts are allowed.';
export const UNVERIFIED_MESSAGE =
  'Unauthorized: Your Netcore email address is not verified. Please sign in with your verified @netcore.ai Google account.';

/** Exactly name@netcore.ai (trimmed, any case). Not subdomains like name@x.netcore.ai, not look-alikes. */
export function isNetcoreEmail(email: string | null | undefined): boolean {
  return /^[^\s@]+@netcore\.ai$/.test(norm(email));
}

export type AccessLevel = 'admin' | 'member' | 'denied';

/**
 * admin  → admins (all SOFs, delete, any country)
 * member → any other @netcore.ai account (own SOFs)
 * denied → everyone else
 * The email must also be verified; the sign-in screen checks that separately (see AuthGate).
 */
export function getAccessLevel(email: string | null | undefined): AccessLevel {
  const e = norm(email);
  if (ADMIN_EMAILS.includes(e)) return 'admin';
  if (isNetcoreEmail(e)) return 'member';
  return 'denied';
}

export const isAdminEmail = (email: string | null | undefined) => getAccessLevel(email) === 'admin';

/** Admins and Netcore accounts: may open the dashboard and read/write their SOFs. */
export const hasAppAccess = (email: string | null | undefined) => getAccessLevel(email) !== 'denied';
