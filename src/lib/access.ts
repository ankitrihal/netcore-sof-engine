/**
 * access.ts: who may use the SOF Engine, and which country they work in.
 *
 *   Admins (ankitrihal@gmail.com, ankit.rihal@netcore.ai)
 *       → every SOF (master history list), and free switching between Indonesia and Philippines
 *   Philippines Account Executives (don.gonzales, yuvraj.bhattee @netcore.ai)
 *       → own SOFs only; locked to Philippines: 12% VAT, SOF_Template_PH.docx, Netcore Cloud Pte Ltd
 *   Indonesia Account Executives (mohd.pakzad, prathamesh.borkar @netcore.ai)
 *       → own SOFs only; locked to Indonesia: 11% VAT, SOF_Template_ID.docx, PT Tera Achiever
 *   Other @netcore.ai accounts → stay signed in, but wait on the "Request Access" screen
 *   Everyone else              → signed out with "Unauthorized: Only Netcore accounts are allowed."
 *
 * Keep these lists in sync with supabase/schema.sql (functions is_approved_email,
 * is_admin and can_sign_in). The database enforces them; the app uses them to show
 * the right screen and lock the country.
 */

const norm = (email: string | null | undefined) => (email ?? '').trim().toLowerCase();

/** Unrestricted access to all SOFs. */
export const ADMIN_EMAILS = ['ankitrihal@gmail.com', 'ankit.rihal@netcore.ai'];

/** Approved Account Executives (AEs): dashboard access, own SOFs only. */
export const AE_EMAILS = [
  'mohd.pakzad@netcore.ai',
  'prathamesh.borkar@netcore.ai',
  'don.gonzales@netcore.ai',
  'yuvraj.bhattee@netcore.ai',
];

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

/** Accounts from this domain that aren't approved get the Request Access screen. */
export const NETCORE_DOMAIN = '@netcore.ai';

/** Where access requests go. */
export const ACCESS_REQUEST_EMAIL = 'ankit.rihal@netcore.ai';

export const UNAUTHORIZED_MESSAGE = 'Unauthorized: Only Netcore accounts are allowed.';
export const REQUEST_SENT_MESSAGE =
  'Your request has been sent to the Admin. You will be informed manually once approved.';

export type AccessLevel = 'admin' | 'ae' | 'pending' | 'denied';

export function getAccessLevel(email: string | null | undefined): AccessLevel {
  const e = norm(email);
  if (ADMIN_EMAILS.includes(e)) return 'admin';
  if (AE_EMAILS.includes(e)) return 'ae';
  if (e.endsWith(NETCORE_DOMAIN)) return 'pending';
  return 'denied';
}

export const isAdminEmail = (email: string | null | undefined) => getAccessLevel(email) === 'admin';

/** Admins and approved Account Executives: may open the dashboard and read/write SOFs. */
export const isApprovedEmail = (email: string | null | undefined) => {
  const level = getAccessLevel(email);
  return level === 'admin' || level === 'ae';
};

/** mailto: link for the Request Access button. */
export function accessRequestMailto(email: string, name?: string): string {
  const subject = `SOF Engine Access Request - ${email}`;
  const body =
    `Hi Ankit,\n\nPlease grant me access to the SOF Engine.\n\n` +
    `Name: ${name || '-'}\nEmail: ${email}\n\nThank you.`;
  return `mailto:${ACCESS_REQUEST_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
