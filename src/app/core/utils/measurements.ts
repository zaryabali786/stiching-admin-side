/**
 * One source of truth for size-chart measurements (inches). Used by the partner job card, QC,
 * the admin order drawer and the customer drawer. Unknown keys are still shown (humanised).
 */

export interface MeasureRow {
  key: string;
  label: string;
  value: number | string | null;
}

export interface MeasureGroup {
  key: string;
  label: string;
  rows: MeasureRow[];
}

/** Group → [key, label on screen]. Order is the order the tailor reads them in. */
export const MEASUREMENT_GROUP_DEFS: { key: string; label: string; fields: [string, string][] }[] = [
  {
    key: 'shirt',
    label: 'Shirt / kameez',
    fields: [
      ['shirt_length', 'Front length'],
      ['shoulder', 'Shoulder'],
      ['bust', 'Bust'],
      ['waist', 'Waist'],
      ['hip', 'Hip'],
      ['bottom', 'Bottom (hem)'],
      ['sleeve', 'Sleeve length'],
      ['cuff_opening', 'Cuff opening (single)'],
      ['armhole', 'Arm hole'],
    ],
  },
  {
    key: 'trouser',
    label: 'Trouser',
    fields: [
      ['trouser_length', 'Length'],
      ['front_rise', 'Front rise'],
      ['back_rise', 'Back rise'],
      ['waist_relaxed', 'Waist (relaxed)'],
      ['trouser_hip', 'Hip'],
      ['knee', 'Knee'],
      ['thigh', 'Thigh'],
      ['bottom_opening', 'Bottom (single)'],
    ],
  },
];

/** Older charts only; shown in an "Other" group. */
const LEGACY_LABELS: Record<string, string> = { shalwar_gheer: 'Shalwar gheer', neck_depth: 'Neck depth' };

/** Flat key → label map (for places that show a single value). */
export const MEASUREMENT_LABELS: Record<string, string> = {
  ...Object.fromEntries(MEASUREMENT_GROUP_DEFS.flatMap((g) => g.fields)),
  ...LEGACY_LABELS,
};

const blank = (v: unknown) => v === null || v === undefined || v === '';

export function humanizeKey(key: string): string {
  const s = key.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Groups a chart's measurements. A group appears only when at least one of its values is filled;
 * inside a group every field is listed (blank = null, shown as an em dash) so the layout stays the same for the tailor.
 * Keys we do not know are collected in "Other".
 */
export function groupMeasurements(m: Record<string, number | string | null | undefined> | null | undefined): MeasureGroup[] {
  if (!m) return [];
  const known = new Set<string>();
  const groups: MeasureGroup[] = [];
  for (const def of MEASUREMENT_GROUP_DEFS) {
    def.fields.forEach(([k]) => known.add(k));
    if (!def.fields.some(([k]) => !blank(m[k]))) continue;
    groups.push({ key: def.key, label: def.label, rows: def.fields.map(([key, label]) => ({ key, label, value: blank(m[key]) ? null : (m[key] as number | string) })) });
  }
  const other = Object.keys(m)
    .filter((k) => !known.has(k) && !blank(m[k]))
    .map((key) => ({ key, label: LEGACY_LABELS[key] || humanizeKey(key), value: m[key] as number | string }));
  if (other.length) groups.push({ key: 'other', label: 'Other', rows: other });
  return groups;
}

/** "Mother · Long kurta" (falls back to the chart's own name). */
export function chartTitle(c: { name?: string | null; person_name?: string | null; variation?: string | null } | null | undefined): string {
  if (!c) return '';
  const parts = [c.person_name, c.variation].filter((x): x is string => !!x && !!x.trim());
  return parts.length ? parts.join(' · ') : c.name || '';
}
