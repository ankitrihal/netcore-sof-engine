/**
 * pricingCalculator.ts
 * ---------------------------------------------------------------------------
 * Netcore CE (Customer Engagement) pricing calculator, pure TypeScript, no deps.
 *
 * Source of truth:
 *   - "CE-MTU Calculator USD - PH  ID.xlsx"
 *       · CE Price Sheet       → MAU buckets, listed price, lowest accepted price,
 *                                 yearly event container (mn) per market
 *       · CE Calculator (USD)  → offer price = list − Mgr1 − Mgr2 discount,
 *                                 overage rate = (offer / MAU) × 1.35,
 *                                 max overage discount = 85% of overage rate,
 *                                 final offer = offer + enhanced container add-on
 *       · Calculation          → Mgr1 cap = 40%, Mgr2 cap = 60% of (list − floor)
 *       · Addon Price Sheet    → enhanced container, overage increment buckets,
 *                                 S3 export, recommendations, attribute storage,
 *                                 app inbox cards, co-marketer, onboarding fee,
 *                                 "PX with CE" (= $0, i.e. bundled free)
 *   - "NETCORE PRICING.xlsx" (Pricing sheet) → Email tiers (INR / 70 = USD)
 *   - PX rate card (Product Experience, Nudges & Contextual Walkthroughs) by MAU tier
 *     and version; matches the sheet's "CW & Nudges Pricing" (INR / 70)
 *   - Flin & Lotte Mart SOFs → SOF structure: One-Time Setup, Platform Fee,
 *       Bundled Products, Shared CSM, TCV, "You Save", complimentary period.
 *
 * All money is USD. Sheet prices are stored in INR and converted exactly as the
 * workbooks do (CE sheet ÷ 85, Email sheet ÷ 70) so results match the Excel.
 * Monthly figures are per month; "paid term" figures multiply by paid months.
 * ---------------------------------------------------------------------------
 */

// ============================================================================
// Constants & rate tables (from the workbooks)
// ============================================================================

export const INR_PER_USD_CE = 85; // CE-MTU Calculator conversion
export const INR_PER_USD_EMAIL = 70; // NETCORE PRICING conversion

/** Overage offer rate = (offer price / MAU) × (1 + 35%) — CE Calculator!B12 */
export const DEFAULT_MAU_OVERAGE_MARKUP = 0.35;
/** PX overage rate per MAU = (PX monthly price / MAU) × (1 + 15%) */
export const DEFAULT_PX_OVERAGE_MARKUP = 0.15;
/** CSM scope shown in the details column of the CSM row (preview and SOF). */
export const CSM_DETAILS =
  'After Sales Support, Training, Best Practices, Recommendations and Suggestions, Weekly reporting and QBRs.';

/** CSM details text when the CSM is part of the deal (paid or complimentary), else ''. */
export const csmDetails = (csm: { monthlyList: number; fullyDiscounted: boolean }) =>
  csm.monthlyList > 0 || csm.fullyDiscounted ? CSM_DETAILS : '';

/** Shown instead of a date when the Billing Start Date is still To Be Discussed. */
export const BILLING_START_TBD_TEXT = 'TBD - To be Discussed';
/** Email overage rate = base per-email rate × (1 + 15%) */
export const DEFAULT_EMAIL_OVERAGE_MARKUP = 0.15;
/** "Max discount offer" on overage rate = 85% of the offer rate — CE Calculator!C12 */
export const MAX_OVERAGE_DISCOUNT_FLOOR = 0.85;
/** Manager discount caps as share of (listed − lowest accepted) — Calculation!B6:B7 */
export const MANAGER1_DISCOUNT_CAP = 0.4;
export const MANAGER2_DISCOUNT_CAP = 0.6;
/** Local IDC = +15% on the LISTED price (not discounted) — CE Calculator!B27 */
export const LOCAL_IDC_UPLIFT = 0.15;
/** AI Components (Standard) monthly list. Not in the Excel; SOF precedent: Lotte $1,000. */
export const DEFAULT_AI_COMPONENTS_MONTHLY = 1000;

export type Market = 'Growth' | 'Enterprise';

interface CeBucketRow {
  market: Market;
  upperMau: number; // bucket is (previous upper, upperMau]
  label: string;
  yearlyEventsMn: number; // included yearly event container (mn)
  listInr: number; // "Pricing" (monthly)
  floorInr: number; // "Lowest Accepted Price" (monthly)
  mtuOverageRef: number; // sheet column K "MTU Overage" (reference only; unit not stated)
}

// prettier-ignore
const CE_PRICE_SHEET: CeBucketRow[] = ([
  ['Growth', 200000, '0 to 200k', 50, 75000, 75000, 0.38],
  ['Growth', 300000, '200k to 300k', 50, 85000, 85000, 0.28],
  ['Growth', 400000, '300k to 400k', 75, 100000, 100000, 0.25],
  ['Growth', 500000, '400k to 500k', 100, 125000, 115000, 0.25],
  ['Growth', 750000, '500k to 750k', 150, 170000, 140000, 0.23],
  ['Growth', 1000000, '750k to 1mn', 250, 225000, 165000, 0.23],
  ['Growth', 1250000, '1mn to 1.25mn', 250, 255000, 190000, 0.2],
  ['Growth', 1500000, '1.25mn to 1.5mn', 250, 285000, 215000, 0.19],
  ['Growth', 1750000, '1.5mn to 1.75mn', 250, 315000, 240000, 0.18],
  ['Growth', 2000000, '1.75mn to 2mn', 500, 350000, 260000, 0.18],
  ['Growth', 2500000, '2mn to 2.5mn', 500, 412500, 305000, 0.17],
  ['Growth', 3000000, '2.5mn to 3mn', 750, 475000, 350000, 0.16],
  ['Growth', 3500000, '3mn to 3.5mn', 750, 525000, 395000, 0.15],
  ['Growth', 4000000, '3.5mn to 4mn', 750, 575000, 440000, 0.14],
  ['Growth', 4500000, '4mn to 4.5mn', 750, 625000, 480000, 0.14],
  ['Growth', 5000000, '4.5mn to 5mn', 1000, 675000, 520000, 0.14],
  ['Enterprise', 200000, '0 to 200k', 50, 90000, 90000, 0.45],
  ['Enterprise', 300000, '200k to 300k', 50, 112500, 105000, 0.38],
  ['Enterprise', 400000, '300k to 400k', 75, 125000, 125000, 0.31],
  ['Enterprise', 500000, '400k to 500k', 100, 160000, 150000, 0.32],
  ['Enterprise', 750000, '500k to 750k', 150, 232500, 185000, 0.31],
  ['Enterprise', 1000000, '750k to 1mn', 250, 310000, 220000, 0.31],
  ['Enterprise', 1250000, '1mn to 1.25mn', 250, 375000, 255000, 0.3],
  ['Enterprise', 1500000, '1.25mn to 1.5mn', 250, 430000, 290000, 0.29],
  ['Enterprise', 1750000, '1.5mn to 1.75mn', 250, 480000, 320000, 0.27],
  ['Enterprise', 2000000, '1.75mn to 2mn', 500, 530000, 350000, 0.27],
  ['Enterprise', 2500000, '2mn to 2.5mn', 500, 570000, 390000, 0.23],
  ['Enterprise', 3000000, '2.5mn to 3mn', 750, 615000, 430000, 0.21],
  ['Enterprise', 3500000, '3mn to 3.5mn', 750, 660000, 470000, 0.19],
  ['Enterprise', 4000000, '3.5mn to 4mn', 750, 705000, 510000, 0.18],
  ['Enterprise', 4500000, '4mn to 4.5mn', 750, 750000, 550000, 0.17],
  ['Enterprise', 5000000, '4.5mn to 5mn', 1000, 790000, 590000, 0.16],
] as const).map(([market, upperMau, label, yearlyEventsMn, listInr, floorInr, mtuOverageRef]) => ({
  market, upperMau, label, yearlyEventsMn, listInr, floorInr, mtuOverageRef,
}));

/** Enhanced Base / Add-on event storage, monthly — Addon Price Sheet A:C */
const ENHANCED_CONTAINER_TIERS = [
  { addMn: 50, inr: 15000 },
  { addMn: 100, inr: 25000 },
  { addMn: 250, inr: 50000 },
  { addMn: 500, inr: 75000 },
  { addMn: 1000, inr: 120000 },
];

/** Increment Bucket – Overages — Addon Price Sheet AC:AD */
export type OverageBucketMn = 50 | 100 | 250;
const OVERAGE_INCREMENT_BUCKETS: Record<OverageBucketMn, number> = { 50: 15000, 100: 25000, 250: 50000 };

/** Event Export via S3 (once a day) — Addon Price Sheet E:F (monthly) */
const S3_EXPORT = { upTo100Mn: 24000, upTo200Mn: 40000, perAdditional100Mn: 16000 };

/** Recommendations on channels — Addon Price Sheet H:I (monthly) */
const RECOMMENDATIONS = [
  { maxApiCalls: 300_000, inr: 60000 },
  { maxApiCalls: 500_000, inr: 85000 },
  { maxApiCalls: 1_000_000, inr: 110000 },
];

/** Additional attribute storage — Addon Price Sheet Q:R (monthly) */
const ATTRIBUTE_STORAGE = [
  { maxAttributes: 200, inr: 0 },
  { maxAttributes: 250, inr: 10000 },
];

/** Cards (App Inbox) — Addon Price Sheet Z:AA (monthly) */
const APP_INBOX_CARDS = [
  { maxPush: 5_000_000, inr: 12000 },
  { maxPush: 10_000_000, inr: 20000 },
  { maxPush: 20_000_000, inr: 40000 },
  { maxPush: 50_000_000, inr: 100000 },
  { maxPush: 100_000_000, inr: 160000 },
];

/** Co-Marketer (Growth plan only) — Addon Price Sheet AF:AG (monthly) */
const CO_MARKETER = [
  { maxMau: 500_000, inr: 50000 },
  { maxMau: 1_000_000, inr: 75000 },
  { maxMau: Infinity, inr: 90000 },
];

/** Email (promotional) monthly tiers — NETCORE PRICING!G:H (INR, ÷70) */
const EMAIL_TIERS = [
  { emails: 100_000, inr: 50000 },
  { emails: 300_000, inr: 75000 },
  { emails: 500_000, inr: 105000 },
  { emails: 1_000_000, inr: 140000 },
  { emails: 2_000_000, inr: 245000 },
  { emails: 3_000_000, inr: 350000 },
  { emails: 4_000_000, inr: 420000 },
  { emails: 5_000_000, inr: 490000 },
  { emails: 7_000_000, inr: 560000 },
  { emails: 10_000_000, inr: 630000 },
];

/**
 * PX (Product Experience, Nudges & Contextual Walkthroughs), USD per month.
 * MAU is placed in the smallest tier that covers it (≤ 500K → 500K tier).
 */
export type PxVersion = 'Standard' | 'Enterprise';
export const PX_RATE_CARD: { tierMau: number; Standard: { usd: number; eventsMn: number }; Enterprise: { usd: number; eventsMn: number } }[] = [
  { tierMau: 500_000, Standard: { usd: 1057.14, eventsMn: 50 }, Enterprise: { usd: 1585.71, eventsMn: 100 } },
  { tierMau: 1_000_000, Standard: { usd: 1585.71, eventsMn: 100 }, Enterprise: { usd: 2114.29, eventsMn: 200 } },
  { tierMau: 2_000_000, Standard: { usd: 2114.29, eventsMn: 150 }, Enterprise: { usd: 3171.43, eventsMn: 300 } },
  { tierMau: 5_000_000, Standard: { usd: 4228.57, eventsMn: 200 }, Enterprise: { usd: 5285.71, eventsMn: 400 } },
  { tierMau: 10_000_000, Standard: { usd: 5814.29, eventsMn: 250 }, Enterprise: { usd: 7400.0, eventsMn: 500 } },
  { tierMau: 20_000_000, Standard: { usd: 6342.86, eventsMn: 375 }, Enterprise: { usd: 7928.57, eventsMn: 750 } },
  { tierMau: 50_000_000, Standard: { usd: 7400.0, eventsMn: 500 }, Enterprise: { usd: 8985.71, eventsMn: 1000 } },
];

/** Name of the PX row under Bundled Products on the SOF. */
export const PX_PRODUCT_NAME = 'Product Experience, Nudges and Contextual Walkthroughs';

/** PX row details: the combined PX event pool, e.g. "500K MAU with 200 Mio Events / Year" (100 Mio CE + 100 Mio PX). */
export const pxDetails = (px: { mauLabel: string; eventsLabel: string; totalEventsYearlyMn?: number }) =>
  px.totalEventsYearlyMn
    ? `${px.mauLabel} MAU with ${fmtEvents(px.totalEventsYearlyMn)} Events / Year` // CE base + PX tier, as on the calculator
    : `${px.mauLabel} MAU with ${px.eventsLabel} Events / Year`;

/** PX overage line, e.g. "Overages: USD 0.003647 per MAU, billable monthly". */
export const pxOverageText = (px: { overageRatePerMau: number }) =>
  `Overages: USD ${px.overageRatePerMau} per MAU, billable monthly`;

/**
 * PX version applied automatically when PX is included (there is no version picker):
 * the top tier, Enterprise. Change here to apply a different version everywhere.
 */
export const DEFAULT_PX_VERSION: PxVersion = 'Enterprise';

/** PX price and event container for a MAU and version; null above 50 Mio MAU (custom pricing). */
export function findPxRate(mau: number, version: PxVersion = DEFAULT_PX_VERSION) {
  const tier = PX_RATE_CARD.find((t) => mau <= t.tierMau);
  return tier ? { tierMau: tier.tierMau, ...tier[version] } : null;
}

const ceUsd = (inr: number) => inr / INR_PER_USD_CE;
const emailUsd = (inr: number) => inr / INR_PER_USD_EMAIL;
/** Drop floating-point noise without rounding real digits: 0.0011 × 1.15 → 0.001265, 0.00137 × 1.15 → 0.0015755. */
const cleanRate = (n: number) => +n.toPrecision(12);

// ============================================================================
// Input / output types
// ============================================================================

export type DateInput = string | Date; // 'YYYY-MM-DD' recommended

/** Connector channels offered in Bundled Products, in display order. */
export const CONNECTOR_CHANNELS = ['WhatsApp', 'Viber', 'SMS'] as const;
export type ConnectorChannel = (typeof CONNECTOR_CHANNELS)[number];
const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/** 'Connector Maintenance Cost (for two components)' */
export const connectorDetails = (count: number) =>
  `Connector Maintenance Cost (for ${COUNT_WORDS[count] ?? String(count)} component${count === 1 ? '' : 's'})`;

export interface Waivable {
  /** true → shown at list price but waived (counts toward "You Save") */
  complimentary?: boolean;
}

export interface BundledProductInput extends Waivable {
  name: string;
  details?: string;
  monthlyListPrice: number;
}

export interface PricingInput {
  /** Contracted Monthly Active Users (MAU / MTU). */
  mau: number;
  /** Plan / market column in the CE Price Sheet. Default 'Enterprise'. */
  market?: Market;
  /**
   * Requested yearly event container (mn events). If above what the MAU bucket
   * includes, the smallest Enhanced Base add-on that covers the gap is added.
   */
  eventContainerMn?: number;

  /**
   * Total contract length in months, complimentary + paid (e.g. 13 for Flin-style
   * "1 month complimentary + 12 paid"). Drives the TCV. If omitted, derived from
   * subscriptionStartDate → subscriptionEndDate.
   */
  totalContractDurationMonths?: number;
  /**
   * Months at the start of the contract during which Platform Fee and bundled
   * products are free. Default 0. If omitted but billingStartDate / complimentaryUntil
   * is given, derived from the dates.
   */
  complimentaryMonths?: number | null;

  /** Optional. When given with the month counts, billing start and end dates are computed for the SOF. */
  subscriptionStartDate?: DateInput;
  /** Optional, inclusive. Only used if totalContractDurationMonths is omitted. */
  subscriptionEndDate?: DateInput;
  /** Optional. Only used if complimentaryMonths is omitted. First paid day. */
  billingStartDate?: DateInput;
  /** Optional alternative to billingStartDate: last complimentary day (inclusive). */
  complimentaryUntil?: DateInput;
  /** Date-derived months only: 'exact' = fractional partial months (default); 'ceil' = round up. */
  monthCounting?: 'exact' | 'ceil';

  /** Negotiated monthly platform fee. Overrides list − manager discounts. */
  platformFeeMonthly?: number;
  /** Manager 1 discount, USD/month (capped at 40% of list − floor). */
  manager1Discount?: number;
  /** Manager 2 discount, USD/month (capped at 60% of list − floor). */
  manager2Discount?: number;

  /**
   * REQUIRED. One-time onboarding / setup fee in USD, entered manually (0 allowed).
   * No default is applied.
   */
  onboardingFee: number;
  /** 100% discount: the fee is shown struck through and counted in "You Save", not TCV. */
  onboardingFeeFullyDiscounted?: boolean;

  /**
   * REQUIRED. CSM fee in USD per month, entered manually (0 allowed). No default is applied.
   * Billed for paid months only.
   */
  csmFee: number;
  /** 100% discount: the fee is shown struck through and counted in "You Save", not TCV. */
  csmFeeFullyDiscounted?: boolean;
  /** Label only. Default 'Shared'. */
  csmResourceType?: 'Shared' | 'Dedicated';

  /**
   * PX module. Omit (or leave undefined) to exclude PX entirely.
   * When included, Platform Fee = CE price + PX price, and PX uses the same MAU as CE.
   */
  px?: { version?: PxVersion }; // version defaults to DEFAULT_PX_VERSION (Enterprise)

  bundled?: {
    /** AI Components (Standard). Default included at $1,000/mo list, complimentary. Pass false to omit. */
    aiComponents?: boolean | ({ monthlyListPrice?: number } & Waivable);
    /** Promotional email bundle priced from NETCORE PRICING tiers unless monthlyListPrice given. */
    /** overagePerEmail is a final-rate override; otherwise overage = base per-email rate × (1 + emailOverageMarkup). */
    /** unitPrice = the custom price per email entered on the quote; overage = unitPrice × 1.15 exactly. */
    email?: { emailsPerMonth: number; monthlyListPrice?: number; unitPrice?: number; overagePerEmail?: number } & Waivable;
    /** Optional connector channels (WhatsApp, Viber, SMS). Row appears only when ≥1 channel is selected. */
    connectors?: { channels: ConnectorChannel[]; monthlyListPrice?: number } & Waivable;
    custom?: BundledProductInput[];
  };

  addons?: {
    /** Event export via S3 (once a day) — exported events per month, in mn. */
    s3Export?: { monthlyEventsMn: number } & Waivable;
    /** Recommendations on channels — API calls per month. */
    recommendations?: { apiCallsPerMonth: number } & Waivable;
    /** Total attributes stored (≤200 free, ≤250 paid). */
    attributeStorage?: { attributes: number } & Waivable;
    /** Cards (App Inbox) — push notifications per month. */
    appInboxCards?: { pushPerMonth: number } & Waivable;
    /** Co-Marketer — Growth plan only, priced by MAU. */
    coMarketer?: boolean | Waivable;
    /** Local IDC: +15% on listed platform price (incl. container upgrade). */
    localIdc?: boolean | Waivable;
    custom?: BundledProductInput[];
  };

  /** Event overage increment bucket size (mn). Default 50. */
  eventOverageBucketMn?: OverageBucketMn;
  /** Override event overage price per 1 mn events (e.g. Lotte SOF: 2,500). */
  eventOveragePerMillion?: number;
  /** MAU overage markup on (offer / MAU). Default 0.35 per sheet; Lotte SOF used 0. */
  mauOverageMarkup?: number;
  /** Override MAU overage rate per user directly. */
  mauOverageRate?: number;
  /** PX overage premium over (PX price / MAU). Default 0.15 (15%). */
  pxOverageMarkup?: number;
  /** Email overage premium over the base per-email rate. Default 0.15 (15%). */
  emailOverageMarkup?: number;

  /** Include complimentary-period value in "You Save". Default false (matches Flin SOF figure). */
  includeComplimentaryPeriodInSavings?: boolean;
  /** e.g. 0.11 for Indonesia, 0.12 for Philippines. Omit for ex-VAT. */
  vatRate?: number;
}

export type LineCategory = 'platform' | 'bundled' | 'addon';

export interface LineItem {
  key: string;
  name: string;
  /** Connectors row only: the selected channels, in display order. */
  channels?: string[];
  category: LineCategory;
  details: string;
  monthlyList: number;
  /** true → 100% discounted: price shown struck through, value counted in "You Save" */
  fullyDiscounted: boolean;
  monthlyNet: number;
  paidTermList: number;
  paidTermNet: number;
}

export interface PricingResult {
  term: {
    totalContractDurationMonths: number;
    complimentaryMonths: number;
    /** totalContractDurationMonths − complimentaryMonths */
    paidMonths: number;
    /** '({c} Months Complimentary + {p} Months Paid)', or '' when complimentaryMonths is 0/blank */
    contractTermDescription: string;
    subscriptionStartDate: string | null;
    billingStartDate: string | null;
    subscriptionEndDate: string | null;
  };
  bucket: { market: Market; label: string; lowerMauExclusive: number; upperMau: number };
  platformFee: {
    listedMonthly: number;
    lowestAcceptedMonthly: number;
    discountMonthly: number;
    offerMonthly: number;
    eventContainerUpgradeMonthly: number;
    /** CE part: offer + container upgrade */
    ceMonthly: number;
    /** PX part (0 when PX is not included) */
    pxMonthly: number;
    /** CE + PX: SOF "Platform (Fee)" monthly */
    monthly: number;
    paidTermTotal: number;
    details: string;
  };
  /** null when PX is not included */
  px: {
    version: PxVersion;
    tierMau: number;
    monthly: number;
    paidTermTotal: number;
    eventsYearlyMn: number;
    /** "500K" */
    mauLabel: string;
    /** "100 Mio", "1,000 Mio" */
    eventsLabel: string;
    /** USD per MAU above the contracted MAU = (monthly / MAU) × 1.15 */
    overageRatePerMau: number;
    /** CE base event container (Mio / year) the PX pool builds on; the CE container itself is unchanged */
    ceBaseEventsMn: number;
    /** PX total event container = CE base + PX tier allowance (CW & Nudges sheet), Mio / year */
    totalEventsYearlyMn: number;
  } | null;
  eventContainer: {
    includedYearlyMn: number;
    upgradeMn: number;
    totalYearlyMn: number;
    requestedYearlyMn: number | null;
  };
  overages: {
    mauRatePerUser: number;
    mauFloorRatePerUser: number;
    eventBucketMn: number;
    eventPricePerBucket: number;
    eventPricePerMillion: number;
    eventPricePerEvent: number;
    emailPerEmail: number | null;
    /** PX overage per MAU; null when PX is not included */
    pxPerMau: number | null;
  };
  bundledProducts: LineItem[];
  addons: LineItem[];
  oneTimeSetupFees: { list: number; net: number; fullyDiscounted: boolean };
  /** The CSM line item (also included in addons). */
  csm: LineItem;
  totals: {
    monthlyRecurringList: number;
    monthlyRecurringNet: number;
    /** Setup + all items at list over the paid term (SOF struck-through TCV) */
    listTCV: number;
    /** What the client pays over the paid term, ex-VAT (SOF bold TCV) */
    totalContractValue: number;
    /** Value of platform + bundled products given free during the complimentary period */
    complimentaryPeriodValue: number;
    youSave: number;
    vat: number;
    totalContractValueInclVat: number;
    /** Same string as term.contractTermDescription, returned with the totals for convenience. */
    contractTermDescription: string;
  };
  warnings: string[];
}

// ============================================================================
// Date helpers (UTC, inclusive end dates)
// ============================================================================

const DAY_MS = 86_400_000;

function toUtcDate(d: DateInput): Date {
  if (d instanceof Date) return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const p = new Date(d);
  if (isNaN(p.getTime())) throw new Error(`Invalid date: ${d}`);
  return new Date(Date.UTC(p.getFullYear(), p.getMonth(), p.getDate()));
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);

function addMonthsUtc(d: Date, n: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const target = new Date(Date.UTC(y, m, 1));
  const dim = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d.getUTCDate(), dim)));
}

/** Months in [start, endInclusive]. 1 Jan → 31 Dec = 12. Partial month = days / days-in-that-month. */
export function monthsBetween(start: DateInput, endInclusive: DateInput, mode: 'exact' | 'ceil' = 'exact'): number {
  const s = toUtcDate(start);
  const endExcl = addDays(toUtcDate(endInclusive), 1);
  if (endExcl <= s) return 0;
  let whole = 0;
  while (addMonthsUtc(s, whole + 1) <= endExcl) whole++;
  const cursor = addMonthsUtc(s, whole);
  const next = addMonthsUtc(s, whole + 1);
  const frac = (endExcl.getTime() - cursor.getTime()) / (next.getTime() - cursor.getTime());
  if (frac <= 1e-9) return whole;
  return mode === 'ceil' ? whole + 1 : whole + frac;
}

// ============================================================================
// Term resolution
// ============================================================================

const fmtMonths = (n: number) => String(Math.round(n * 100) / 100);

/** Manual fees have no default: throw unless a real number ≥ 0 was entered. */
function requireManualFee(name: string, v: unknown): void {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0)
    throw new Error(`${name} is required: enter a value in USD (0 or more).`);
}

/**
 * '({complimentaryMonths} Months Complimentary + {paidMonths} Months Paid)'.
 * Returns '' when there is no complimentary period (0 or blank).
 */
export function buildContractTermDescription(complimentaryMonths: number | null | undefined, paidMonths: number): string {
  if (!complimentaryMonths) return '';
  return `(${fmtMonths(complimentaryMonths)} Months Complimentary + ${fmtMonths(paidMonths)} Months Paid)`;
}

interface ResolvedTerm {
  totalContractDurationMonths: number;
  complimentaryMonths: number;
  paidMonths: number;
  contractTermDescription: string;
  subscriptionStartDate: string | null;
  billingStartDate: string | null;
  subscriptionEndDate: string | null;
}

/**
 * Month counts come first: totalContractDurationMonths and complimentaryMonths
 * set the term directly, and paidMonths = total − complimentary. Dates are only a
 * fallback for whichever count is missing, and are computed for display when a
 * start date is given.
 */
export function resolveTerm(input: PricingInput, warnings: string[] = []): ResolvedTerm {
  const mode = input.monthCounting ?? 'exact';
  let start = input.subscriptionStartDate !== undefined ? toUtcDate(input.subscriptionStartDate) : null;

  // Total duration
  let total = input.totalContractDurationMonths;
  if (total === undefined) {
    if (!start || input.subscriptionEndDate === undefined)
      throw new Error('Provide totalContractDurationMonths, or both subscriptionStartDate and subscriptionEndDate.');
    const end = toUtcDate(input.subscriptionEndDate);
    if (end < start) throw new Error('subscriptionEndDate is before subscriptionStartDate');
    total = monthsBetween(start, end, mode);
  }
  if (!(total > 0)) throw new Error('totalContractDurationMonths must be greater than 0');

  // Complimentary months
  let comp: number | undefined =
    input.complimentaryMonths === null || Number.isNaN(input.complimentaryMonths as number)
      ? undefined
      : input.complimentaryMonths;
  if (comp === undefined) {
    let billing: Date | null = null;
    if (input.billingStartDate !== undefined) billing = toUtcDate(input.billingStartDate);
    else if (input.complimentaryUntil !== undefined) billing = addDays(toUtcDate(input.complimentaryUntil), 1);
    comp = billing && start && billing > start ? monthsBetween(start, addDays(billing, -1), mode) : 0;
    if (billing && !start) warnings.push('billingStartDate/complimentaryUntil ignored: no subscriptionStartDate given.');
  }
  if (comp < 0) throw new Error('complimentaryMonths cannot be negative');
  if (comp >= total) throw new Error('complimentaryMonths must be less than totalContractDurationMonths');

  const paid = total - comp;

  // Billing-first: only a Billing Start Date given → the subscription starts `comp` months
  // earlier (the complimentary period), or on the billing date when there are none
  let billingAnchor: Date | null = null;
  if (!start && input.billingStartDate !== undefined && Number.isInteger(comp)) {
    billingAnchor = toUtcDate(input.billingStartDate);
    start = addMonthsUtc(billingAnchor, -comp);
  }

  // Display dates: start + comp months = billing start; start + total months − 1 day = end
  const wholeOrNull = (n: number) => (Number.isInteger(n) ? n : null);
  let billingIso: string | null = null;
  let endIso: string | null = null;
  if (start) {
    const c = wholeOrNull(comp);
    const t = wholeOrNull(total);
    if (billingAnchor) billingIso = iso(billingAnchor); // exactly the date chosen
    else if (c !== null) billingIso = iso(addMonthsUtc(start, c));
    if (t !== null) endIso = iso(addDays(addMonthsUtc(start, t), -1));
    if (c === null || t === null) warnings.push('Fractional month counts: billing/end dates not computed.');
  }

  return {
    totalContractDurationMonths: total,
    complimentaryMonths: comp,
    paidMonths: paid,
    contractTermDescription: buildContractTermDescription(comp, paid),
    subscriptionStartDate: start ? iso(start) : null,
    billingStartDate: billingIso,
    subscriptionEndDate: endIso,
  };
}

// ============================================================================
// Lookups
// ============================================================================

export function findBucket(mau: number, market: Market) {
  const rows = CE_PRICE_SHEET.filter((r) => r.market === market);
  let lower = 0;
  for (const r of rows) {
    if (mau > lower && mau <= r.upperMau) return { row: r, lowerMauExclusive: lower };
    lower = r.upperMau;
  }
  return null; // sheet returns 0 → custom pricing required
}

function tierPick<T>(tiers: T[], ok: (t: T) => boolean): T | undefined {
  return tiers.find(ok);
}

// ============================================================================
// Main calculator
// ============================================================================

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r6 = (n: number) => Math.round((n + Number.EPSILON) * 1e6) / 1e6;
const fmtInt = (n: number) => n.toLocaleString('en-US');
const fmtMau = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(2)} Mio` : `${+(n / 1e3).toFixed(1)}K`);
/** 100 → "100 Mio", 1400 → "1,400 Mio" */
const fmtEvents = (mn: number) => `${fmtInt(mn)} Mio`; // always in millions, e.g. "1,400 Mio"

function asOpts<T extends object>(v: boolean | T | undefined, dflt: boolean): (T & Waivable) | null {
  if (v === undefined) return dflt ? ({} as T) : null;
  if (v === false) return null;
  if (v === true) return {} as T;
  return v as T & Waivable;
}

export function calculatePricing(input: PricingInput): PricingResult {
  const warnings: string[] = [];
  const market: Market = input.market ?? 'Enterprise';
  const { mau } = input;
  if (!(mau > 0)) throw new Error('mau must be a positive number');
  requireManualFee('onboardingFee', input.onboardingFee);
  requireManualFee('csmFee', input.csmFee);

  // ---- Term & complimentary period -------------------------------------
  const term = resolveTerm(input, warnings);
  const { complimentaryMonths, paidMonths } = term;

  // ---- Bucket & platform fee -------------------------------------------
  const hit = findBucket(mau, market);
  if (!hit) {
    throw new Error(
      `MAU ${fmtInt(mau)} is outside the ${market} price sheet (max 5,000,000). Custom pricing required.`,
    );
  }
  const { row, lowerMauExclusive } = hit;
  const listed = ceUsd(row.listInr);
  const floor = ceUsd(row.floorInr);
  const headroom = Math.max(0, listed - floor);

  let offer: number;
  if (input.platformFeeMonthly !== undefined) {
    offer = input.platformFeeMonthly;
    if (input.manager1Discount || input.manager2Discount)
      warnings.push('platformFeeMonthly given; manager discounts ignored.');
  } else {
    const d1 = input.manager1Discount ?? 0;
    const d2 = input.manager2Discount ?? 0;
    if (d1 > headroom * MANAGER1_DISCOUNT_CAP + 1e-9)
      warnings.push(`Manager 1 discount $${r2(d1)} exceeds cap $${r2(headroom * MANAGER1_DISCOUNT_CAP)}.`);
    if (d2 > headroom * MANAGER2_DISCOUNT_CAP + 1e-9)
      warnings.push(`Manager 2 discount $${r2(d2)} exceeds cap $${r2(headroom * MANAGER2_DISCOUNT_CAP)}.`);
    offer = listed - d1 - d2;
  }
  if (offer < floor - 1e-9)
    warnings.push(`Platform offer $${r2(offer)}/mo is below the lowest accepted price $${r2(floor)}/mo.`);

  // ---- Event container --------------------------------------------------
  const includedMn = row.yearlyEventsMn;
  const requested = input.eventContainerMn ?? null;
  let upgradeMn = 0;
  let upgradeMonthly = 0;
  if (requested !== null && requested > includedMn) {
    const gap = requested - includedMn;
    const tier = tierPick(ENHANCED_CONTAINER_TIERS, (t) => t.addMn >= gap);
    const chosen = tier ?? ENHANCED_CONTAINER_TIERS[ENHANCED_CONTAINER_TIERS.length - 1];
    if (!tier)
      warnings.push(
        `Requested container ${fmtInt(requested)} mn exceeds base + largest add-on (${includedMn + chosen.addMn} mn). Price the rest manually.`,
      );
    upgradeMn = chosen.addMn;
    upgradeMonthly = ceUsd(chosen.inr);
  }
  const totalYearlyMn = includedMn + upgradeMn;
  const ceMonthly = offer + upgradeMonthly;

  // ---- PX (optional) ----------------------------------------------------
  let px: PricingResult['px'] = null;
  if (input.px) {
    const version = input.px.version ?? DEFAULT_PX_VERSION;
    const rate = findPxRate(mau, version);
    if (!rate) throw new Error(`MAU ${fmtInt(mau)} is above the PX rate card (max 50,000,000). Custom pricing required.`);
    px = {
      version,
      tierMau: rate.tierMau,
      monthly: rate.usd,
      paidTermTotal: 0, // set in the result once paid months are applied
      eventsYearlyMn: rate.eventsMn,
      mauLabel: fmtMau(mau),
      eventsLabel: fmtEvents(rate.eventsMn),
      overageRatePerMau: r6((rate.usd / mau) * (1 + (input.pxOverageMarkup ?? DEFAULT_PX_OVERAGE_MARKUP))),
      ceBaseEventsMn: 0, // set in the result, once the CE container is known
      totalEventsYearlyMn: 0,
    };
  }
  const pxMonthly = px ? px.monthly : 0;
  const platformMonthly = ceMonthly + pxMonthly;

  // ---- Overages ---------------------------------------------------------
  const markup = input.mauOverageMarkup ?? DEFAULT_MAU_OVERAGE_MARKUP;
  const mauRate = input.mauOverageRate ?? (offer / mau) * (1 + markup);
  const bucketMn: OverageBucketMn = input.eventOverageBucketMn ?? 50;
  const perBucket =
    input.eventOveragePerMillion !== undefined
      ? input.eventOveragePerMillion * bucketMn
      : ceUsd(OVERAGE_INCREMENT_BUCKETS[bucketMn]);
  const perMillion = perBucket / bucketMn;

  // ---- Line-item builder ------------------------------------------------
  const mk = (
    key: string,
    name: string,
    category: LineCategory,
    details: string,
    monthlyList: number,
    complimentary = false,
  ): LineItem => {
    const monthlyNet = complimentary ? 0 : monthlyList;
    return {
      key,
      name,
      category,
      details,
      monthlyList: r2(monthlyList),
      fullyDiscounted: complimentary,
      monthlyNet: r2(monthlyNet),
      paidTermList: r2(monthlyList * paidMonths),
      paidTermNet: r2(monthlyNet * paidMonths),
      // keep unrounded copies for totals
      ...({ _ml: monthlyList, _mn: monthlyNet } as object),
    } as LineItem;
  };

  // ---- Bundled products -------------------------------------------------
  const bundled: LineItem[] = [];
  const b = input.bundled ?? {};
  const annualMau = mau * 12;

  const ai = asOpts(b.aiComponents, true);
  if (ai) {
    bundled.push(
      mk(
        'aiComponents',
        'AI Components (Standard)',
        'bundled',
        'Subject Line Optimization, Send Time Optimization, AI-Powered Segmentation & Targeting, ' +
          'Omnichannel AI Orchestration, AI Campaign Optimization, Analytics & AI Insights Dashboard',
        ai.monthlyListPrice ?? DEFAULT_AI_COMPONENTS_MONTHLY,
        ai.complimentary ?? true,
      ),
    );
  }
  if (b.connectors) {
    const chosen = CONNECTOR_CHANNELS.filter((c) => b.connectors!.channels.includes(c));
    if (chosen.length) {
      const item = mk(
        'connectors',
        'Connectors',
        'bundled',
        connectorDetails(chosen.length),
        b.connectors.monthlyListPrice ?? 0,
        b.connectors.complimentary ?? false,
      );
      item.channels = [...chosen];
      bundled.push(item);
    }
  }
  let emailOverage: number | null = null;
  if (b.email) {
    const e = b.email;
    const tier = tierPick(EMAIL_TIERS, (t) => t.emails >= e.emailsPerMonth);
    let price = e.monthlyListPrice;
    if (price === undefined) {
      if (!tier) {
        warnings.push(`Email volume ${fmtInt(e.emailsPerMonth)}/mo exceeds the 10 Mio tier; using the 10 Mio price.`);
      }
      const t = tier ?? EMAIL_TIERS[EMAIL_TIERS.length - 1];
      price = emailUsd(t.inr);
    }
    // Base per-email rate: the exact unit price entered on the quote; else quoted monthly price ÷ volume;
    // else the standard tier's rate. Overage = base × (1 + 15%), not rounded (0.00137 → 0.0015755).
    const tierForRate = tier ?? EMAIL_TIERS[EMAIL_TIERS.length - 1];
    const baseRate =
      e.unitPrice !== undefined
        ? e.unitPrice
        : e.monthlyListPrice !== undefined && e.emailsPerMonth > 0
          ? e.monthlyListPrice / e.emailsPerMonth
          : emailUsd(tierForRate.inr) / tierForRate.emails;
    const quoted = e.unitPrice !== undefined || e.monthlyListPrice !== undefined;
    const withMarkup = baseRate * (1 + (input.emailOverageMarkup ?? DEFAULT_EMAIL_OVERAGE_MARKUP));
    // Quoted prices keep every digit; the standard tier rate (a long fraction) is rounded to 6 dp.
    emailOverage = e.overagePerEmail !== undefined ? cleanRate(e.overagePerEmail) : quoted ? cleanRate(withMarkup) : r6(withMarkup);
    bundled.push(
      mk(
        'email',
        'Email (Promotional)',
        'bundled',
        `${fmtInt(e.emailsPerMonth)} emails per month. Overages: USD ${emailOverage} per email`,
        price,
        e.complimentary ?? false,
      ),
    );
  }
  for (const [i, c] of (b.custom ?? []).entries())
    bundled.push(mk(`bundledCustom${i}`, c.name, 'bundled', c.details ?? '', c.monthlyListPrice, c.complimentary));

  // ---- Add-ons ----------------------------------------------------------
  const addons: LineItem[] = [];
  const a = input.addons ?? {};

  const csmLine = mk(
    'csm',
    `Customer Success Manager (CSM) – ${input.csmResourceType ?? 'Shared'} Resource`,
    'addon',
    '',
    input.csmFee,
    !!input.csmFeeFullyDiscounted,
  );
  addons.push(csmLine);

  if (a.s3Export) {
    const v = a.s3Export.monthlyEventsMn;
    let inr: number;
    if (v <= 100) inr = S3_EXPORT.upTo100Mn;
    else if (v <= 200) inr = S3_EXPORT.upTo200Mn;
    else inr = S3_EXPORT.upTo200Mn + Math.ceil((v - 200) / 100) * S3_EXPORT.perAdditional100Mn;
    addons.push(mk('s3Export', 'Event Export via S3 (once a day)', 'addon',
      `Up to ${fmtInt(v)} Mio events/month`, ceUsd(inr), a.s3Export.complimentary));
  }
  if (a.recommendations) {
    const v = a.recommendations.apiCallsPerMonth;
    const t = tierPick(RECOMMENDATIONS, (x) => x.maxApiCalls >= v);
    if (!t) warnings.push(`Recommendations volume ${fmtInt(v)} API calls/mo exceeds 1,000K tier; priced at top tier.`);
    const tt = t ?? RECOMMENDATIONS[RECOMMENDATIONS.length - 1];
    addons.push(mk('recommendations', 'Recommendations on Channels', 'addon',
      `Up to ${fmtInt(tt.maxApiCalls)} API calls/month`, ceUsd(tt.inr), a.recommendations.complimentary));
  }
  if (a.attributeStorage) {
    const v = a.attributeStorage.attributes;
    const t = tierPick(ATTRIBUTE_STORAGE, (x) => x.maxAttributes >= v);
    if (!t) warnings.push(`Attribute storage ${v} exceeds 250-attribute tier; priced at top tier.`);
    const tt = t ?? ATTRIBUTE_STORAGE[ATTRIBUTE_STORAGE.length - 1];
    addons.push(mk('attributeStorage', 'Additional Attribute Storage', 'addon',
      `Up to ${tt.maxAttributes} attributes`, ceUsd(tt.inr), a.attributeStorage.complimentary));
  }
  if (a.appInboxCards) {
    const v = a.appInboxCards.pushPerMonth;
    const t = tierPick(APP_INBOX_CARDS, (x) => x.maxPush >= v);
    if (!t) warnings.push(`App Inbox volume ${fmtInt(v)}/mo exceeds 100 Mio tier; priced at top tier.`);
    const tt = t ?? APP_INBOX_CARDS[APP_INBOX_CARDS.length - 1];
    addons.push(mk('appInboxCards', 'Cards (App Inbox)', 'addon',
      `Up to ${fmtInt(tt.maxPush / 1e6)} Mio push notifications/month`, ceUsd(tt.inr), a.appInboxCards.complimentary));
  }
  const cm = asOpts(a.coMarketer, false);
  if (cm) {
    if (market !== 'Growth') {
      warnings.push('Co-Marketer is only available on the Growth plan; skipped (sheet returns 0).');
    } else {
      const t = CO_MARKETER.find((x) => mau <= x.maxMau)!;
      addons.push(mk('coMarketer', 'Co-Marketer (Growth Plan)', 'addon', `${fmtMau(mau)} MAU`,
        ceUsd(t.inr), cm.complimentary));
    }
  }
  const idc = asOpts(a.localIdc, false);
  if (idc) {
    addons.push(mk('localIdc', 'Local IDC', 'addon', '15% on listed platform price (not discounted)',
      (listed + upgradeMonthly) * LOCAL_IDC_UPLIFT, idc.complimentary));
  }
  for (const [i, c] of (a.custom ?? []).entries())
    addons.push(mk(`addonCustom${i}`, c.name, 'addon', c.details ?? '', c.monthlyListPrice, c.complimentary));

  // ---- Setup fee --------------------------------------------------------
  const setupList = input.onboardingFee;
  const setupComp = !!input.onboardingFeeFullyDiscounted;
  const setupNet = setupComp ? 0 : setupList; // fully discounted → goes to You Save, not TCV

  // ---- Totals -----------------------------------------------------------
  const raw = (li: LineItem) => li as unknown as { _ml: number; _mn: number };
  const recurring = [...bundled, ...addons];
  const sumList = recurring.reduce((s, li) => s + raw(li)._ml, 0);
  const sumNet = recurring.reduce((s, li) => s + raw(li)._mn, 0);
  const monthlyRecurringList = platformMonthly + sumList;
  const monthlyRecurringNet = platformMonthly + sumNet;

  const listTCV = setupList + monthlyRecurringList * paidMonths;
  const tcv = setupNet + monthlyRecurringNet * paidMonths;

  // Per Flin SOF: during the complimentary period the Platform Fee and bundled products are free.
  const bundledListMonthly = bundled.reduce((s, li) => s + raw(li)._ml, 0);
  const complimentaryPeriodValue = (platformMonthly + bundledListMonthly) * complimentaryMonths;

  const youSave = listTCV - tcv + (input.includeComplimentaryPeriodInSavings ? complimentaryPeriodValue : 0);
  const vat = input.vatRate ? tcv * input.vatRate : 0;

  // strip private fields
  const clean = (li: LineItem): LineItem => {
    const { _ml, _mn, ...rest } = li as LineItem & { _ml: number; _mn: number };
    return rest;
  };

  return {
    term: {
      totalContractDurationMonths: r2(term.totalContractDurationMonths),
      complimentaryMonths: r2(complimentaryMonths),
      paidMonths: r2(paidMonths),
      contractTermDescription: term.contractTermDescription,
      subscriptionStartDate: term.subscriptionStartDate,
      billingStartDate: term.billingStartDate,
      subscriptionEndDate: term.subscriptionEndDate,
    },
    bucket: { market, label: row.label, lowerMauExclusive, upperMau: row.upperMau },
    platformFee: {
      listedMonthly: r2(listed),
      lowestAcceptedMonthly: r2(floor),
      discountMonthly: r2(listed - offer),
      offerMonthly: r2(offer),
      eventContainerUpgradeMonthly: r2(upgradeMonthly),
      ceMonthly: r2(ceMonthly),
      pxMonthly: r2(pxMonthly),
      monthly: r2(platformMonthly),
      paidTermTotal: r2(platformMonthly * paidMonths),
      details: `${fmtMau(mau)} MAU or ${+(annualMau / 1e6).toFixed(2)} Mio per year`,
    },
    px: px
      ? {
          ...px,
          paidTermTotal: r2(px.monthly * paidMonths),
          ceBaseEventsMn: includedMn,
          totalEventsYearlyMn: includedMn + px.eventsYearlyMn,
        }
      : null,
    eventContainer: {
      includedYearlyMn: includedMn,
      upgradeMn,
      totalYearlyMn,
      requestedYearlyMn: requested,
    },
    overages: {
      mauRatePerUser: r6(mauRate),
      mauFloorRatePerUser: r6(mauRate * MAX_OVERAGE_DISCOUNT_FLOOR),
      eventBucketMn: bucketMn,
      eventPricePerBucket: r2(perBucket),
      eventPricePerMillion: r2(perMillion),
      eventPricePerEvent: r6(perMillion / 1e6),
      emailPerEmail: emailOverage,
      pxPerMau: px ? px.overageRatePerMau : null,
    },
    bundledProducts: bundled.map(clean),
    addons: addons.map(clean),
    oneTimeSetupFees: { list: r2(setupList), net: r2(setupNet), fullyDiscounted: setupComp },
    csm: clean(csmLine),
    totals: {
      monthlyRecurringList: r2(monthlyRecurringList),
      monthlyRecurringNet: r2(monthlyRecurringNet),
      listTCV: r2(listTCV),
      totalContractValue: r2(tcv),
      complimentaryPeriodValue: r2(complimentaryPeriodValue),
      youSave: r2(youSave),
      vat: r2(vat),
      totalContractValueInclVat: r2(tcv + vat),
      contractTermDescription: term.contractTermDescription,
    },
    warnings,
  };
}

export default calculatePricing;
