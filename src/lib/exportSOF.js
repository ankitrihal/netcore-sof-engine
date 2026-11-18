/**
 * exportSOF.js: fills public/SOF_Template.docx with the dashboard's data and
 * downloads the result as a Word file. Runs entirely in the browser.
 *
 *   await exportSOF({ client, pricing });   // the object SofDashboard's onExport provides
 *
 * Two templates, chosen by country (the dashboard's Country / VAT field, locked per team):
 *   Indonesia (11%)   → public/SOF_Template_ID.docx (falls back to public/SOF_Template.docx)
 *   Philippines (12%) → public/SOF_Template_PH.docx
 *
 * Tag syntax is docxtemplater:
 *   {tag} value · {#flag}…{/flag} shown when true · {^flag}…{/flag} shown when false
 *   {#list}…{/list} repeats per item (in a table row: repeats the row)
 * Money values are "3,000.00" with no currency sign, so keep the template's own "$".
 *
 * CLIENT     {clientName} {billingAddress} {primaryContact} {primaryEmail} {primaryPhone}
 *            {billingContact} {billingEmail} {billingPhone}
 * TERM       {StartDate} {BillingStartDate} {EndDate} {ComplimentaryEndDate}   e.g. "1 January 2027"
 *            {BillingStartDate} is "TBD - To be Discussed" when billingStartTbd is set;
 *            {BillingStartDateKnown} is the date, or '' when TBD (for "from <date> …" phrases)
 *            {#billingStartTbd}…{/billingStartTbd} only when the Billing Start Date is TBD
 *            {StartDate} {EndDate} are also "TBD - To be Discussed" then; {StartDateKnown} {EndDateKnown} are ''
 *            {totalMonths} {complimentaryMonths} {paidMonths}
 *            {paidMonthsText} "Twelve (12)" · {complimentaryPeriodText} "One (1) month"
 *            {contractTermDescription} "(1 Months Complimentary + 12 Months Paid)" or ""
 *            {paidPeriodLabel} "12-month paid period"
 *            {#hasComplimentary}…{/hasComplimentary}
 * SETUP FEE  {onboardingFee} · {#onboardingDiscounted}…{/onboardingDiscounted} · {^onboardingDiscounted}…{/onboardingDiscounted}
 *            {#hasOnboardingFee}…{/hasOnboardingFee}
 * PLATFORM   {platformFeeDetails} {platformFeeMonthly} {platformFeeTotal} {ceMonthly} {mauOverageRate}
 *            {eventContainerMn} {eventOveragePerBucket} {eventOverageBucketMn}
 * PX         {#hasPx}…{/hasPx} {pxVersion} {pxMonthly} {pxTotal} {pxEventsMn}
 *            {pxOverageRate} "0.003647" = (PX price / MAU) × 1.15, USD per MAU
 * BUNDLED    {#bundled} {name} {details} {monthly} {total} {#discounted}…{/discounted} {#hasPrice}…{/hasPrice}
 *            {detailsMultiline} (one item per line, e.g. each AI feature) {/bundled}
 *            PX row comes first, only when PX is included: "Product Experience, Nudges and
 *            Contextual Walkthroughs" / "500K MAU with 200 Mio Events / Year"
 * CSM        {csmLabel} {csmFeeMonthly} {csmFeeTotal} · {#csmDiscounted}…{/csmDiscounted} · {^csmDiscounted}…{/csmDiscounted}
 * ADD-ONS    {#addons}…same fields as bundled…{/addons} · {#hasAddons}…{/hasAddons}
 * TOTALS     {totalMonthly} {listTCV} {totalContractValue}
 *            {#hasSavings}…{/hasSavings} {youSave} {youSaveInclComplimentary} {complimentaryPeriodValue}
 *            {savingsText} "Complimentary CSM + USD 2,000 per month of Complimentary Period"
 *            {savingsSummary} "Complimentary CSM + complimentary period"
 *            {savingsLabel} "(Complimentary CSM)" (v1 wording)
 * VAT        {vatPercent} "11" · {vatNote} "excludes 11% VAT" · {vatAmount} {totalInclVat}
 *            {#vatPercent}…{/vatPercent}
 * COUNTRY    {country} "ID"/"PH" · {countryName} · {entityName} {entityAddress}
 *            {billingMethod} {billingFrequency} {billingCurrency} {paymentMethod} {paymentTerms}
 *            {governingLaw} "the Laws of Singapore" · {jurisdiction} "the Courts in Singapore"
 *            {#hasBankDetails} {bankBeneficiary} {bankName} {bankBranch} {bankBranchAddress}
 *            {bankAccountNo} {bankCode} {bankSwift} {/hasBankDetails}
 *            Dates are "1 January 2027" for Indonesia and "01 Jan 2027" for the Philippines.
 * SIGNATORY  {netcoreSignatoryName} {netcoreSignatoryTitle}: the signed-in user (blank if unknown)
 * PH LAYOUT  {mauLabel} "100K" · {planName} · {#isEnterprise}…{/isEnterprise}
 *            {platformAllInMonthly} {platformAllInTotal} (platform + bundled products, one row)
 *            {#hasEmail} {emailsLabel} "300K" {emailOverageRate} {/hasEmail}
 *            {pxDetailsText} "500K MAU with 200 Mio Events / Year" (CE base + PX tier) · {paidMonthsCountText} "12 (twelve)"
 * Tags the data doesn't have are left blank, never printed as "undefined".
 */
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { PX_PRODUCT_NAME, pxDetails, pxOverageText, BILLING_START_TBD_TEXT } from './pricingCalculator';

/**
 * Word templates, served from the public/ folder, one per country.
 * Indonesia falls back to the original SOF_Template.docx if SOF_Template_ID.docx is missing.
 */
export const TEMPLATES = {
  ID: '/SOF_Template_ID.docx',
  PH: '/SOF_Template_PH.docx',
};
const TEMPLATE_FALLBACK = { ID: '/SOF_Template.docx' };

/** Kept for older imports: the Indonesia template. */
export const TEMPLATE_URL = TEMPLATES.ID;

/** Country from the export data: explicit `country`, else from VAT (12% → PH, otherwise ID). */
export const resolveCountry = (data) => {
  if (data?.country === 'PH' || data?.country === 'ID') return data.country;
  const t = data?.pricing?.totals;
  const vat = t && t.totalContractValue > 0 ? Math.round((t.vat / t.totalContractValue) * 100) : 0;
  return vat === 12 ? 'PH' : 'ID';
};

export const templateUrlFor = (country) => TEMPLATES[country] ?? TEMPLATES.ID;

/**
 * Contracting entity and payment details per country (copied from the two templates).
 * Available as tags, e.g. {entityName}, {bankAccountNo}, {governingLaw}.
 */
export const COUNTRY_ENTITY = {
  ID: {
    countryName: 'Indonesia',
    entityName: 'Netcore Cloud (PT Tera Achiever)',
    entityAddress: 'GoWork Sopo Del Tower, 22nd Floor, Mega Kuningan Barat, Jakarta Selatan 12950',
    billingMethod: 'Prepaid',
    billingFrequency: 'Annual',
    billingCurrency: 'USD',
    paymentMethod: 'Local Transfer',
    paymentTerms: 'Annual Billing in Advance',
    governingLaw: 'the Laws of the Republic of Indonesia',
    jurisdiction: 'the Courts in Indonesia',
    bank: null, // paid in local currency to the authorized partner
  },
  PH: {
    countryName: 'Philippines',
    entityName: 'Netcore Cloud Pte Ltd',
    entityAddress: '72 Circular Road #02-01, Singapore 049426',
    billingMethod: 'Postpaid',
    billingFrequency: 'Monthly',
    billingCurrency: 'USD',
    paymentMethod: 'Wire Transfer',
    paymentTerms: '30 Days',
    governingLaw: 'the Laws of Singapore',
    jurisdiction: 'the Courts in Singapore',
    bank: {
      beneficiary: 'NETCORE CLOUD PTE LTD',
      bankName: 'Citibank N.A.',
      branch: 'Singapore Branch',
      branchAddress: '8 Marina View #22-01 Asia Square Tower 1, Singapore 018960',
      accountNo: '0-010242-029',
      bankCode: '7214',
      swift: 'CITISGSG',
    },
  },
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** "2027-01-01" → "01 Jan 2027" (Philippines template style); empty when there is no date. */
export const shortDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
};

/** 3000 → "3,000.00" */
export const money = (n) =>
  (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "2027-12-31" → "31 December 2027"; empty when there is no date. */
export const longDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty'];

/** 12 → "Twelve (12)", 36 → "Thirty-Six (36)"; fractions or >60 stay as digits. */
export const monthsInWords = (n) => {
  if (!Number.isInteger(n) || n < 0 || n > 60) return String(n);
  const w = n < 20 ? NUMBER_WORDS[n] : TENS[Math.floor(n / 10)] + (n % 10 ? '-' + NUMBER_WORDS[n % 10] : '');
  return `${w} (${n})`;
};

/** 12 → "12 (twelve)" (lower-case words, Philippines style). */
export const monthsCountText = (n) => {
  const w = monthsInWords(n); // "Twelve (12)"
  const m = /^(.*) \((\d+)\)$/.exec(w);
  return m ? `${m[2]} (${m[1].toLowerCase()})` : String(n);
};

/** Day before an ISO date ("2027-01-01" → "2026-12-31"). */
const dayBefore = (iso) => {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** 2000 → "2,000", 1585.71 → "1,585.71" (whole amounts without ".00", for wording like "USD 2,000 per month"). */
export const moneyShort = (n) =>
  (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/**
 * Details split into separate lines for templates that show one item per line (v2):
 * AI Components → one feature per line; Email → volume and overage on separate lines.
 */
const detailLinesFor = (key, details) => {
  if (!details) return [];
  if (key === 'aiComponents') return details.split(/,\s*/).filter(Boolean);
  if (key === 'email') return details.split(/\.\s+/).filter(Boolean);
  return [details];
};

const lineData = (li) => ({
  key: li.key,
  name: li.name,
  details: li.details,
  detailLines: detailLinesFor(li.key, li.details),
  detailsMultiline: detailLinesFor(li.key, li.details).join('\n'), // one item per line in a single cell
  monthly: money(li.monthlyList),
  total: money(li.paidTermList),
  discounted: li.fullyDiscounted,
  hasPrice: li.monthlyList > 0,
});

/**
 * Turns the dashboard's { client, pricing } into the flat object the template reads.
 * Exported separately so it can be tested without a browser.
 */
export function buildSofTemplateData(data) {
  const { client, pricing } = data;
  const country = resolveCountry(data);
  const entity = COUNTRY_ENTITY[country];
  const fmtDate = country === 'PH' ? shortDate : longDate; // "01 Jan 2027" vs "1 January 2027"
  const { term, platformFee, overages, eventContainer, totals } = pricing;
  const csm = pricing.csm;
  const setup = pricing.oneTimeSetupFees;

  const saved = [];
  if (setup.fullyDiscounted && setup.list > 0) saved.push('Onboarding Fee');
  if (csm.fullyDiscounted && csm.monthlyList > 0) saved.push('CSM');
  pricing.bundledProducts
    .filter((b) => b.fullyDiscounted && b.monthlyList > 0)
    .forEach((b) => saved.push(b.name));

  // Savings wording (v2). The complimentary period is named in the text; its value is
  // shown separately (complimentaryPeriodValue) and is not part of youSave.
  const hasComplimentary = term.complimentaryMonths > 0;
  const compPerMonth = hasComplimentary ? totals.complimentaryPeriodValue / term.complimentaryMonths : 0;
  const waived = saved.length ? `Complimentary ${saved.join(' + ')}` : '';
  // Table row: "Complimentary CSM + USD 2,000 per month of Complimentary Period"
  const savingsText = [waived, hasComplimentary ? `USD ${moneyShort(compPerMonth)} per month of Complimentary Period` : '']
    .filter(Boolean)
    .join(' + ');
  // Order Summary card: "Complimentary CSM + complimentary period"
  const savingsSummary = [waived, hasComplimentary ? 'complimentary period' : ''].filter(Boolean).join(' + ');

  const vatPercent = totals.vat > 0 && totals.totalContractValue > 0
    ? String(Math.round((totals.vat / totals.totalContractValue) * 10000) / 100)
    : '';

  const pxRow = pricing.px
    ? [{
        key: 'px',
        name: PX_PRODUCT_NAME,
        details: `${pxDetails(pricing.px)}. ${pxOverageText(pricing.px)}`,
        detailLines: [pxDetails(pricing.px), pxOverageText(pricing.px)], // "500K MAU with 200 Mio Events / Year" / "Overages: USD … per MAU, billable monthly"
        detailsMultiline: `${pxDetails(pricing.px)}\n${pxOverageText(pricing.px)}`,
        monthly: money(0),
        total: money(0),
        discounted: false,
        hasPrice: false, // its price is inside the Platform Fee
      }]
    : [];
  const addons = pricing.addons.filter((a) => a.key !== 'csm').map(lineData);

  // Values for layouts without a Bundled Products section (Philippines): everything is in the Platform row
  const bundledNetMonthly = pricing.bundledProducts.reduce((sum, b) => sum + b.monthlyNet, 0);
  const bundledNetTotal = pricing.bundledProducts.reduce((sum, b) => sum + b.paidTermNet, 0);
  const emailItem = pricing.bundledProducts.find((b) => b.key === 'email');
  const emailCount = emailItem ? Number((emailItem.details.match(/^([\d,]+) emails/) || [])[1]?.replace(/,/g, '')) || 0 : 0;
  const compact = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(2)} Mio` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : String(n));
  const bank = entity.bank;
  const billingTbd = !!data.billingStartTbd;

  return {
    // Netcore signature block: whoever is signed in and exporting
    netcoreSignatoryName: data.signatory?.name ?? '',
    netcoreSignatoryTitle: data.signatory?.title ?? '',
    // Country & contracting entity
    country,
    countryName: entity.countryName,
    entityName: entity.entityName,
    entityAddress: entity.entityAddress,
    billingMethod: entity.billingMethod,
    billingFrequency: entity.billingFrequency,
    billingCurrency: entity.billingCurrency,
    paymentMethod: entity.paymentMethod,
    paymentTerms: entity.paymentTerms,
    governingLaw: entity.governingLaw,
    jurisdiction: entity.jurisdiction,
    hasBankDetails: !!bank,
    bankBeneficiary: bank?.beneficiary ?? '',
    bankName: bank?.bankName ?? '',
    bankBranch: bank?.branch ?? '',
    bankBranchAddress: bank?.branchAddress ?? '',
    bankAccountNo: bank?.accountNo ?? '',
    bankCode: bank?.bankCode ?? '',
    bankSwift: bank?.swift ?? '',

    // Client
    clientName: client.clientName,
    billingAddress: client.billingAddress, // line breaks kept (linebreaks: true)
    primaryContact: client.primaryContact,
    primaryEmail: client.primaryEmail,
    primaryPhone: client.primaryPhone,
    billingContact: client.billingContact ?? '',
    billingEmail: client.billingEmail ?? '',
    billingPhone: client.billingPhone ?? '',

    // Term
    // Subscription dates: "TBD - To be Discussed" while the Billing Start Date is TBD.
    // The ...Known versions are '' when TBD, for phrases like "Start Date – <end date>".
    StartDate: billingTbd ? BILLING_START_TBD_TEXT : fmtDate(term.subscriptionStartDate),
    StartDateKnown: billingTbd ? '' : fmtDate(term.subscriptionStartDate),
    BillingStartDate: billingTbd ? BILLING_START_TBD_TEXT : fmtDate(term.billingStartDate),
    BillingStartDateKnown: billingTbd ? '' : fmtDate(term.billingStartDate),
    billingStartTbd: billingTbd,
    EndDate: billingTbd ? BILLING_START_TBD_TEXT : fmtDate(term.subscriptionEndDate),
    EndDateKnown: billingTbd ? '' : fmtDate(term.subscriptionEndDate),
    totalMonths: term.totalContractDurationMonths,
    complimentaryMonths: term.complimentaryMonths,
    paidMonths: term.paidMonths,
    hasComplimentary,
    ComplimentaryEndDate: term.complimentaryMonths > 0 && !billingTbd ? fmtDate(dayBefore(term.billingStartDate)) : '',
    paidMonthsText: monthsInWords(term.paidMonths),
    paidMonthsCountText: monthsCountText(term.paidMonths), // "12 (twelve)", Philippines style
    complimentaryPeriodText: `${monthsInWords(term.complimentaryMonths)} ${term.complimentaryMonths === 1 ? 'month' : 'months'}`,
    contractTermDescription: term.contractTermDescription, // '' when no complimentary period
    paidPeriodLabel: `${term.paidMonths}-month paid period`, // no longer used by the templates (caption removed)

    // One-time fee
    onboardingFee: money(setup.list),
    onboardingDiscounted: setup.fullyDiscounted,
    hasOnboardingFee: setup.list > 0,

    // Platform
    platformFeeDetails: platformFee.details,
    mauLabel: platformFee.details.split(' MAU')[0], // "100K"
    planName: pricing.bucket.market, // "Enterprise" | "Growth"
    isEnterprise: pricing.bucket.market === 'Enterprise',
    platformAllInMonthly: money(platformFee.monthly + bundledNetMonthly), // platform + bundled products
    platformAllInTotal: money(platformFee.paidTermTotal + bundledNetTotal),
    platformFeeMonthly: money(platformFee.monthly),
    platformFeeTotal: money(platformFee.paidTermTotal),
    mauOverageRate: String(overages.mauRatePerUser),
    eventContainerMn: eventContainer.totalYearlyMn,
    eventOveragePerBucket: money(overages.eventPricePerBucket),
    eventOverageBucketMn: overages.eventBucketMn,

    // CSM
    csmLabel: csm.name.replace('Customer Success Manager (CSM) – ', ''),
    csmFeeMonthly: money(csm.monthlyList),
    csmFeeTotal: money(csm.paidTermList),
    csmDiscounted: csm.fullyDiscounted,

    // PX
    hasPx: !!pricing.px,
    pxVersion: pricing.px ? pricing.px.version : '',
    pxMonthly: pricing.px ? money(pricing.px.monthly) : '',
    pxTotal: pricing.px ? money(pricing.px.paidTermTotal) : '',
    pxEventsMn: pricing.px ? pricing.px.totalEventsYearlyMn : '', // CE base + PX tier
    pxDetailsText: pricing.px ? pxDetails(pricing.px) : '',
    pxOverageRate: pricing.px ? String(pricing.px.overageRatePerMau) : '',

    // Email (for layouts that show it inside the Platform row)
    hasEmail: !!emailItem,
    emailsLabel: emailCount ? compact(emailCount) : '',
    emailOverageRate: overages.emailPerEmail != null ? String(overages.emailPerEmail) : '',
    ceMonthly: money(platformFee.ceMonthly),

    // Lists. The PX row comes first and only when PX is included.
    bundled: [...pxRow, ...pricing.bundledProducts.map(lineData)],
    addons,
    hasAddons: addons.length > 0,

    // Totals
    totalMonthly: money(totals.monthlyRecurringNet),
    listTCV: money(totals.listTCV),
    totalContractValue: money(totals.totalContractValue),
    hasSavings: totals.youSave > 0,
    youSave: money(totals.youSave),
    savingsLabel: saved.length ? `(Complimentary ${saved.join(' + ')})` : '', // v1 wording, with brackets
    savingsText, // v2 YOU SAVE row
    savingsSummary, // v2 Order Summary card
    complimentaryPeriodValue: money(totals.complimentaryPeriodValue),
    youSaveInclComplimentary: money(totals.youSave + totals.complimentaryPeriodValue),
    vatAmount: money(totals.vat),
    totalInclVat: money(totals.totalContractValueInclVat),
    vatPercent,
    vatNote: vatPercent ? `excludes ${vatPercent}% VAT` : 'excludes applicable taxes', // v2 Order Summary card
  };
}

/** Fill a template (ArrayBuffer) and return the finished .docx as a Blob. */
export function renderSof(templateBuffer, exportData) {
  const doc = new Docxtemplater(new PizZip(templateBuffer), {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => '',
  });
  try {
    doc.render(buildSofTemplateData(exportData));
  } catch (err) {
    // Turn docxtemplater's template errors into one readable message
    const details = err?.properties?.errors?.map((e) => e.properties?.explanation).filter(Boolean);
    throw new Error(details?.length ? `Template error: ${details.join('; ')}` : err.message);
  }
  return doc.getZip().generate({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
  });
}

/** "SOF - ID - PT Lotte Shopping Indonesia - 2026-11-18.docx" (ext: 'docx' or 'pdf') */
export function sofFileName(clientName, country, ext = 'docx') {
  const safe = (clientName || 'Client').replace(/[\\/:*?"<>|]+/g, '').trim() || 'Client';
  return `SOF - ${country ? country + ' - ' : ''}${safe} - ${new Date().toISOString().slice(0, 10)}.${ext}`;
}

/** Fetch the template, fill it, and download the Word file. */
/** Download the right country's template (Indonesia falls back to SOF_Template.docx). */
async function fetchTemplate(country) {
  const urls = [templateUrlFor(country), TEMPLATE_FALLBACK[country]].filter(Boolean);
  for (const url of urls) {
    const res = await fetch(url);
    // Vite's dev server answers missing files with index.html, so check it's really a .docx (zip)
    if (res.ok) {
      const buf = await res.arrayBuffer();
      if (new Uint8Array(buf.slice(0, 2)).join() === '80,75') return buf; // "PK"
    }
  }
  throw new Error(`Could not load the ${COUNTRY_ENTITY[country].countryName} template (${urls.join(' or ')}). Is it in the public/ folder?`);
}

/** Export formats offered by the Export menu. */
export const EXPORT_FORMATS = ['docx', 'pdf', 'both'];

function download(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Gap between the Word and PDF downloads in "Export Both", so the browser accepts the second file. */
export const BOTH_DOWNLOAD_GAP_MS = 500;

/**
 * Fill the country's template and download it.
 *   format 'docx' (default) → Word file
 *   format 'pdf'            → PDF of the same filled Word file (rendered in the browser)
 *   format 'both'           → Word file first, then the PDF at least 500 ms later
 * Returns the files it downloaded, so the caller can offer them again.
 */
export async function exportSOF(exportData, format = 'docx') {
  if (!EXPORT_FORMATS.includes(format)) throw new Error(`Unknown export format: ${format}`);
  const country = resolveCountry(exportData);
  const docx = renderSof(await fetchTemplate(country), { ...exportData, country });
  const name = (ext) => sofFileName(exportData.client.clientName, country, ext);
  const files = [];

  // Word goes out straight away, while the browser still counts it as part of the click
  let docxAt = 0;
  if (format !== 'pdf') {
    download(docx, name('docx'));
    docxAt = Date.now();
    files.push({ name: name('docx'), blob: docx });
  }
  if (format !== 'docx') {
    const { docxToPdf } = await import('./sofPdf.js'); // loaded only when a PDF is requested
    const pdf = await docxToPdf(docx);
    if (format === 'both') {
      // Stagger: browsers block a second download fired in the same instant as the first
      const wait = BOTH_DOWNLOAD_GAP_MS - (Date.now() - docxAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    download(pdf, name('pdf'));
    files.push({ name: name('pdf'), blob: pdf });
  }
  return files;
}

/** Download a file again (e.g. from a "Download PDF" button if the browser held it back). */
export function downloadAgain(file) {
  download(file.blob, file.name);
}
