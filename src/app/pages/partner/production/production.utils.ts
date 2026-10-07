import { ProductionStage, UploadFile } from '../../../core/services/production.service';

/** Column / step metadata shared by the board and the job card page. */
export interface StageMeta {
  stage: ProductionStage;
  en: string;
  ur: string;
  subEn: string;
  subUr: string;
  /** Accent colour of the column (CSS colour or token): to assign = amber (needs action), packed = green (done). */
  color: string;
}

export const STAGE_META: Record<ProductionStage, StageMeta> = {
  to_assign: { stage: 'to_assign', en: 'To assign', ur: 'تقسیم باقی', subEn: 'Received, needs a master', subUr: 'وصول شدہ، ماسٹر درکار', color: 'var(--c-amber)' },
  cutting: { stage: 'cutting', en: 'Cutting', ur: 'کٹائی', subEn: 'With the master', subUr: 'ماسٹر کے پاس', color: 'var(--c-gold)' },
  stitching: { stage: 'stitching', en: 'Stitching', ur: 'سلائی', subEn: 'With a tailor', subUr: 'درزی کے پاس', color: '#B5733A' },
  qc: { stage: 'qc', en: 'Quality check', ur: 'کوالٹی چیک', subEn: 'Master or QC staff', subUr: 'ماسٹر یا کیو سی عملہ', color: 'var(--c-blue)' },
  packed: { stage: 'packed', en: 'Packed', ur: 'پیک شدہ', subEn: 'Handed to warehouse', subUr: 'گودام کے حوالے', color: 'var(--c-green)' },
};

/** "Akram" → "Master Akram" (does not double the prefix). */
export function masterLabel(name: string | null | undefined): string {
  if (!name) return '';
  return /^master\b/i.test(name.trim()) ? name.trim() : `Master ${name.trim()}`;
}

export function initial(name: string | null | undefined): string {
  const clean = (name || '').replace(/^master\s+/i, '').trim();
  return clean ? clean.charAt(0).toUpperCase() : '?';
}

/** "2026-10-24" → "24 Oct" (adds the year when it is not the current one). */
export function shortDate(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' });
}

/** ISO → "16 Oct, 14:05" */
export function shortDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${shortDate(value)}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

// ───────────────────────── Fabric swatches ─────────────────────────

const PALETTES: [string, string][] = [
  ['#2F5D8A', '#C49F63'],
  ['#9C4A2F', '#E8C9A6'],
  ['#6B4FA0', '#E4D8F2'],
  ['#1E6B48', '#D7E9DC'],
  ['#B3412F', '#F4D6CB'],
  ['#3E4A5C', '#D9C9A3'],
  ['#8A6D2F', '#F2E6C8'],
  ['#2C6E73', '#F1D7DD'],
  ['#5B2F4E', '#E6B7A9'],
  ['#4F6B2F', '#EFE3B6'],
];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic "fabric" background for a card (same seed → same swatch), as a CSS `background` value.
 */
export function swatchBackground(seed: string | null | undefined): string {
  const h = hash(seed || 'fabric');
  const [a, b] = PALETTES[h % PALETTES.length];
  const pattern = (h >>> 8) % 6;
  switch (pattern) {
    case 0: // diagonal stripes
      return `repeating-linear-gradient(45deg, ${a} 0 6px, ${b} 6px 9px)`;
    case 1: // vertical stripes
      return `repeating-linear-gradient(90deg, ${a} 0 5px, ${b} 5px 7px, ${a} 7px 12px)`;
    case 2: // polka dots
      return `radial-gradient(circle at 50% 50%, ${b} 0 2.2px, transparent 2.6px) 0 0 / 9px 9px, ${a}`;
    case 3: // checks
      return `repeating-linear-gradient(0deg, transparent 0 6px, ${b}55 6px 9px), repeating-linear-gradient(90deg, ${a} 0 6px, ${b} 6px 9px)`;
    case 4: // block print motif
      return `radial-gradient(circle at 25% 25%, ${b} 0 3px, transparent 3.5px) 0 0 / 14px 14px, radial-gradient(circle at 75% 75%, ${b}AA 0 2px, transparent 2.5px) 0 0 / 14px 14px, ${a}`;
    default: // embroidered border
      return `linear-gradient(180deg, ${a} 0 62%, ${b} 62% 70%, ${a} 70% 78%, ${b} 78% 100%)`;
  }
}

// ───────────────────────── Uploads ─────────────────────────

export const MAX_UPLOADS = 6;
const MAX_VIDEO_BYTES = 7.5 * 1024 * 1024;

export interface PreparedUpload extends UploadFile {
  kind: 'image' | 'video';
}

/** Read a picked file as a data URL; photos are resized to max 1600px and re-encoded as JPEG. */
export async function prepareUpload(file: File): Promise<PreparedUpload> {
  if (file.type.startsWith('video/')) {
    if (file.size > MAX_VIDEO_BYTES) throw new Error(`${file.name} is too large. Keep videos under 7 MB.`);
    return { name: file.name, dataUrl: await readAsDataUrl(file), kind: 'video' };
  }
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not a photo or video.`);
  const original = await readAsDataUrl(file);
  try {
    const dataUrl = await compressImage(original, 1600, 0.82);
    return { name: file.name.replace(/\.[^.]+$/, '') + '.jpg', dataUrl, kind: 'image' };
  } catch {
    return { name: file.name, dataUrl: original, kind: 'image' };
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function compressImage(dataUrl: string, maxSide: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas not supported'));
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('Could not decode image'));
    img.src = dataUrl;
  });
}

// ───────────────────────── Article status ─────────────────────────

/**
 * The API gives each article a `display_status` / `display_label`: its production stage while it is being made,
 * then the order's own progress (Shipped, Delivered ...) once it left production. The raw `stage` stays 'packed'.
 * Returns the label only when it differs from the stage, so the stage names keep their Urdu translation.
 */
export function cardDisplayLabel(c: { stage: string; display_status?: string | null; display_label?: string | null }): string | null {
  return c.display_status && c.display_label && c.display_status !== c.stage ? c.display_label : null;
}

/** Badge tone for a status shown by `cardDisplayLabel`. */
export function cardDisplayTone(c: { display_status?: string | null }): string {
  return c.display_status === 'shipped' || c.display_status === 'delivered' ? 'green' : 'blue';
}
