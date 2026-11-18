/**
 * SofDashboard.tsx — React SOF builder with a live Sales Order Form preview.
 * Uses pricingCalculator.ts for every number; this file holds UI only.
 * Styled with Tailwind CSS (set up in vite.config.ts and src/index.css).
 *
 *   import SofDashboard from './SofDashboard';
 *   <SofDashboard onExport={({ client, pricing }) => exportSOF(client, pricing)} />
 *
 * Client details are typed in manually on the left and flow into the preview
 * and into onExport.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ExportFormat } from '../lib/exportSOF';
import {
  calculatePricing,
  findPxRate,
  pxDetails,
  pxOverageText,
  PX_PRODUCT_NAME,
  BILLING_START_TBD_TEXT,
  resolveTerm,
  type Market,
  type PricingResult,
  type LineItem,
  type PxVersion,
  DEFAULT_PX_VERSION,
} from '../lib/pricingCalculator';
import { COUNTRY_NAME, COUNTRY_VAT, countryFromVat, type Country } from '../lib/access';

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
const usd = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rate = (n: number) => 'USD ' + (+n.toPrecision(4)).toString();

/** Blank text → null so the calculator can reject missing manual fees. */
const num = (s: string): number | null => (s.trim() === '' || isNaN(+s) ? null : +s);

/** Price cell: struck through when fully discounted. */
function Price({ value, discounted }: { value: number; discounted: boolean }) {
  return discounted ? <del>{usd(value)}</del> : <>{usd(value)}</>;
}

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------
/** Client details typed in manually; passed to onExport for the Word template. */
export interface ClientDetails {
  clientName: string;
  billingAddress: string;
  primaryContact: string;
  primaryEmail: string;
  primaryPhone: string;
  billingContact: string;
  billingEmail: string;
  billingPhone: string;
}

export interface SofExportData {
  client: ClientDetails;
  pricing: PricingResult;
  /** Picks the Word template and entity details: ID = Indonesia, PH = Philippines. */
  country: Country;
  /** Exact form state at export time, saved to SOF History before the download. */
  form?: FormState;
  /** Billing Start Date is To Be Discussed: the SOF shows "TBD - To be Discussed" instead of a date. */
  billingStartTbd?: boolean;
  /** File(s) to download: Word (default), PDF, or both. */
  format?: ExportFormat;
  /** Netcore signatory for the signature block: the signed-in user creating the SOF. */
  signatory?: { name: string; title: string } | null;
}

/** Phone country code per SOF country. Fully editable in the field. */
export const PHONE_PREFIXES: Record<Country, string> = { ID: '+62 ', PH: '+63 ' };

/** True when a phone field holds nothing but a country code (e.g. "+62 ", "+63", or empty). */
const isBarePhonePrefix = (v: string) => /^\+?\d{0,4}\s*$/.test(v.trim());

/**
 * Apply the country rules to the form:
 *  - a locked user's country/VAT is forced to their country (no-op for admins)
 *  - the phone prefix follows the country (+62 Indonesia, +63 Philippines), but only while the
 *    phone field holds just a country code, so a number the user typed is never overwritten
 */
function applyCountryRules(form: FormState, lock: Country | null | undefined): FormState {
  const country = lock ?? countryFromVat(form.vatRate);
  let next = form;
  if (form.vatRate !== COUNTRY_VAT[country]) next = { ...next, vatRate: COUNTRY_VAT[country] };
  const prefix = PHONE_PREFIXES[country];
  if (isBarePhonePrefix(next.primaryPhone) && next.primaryPhone !== prefix) next = { ...next, primaryPhone: prefix };
  // A custom Billing Phone that is only a (now outdated) country code goes back to copying Primary Phone
  if (next.billingPhone !== null && isBarePhonePrefix(next.billingPhone)) next = { ...next, billingPhone: null };
  return next;
}

/**
 * Billing fields mirror the matching Primary field while they are null.
 * Typing a custom value stores it and breaks the link; clearing the field re-links it.
 */
type BillingKey = 'billingContact' | 'billingEmail' | 'billingPhone';
const BILLING_SOURCE: Record<BillingKey, 'primaryContact' | 'primaryEmail' | 'primaryPhone'> = {
  billingContact: 'primaryContact',
  billingEmail: 'primaryEmail',
  billingPhone: 'primaryPhone',
};

/** Starting phone prefix before the country is known (Indonesia); replaced by applyCountryRules. */
const PHONE_PREFIX = PHONE_PREFIXES.ID;

/**
 * If the field holds only the prefix (e.g. "+62 "), move the cursor after it.
 * Runs on click (after the browser places the cursor) and, via a timer, on keyboard focus.
 * The value is re-checked each time, so it never moves the cursor once the user has started typing.
 */
function caretAfterPrefix(el: HTMLInputElement, prefix: string) {
  // Leave it alone if the user has selected text (e.g. to replace it all)
  if (el.value === prefix && el.selectionStart === el.selectionEnd) {
    el.setSelectionRange(prefix.length, prefix.length);
  }
}

/** "+62 +62 811…" or "+62 +63 811…" (a full number pasted after the default prefix) → keep the pasted number. */
const dedupePhonePrefix = (v: string) => v.replace(/^\+\d{1,4}\s*(?=\+)/, '');

/** A phone field holding only a country code ("+62") counts as empty in the preview and export. */
const cleanPhone = (v: string) => (/^\+?\d{0,4}$/.test(v.trim()) ? '' : v.trim());

/**
 * A phone number counts only if it has digits after the country code:
 * "+62 " or "+62" alone fails; "+62 8119530303" passes. Also requires length > 4.
 */
const hasPhoneDigits = (v: string) => {
  const t = v.trim();
  return t.length > 4 && /\d/.test(t.replace(/^\+\d{1,4}\s*/, ''));
};

/** Standard email format: something@domain.tld, no spaces. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isValidEmail = (v: string) => EMAIL_PATTERN.test(v.trim());
const INVALID_EMAIL_MSG = 'Enter a valid email address, e.g. name@company.com';

/**
 * Email fields that hold text but aren't a valid address. Billing Email is only checked
 * when typed separately (while linked it is the Primary Email, already checked).
 */
function invalidEmailFields(f: FormState): string[] {
  const out: string[] = [];
  if (f.primaryEmail.trim() && !isValidEmail(f.primaryEmail)) out.push(`Primary Email ("${f.primaryEmail.trim()}")`);
  if (f.billingEmail !== null && f.billingEmail.trim() && !isValidEmail(f.billingEmail)) out.push(`Billing Email ("${f.billingEmail.trim()}")`);
  return out;
}

/** The 8 mandatory Client Details fields, checked before any export. */
const MANDATORY_CLIENT_FIELDS: { key: keyof ClientDetails; label: string; phone?: boolean }[] = [
  { key: 'clientName', label: 'Client Name' },
  { key: 'billingAddress', label: 'Billing Address' },
  { key: 'primaryContact', label: 'Primary Contact' },
  { key: 'primaryEmail', label: 'Primary Email' },
  { key: 'primaryPhone', label: 'Primary Phone', phone: true },
  { key: 'billingContact', label: 'Billing Contact' },
  { key: 'billingEmail', label: 'Billing Email' },
  { key: 'billingPhone', label: 'Billing Phone', phone: true },
];

/**
 * Labels of mandatory fields that are still incomplete. Uses the raw values the user
 * sees (billing fields include the Primary value they copy), so "+62 " alone fails.
 */
function missingClientFields(raw: Record<keyof ClientDetails, string>): string[] {
  return MANDATORY_CLIENT_FIELDS.filter(({ key, phone }) =>
    phone ? !hasPhoneDigits(raw[key]) : raw[key].trim() === '',
  ).map(({ label }) => label);
}

/** Readable names of required pricing inputs that are empty or invalid (mirrors runCalc's checks). */
function missingPricingFields(f: FormState): string[] {
  const out: string[] = [];
  const mau = num(f.mau);
  if (!mau || mau <= 0) out.push('MAU');
  const total = num(f.totalContractDurationMonths);
  if (!total || total < MIN_TERM_MONTHS) out.push(`Total Duration (months), minimum ${MIN_TERM_MONTHS}`);
  const onboarding = num(f.onboardingFee);
  if (onboarding === null || onboarding < 0) out.push('Onboarding Fee ($)');
  const csm = num(f.csmFee);
  if (csm === null || csm < 0) out.push('CSM Fee ($ / month)');
  const rate = num(f.emailRate);
  if (num(f.emailsPerMonth) && (rate === null || rate < 0)) out.push('Pricing per email ($)');
  return out;
}

/** Contracts run for at least 12 months. */
const MIN_TERM_MONTHS = 12;

/** VAT options: value is the percentage passed to the calculator and export. */
const VAT_OPTIONS = [
  { value: '11', label: 'Indonesia (11%)' },
  { value: '12', label: 'Philippines (12%)' },
];

/** Standard per-email rate shown by default (NETCORE PRICING sheet). */
const DEFAULT_EMAIL_RATE = '0.0011';

/** The dashboard's complete form state. This exact object is saved as form_data in Supabase. */
export interface FormState extends Omit<ClientDetails, BillingKey> {
  billingContact: string | null; // null = same as Primary Contact
  billingEmail: string | null; // null = same as Primary Email
  billingPhone: string | null; // null = same as Primary Phone
  mau: string;
  market: Market;
  totalContractDurationMonths: string;
  complimentaryMonths: string;
  subscriptionStartDate: string;
  /** Billing Start Date still to be agreed: SOF shows "TBD - To be Discussed" instead of a date. */
  billingStartTbd: boolean;
  onboardingFee: string;
  onboardingFeeFullyDiscounted: boolean;
  csmFee: string;
  csmFeeFullyDiscounted: boolean;
  aiMonthly: string;
  aiFullyDiscounted: boolean;
  emailsPerMonth: string;
  emailRate: string;
  vatRate: string;
  includePx: boolean;
  pxVersion: PxVersion;
}

/** The value a billing field shows and exports: its own if typed, otherwise the Primary value. */
const billingValue = (f: FormState, k: BillingKey) => f[k] ?? f[BILLING_SOURCE[k]];

export const INITIAL: FormState = {
  clientName: '',
  billingAddress: '',
  primaryContact: '',
  primaryEmail: '',
  primaryPhone: PHONE_PREFIX, // editable default country code
  billingContact: null,
  billingEmail: null,
  billingPhone: null,
  mau: '100000',
  market: 'Enterprise',
  totalContractDurationMonths: '12',
  complimentaryMonths: '',
  subscriptionStartDate: '',
  billingStartTbd: false,
  onboardingFee: '', // manual, no default
  onboardingFeeFullyDiscounted: false,
  csmFee: '', // manual, no default
  csmFeeFullyDiscounted: false,
  aiMonthly: '0',
  aiFullyDiscounted: false,
  emailsPerMonth: '',
  emailRate: DEFAULT_EMAIL_RATE,
  vatRate: '11',
  includePx: false,
  pxVersion: DEFAULT_PX_VERSION, // kept for older saved SOFs; PX always uses DEFAULT_PX_VERSION
};

/**
 * Turn saved form_data back into a complete FormState. Starts from the defaults and
 * copies only known fields of the right type, so SOFs saved before a field existed
 * still load (the new field gets its default).
 */
export function normalizeFormState(data: unknown): FormState {
  const out: FormState = { ...INITIAL };
  if (!data || typeof data !== 'object') return out;
  const src = data as Record<string, unknown>;
  for (const key of Object.keys(INITIAL) as (keyof FormState)[]) {
    if (!(key in src)) continue;
    const v = src[key];
    const def = INITIAL[key];
    const billing = key === 'billingContact' || key === 'billingEmail' || key === 'billingPhone';
    if ((billing && (v === null || typeof v === 'string')) || (!billing && typeof v === typeof def)) {
      (out as unknown as Record<string, unknown>)[key] = v;
    }
  }
  return out;
}

/** Billing start date (ISO) from the Term fields, using the calculator's own rule; null if it can't be worked out yet. */
function billingStartPreview(f: FormState): string | null {
  if (!f.subscriptionStartDate) return null;
  try {
    return resolveTerm({
      subscriptionStartDate: f.subscriptionStartDate,
      totalContractDurationMonths: num(f.totalContractDurationMonths) ?? MIN_TERM_MONTHS,
      complimentaryMonths: num(f.complimentaryMonths) ?? 0,
    } as Parameters<typeof resolveTerm>[0]).billingStartDate;
  } catch {
    return null;
  }
}

type Calc = { ok: true; r: PricingResult } | { ok: false; errors: string[] };

/** CSM is always a shared resource on SOFs built here. */
const CSM_RESOURCE_TYPE = 'Shared' as const;

/**
 * Platform fee and event allowance for the read-only fields. These depend only on
 * MAU and plan, so they show as soon as MAU is entered, before the fees are filled in.
 */
type PlatformInfo =
  | { ok: true; monthly: number; eventsMn: number; band: string }
  | { ok: false; message: string };

function platformInfo(f: FormState): PlatformInfo {
  const mau = num(f.mau);
  if (!mau || mau <= 0) return { ok: false, message: 'Enter MAU' };
  try {
    const r = calculatePricing({
      mau,
      market: f.market,
      totalContractDurationMonths: 12,
      onboardingFee: 0,
      csmFee: 0,
      csmResourceType: CSM_RESOURCE_TYPE,
    });
    return { ok: true, monthly: r.platformFee.ceMonthly, eventsMn: r.eventContainer.totalYearlyMn, band: r.bucket.label };
  } catch {
    return { ok: false, message: 'Custom pricing (above 5 Mn MAU)' };
  }
}

/** PX price and event container for the read-only PX fields (same MAU as CE). */
type PxInfo = { ok: true; monthly: number; eventsMn: number; tierMau: number } | { ok: false; message: string };

function pxInfo(f: FormState): PxInfo {
  const mau = num(f.mau);
  if (!mau || mau <= 0) return { ok: false, message: 'Enter MAU in the CE section' };
  const rate = findPxRate(mau, DEFAULT_PX_VERSION);
  return rate
    ? { ok: true, monthly: rate.usd, eventsMn: rate.eventsMn, tierMau: rate.tierMau }
    : { ok: false, message: 'Custom pricing (above 50 Mn MAU)' };
}

function runCalc(f: FormState): Calc {
  const errors: string[] = [];
  const onboardingFee = num(f.onboardingFee);
  const csmFee = num(f.csmFee);
  const mau = num(f.mau);
  const total = num(f.totalContractDurationMonths);
  if (onboardingFee === null || onboardingFee < 0) errors.push('Enter the Onboarding Fee ($).');
  if (csmFee === null || csmFee < 0) errors.push('Enter the CSM Fee ($).');
  if (!mau || mau <= 0) errors.push('Enter MAU.');
  if (!total || total <= 0) errors.push('Enter the total contract duration (months).');
  else if (total < MIN_TERM_MONTHS) errors.push(`Total duration must be at least ${MIN_TERM_MONTHS} months.`);
  if (errors.length) return { ok: false, errors };

  const emails = num(f.emailsPerMonth);
  const emailRate = num(f.emailRate);
  if (emails && (emailRate === null || emailRate < 0)) {
    return { ok: false, errors: ['Enter the Pricing per email ($).'] };
  }
  try {
    const r = calculatePricing({
      mau: mau!,
      market: f.market,
      totalContractDurationMonths: total!,
      complimentaryMonths: num(f.complimentaryMonths) ?? 0, // blank → 0
      subscriptionStartDate: f.subscriptionStartDate || undefined,
      onboardingFee: onboardingFee!,
      onboardingFeeFullyDiscounted: f.onboardingFeeFullyDiscounted,
      csmFee: csmFee!,
      csmFeeFullyDiscounted: f.csmFeeFullyDiscounted,
      csmResourceType: CSM_RESOURCE_TYPE, // always Shared; no longer chosen in the UI
      px: f.includePx ? { version: DEFAULT_PX_VERSION } : undefined, // unchecked → no PX; checked → Enterprise automatically
      bundled: {
        aiComponents: { monthlyListPrice: num(f.aiMonthly) ?? 0, complimentary: f.aiFullyDiscounted },
        // Per-email rate overrides the standard tier: monthly price = emails × rate.
        // Overage per extra email = that rate + 15% (applied in calculatePricing).
        email: emails
          ? { emailsPerMonth: emails, monthlyListPrice: emails * emailRate!, unitPrice: emailRate! }
          : undefined,
      },
      vatRate: (num(f.vatRate) ?? 0) / 100 || undefined,
    });
    return { ok: true, r };
  } catch (e) {
    return { ok: false, errors: [(e as Error).message] };
  }
}

// ---------------------------------------------------------------------------
// Styling (Tailwind). The sof-* class names have no styles of their own; they
// are stable hooks for tests.
// ---------------------------------------------------------------------------
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// Each input gets exactly one state style, so background/border colours never compete.
const INPUT = 'w-full rounded-md border px-2.5 py-1.5 text-xs placeholder:text-slate-400 transition focus:outline-none';
const FOCUS = 'focus:border-blue-500 focus:ring-2 focus:ring-blue-500/60';
const INPUT_NORMAL = cx('border-slate-300 bg-white text-slate-900 shadow-sm', FOCUS);
const INPUT_MISSING = cx('sof-missing border-amber-400 bg-amber-50 text-slate-900 shadow-sm', FOCUS);
const INPUT_ERROR = cx('sof-invalid border-red-400 bg-red-50 text-slate-900 shadow-sm', FOCUS);
const ERROR_TEXT = 'sof-error mt-1 block text-[11px] font-medium text-red-600';
const INPUT_INHERITED = cx(
  'sof-inherited border-dashed border-slate-300 bg-slate-100 text-slate-500 shadow-[inset_0_1px_2px_rgba(15,23,42,0.08)]',
  FOCUS,
);
const INPUT_READONLY =
  'sof-readonly cursor-not-allowed border-slate-300/70 bg-slate-200/70 pr-9 font-medium text-slate-700 ' +
  'shadow-[inset_0_1px_3px_rgba(15,23,42,0.12)]';
const LABEL = 'mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-700';
const HINT = 'mt-1.5 block text-[11px] text-slate-500';

/** Small tag next to a label, e.g. "Auto" or "Linked". */
function Tag({ children, tone }: { children: React.ReactNode; tone: 'slate' | 'blue' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        tone === 'slate' ? 'bg-slate-200 text-slate-600' : 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
      )}
    >
      {children}
    </span>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
      <path
        fillRule="evenodd"
        d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-3 w-3">
      <path d="M12.232 4.232a2.5 2.5 0 013.536 3.536l-1.225 1.224a.75.75 0 001.061 1.06l1.224-1.224a4 4 0 00-5.656-5.656l-3 3a4 4 0 00.225 5.865.75.75 0 00.977-1.138 2.5 2.5 0 01-.142-3.667l3-3z" />
      <path d="M11.603 7.963a.75.75 0 00-.977 1.138 2.5 2.5 0 01.142 3.667l-3 3a2.5 2.5 0 01-3.536-3.536l1.225-1.224a.75.75 0 00-1.061-1.06l-1.224 1.224a4 4 0 105.656 5.656l3-3a4 4 0 00-.225-5.865z" />
    </svg>
  );
}

/** A form section: white card with a dark header bar. */
function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="sof-card overflow-hidden rounded-lg bg-white shadow-md ring-1 ring-slate-900/5">
      <header className="bg-slate-800 px-4 py-2.5">
        <h2 className="text-xs font-semibold tracking-wide text-white">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[11px] text-slate-300">{subtitle}</p>}
      </header>
      <div className="space-y-3.5 p-4">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------
/** Red asterisk for mandatory fields. */
const RequiredMark = () => <span className="text-red-500 ml-1">*</span>;

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  multiline?: boolean;
  autoComplete?: string;
  /** If the field holds only this prefix, put the cursor after it on focus. */
  prefix?: string;
  /** Overrides the "empty" check for required fields (e.g. a phone holding only "+62 "). */
  isMissing?: boolean;
  /** Minimum for number inputs (default 0). */
  min?: number;
  onBlur?: () => void;
  /** Validation message; shown after the user leaves the field, or at once when showError is set. */
  error?: string | null;
  showError?: boolean;
  children?: React.ReactNode;
}) {
  const [touched, setTouched] = useState(false);
  const missing = props.required && (props.isMissing ?? props.value.trim() === '');
  const errorShown = !!props.error && (touched || !!props.showError);
  return (
    <label className="sof-field block">
      <span className={LABEL}>
        <span>
          {props.label}
          {props.required && <RequiredMark />}
        </span>
      </span>
      <span className="flex items-center gap-3">
        {props.multiline ? (
          <textarea
            rows={3}
            value={props.value}
            placeholder={props.placeholder}
            autoComplete={props.autoComplete}
            required={props.required}
            aria-invalid={missing || undefined}
            className={cx('sof-input', INPUT, missing ? INPUT_MISSING : INPUT_NORMAL, 'min-h-[76px] resize-y leading-relaxed')}
            onChange={(e) => props.onChange(e.target.value)}
          />
        ) : (
          <input
            type={props.type ?? 'number'}
            min={props.type === 'number' || props.type === undefined ? props.min ?? 0 : undefined}
            step={props.type === 'number' || props.type === undefined ? 'any' : undefined}
            value={props.value}
            placeholder={props.placeholder}
            autoComplete={props.autoComplete}
            // Only acts while nothing has been typed after the prefix, so clicking
            // inside a full number still lets the user edit at that spot
            onFocus={props.prefix ? (e) => { const el = e.currentTarget; setTimeout(() => caretAfterPrefix(el, props.prefix!), 0); } : undefined}
            onClick={props.prefix ? (e) => caretAfterPrefix(e.currentTarget, props.prefix!) : undefined}
            required={props.required}
            onBlur={() => { setTouched(true); props.onBlur?.(); }}
            aria-invalid={missing || errorShown || undefined}
            className={cx('sof-input', INPUT, errorShown ? INPUT_ERROR : missing ? INPUT_MISSING : INPUT_NORMAL)}
            onChange={(e) => props.onChange(e.target.value)}
          />
        )}
        {props.children}
      </span>
      {errorShown && <span className={ERROR_TEXT} role="alert">{props.error}</span>}
      {props.hint && <span className={cx('sof-hint', HINT)}>{props.hint}</span>}
    </label>
  );
}

/** Billing field that shows the Primary value greyed out until the user types their own. */
function BillingField(props: {
  label: string;
  type: string;
  value: string | null; // null = mirroring
  mirrored: string;
  sourceLabel: string;
  placeholder?: string;
  /** If the copied value is only this prefix (e.g. "+62 "), put the cursor after it instead of selecting it. */
  prefix?: string;
  required?: boolean;
  /** Validation message for a separately typed value (see Field). */
  error?: string | null;
  showError?: boolean;
  onChange: (v: string | null) => void;
}) {
  const [touched, setTouched] = useState(false);
  const inherited = props.value === null;
  const errorShown = !inherited && !!props.error && (touched || !!props.showError);
  return (
    <label className="sof-field block">
      <span className={LABEL}>
        <span>
          {props.label}
          {props.required && <RequiredMark />}
        </span>
        {inherited && (
          <Tag tone="blue">
            <LinkIcon />
            Linked
          </Tag>
        )}
      </span>
      <input
        type={props.type}
        required={props.required}
        className={cx('sof-input', INPUT, inherited ? INPUT_INHERITED : errorShown ? INPUT_ERROR : INPUT_NORMAL)}
        aria-invalid={errorShown || undefined}
        onBlur={() => setTouched(true)}
        value={inherited ? props.mirrored : props.value!}
        placeholder={inherited ? `Same as ${props.sourceLabel}` : props.placeholder}
        // While mirroring, select the copied text on focus so typing replaces it,
        // except a bare prefix like "+62 ", where typing continues after it
        onFocus={(e) => {
          if (!inherited) return;
          const el = e.currentTarget;
          if (props.prefix && el.value === props.prefix) setTimeout(() => caretAfterPrefix(el, props.prefix!), 0);
          else el.select();
        }}
        onClick={(e) => props.prefix && caretAfterPrefix(e.currentTarget, props.prefix)}
        onChange={(e) => props.onChange(e.target.value === '' ? null : e.target.value)}
      />
      {errorShown && <span className={ERROR_TEXT} role="alert">{props.error}</span>}
      <span className={cx('sof-hint', HINT)}>
        {inherited ? (
          <>Same as {props.sourceLabel}. Type to use a different value.</>
        ) : (
          <button
            type="button"
            className="sof-link font-medium text-blue-600 underline-offset-2 hover:text-blue-700 hover:underline"
            onClick={() => props.onChange(null)}
          >
            Use {props.sourceLabel} instead
          </button>
        )}
      </span>
    </label>
  );
}

/** Greyed-out, read-only field showing a calculated value. */
function ReadOnlyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <label className="sof-field block">
      <span className={LABEL}>
        {label}
        <Tag tone="slate">Auto</Tag>
      </span>
      <span className="relative block">
        <input
          type="text"
          className={cx('sof-input', INPUT, INPUT_READONLY)}
          value={value}
          readOnly
          aria-readonly="true"
          tabIndex={-1}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
          <LockIcon />
        </span>
      </span>
      {hint && <span className={cx('sof-hint', HINT)}>{hint}</span>}
    </label>
  );
}

const EXPORT_OPTIONS: { format: ExportFormat; label: string; hint: string }[] = [
  { format: 'docx', label: 'Export as Word (DOCX)', hint: 'Editable Word file' },
  { format: 'pdf', label: 'Export as PDF', hint: 'Ready to send or sign' },
  { format: 'both', label: 'Export Both', hint: 'Word file and PDF' },
];

const DownloadIcon = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
    <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
    <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
  </svg>
);

/** Export split button: the main part exports Word; the arrow opens Word / PDF / Both. */
function ExportSplitButton({ onExport }: { onExport: (format: ExportFormat) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const btn =
    'inline-flex items-center bg-blue-600 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-slate-800';
  return (
    <div ref={ref} className="sof-export relative inline-flex shrink-0">
      <button
        type="button"
        title="Download the filled Sales Order Form as a Word file"
        className={cx('sof-btn gap-2 rounded-l-md py-2 pl-4 pr-3', btn)}
        onClick={() => onExport('docx')}
      >
        <DownloadIcon />
        Export SOF
      </button>
      <button
        type="button"
        aria-label="More export options"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cx('sof-export-toggle rounded-r-md border-l border-blue-400/60 px-2 py-2', btn)}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={cx('h-4 w-4 transition', open && 'rotate-180')}>
          <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 011.06 0L10 11.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 9.28a.75.75 0 010-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="sof-export-menu absolute right-0 top-full z-30 mt-1.5 w-56 overflow-hidden rounded-md bg-white py-1 shadow-lg ring-1 ring-slate-900/10">
          {EXPORT_OPTIONS.map((o) => (
            <button
              key={o.format}
              type="button"
              role="menuitem"
              data-format={o.format}
              className="sof-export-option flex w-full flex-col items-start px-3 py-2 text-left transition hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
              onClick={() => {
                setOpen(false);
                onExport(o.format);
              }}
            >
              <span className="text-xs font-medium text-slate-800">{o.label}</span>
              <span className="text-[11px] text-slate-500">{o.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DiscountToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label
      className={cx(
        'sof-check flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md border px-3 py-2 text-xs font-medium transition',
        checked
          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
          : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
      )}
    >
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-slate-300 accent-emerald-600"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      Fully Discounted
    </label>
  );
}

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  locked,
  hint,
}: {
  label: string;
  value: T;
  options: (T | { value: T; label: string })[];
  onChange: (v: T) => void;
  /** Read-only: shown greyed with a lock and can't be changed. */
  locked?: boolean;
  hint?: string;
}) {
  return (
    <label className="sof-field block">
      <span className={LABEL}>
        {label}
        {locked && <Tag tone="slate">Locked</Tag>}
      </span>
      <select
        className={cx('sof-input', INPUT, locked ? cx(INPUT_READONLY, 'appearance-none') : INPUT_NORMAL, 'pr-8')}
        value={value}
        disabled={locked}
        aria-readonly={locked || undefined}
        onChange={(e) => !locked && onChange(e.target.value as T)}
      >
        {options.map((o) => {
          const { value: v, label: l } = typeof o === 'string' ? { value: o, label: o } : o;
          return (
            <option key={v} value={v}>
              {l}
            </option>
          );
        })}
      </select>
      {hint && <span className={cx('sof-hint', HINT)}>{hint}</span>}
    </label>
  );
}

// ---------------------------------------------------------------------------
// SOF preview
// ---------------------------------------------------------------------------
const TH = 'border border-slate-200 bg-slate-50 px-3 py-2 text-left align-top font-medium text-slate-600';
const TD = 'border border-slate-200 px-3 py-2 align-top text-slate-800';
const NUM = 'whitespace-nowrap text-right tabular-nums';

function LineRow({ li, months }: { li: LineItem; months: number }) {
  return (
    <tr>
      <td className={cx(TD, 'font-medium text-slate-900')}>{li.name}</td>
      <td className={TD}>{li.details}</td>
      <td className={cx(TD, NUM)}>
        <Price value={li.monthlyList} discounted={li.fullyDiscounted} />
      </td>
      <td className={cx(TD, NUM)}>
        <Price value={li.monthlyList * months} discounted={li.fullyDiscounted} />
      </td>
    </tr>
  );
}

function SectionRow({ children }: { children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={4} className="border border-slate-200 bg-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
        {children}
      </td>
    </tr>
  );
}

function SofPreview({ r, client, billingStartTbd }: { r: PricingResult; client: ClientDetails; billingStartTbd?: boolean }) {
  const { term, platformFee, overages, eventContainer, totals } = r;
  const billingStart = billingStartTbd ? BILLING_START_TBD_TEXT : term.billingStartDate;
  const hasComp = term.contractTermDescription !== ''; // '' when complimentaryMonths is 0/blank
  const paid = term.paidMonths;
  const setup = r.oneTimeSetupFees;
  const csm = r.csm;
  const otherAddons = r.addons.filter((a) => a.key !== 'csm');

  // "You Save" label lists only what is actually waived; no complimentary-period text when there is none.
  const saveParts: string[] = [];
  if (setup.fullyDiscounted && setup.list > 0) saveParts.push('Onboarding Fee');
  if (csm.fullyDiscounted && csm.monthlyList > 0) saveParts.push('CSM');
  r.bundledProducts.filter((b) => b.fullyDiscounted && b.monthlyList > 0).forEach((b) => saveParts.push(b.name));

  const meta = (label: string, value: React.ReactNode, extra?: { rowSpan?: number; pre?: boolean }) => (
    <>
      <th rowSpan={extra?.rowSpan} className={cx(TH, 'w-[19%]')}>{label}</th>
      <td rowSpan={extra?.rowSpan} className={cx(TD, extra?.pre && 'whitespace-pre-line')}>
        {value || <span className="text-slate-300">—</span>}
      </td>
    </>
  );

  return (
    <div className="sof-doc text-xs text-slate-800 [&_del]:text-slate-400">
      <div className="mb-6 flex items-end justify-between border-b border-slate-200 pb-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-blue-600">Netcore</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-900">Sales Order Form</h3>
        </div>
        <p className="text-right text-[11px] text-slate-500">
          {term.totalContractDurationMonths} months
          {hasComp && <> · {term.contractTermDescription}</>}
        </p>
      </div>

      <table className="sof-meta w-full border-collapse">
        <tbody>
          <tr>{meta('Customer Name', client.clientName)}{meta('Billing Contact', client.billingContact)}</tr>
          <tr>
            {meta('Billing Address', client.billingAddress, { rowSpan: 2, pre: true })}
            {meta('Billing Email', client.billingEmail)}
          </tr>
          <tr>{meta('Billing Phone', client.billingPhone)}</tr>
          <tr>{meta('Primary Contact', client.primaryContact)}{meta('Billing Method', 'Prepaid')}</tr>
          <tr>{meta('Primary Email', client.primaryEmail)}{meta('Billing Frequency', 'Annual')}</tr>
          <tr>{meta('Primary Phone', client.primaryPhone)}{meta('Billing Start Date', billingStart)}</tr>
          <tr>
            {meta(
              'Contract Term',
              <>
                {term.totalContractDurationMonths} Months
                {hasComp && <> {term.contractTermDescription}</>}
              </>,
            )}
            {meta('Payment Method', 'Local Transfer')}
          </tr>
          <tr>{meta('Subscription Start Date', term.subscriptionStartDate)}{meta('Subscription End Date', term.subscriptionEndDate)}</tr>
        </tbody>
      </table>

      <h4 className="mb-3 mt-8 text-xs font-semibold text-slate-900">Pricing and Payment Terms for the Services</h4>
      <table className="sof-price w-full border-collapse">
        <thead>
          <tr className="bg-slate-800 text-left text-[11px] font-semibold uppercase tracking-wide text-white">
            <th className="border border-slate-800 px-3 py-2.5">Component / Product</th>
            <th className="border border-slate-800 px-3 py-2.5">Details</th>
            <th className={cx('border border-slate-800 px-3 py-2.5', NUM)}>Monthly (USD)</th>
            <th className={cx('border border-slate-800 px-3 py-2.5', NUM)}>Total Contract Value (USD)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={cx(TD, 'font-semibold text-slate-900')}>One Time Setup Fees (Onboarding)</td>
            <td className={TD}>–</td>
            <td className={cx(TD, NUM)}>–</td>
            <td className={cx(TD, NUM)}>
              <Price value={setup.list} discounted={setup.fullyDiscounted} />
            </td>
          </tr>
          <tr>
            <td className={cx(TD, 'font-semibold text-slate-900')}>Platform (Fee)</td>
            <td className={TD}>{platformFee.details}</td>
            <td className={cx(TD, NUM, 'font-semibold text-slate-900')}>{usd(platformFee.monthly)}</td>
            <td className={cx(TD, NUM, 'font-semibold text-slate-900')}>{usd(platformFee.paidTermTotal)}</td>
          </tr>
          <tr>
            <td className={cx(TD, 'font-medium text-slate-900')}>Customer Engagement (CE) and Analytics</td>
            <td className={TD}>Overages: {rate(overages.mauRatePerUser)} per MAU, billable monthly</td>
            <td className={TD} />
            <td className={TD} />
          </tr>
          <tr>
            <td className={cx(TD, 'font-medium text-slate-900')}>Event Container Inclusion and Overages</td>
            <td className={TD}>
              {eventContainer.totalYearlyMn} Mn Events (Included) / year. Overages: {usd(overages.eventPricePerBucket)} per
              additional {overages.eventBucketMn} Mn events
            </td>
            <td className={TD} />
            <td className={TD} />
          </tr>

          <SectionRow>Bundled Products (with Monthly Consumption Validity)</SectionRow>
          {r.px && (
            <tr>
              <td className={cx(TD, 'font-medium text-slate-900')}>{PX_PRODUCT_NAME}</td>
              <td className={TD}>{pxDetails(r.px)}<br />{pxOverageText(r.px)}</td>
              <td className={TD} />
              <td className={TD} />
            </tr>
          )}
          {r.bundledProducts.map((b) =>
            b.monthlyList > 0 ? (
              <LineRow key={b.key} li={b} months={paid} />
            ) : (
              <tr key={b.key}>
                <td className={cx(TD, 'font-medium text-slate-900')}>{b.name}</td>
                <td className={TD}>{b.details}</td>
                <td className={TD} />
                <td className={TD} />
              </tr>
            ),
          )}

          <SectionRow>Customer Success Manager (CSM)</SectionRow>
          <tr>
            <td className={cx(TD, 'font-medium text-slate-900')}>{r.csm.name.replace('Customer Success Manager (CSM) – ', '')}</td>
            <td className={TD} />
            <td className={cx(TD, NUM)}>
              <Price value={csm.monthlyList} discounted={csm.fullyDiscounted} />
            </td>
            <td className={cx(TD, NUM)}>
              <Price value={csm.paidTermList} discounted={csm.fullyDiscounted} />
            </td>
          </tr>
          {otherAddons.map((a) => (
            <LineRow key={a.key} li={a} months={paid} />
          ))}

          <tr className="sof-total bg-slate-100 font-semibold text-slate-900">
            <td className={cx(TD, 'text-slate-900')}>TOTAL</td>
            <td className={TD} />
            <td className={cx(TD, NUM, 'text-slate-900')}>{usd(totals.monthlyRecurringNet)}</td>
            <td className={cx(TD, NUM, 'text-slate-900')}>
              {totals.youSave > 0 && (
                <>
                  <del className="font-normal text-red-400">{usd(totals.listTCV)}</del>{' '}
                </>
              )}
              <span className="text-sm">{usd(totals.totalContractValue)}</span>
            </td>
          </tr>
          {totals.youSave > 0 && (
            <tr className="sof-save bg-emerald-50 text-emerald-700">
              <td colSpan={2} className="border border-slate-200 px-3 py-2 font-medium">
                You Save{saveParts.length > 0 && ` (Complimentary ${saveParts.join(' + ')})`}
              </td>
              <td className={cx('border border-slate-200 px-3 py-2', NUM)}>–</td>
              <td className={cx('border border-slate-200 px-3 py-2 font-semibold', NUM)}>{usd(totals.youSave)}</td>
            </tr>
          )}
        </tbody>
      </table>

      <ul className="sof-terms mt-6 list-disc space-y-1.5 pl-5 text-slate-600 marker:text-slate-400">
        {hasComp && (
          <li>
            <b className="text-slate-800">Contract Term:</b> This Order Form covers a Complimentary Period of{' '}
            {term.complimentaryMonths} months, during which the Platform Fee and bundled products are provided free of
            charge, followed by a Paid Period of {term.paidMonths} months.
          </li>
        )}
        <li>
          <b className="text-slate-800">Payment Terms:</b> Annual Billing in Advance
          {billingStart ? `, invoiced on the Billing Start Date (${billingStart})` : ''}.
        </li>
        {totals.vat > 0 && (
          <li>
            Pricing excludes VAT. VAT amount: {usd(totals.vat)}; total incl. VAT: {usd(totals.totalContractValueInclVat)}.
          </li>
        )}
      </ul>
      {r.warnings.length > 0 && (
        <div className="sof-warn mt-5 space-y-1 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          {r.warnings.map((w) => (
            <div key={w}>⚠ {w}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export interface SofDashboardProps {
  onExport?: (data: SofExportData) => void;
  /** Save or update the current form. Receives the exact form state and the client name. */
  onSave?: (form: FormState, clientName: string) => Promise<void>;
  /** Load a saved SOF into the form. Change `key` each time to (re)load. */
  loadRequest?: { key: number; data: unknown };
  /** The saved SOF currently open, if any. Switches "Save SOF" to "Update SOF". */
  editing?: { clientName: string; updatedAt: string; ownerEmail?: string } | null;
  /** Start a fresh, unsaved SOF. */
  onNew?: () => void;
  /** Extra content on the right of the top bar (user menu, SOF History button). */
  headerRight?: React.ReactNode;
  /** Lock the country/VAT to this country (country-team Account Executives). null/undefined = can switch (admins). */
  countryLock?: Country | null;
}

export default function SofDashboard({ onExport, onSave, loadRequest, editing, onNew, headerRight, countryLock }: SofDashboardProps = {}) {
  const [f, setF] = useState<FormState>(() => applyCountryRules(INITIAL, countryLock));
  const [saving, setSaving] = useState(false);
  /** Set after a blocked Save/Export so every invalid field shows its message. */
  const [showErrors, setShowErrors] = useState(false);

  // Load a saved SOF (or a blank form) when the parent asks
  useEffect(() => {
    if (loadRequest) {
      setF(applyCountryRules(normalizeFormState(loadRequest.data), countryLock));
      setShowErrors(false);
    }
  }, [loadRequest?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep a country-team user's form on their country and phone prefix (also covers a lock arriving after mount)
  useEffect(() => {
    setF((s) => applyCountryRules(s, countryLock));
  }, [countryLock]);

  /** Save SOF / Update SOF. Only Client Name is required to save; drafts can be incomplete. */
  const handleSave = async () => {
    if (!onSave || saving) return;
    const name = f.clientName.trim();
    if (!name) {
      alert('Cannot save SOF. Please fill in the Client Name first.');
      return;
    }
    const badEmails = invalidEmailFields(f);
    if (badEmails.length > 0) {
      setShowErrors(true);
      alert(`Cannot save SOF. Please enter a valid email address for:\n- ${badEmails.join('\n- ')}\n\nFormat: name@company.com`);
      return;
    }
    setSaving(true);
    try {
      await onSave(f, name);
    } finally {
      setSaving(false);
    }
  };
  const set = <K extends keyof FormState>(k: K) => (v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const calc = useMemo(() => runCalc(f), [f]);
  const platform = useMemo(() => platformInfo(f), [f.mau, f.market]);
  const pxPrice = useMemo(() => pxInfo(f), [f.mau]);
  const mauNum = num(f.mau);
  const phonePrefix = PHONE_PREFIXES[countryLock ?? countryFromVat(f.vatRate)];

  // Total duration can't go below 12. A single digit is allowed while typing (the "2" of "24")
  // and snaps to 12 when the field loses focus; finished values under 12 (10, 11, arrow-down) snap at once.
  const onDurationChange = (v: string) => {
    const n = num(v);
    set('totalContractDurationMonths')(n !== null && n < MIN_TERM_MONTHS && v.trim().length >= 2 ? String(MIN_TERM_MONTHS) : v);
  };
  const onDurationBlur = () => {
    const n = num(f.totalContractDurationMonths);
    if (n === null || n < MIN_TERM_MONTHS) set('totalContractDurationMonths')(String(MIN_TERM_MONTHS));
  };

  const client: ClientDetails = {
    clientName: f.clientName.trim(),
    billingAddress: f.billingAddress.trim(),
    primaryContact: f.primaryContact.trim(),
    primaryEmail: f.primaryEmail.trim(),
    primaryPhone: cleanPhone(f.primaryPhone),
    billingContact: billingValue(f, 'billingContact').trim(),
    billingEmail: billingValue(f, 'billingEmail').trim(),
    billingPhone: cleanPhone(billingValue(f, 'billingPhone')),
  };

  /**
   * Export SOF click handler: the only path to onExport (exportSOF).
   * Checks all 8 mandatory Client Details fields (phones need digits beyond the "+62 " prefix)
   * plus the required pricing fields, and shows exactly what's missing instead of exporting.
   */
  const handleExport = (format: ExportFormat = 'docx') => {
    if (!onExport) return;
    const missingFields = [
      ...missingClientFields({
        clientName: f.clientName,
        billingAddress: f.billingAddress,
        primaryContact: f.primaryContact,
        primaryEmail: f.primaryEmail,
        primaryPhone: f.primaryPhone,
        billingContact: billingValue(f, 'billingContact'),
        billingEmail: billingValue(f, 'billingEmail'),
        billingPhone: billingValue(f, 'billingPhone'),
      }),
      ...missingPricingFields(f),
    ];
    const badEmails = invalidEmailFields(f);
    if (missingFields.length > 0 || badEmails.length > 0) {
      setShowErrors(true);
      const parts = [
        missingFields.length ? `Please fill in the following mandatory fields:\n- ${missingFields.join('\n- ')}` : '',
        badEmails.length ? `Please enter a valid email address (name@company.com) for:\n- ${badEmails.join('\n- ')}` : '',
      ].filter(Boolean);
      alert(`Cannot export SOF. ${parts.join('\n\n')}`);
      return;
    }
    if (!calc.ok) {
      // Fields are filled but pricing can't be calculated (e.g. MAU above the rate card)
      alert(`Cannot export SOF. ${calc.errors.join(' ')}`);
      return;
    }
    onExport({ client, pricing: calc.r, country: countryLock ?? countryFromVat(f.vatRate), form: f, billingStartTbd: f.billingStartTbd, format });
  };

  return (
    <div className="sof-app min-h-screen bg-slate-100 font-sans text-slate-900 antialiased">
      <header className="bg-slate-900 px-5 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-600 text-xs font-bold text-white">S</span>
          <div>
            <h1 className="text-sm font-semibold text-white">SOF Engine</h1>
            <p className="text-[11px] text-slate-400">Netcore Sales Order Form builder</p>
          </div>
          {headerRight && <div className="ml-auto flex items-center gap-3">{headerRight}</div>}
        </div>
      </header>

      <div className="grid gap-5 p-5 lg:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="sof-form space-y-4">
          <Card title="Client Details">
            <Field label="Client Name" type="text" required value={f.clientName} onChange={set('clientName')}
              placeholder="e.g. PT Lotte Shopping Indonesia" autoComplete="organization" />
            <Field label="Billing Address" multiline required value={f.billingAddress} onChange={set('billingAddress')}
              placeholder="Street, city, postcode" autoComplete="street-address" />
            <Field label="Primary Contact" type="text" required value={f.primaryContact} onChange={set('primaryContact')}
              placeholder="Full name" autoComplete="name" />
            <Field label="Primary Email" type="email" required value={f.primaryEmail} onChange={set('primaryEmail')}
              placeholder="name@company.com" autoComplete="email"
              error={f.primaryEmail.trim() && !isValidEmail(f.primaryEmail) ? INVALID_EMAIL_MSG : null} showError={showErrors} />
            <Field label="Primary Phone" type="tel" required isMissing={cleanPhone(f.primaryPhone) === ''} value={f.primaryPhone} onChange={(v) => set('primaryPhone')(dedupePhonePrefix(v))}
              placeholder={`${phonePrefix}8xx xxxx xxxx`} autoComplete="tel" prefix={phonePrefix} />
            <div className="space-y-3.5 border-t border-slate-200 pt-3.5">
              <BillingField label="Billing Contact" type="text" required value={f.billingContact} mirrored={f.primaryContact}
                sourceLabel="Primary Contact" placeholder="Person who receives invoices" onChange={set('billingContact')} />
              <BillingField label="Billing Email" type="email" required value={f.billingEmail} mirrored={f.primaryEmail}
                sourceLabel="Primary Email" placeholder="finance@company.com" onChange={set('billingEmail')}
                error={f.billingEmail !== null && f.billingEmail.trim() && !isValidEmail(f.billingEmail) ? INVALID_EMAIL_MSG : null} showError={showErrors} />
              <BillingField label="Billing Phone" type="tel" required value={f.billingPhone} mirrored={f.primaryPhone}
                sourceLabel="Primary Phone" placeholder={`${phonePrefix}…`} prefix={phonePrefix} onChange={(v) => set('billingPhone')(v === null ? null : dedupePhonePrefix(v))} />
            </div>
          </Card>

          <Card title="CE (Customer Engagement)" subtitle="Priced from MAU and plan">
            <div className="grid grid-cols-2 gap-3">
              <Field label="MAU" value={f.mau} onChange={set('mau')} required />
              <Select label="Plan" value={f.market} options={['Enterprise', 'Growth'] as Market[]} onChange={set('market')} />
            </div>
            <ReadOnlyField
              label="CE Price ($ / month)"
              value={platform.ok ? usd(platform.monthly) : platform.message}
              hint={platform.ok ? `${f.market} list price, ${platform.band} MAU band` : undefined}
            />
            <ReadOnlyField
              label="Event container (Mn / year)"
              value={platform.ok ? `${platform.eventsMn.toLocaleString('en-US')} Mn events` : platform.message}
              hint={platform.ok ? 'Included with this MAU band' : undefined}
            />
          </Card>

          <Card title="PX (Product Experience, Nudges and Contextual Walkthroughs)">
            <label
              className={cx(
                'flex cursor-pointer items-center gap-3 rounded-md border px-4 py-3 text-xs font-medium transition',
                f.includePx ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
              )}
            >
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                checked={f.includePx}
                onChange={(e) => set('includePx')(e.target.checked)}
              />
              Include PX
              <span className="ml-auto text-[11px] font-normal text-slate-500">{f.includePx ? 'Added to Platform Fee' : 'Not included'}</span>
            </label>
            {f.includePx && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <ReadOnlyField label="Version" value={DEFAULT_PX_VERSION} hint="Top tier, applied automatically" />
                  <ReadOnlyField
                    label="MAU"
                    value={mauNum ? mauNum.toLocaleString('en-US') : 'Enter MAU in the CE section'}
                    hint="Same as the CE section"
                  />
                </div>
                <ReadOnlyField
                  label="PX Price ($ / month)"
                  value={pxPrice.ok ? usd(pxPrice.monthly) : pxPrice.message}
                  hint={pxPrice.ok ? `${DEFAULT_PX_VERSION}, up to ${(pxPrice.tierMau / 1e6).toLocaleString('en-US')} Mn MAU tier` : undefined}
                />
                <ReadOnlyField
                  label="Total event container: CE + PX (Mn / year)"
                  value={
                    !pxPrice.ok
                      ? pxPrice.message
                      : platform.ok
                        ? `${(platform.eventsMn + pxPrice.eventsMn).toLocaleString('en-US')} Mn events`
                        : platform.message
                  }
                  hint={
                    pxPrice.ok && platform.ok
                      ? `${platform.eventsMn.toLocaleString('en-US')} Mn CE base + ${pxPrice.eventsMn.toLocaleString('en-US')} Mn PX (${DEFAULT_PX_VERSION} tier)`
                      : undefined
                  }
                />
                {platform.ok && pxPrice.ok && (
                  <ReadOnlyField
                    label="Platform Fee: CE + PX ($ / month)"
                    value={usd(platform.monthly + pxPrice.monthly)}
                    hint="Shown as Platform (Fee) on the SOF"
                  />
                )}
              </>
            )}
          </Card>

          <Card title="Term">
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Total duration (months)"
                value={f.totalContractDurationMonths}
                onChange={onDurationChange}
                onBlur={onDurationBlur}
                min={MIN_TERM_MONTHS}
                hint="Minimum 12 months"
                required
              />
              <Field
                label="Complimentary months"
                value={f.complimentaryMonths}
                onChange={set('complimentaryMonths')}
                placeholder="0"
              />
            </div>
            <Field label="Subscription start date" type="date" value={f.subscriptionStartDate} onChange={set('subscriptionStartDate')} />
            <div className="sof-billing-start space-y-2">
              <ReadOnlyField
                label="Billing start date"
                value={f.billingStartTbd ? BILLING_START_TBD_TEXT : billingStartPreview(f) ?? ''}
                hint={
                  f.billingStartTbd
                    ? 'The SOF will show "TBD - To be Discussed" instead of a date'
                    : billingStartPreview(f)
                      ? 'Subscription start date + complimentary months'
                      : 'Set the subscription start date to calculate it'
                }
              />
              <label
                className={cx(
                  'sof-tbd flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition',
                  f.billingStartTbd ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
                )}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 accent-amber-600"
                  checked={f.billingStartTbd}
                  onChange={(e) => set('billingStartTbd')(e.target.checked)}
                />
                TBD - To be Discussed
              </label>
            </div>
          </Card>

          <Card title="Fees">
            <Field label="Onboarding Fee ($)" value={f.onboardingFee} onChange={set('onboardingFee')} required placeholder="Enter amount">
              <DiscountToggle checked={f.onboardingFeeFullyDiscounted} onChange={set('onboardingFeeFullyDiscounted')} />
            </Field>
            <Field label="CSM Fee ($ / month)" value={f.csmFee} onChange={set('csmFee')} required placeholder="Enter amount">
              <DiscountToggle checked={f.csmFeeFullyDiscounted} onChange={set('csmFeeFullyDiscounted')} />
            </Field>
          </Card>

          <Card title="Bundled Products">
            <Field label="AI Components ($ / month)" value={f.aiMonthly} onChange={set('aiMonthly')}>
              <DiscountToggle checked={f.aiFullyDiscounted} onChange={set('aiFullyDiscounted')} />
            </Field>
            <Field label="Emails per month" value={f.emailsPerMonth} onChange={set('emailsPerMonth')} placeholder="Blank = none" />
            <Field label="Pricing per email ($)" value={f.emailRate} onChange={set('emailRate')} placeholder={DEFAULT_EMAIL_RATE}
              hint="Monthly email price = emails × this rate; overage = this rate + 15%" />
            <Select
              label="Country / VAT"
              value={f.vatRate}
              options={VAT_OPTIONS}
              onChange={(v) => setF((s) => applyCountryRules({ ...s, vatRate: v }, countryLock))}
              locked={!!countryLock}
              hint={
                countryLock
                  ? `Locked to ${COUNTRY_NAME[countryLock]} for your account`
                  : `Uses the ${COUNTRY_NAME[countryFromVat(f.vatRate)]} SOF template`
              }
            />
          </Card>
        </aside>

        <main className="sof-preview min-w-0">
          <section className="overflow-hidden rounded-lg bg-white shadow-md ring-1 ring-slate-900/5 lg:sticky lg:top-5">
            <header className="flex items-center justify-between gap-4 bg-slate-800 px-5 py-2.5">
              <div>
                <h2 className="text-xs font-semibold tracking-wide text-white">Pricing &amp; SOF Preview</h2>
                <p className="sof-edit-status mt-0.5 text-[11px] text-slate-300">
                  {editing ? (
                    <>
                      Editing saved SOF: <span className="font-medium text-white">{editing.clientName}</span>
                      {editing.ownerEmail && <> · by {editing.ownerEmail}</>} · last saved{' '}
                      {new Date(editing.updatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </>
                  ) : onSave ? (
                    'New SOF, not saved yet'
                  ) : (
                    'Updates as you type'
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
              {editing && onNew && (
                <button
                  type="button"
                  className="sof-new-btn rounded-md px-3 py-2 text-xs font-medium text-slate-200 transition hover:bg-slate-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                  onClick={onNew}
                >
                  New SOF
                </button>
              )}
              {onSave && (
                <button
                  type="button"
                  title={editing ? 'Save your changes to this SOF' : 'Save this SOF to your history'}
                  className="sof-save-btn inline-flex items-center gap-2 rounded-md border border-slate-500 bg-slate-700 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-slate-800 disabled:opacity-60"
                  onClick={handleSave}
                  disabled={saving}
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
                    <path d="M4.25 2A2.25 2.25 0 002 4.25v11.5A2.25 2.25 0 004.25 18h11.5A2.25 2.25 0 0018 15.75V6.56a2.25 2.25 0 00-.66-1.59l-2.31-2.31A2.25 2.25 0 0013.44 2H4.25zM6 4.5a.5.5 0 01.5-.5h6a.5.5 0 01.5.5V7a.5.5 0 01-.5.5h-6A.5.5 0 016 7V4.5zm4 6.25a2.25 2.25 0 100 4.5 2.25 2.25 0 000-4.5z" />
                  </svg>
                  {saving ? 'Saving…' : editing ? 'Update SOF' : 'Save SOF'}
                </button>
              )}
              {onExport && (
                <ExportSplitButton onExport={handleExport} />
              )}
              </div>
            </header>
            <div className="p-5 lg:max-h-[calc(100vh-7rem)] lg:overflow-auto lg:p-6">
              {calc.ok ? (
                <SofPreview r={calc.r} client={client} billingStartTbd={f.billingStartTbd} />
              ) : (
                <div className="sof-empty py-6">
                  <h3 className="text-sm font-semibold text-slate-900">Sales Order Form preview</h3>
                  <p className="mt-1 text-xs text-slate-500">Fill in the remaining fields to see pricing:</p>
                  <ul className="mt-4 space-y-2">
                    {calc.errors.map((e) => (
                      <li key={e} className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        {e}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
