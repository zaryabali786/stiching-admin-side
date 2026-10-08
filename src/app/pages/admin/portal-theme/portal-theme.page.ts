import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { IonIcon, IonSpinner } from '@ionic/angular';
import { PortalPreset, PortalTheme, PortalThemeService, loadFonts, portalVars } from '../../../core/services/portal-theme.service';
import { UiService } from '../../../core/services/ui.service';

type ColorKey = 'sidebar_bg' | 'sidebar_text' | 'sidebar_active_bg' | 'sidebar_accent' | 'primary' | 'primary_text' | 'page_bg' | 'card_bg';

interface Field {
  key: ColorKey;
  label: string;
  hint: string;
}

const F = { heading_font: 'Playfair Display', heading_size: 30, body_font: 'Inter', body_size: 14 };

const PRESETS: { name: string; theme: PortalTheme }[] = [
  { name: 'Forest', theme: { sidebar_bg: '#0F2219', sidebar_text: '#B8C4BD', sidebar_active_bg: '#27382F', sidebar_accent: '#7FD3A8', primary: '#17362A', primary_text: '#FFFFFF', page_bg: '#F6F3EE', card_bg: '#FFFFFF', ...F } },
  { name: 'Midnight', theme: { sidebar_bg: '#0F172A', sidebar_text: '#A8B3C7', sidebar_active_bg: '#24304A', sidebar_accent: '#60A5FA', primary: '#1E293B', primary_text: '#FFFFFF', page_bg: '#F4F6FA', card_bg: '#FFFFFF', ...F, heading_font: 'Manrope', body_font: 'Manrope' } },
  { name: 'Plum', theme: { sidebar_bg: '#2A1240', sidebar_text: '#CDB8E3', sidebar_active_bg: '#432063', sidebar_accent: '#C084FC', primary: '#6B21A8', primary_text: '#FFFFFF', page_bg: '#F8F5FC', card_bg: '#FFFFFF', ...F, heading_font: 'Cormorant Garamond', heading_size: 34 } },
  { name: 'Ocean', theme: { sidebar_bg: '#0B3B46', sidebar_text: '#B5D3D9', sidebar_active_bg: '#14586A', sidebar_accent: '#5EEAD4', primary: '#0F766E', primary_text: '#FFFFFF', page_bg: '#F2F8F8', card_bg: '#FFFFFF', ...F, heading_font: 'Lora', body_font: 'Nunito', body_size: 15 } },
  { name: 'Light', theme: { sidebar_bg: '#FFFFFF', sidebar_text: '#4B5563', sidebar_active_bg: '#EEF2FF', sidebar_accent: '#4F46E5', primary: '#4F46E5', primary_text: '#FFFFFF', page_bg: '#F3F4F6', card_bg: '#FFFFFF', ...F, heading_font: 'Poppins', heading_size: 28, body_font: 'Poppins', body_size: 13 } },
  { name: 'Rose', theme: { sidebar_bg: '#3B1520', sidebar_text: '#E8C5CE', sidebar_active_bg: '#5A2434', sidebar_accent: '#FB9DB5', primary: '#BE185D', primary_text: '#FFFFFF', page_bg: '#FDF5F7', card_bg: '#FFFFFF', heading_font: 'Lora', heading_size: 32, body_font: 'DM Sans', body_size: 14 } },
  { name: 'Sunset', theme: { sidebar_bg: '#3A1A12', sidebar_text: '#F0CDBE', sidebar_active_bg: '#5C2B1D', sidebar_accent: '#FDBA74', primary: '#C2410C', primary_text: '#FFFFFF', page_bg: '#FFF7F1', card_bg: '#FFFFFF', heading_font: 'Playfair Display', heading_size: 30, body_font: 'Nunito', body_size: 15 } },
  { name: 'Lavender', theme: { sidebar_bg: '#F3EEFF', sidebar_text: '#5B4B8A', sidebar_active_bg: '#E2D6FF', sidebar_accent: '#7C3AED', primary: '#7C3AED', primary_text: '#FFFFFF', page_bg: '#FAF8FF', card_bg: '#FFFFFF', heading_font: 'Cormorant Garamond', heading_size: 36, body_font: 'Manrope', body_size: 14 } },
  { name: 'Fresh mint', theme: { sidebar_bg: '#FFFFFF', sidebar_text: '#3F5F52', sidebar_active_bg: '#DFF5EA', sidebar_accent: '#059669', primary: '#059669', primary_text: '#FFFFFF', page_bg: '#F1F8F4', card_bg: '#FFFFFF', heading_font: 'Lora', heading_size: 30, body_font: 'Nunito', body_size: 15 } },
  { name: 'Graphite gold', theme: { sidebar_bg: '#1F1F23', sidebar_text: '#BDBDC4', sidebar_active_bg: '#34343B', sidebar_accent: '#E5B94E', primary: '#2B2B31', primary_text: '#FFFFFF', page_bg: '#F5F4F1', card_bg: '#FFFFFF', heading_font: 'Playfair Display', heading_size: 30, body_font: 'Inter', body_size: 14 } },
  { name: 'Sky', theme: { sidebar_bg: '#0C4A6E', sidebar_text: '#BAE0F5', sidebar_active_bg: '#0E6293', sidebar_accent: '#7DD3FC', primary: '#0369A1', primary_text: '#FFFFFF', page_bg: '#F0F7FC', card_bg: '#FFFFFF', heading_font: 'Montserrat', heading_size: 28, body_font: 'Open Sans', body_size: 14 } },
  { name: 'Mocha', theme: { sidebar_bg: '#3B2A22', sidebar_text: '#D9C6B8', sidebar_active_bg: '#5A4033', sidebar_accent: '#E0B48A', primary: '#7A5238', primary_text: '#FFFFFF', page_bg: '#FAF6F1', card_bg: '#FFFFFF', heading_font: 'Merriweather', heading_size: 28, body_font: 'Lato', body_size: 14 } },
  { name: 'Berry', theme: { sidebar_bg: '#2D1230', sidebar_text: '#E3C3E6', sidebar_active_bg: '#4A2150', sidebar_accent: '#F0ABFC', primary: '#A21CAF', primary_text: '#FFFFFF', page_bg: '#FCF5FD', card_bg: '#FFFFFF', heading_font: 'Playfair Display', heading_size: 30, body_font: 'Poppins', body_size: 14 } },
  { name: 'Slate mist', theme: { sidebar_bg: '#E8EDF3', sidebar_text: '#475569', sidebar_active_bg: '#D3DCE8', sidebar_accent: '#2563EB', primary: '#2563EB', primary_text: '#FFFFFF', page_bg: '#F6F8FB', card_bg: '#FFFFFF', heading_font: 'Inter', heading_size: 28, body_font: 'Inter', body_size: 14 } },
];

@Component({
  selector: 'app-admin-portal-theme',
  standalone: true,
  imports: [IonIcon, IonSpinner],
  templateUrl: './portal-theme.page.html',
  styleUrls: ['./portal-theme.page.scss'],
})
export class AdminPortalThemePage implements OnInit {
  private themes = inject(PortalThemeService);
  private ui = inject(UiService);

  readonly presets = PRESETS;
  readonly myPresets = signal<PortalPreset[]>([]);
  readonly fonts = signal<string[]>([]);
  readonly newName = signal('');
  readonly naming = signal(false);
  readonly savingPreset = signal(false);
  readonly groups: { title: string; hint: string; fields: Field[] }[] = [
    {
      title: 'Sidebar',
      hint: 'The menu on the left of the admin and partner portals.',
      fields: [
        { key: 'sidebar_bg', label: 'Background', hint: '' },
        { key: 'sidebar_text', label: 'Menu text and icons', hint: '' },
        { key: 'sidebar_active_bg', label: 'Selected item background', hint: '' },
        { key: 'sidebar_accent', label: 'Selected item accent', hint: '' },
      ],
    },
    {
      title: 'Buttons and tabs',
      hint: 'Main buttons, selected tabs and the avatar.',
      fields: [
        { key: 'primary', label: 'Button colour', hint: '' },
        { key: 'primary_text', label: 'Text on buttons', hint: '' },
      ],
    },
    {
      title: 'Pages',
      hint: 'The background of every page and of the cards on it.',
      fields: [
        { key: 'page_bg', label: 'Page background', hint: '' },
        { key: 'card_bg', label: 'Card background', hint: '' },
      ],
    },
  ];

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly theme = signal<PortalTheme | null>(null);
  readonly savedJson = signal('');
  readonly defaults = signal<PortalTheme | null>(null);
  readonly dirty = computed(() => !!this.theme() && JSON.stringify(this.theme()) !== this.savedJson());
  readonly previewVars = computed(() => (this.theme() ? portalVars(this.theme()!) : {}));

  ngOnInit(): void {
    this.themes.get().subscribe({
      next: (d) => {
        this.theme.set({ ...d.theme });
        this.savedJson.set(JSON.stringify(d.theme));
        this.defaults.set(d.defaults);
        this.myPresets.set(d.presets);
        this.fonts.set([...d.fonts.sans, ...d.fonts.serif]);
        this.previewFonts();
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.message || 'Could not load the portal theme.');
        this.loading.set(false);
      },
    });
  }

  set(key: ColorKey, value: string): void {
    if (/^#[0-9a-fA-F]{6}$/.test(value)) this.theme.update((t) => (t ? { ...t, [key]: value.toUpperCase() } : t));
  }

  setFont(key: 'heading_font' | 'body_font', value: string): void {
    this.theme.update((t) => (t ? { ...t, [key]: value } : t));
    this.previewFonts();
  }

  setSize(key: 'heading_size' | 'body_size', value: number): void {
    this.theme.update((t) => (t ? { ...t, [key]: value } : t));
  }

  private previewFonts(): void {
    const t = this.theme();
    // the editor's preview loads its fonts in its own stylesheet, so the fonts the portal is really using stay loaded
    if (t) loadFonts([t.body_font, t.heading_font], 'portal-theme-preview-fonts');
  }

  saveAsPreset(): void {
    const t = this.theme();
    const name = this.newName().trim();
    if (!t || name.length < 2 || this.savingPreset()) return;
    this.savingPreset.set(true);
    this.themes.createPreset(name, t).subscribe({
      next: (res) => {
        this.savingPreset.set(false);
        this.myPresets.set(res.data.presets);
        this.newName.set('');
        this.naming.set(false);
        this.ui.success(res.message);
      },
      error: (err) => {
        this.savingPreset.set(false);
        this.ui.error(err);
      },
    });
  }

  async deletePreset(p: PortalPreset): Promise<void> {
    const ok = await this.ui.confirm({ title: `Delete "${p.name}"?`, message: 'This only removes it from your list. The portals keep their current look.', confirmText: 'Delete', danger: true });
    if (!ok) return;
    this.themes.deletePreset(p.id).subscribe({
      next: (d) => this.myPresets.set(d.presets),
      error: (err) => this.ui.error(err),
    });
  }

  isPreset(p: PortalTheme): boolean {
    return JSON.stringify(p) === JSON.stringify(this.theme());
  }

  usePreset(p: PortalTheme): void {
    this.theme.set({ ...p });
    this.previewFonts();
  }

  discard(): void {
    const saved = this.savedJson();
    if (saved) this.theme.set(JSON.parse(saved));
  }

  save(): void {
    const t = this.theme();
    if (!t || this.saving()) return;
    this.saving.set(true);
    this.themes.save(t).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.savedJson.set(JSON.stringify(res.data.theme));
        this.themes.apply(res.data.theme);
        this.ui.success(res.message);
      },
      error: (err) => {
        this.saving.set(false);
        this.ui.error(err);
      },
    });
  }

  async resetAll(): Promise<void> {
    const ok = await this.ui.confirm({
      title: 'Go back to the original look?',
      message: 'The portals return to their built-in colours for everyone.',
      confirmText: 'Reset',
      danger: true,
    });
    if (!ok) return;
    this.saving.set(true);
    this.themes.reset().subscribe({
      next: (d) => {
        this.saving.set(false);
        this.theme.set({ ...d.defaults });
        this.savedJson.set(JSON.stringify(d.defaults));
        this.themes.apply(null);
        this.ui.success('Portal theme reset.');
      },
      error: (err) => {
        this.saving.set(false);
        this.ui.error(err);
      },
    });
  }
}
