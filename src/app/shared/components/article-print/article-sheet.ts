import * as QRCode from 'qrcode';
import { Card } from '../../../core/services/production.service';
import { chartTitle, groupMeasurements, humanizeKey } from '../../../core/utils/measurements';

/**
 * The print-ready sheet of ONE article for the people who make it: a complete HTML document (its own styles, no app UI), built from the
 * production card that is already on the board. Two layouts:
 *   'a4'     the full job sheet: article, size, QR code, details, design, every measurement, notes
 *   'label'  a 100 x 150 mm label: article, size, QR code, who has it and when it is due
 * The QR code is the article's own code (the same one the Receiving and Production scanners read), never a new kind of code.
 * Only production information is printed: no customer name, phone or address (the customer code and the order reference are enough).
 */
export type SheetMode = 'a4' | 'label';

const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const blank = (v: unknown): boolean => v === null || v === undefined || String(v).trim() === '';

const STAGE_LABELS: Record<string, string> = { to_assign: 'To assign', cutting: 'Cutting', stitching: 'Stitching', qc: 'Quality check', pressing: 'Pressing', packed: 'Packed' };

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** The code the QR carries: the article's own code (SA-1080-1), else the order reference with its line number. */
export const articleQrValue = (card: Card): string => {
  const code = card.unit?.code;
  return String(code || `${card.order_reference}-${card.unit?.line_no ?? 1}`);
};

const qrSvg = (value: string, px: number): string => {
  const { modules } = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const n = modules.size;
  let path = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (modules.get(y, x)) path += `M${x} ${y}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 8} ${n + 8}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="QR code ${esc(value)}"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" transform="translate(4 4)" fill="#000"/></svg>`;
};

const css = (mode: SheetMode): string => `
  @page { size: ${mode === 'a4' ? 'A4' : '100mm 150mm'}; margin: ${mode === 'a4' ? '10mm' : '4mm'}; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font: ${mode === 'a4' ? '12px' : '10px'}/1.4 'Segoe UI', system-ui, -apple-system, Arial, sans-serif; color: #111; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { width: ${mode === 'a4' ? '190mm' : '92mm'}; margin: 0 auto; padding: ${mode === 'a4' ? '0' : '0'}; }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-bottom: ${mode === 'a4' ? '8px' : '4px'}; border-bottom: 2px solid #111; }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 700; letter-spacing: .04em; }
  .mark { width: ${mode === 'a4' ? '30px' : '20px'}; height: ${mode === 'a4' ? '30px' : '20px'}; border-radius: 8px; background: #111; color: #e8d3a0; display: inline-flex; align-items: center; justify-content: center; font-size: ${mode === 'a4' ? '17px' : '12px'}; }
  .doc { text-align: right; font-size: ${mode === 'a4' ? '11px' : '9px'}; color: #444; }
  .doc b { display: block; font-size: ${mode === 'a4' ? '20px' : '14px'}; color: #111; letter-spacing: .02em; }
  .hero { display: flex; align-items: center; justify-content: space-between; gap: ${mode === 'a4' ? '16px' : '8px'}; padding: ${mode === 'a4' ? '14px 0' : '8px 0'}; border-bottom: 1px solid #bbb; }
  .hero .txt { min-width: 0; flex: 1; }
  .eyebrow { font-size: ${mode === 'a4' ? '10px' : '8px'}; letter-spacing: .14em; text-transform: uppercase; color: #666; }
  .name { font-size: ${mode === 'a4' ? '30px' : '19px'}; font-weight: 800; line-height: 1.1; margin: 2px 0 8px; overflow-wrap: anywhere; }
  .size { display: inline-flex; align-items: baseline; gap: 8px; padding: ${mode === 'a4' ? '6px 14px' : '3px 9px'}; border: 2px solid #111; border-radius: 10px; }
  .size .v { font-size: ${mode === 'a4' ? '30px' : '20px'}; font-weight: 800; line-height: 1; }
  .size .k { font-size: ${mode === 'a4' ? '10px' : '8px'}; letter-spacing: .12em; text-transform: uppercase; color: #444; }
  .qty { margin-left: 10px; font-size: ${mode === 'a4' ? '16px' : '12px'}; font-weight: 700; }
  .qr { text-align: center; flex: none; }
  .qr svg { display: block; }
  .qr .code { margin-top: 3px; font: 700 ${mode === 'a4' ? '14px' : '11px'} ui-monospace, Consolas, monospace; letter-spacing: .04em; }
  .rush { display: inline-block; margin-left: 8px; padding: 1px 8px; border-radius: 99px; background: #111; color: #fff; font-size: ${mode === 'a4' ? '10px' : '8px'}; letter-spacing: .1em; text-transform: uppercase; vertical-align: middle; }
  h2 { margin: ${mode === 'a4' ? '14px 0 6px' : '8px 0 4px'}; font-size: ${mode === 'a4' ? '11px' : '9px'}; letter-spacing: .14em; text-transform: uppercase; color: #555; }
  .facts { display: grid; grid-template-columns: ${mode === 'a4' ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)'}; gap: ${mode === 'a4' ? '6px 14px' : '3px 8px'}; }
  .fact { border-left: 3px solid #ddd; padding-left: 7px; min-width: 0; }
  .fact .k { display: block; font-size: ${mode === 'a4' ? '9.5px' : '8px'}; letter-spacing: .1em; text-transform: uppercase; color: #666; }
  .fact .v { font-weight: 700; font-size: ${mode === 'a4' ? '13px' : '10.5px'}; overflow-wrap: anywhere; }
  .groups { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
  table { width: 100%; border-collapse: collapse; }
  caption { text-align: left; font-weight: 700; font-size: 12px; padding: 0 0 4px; }
  td { padding: 3px 6px; border: 1px solid #ccc; }
  td.l { color: #333; width: 62%; }
  td.n { text-align: right; font-weight: 800; font-size: 14px; white-space: nowrap; }
  td.n.empty { color: #aaa; font-weight: 400; }
  .note { border: 1px solid #ccc; border-radius: 6px; padding: 6px 9px; margin: 0 0 6px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .note b { display: block; font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase; color: #666; margin-bottom: 1px; }
  .muted { color: #777; }
  .foot { margin-top: ${mode === 'a4' ? '14px' : '6px'}; padding-top: 6px; border-top: 1px solid #ccc; display: flex; justify-content: space-between; font-size: ${mode === 'a4' ? '10px' : '8px'}; color: #666; }
  .who { margin-top: ${mode === 'a4' ? '10px' : '6px'}; display: flex; gap: 10px; flex-wrap: wrap; }
  .who .fact { flex: 1; min-width: ${mode === 'a4' ? '120px' : '70px'}; }
  @media screen { html, body { overflow: hidden; } body.multi { overflow: auto; } .sheet + .sheet { border-top: 6px solid #e9e9ee; } body { background: #fff; } .sheet { background: #fff; padding: ${mode === 'a4' ? '10mm' : '4mm'}; width: ${mode === 'a4' ? '210mm' : '100mm'}; min-height: ${mode === 'a4' ? '297mm' : '150mm'}; margin: 0; } }
  @media print { .sheet { padding: 0; } .sheet + .sheet { break-before: page; page-break-before: always; } }
`;

function sheetOf(card: Card, mode: SheetMode): string {
  const unit = card.unit;
  const order = card.order;
  const code = articleQrValue(card);
  const chart = unit?.size_chart ?? null;
  const size = chart?.nearest_size || chart?.variation || null;
  const qty = unit?.quantity && unit.quantity > 1 ? unit.quantity : 0;
  const design = Object.entries(unit?.design || {}).filter(([, v]) => !blank(v)).map(([k, v]) => ({ label: humanizeKey(k), value: String(v) }));
  const groups = groupMeasurements(chart?.measurements);
  const due = fmtDate(card.due_date || order?.due_date);
  const rush = card.priority === 'rush' || order?.priority === 'rush';
  const master = card.master?.name || '';
  const tailor = card.tailor?.name || '';
  const stage = STAGE_LABELS[card.stage] || card.stage;

  const fact = (k: string, v: unknown): string => (blank(v) ? '' : `<div class="fact"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`);

  const header = `
    <div class="top">
      <div class="brand"><span class="mark">V</span><span>Stitch&Ship</span></div>
      <div class="doc"><b>${esc(card.order_reference)}</b>Job sheet · printed ${esc(fmtDate(new Date().toISOString()))}</div>
    </div>`;

  const hero = `
    <div class="hero">
      <div class="txt">
        <div class="eyebrow">Article${rush ? '' : ''}</div>
        <div class="name">${esc(card.unit_title || unit?.unit_title || 'Article')}${rush ? '<span class="rush">Priority</span>' : ''}</div>
        <div class="size"><span class="k">Size</span><span class="v">${esc(size || (chart ? chartTitle(chart) : '') || 'See measurements')}</span></div>${qty ? `<span class="qty">× ${qty}</span>` : ''}
      </div>
      <div class="qr">${qrSvg(code, mode === 'a4' ? 168 : 128)}<div class="code">${esc(code)}</div></div>
    </div>`;

  const assigned = [fact('Master', master), fact('Tailor', tailor), fact('Stage', stage), fact('Due', due)].join('');

  if (mode === 'label') {
    const note = unit?.notes || chart?.notes || '';
    return wrap(`${header}${hero}
      <div class="facts">
        ${fact('Order', card.order_reference)}${fact('Article ID', code)}${fact('Brand', order?.brand)}${fact('Customer code', card.customer_code || order?.customer_code)}
      </div>
      <div class="who">${assigned}</div>
      ${note ? `<h2>Note</h2><div class="note">${esc(String(note).slice(0, 160))}${String(note).length > 160 ? '…' : ''}</div>` : ''}`);
  }

  const measures = groups.length
    ? `<div class="groups">${groups
        .map((g) => `<table><caption>${esc(g.label)} <span class="muted">(inches)</span></caption>${g.rows.map((r) => `<tr><td class="l">${esc(r.label)}</td><td class="n${blank(r.value) ? ' empty' : ''}">${blank(r.value) ? '—' : esc(r.value)}</td></tr>`).join('')}</table>`)
        .join('')}</div>`
    : `<p class="muted">${chart ? 'The size chart has no measurements yet.' : 'No size chart is attached to this article. Ask before cutting.'}</p>`;

  const designHtml = design.length
    ? `<div class="facts">${design.map((d) => fact(d.label, d.value)).join('')}</div>`
    : '<p class="muted">No customization selected.</p>';

  const notes = [
    chart?.notes ? `<div class="note"><b>Size note from the customer</b>${esc(chart.notes)}</div>` : '',
    chart?.fit_feedback ? `<div class="note"><b>Fit feedback</b>${esc(chart.fit_feedback)}</div>` : '',
    unit?.notes ? `<div class="note"><b>Stitching instructions / article notes</b>${esc(unit.notes)}</div>` : '',
    order?.customer_notes ? `<div class="note"><b>Order note</b>${esc(order.customer_notes)}</div>` : '',
    card.change_request || order?.change_request ? `<div class="note"><b>Change requested by the customer</b>${esc(card.change_request || order?.change_request)}</div>` : '',
  ].join('');

  return wrap(`${header}${hero}
    <h2>Production details</h2>
    <div class="facts">
      ${fact('Order', card.order_reference)}${fact('Article ID', code)}${fact('Customer code', card.customer_code || order?.customer_code)}
      ${fact('Brand', order?.brand)}${fact('Stitching type', unit?.stitching_type)}${fact('Quantity', unit?.quantity)}
      ${fact('Size chart', chart ? chartTitle(chart) : '')}${fact('Priority', rush ? 'Priority stitching' : '')}${fact('Due', due)}
    </div>
    <div class="who">${[fact('Master', master || 'Not assigned yet'), fact('Tailor', tailor), fact('Stage', stage)].join('')}</div>
    <h2>Design and customization</h2>
    ${designHtml}
    <h2>Measurements</h2>
    ${measures}
    <h2>Notes</h2>
    ${notes || '<p class="muted">No notes.</p>'}
    <div class="foot"><span>${esc(card.order_reference)} · ${esc(code)}</span><span>Stitch&Ship production sheet</span></div>`);
}

function wrap(body: string): string {
  return `<main class="sheet">${body}</main>`;
}

/** The sheets of one or several articles as ONE document: each article starts on a new page (or label). */
export function buildArticleSheets(cards: Card[], mode: SheetMode = 'a4'): string {
  const title = cards.length === 1 ? `${cards[0].unit_title} · ${cards[0].order_reference}` : `${cards.length} article sheets`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${css(mode)}</style></head><body${cards.length > 1 ? ' class="multi"' : ''}>${cards.map((c) => sheetOf(c, mode)).join('')}</body></html>`;
}

export const buildArticleSheet = (card: Card, mode: SheetMode = 'a4'): string => buildArticleSheets([card], mode);
