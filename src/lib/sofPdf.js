/**
 * sofPdf.js: turn a filled SOF Word file into a PDF, in the browser.
 *
 * The finished .docx (same file as the Word export) is drawn on the page with
 * docx-preview, each template page is captured with html2canvas, and the pages
 * are put into a US Letter PDF with jsPDF. So the PDF follows the Word template's
 * layout, fonts and tables, with no server involved.
 *
 *   - A template page whose content runs past one sheet is split between
 *     paragraphs / table rows (never through a line), and every extra sheet gets
 *     the template's header and footer.
 *   - "Page X of N" is drawn where the template's page-number field sits.
 *
 * This module (and its libraries) is only loaded when a PDF is requested.
 */
import { renderAsync } from 'docx-preview';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
// The templates use Plus Jakarta Sans; bundle it so the PDF doesn't fall back to another font
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/plus-jakarta-sans/400-italic.css';

/** US Letter at 96 px per inch (the templates are 8.5 × 11 in). */
const PAGE_W = 816;
const PAGE_H = 1056;
/** Capture resolution (2 = 192 dpi): sharp text, reasonable file size. */
const SCALE = 2;
/** Space kept above the footer's top rule when copying the footer strip. */
const FOOTER_GAP = 8;

/**
 * Render a .docx Blob to a PDF Blob.
 * @param {Blob} docxBlob
 * @returns {Promise<Blob>}
 */
export async function docxToPdf(docxBlob) {
  const wrapper = document.createElement('div');
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.style.cssText = `position:fixed;left:-20000px;top:0;width:${PAGE_W}px;background:#fff;`;
  document.body.appendChild(wrapper);
  try {
    await renderAsync(docxBlob, wrapper, undefined, {
      inWrapper: false, // no grey preview background or page shadows
      breakPages: true, // one <section> per template page break
      ignoreLastRenderedPageBreak: true,
      renderHeaders: true,
      renderFooters: true,
      useBase64URL: true, // images as data URLs, so the capture can read them
      experimental: true,
    });
    if (document.fonts?.ready) await document.fonts.ready;
    await Promise.all(
      [...wrapper.querySelectorAll('img')].map((img) =>
        img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }),
      ),
    );

    const sections = [...wrapper.querySelectorAll('section.docx')];
    sections.forEach((s) => {
      s.style.margin = '0';
      s.style.boxShadow = 'none';
      fixHeaderTab(s);
    });

    // Build every sheet first (page count is needed for "Page X of N")
    const sheets = [];
    for (const section of sections) {
      const plan = planSection(section);
      const canvas = await html2canvas(section, {
        scale: SCALE,
        backgroundColor: '#ffffff',
        useCORS: true,
        windowWidth: PAGE_W,
        logging: false,
      });
      sliceSection(plan, canvas);
      for (const slice of plan.slices) sheets.push({ canvas, plan, slice });
    }

    const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait', compress: true });
    const total = sheets.length;
    sheets.forEach((sheet, i) => {
      const page = composeSheet(sheet);
      drawPageNumber(page, sheet.plan, i + 1, total);
      if (i > 0) pdf.addPage('letter', 'portrait');
      pdf.addImage(page.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 612, 792, undefined, 'FAST');
    });
    return pdf.output('blob');
  } finally {
    wrapper.remove();
  }
}

/**
 * The header is a logo plus a right tab before "SALES ORDER FORM". docx-preview doesn't
 * apply right tab stops, so lay the line out with flex: logo left, text right.
 */
function fixHeaderTab(section) {
  const p = section.querySelector('header > p');
  if (!p || p.children.length < 2) return;
  const textSpan = [...p.children].find((s) => /^\t/.test(s.textContent ?? ''));
  if (!textSpan) return;
  textSpan.textContent = (textSpan.textContent ?? '').replace(/^\t+/, '');
  p.style.display = 'flex';
  p.style.justifyContent = 'space-between';
  p.style.alignItems = 'flex-end';
}

/**
 * Measure one template page and decide where to cut it into sheets.
 * Positions are CSS px from the top of the section.
 */
function planSection(section) {
  const top = section.getBoundingClientRect().top;
  const rel = (el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top - top, bottom: r.bottom - top };
  };
  const height = section.getBoundingClientRect().height;
  const article = section.querySelector('article');
  const footer = section.querySelector('footer');
  const contentTop = article ? rel(article).top : 0;
  const footerTop = footer ? rel(footer).top - FOOTER_GAP : height;
  // Where the page number goes: right edge, on the footer's first line
  const firstFooterLine = footer?.querySelector('p');
  const numberLine = firstFooterLine ? rel(firstFooterLine) : null;
  const padRight = parseFloat(getComputedStyle(section).paddingRight) || 72;

  const plan = { height, contentTop, footerTop, numberLine, padRight, cuts: [], slices: [] };
  if (height <= PAGE_H + 1) return plan;

  // Candidate cuts: gaps between text lines and table row edges (checked against the image later)
  const lines = [];
  const walker = document.createTreeWalker(article ?? section, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) if (r.height > 0) lines.push(r.bottom - top + 1);
  }
  const rows = [...section.querySelectorAll('article tr')].map((el) => rel(el).bottom);
  // Keep a table on one sheet when it fits on one (e.g. the signature block): no cuts inside it
  const room = PAGE_H - contentTop - (height - footerTop);
  const keepTogether = [...section.querySelectorAll('article table')]
    .map(rel)
    .filter((t) => t.bottom - t.top < room * 0.9);
  const insideKept = (y) => keepTogether.some((t) => y > t.top + 1 && y < t.bottom - 1);
  plan.cuts = [...new Set([...lines, ...rows, ...keepTogether.map((t) => t.top - 2)].map((y) => Math.round(y)))]
    .filter((y) => y > contentTop && y < footerTop && !insideKept(y))
    .sort((a, b) => a - b);
  return plan;
}

/**
 * True when the captured image has no text on this row (CSS px). Thin vertical lines
 * (table borders) and solid fills don't count: only short dark runs, i.e. glyphs.
 */
function rowIsClear(canvas, y) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const row = (yy) => ctx.getImageData(0, Math.round(yy * SCALE), canvas.width, 1).data;
  const d = row(y);
  const above = row(y - 3);
  const below = row(y + 3);
  // Ink = anything darker than a light grey fill, or clearly coloured (blue headings, orange bullets)
  const ink = (a, i) => {
    const r = a[i], g = a[i + 1], b = a[i + 2];
    return (r + g + b) / 3 < 215 || Math.max(r, g, b) - Math.min(r, g, b) > 60;
  };
  for (let i = 0; i < d.length; i += 4) {
    // ink on the rows above and below too → a vertical rule or a fill, not text
    if (ink(d, i) && !(ink(above, i) && ink(below, i))) return false;
  }
  return true;
}

/** Cut a tall template page into sheets at rows that cross no text. */
function sliceSection(plan, canvas) {
  if (plan.height <= PAGE_H + 1) {
    plan.slices = [{ whole: true }];
    return;
  }
  const { contentTop, footerTop, height } = plan;
  const footerStrip = height - footerTop; // copied to the bottom of every sheet
  const room = PAGE_H - contentTop - footerStrip; // content height that fits on one sheet
  const clear = (y) => rowIsClear(canvas, y) && rowIsClear(canvas, y - 1);
  let from = contentTop;
  while (from < footerTop - 1) {
    const limit = from + room;
    let to;
    if (limit >= footerTop) to = footerTop;
    else {
      // Lowest candidate on this sheet whose row is clear in the image; else scan for any clear row
      to = plan.cuts.filter((y) => y > from + 40 && y <= limit).reverse().find(clear);
      if (to === undefined) {
        for (let y = Math.floor(limit); y > from + 40; y--) if (clear(y)) { to = y; break; }
      }
      if (to === undefined) to = limit; // nothing clear (e.g. a block taller than a sheet): hard cut
    }
    plan.slices.push({ from, to });
    from = to;
  }
}

/** Paint one Letter sheet from a captured section. */
function composeSheet({ canvas, plan, slice }) {
  const page = document.createElement('canvas');
  page.width = PAGE_W * SCALE;
  page.height = PAGE_H * SCALE;
  const ctx = page.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, page.width, page.height);
  const copy = (sy, sh, dy) => {
    if (sh <= 0) return;
    ctx.drawImage(canvas, 0, sy * SCALE, canvas.width, sh * SCALE, 0, dy * SCALE, PAGE_W * SCALE, sh * SCALE);
  };
  if (slice.whole) {
    copy(0, Math.min(plan.height, PAGE_H), 0);
    return page;
  }
  copy(0, plan.contentTop, 0); // header and top margin
  copy(slice.from, slice.to - slice.from, plan.contentTop); // this sheet's content
  const footerStrip = plan.height - plan.footerTop;
  copy(plan.footerTop, footerStrip, PAGE_H - footerStrip); // footer and bottom margin
  return page;
}

/** "Page 2 of 5" at the right of the footer's first line, like the Word field. */
function drawPageNumber(page, plan, n, total) {
  if (!plan.numberLine) return;
  const ctx = page.getContext('2d');
  // Footer line position on this sheet (footers sit at the same distance from the bottom)
  const lineBottom = PAGE_H - (plan.height - plan.numberLine.bottom);
  ctx.font = `400 ${7 * (96 / 72) * SCALE}px "Plus Jakarta Sans", sans-serif`;
  ctx.fillStyle = '#6b7280';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`Page ${n} of ${total}`, (PAGE_W - plan.padRight) * SCALE, (lineBottom - 2) * SCALE);
}
