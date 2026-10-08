import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiService } from './api.service';

/** Colours of the admin and partner portals, chosen by the admin (Setup > Portal theme). */
export interface PortalTheme {
  sidebar_bg: string;
  sidebar_text: string;
  sidebar_active_bg: string;
  sidebar_accent: string;
  primary: string;
  primary_text: string;
  page_bg: string;
  card_bg: string;
  heading_font: string;
  heading_size: number;
  body_font: string;
  body_size: number;
}

export interface PortalPreset {
  id: string;
  name: string;
  theme: PortalTheme;
}

export interface PortalThemeData {
  theme: PortalTheme;
  defaults: PortalTheme;
  saved: boolean;
  fonts: { sans: string[]; serif: string[] };
  presets: PortalPreset[];
}

const CACHE_KEY = 'portal-theme';
const VARS = [
  '--c-bg', '--c-bg-soft', '--c-hover', '--c-surface', '--c-dark-2', '--c-dark-2-hover', '--portal-on-primary', '--ion-background-color',
  '--font-sans', '--font-serif', '--portal-body-size', '--portal-h1-size',
  '--portal-sb-bg', '--portal-sb-text', '--portal-sb-text-strong', '--portal-sb-muted', '--portal-sb-hover', '--portal-sb-active', '--portal-sb-accent', '--portal-sb-line',
];

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const toHex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
/** Blend `hex` towards `target` by `amount` (0 = hex, 1 = target). */
export const mix = (hex: string, target: string, amount: number) => {
  const a = rgb(hex);
  const b = rgb(target);
  return toHex(a.map((v, i) => v + (b[i] - v) * amount));
};
export const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};

/** CSS variables for a theme (also used by the live preview in the editor). */
export function portalVars(theme: PortalTheme): Record<string, string> {
  // a theme cached before fonts existed has no font settings: fill them in
  const fallback = { heading_font: 'Playfair Display', heading_size: 30, body_font: 'Inter', body_size: 14 };
  const t = { ...fallback, ...(theme as Partial<PortalTheme>) } as PortalTheme;
  const [tr, tg, tb] = rgb(t.sidebar_text);
  return {
    '--c-bg': t.page_bg,
    '--c-bg-soft': mix(t.page_bg, '#ffffff', 0.5),
    '--c-hover': mix(t.page_bg, '#000000', 0.04),
    '--c-surface': t.card_bg,
    '--c-dark-2': t.primary,
    '--c-dark-2-hover': mix(t.primary, '#000000', 0.15),
    '--portal-on-primary': t.primary_text,
    '--ion-background-color': t.page_bg,
    '--font-sans': `'${t.body_font}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`,
    '--font-serif': `'${t.heading_font}', Georgia, serif`,
    '--portal-body-size': `${t.body_size}px`,
    '--portal-h1-size': `${t.heading_size}px`,
    '--portal-sb-bg': t.sidebar_bg,
    '--portal-sb-text': t.sidebar_text,
    '--portal-sb-text-strong': luminance(t.sidebar_active_bg) > 0.6 ? '#111827' : '#FFFFFF',
    '--portal-sb-muted': mix(t.sidebar_text, t.sidebar_bg, 0.45),
    '--portal-sb-hover': `rgba(${tr}, ${tg}, ${tb}, 0.09)`,
    '--portal-sb-active': t.sidebar_active_bg,
    '--portal-sb-accent': t.sidebar_accent,
    '--portal-sb-line': `rgba(${tr}, ${tg}, ${tb}, 0.14)`,
  };
}

const FONT_LINK_ID = 'portal-theme-fonts';

/** Loads the chosen Google Fonts (the page's own fonts stay as the fallback while they download). */
export function loadFonts(families: string[], linkId = FONT_LINK_ID): void {
  const unique = [...new Set(families)];
  const href = `https://fonts.googleapis.com/css2?${unique.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700`).join('&')}&display=swap`;
  let link = document.getElementById(linkId) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.id = linkId;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  if (link.href !== href) link.href = href;
}

/** Applies the admin's portal theme as CSS variables on <html>. Cached, so the portal never flashes the old look. */
@Injectable({ providedIn: 'root' })
export class PortalThemeService {
  private api = inject(ApiService);

  constructor() {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) this.apply(JSON.parse(cached) as PortalTheme, false);
    } catch {
      /* storage unavailable: the built-in look applies */
    }
  }

  /** Reads the saved theme from the public config (works for admin and partner users alike). */
  load(): void {
    this.api.get<{ portalTheme?: PortalTheme | null }>('/config').subscribe({
      next: (c) => this.apply(c.portalTheme ?? null),
      error: () => undefined,
    });
  }

  apply(theme: PortalTheme | null, cache = true): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement.style;
    if (!theme) {
      VARS.forEach((v) => root.removeProperty(v));
      delete document.documentElement.dataset['portalFonts'];
    } else {
      Object.entries(portalVars(theme)).forEach(([k, v]) => root.setProperty(k, v));
      document.documentElement.dataset['portalFonts'] = 'on';
      loadFonts([theme.body_font || 'Inter', theme.heading_font || 'Playfair Display']);
    }
    if (cache) {
      try {
        if (theme) localStorage.setItem(CACHE_KEY, JSON.stringify(theme));
        else localStorage.removeItem(CACHE_KEY);
      } catch {
        /* ignore */
      }
    }
  }

  // admin editor
  get(): Observable<PortalThemeData> {
    return this.api.get<PortalThemeData>('/admin/settings/portal-theme');
  }

  save(theme: PortalTheme): Observable<{ data: PortalThemeData; message: string }> {
    return this.api.put<PortalThemeData>('/admin/settings/portal-theme', theme).pipe(map((data) => ({ data, message: 'Portal theme saved.' })));
  }

  createPreset(name: string, theme: PortalTheme): Observable<{ data: PortalThemeData; message: string }> {
    return this.api.postWithMessage<PortalThemeData>('/admin/settings/portal-theme/presets', { name, theme });
  }

  deletePreset(id: string): Observable<PortalThemeData> {
    return this.api.delete<PortalThemeData>(`/admin/settings/portal-theme/presets/${id}`);
  }

  reset(): Observable<PortalThemeData> {
    return this.api.delete<PortalThemeData>('/admin/settings/portal-theme');
  }
}
