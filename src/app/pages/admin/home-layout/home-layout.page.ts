import { NgTemplateOutlet } from '@angular/common';
import { Component, HostListener, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { IonIcon, IonSpinner } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  megaphoneOutline, cloudUploadOutline, sparklesOutline, textOutline, radioButtonOnOutline, chatbubbleEllipsesOutline, colorPaletteOutline, swapHorizontalOutline, imagesOutline, imageOutline, albumsOutline, shirtOutline, gridOutline, createOutline,
  reorderTwoOutline, eyeOutline, eyeOffOutline, trashOutline, addOutline, closeOutline, copyOutline,
  mailOutline, notificationsOutline, home, cubeOutline, optionsOutline, personOutline, footstepsOutline, chevronUpOutline, chevronDownOutline,
} from 'ionicons/icons';
import { AdminService, Banner, ClientTheme, ClientThemeData, ClientThemePreset, HomeLayoutArticle, HomeLayoutSection, HomeSectionType, HomeStepItem } from '../../../core/services/admin.service';
import { UiService } from '../../../core/services/ui.service';
import { ImageUpload, compressImage, prepareIcon } from '../../../core/utils/image';
import { Paged } from '../../../core/models/api.models';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';

/** Pages inside the customer app a banner or button can open. */
export const APP_PAGES = [
  { path: '/app/overview', label: 'Home' },
  { path: '/app/orders', label: 'My orders' },
  { path: '/app/orders/new', label: 'New order' },
  { path: '/app/inbox', label: 'Inbox' },
  { path: '/app/sizes', label: 'Size charts' },
  { path: '/app/profile', label: 'Profile' },
];

interface BannerForm {
  id: string | null;
  title: string;
  link_url: string;
  is_active: boolean;
  preview: string | null;
  upload: ImageUpload | null;
  /** The text on the banner and its button. */
  heading: string;
  subheading: string;
  button_label: string;
  button_link: string;
  text_color: string;
  button_bg: string;
  button_color: string;
  overlay: number;
  text_align: 'left' | 'center';
  /** The part of the picture kept in view (percent across and down), set by dragging the picture. */
  focus_x: number;
  focus_y: number;
}

const BANNER_COPY_DEFAULTS = { heading: '', subheading: '', button_label: '', button_link: '', text_color: '#FFFFFF', button_bg: '#FFFFFF', button_color: '#62003E', overlay: 35, text_align: 'left' as const, focus_x: 50, focus_y: 50 };

interface SectionMeta {
  type: HomeSectionType;
  label: string;
  icon: string;
  help: string;
  defaults: Record<string, any>;
}

/** Soft colour pairs for the cards of a "How it works" section (first colour to second colour, top left to bottom right). */
export const STEP_COLORS: { name: string; bg: string; bg2: string }[] = [
  { name: 'Pink', bg: '#FDE2EF', bg2: '#F9B4D6' },
  { name: 'Lavender', bg: '#EBDDFB', bg2: '#C9ABEF' },
  { name: 'Sand', bg: '#F7ECDD', bg2: '#E6CFAE' },
  { name: 'Mint', bg: '#D9F5DF', bg2: '#8FDBA3' },
  { name: 'Sky', bg: '#D8F0FB', bg2: '#8ECDE8' },
  { name: 'Peach', bg: '#FFE8D6', bg2: '#FFC29B' },
  { name: 'Lemon', bg: '#FFF6C9', bg2: '#F7DE7A' },
  { name: 'Slate', bg: '#E2E8F0', bg2: '#B6C2D2' },
];

const stepCard = (title: string, text: string, emoji: string, c: number): HomeStepItem => ({ title, text, icon_url: '', emoji, bg: STEP_COLORS[c].bg, bg2: STEP_COLORS[c].bg2, color: '#1F2937', link: '' });

/** Every section the admin can add, with the settings a new one starts with (the server keeps the same defaults). */
export const SECTION_META: SectionMeta[] = [
  { type: 'announcement', label: 'Announcement bar', icon: 'megaphone-outline', help: 'A short offer or notice in a coloured bar.',
    defaults: { text: 'Free consultation on your first order', image_url: '', link: '', bg: '#0F172A', color: '#FFFFFF', align: 'center', size: 'small', dismissible: true } },
  { type: 'marquee', label: 'Running text', icon: 'swap-horizontal-outline', help: 'A message that scrolls across the screen.',
    defaults: { text: '✨ Bespoke stitching · Delivered worldwide · New season fabrics welcome', image_url: '', image_size: 'small', link: '', bg: '#C29848', color: '#FFFFFF', speed: 'normal', direction: 'left' } },
  { type: 'banners', label: 'Banner slider', icon: 'images-outline', help: 'Your banner pictures (slides automatically when there are several).',
    defaults: { autoplay: true } },
  { type: 'hero', label: 'Hero image', icon: 'image-outline', help: 'A large picture with a heading and a button.',
    defaults: { image_url: '', heading: 'New season, tailored for you', subheading: '', button_label: 'Book stitching', button_link: '/app/orders/new', overlay: 35, align: 'left', height: 'medium' } },
  { type: 'image_text', label: 'Image with text', icon: 'albums-outline', help: 'A picture next to a heading and a short text.',
    defaults: { image_url: '', heading: 'Made to your measurements', body: '', button_label: '', button_link: '', layout: 'image-left', bg: '#FFFFFF', color: '#111827' } },
  { type: 'articles', label: 'Articles', icon: 'shirt-outline', help: 'Show articles you pick from your catalogue.',
    defaults: { title: 'Our articles', article_ids: [], layout: 'grid', columns: 2, autoplay: false, button_label: '', button_link: '' } },
  { type: 'collection', label: 'Featured collection', icon: 'grid-outline', help: 'Hand-pick articles to feature, as a slider, grid or list.',
    defaults: { title: 'Featured', article_ids: [], layout: 'slider', columns: 2, autoplay: false, button_label: '', button_link: '' } },
  { type: 'steps', label: 'How it works (cards)', icon: 'footsteps-outline', help: 'A row of numbered cards, each with its own picture, text and colours. Good for steps or features.',
    defaults: {
      title: 'How it works?', highlight: 'it', highlight_color: '#6D1D3A', subtitle: '', layout: 'slider', show_numbers: true, number_color: '#FFFFFF',
      items: [
        stepCard('Send Us Your Fabric', 'Order directly from any brand\'s website to our address, or send us your own parcel.', '📦', 0),
        stepCard('Customize Your Fit', 'Add your measurements in the app and share your specific design preferences.', '📏', 1),
        stepCard('Track the Crafting', 'Follow along with live updates on your dashboard as we stitch your dress.', '🧵', 2),
        stepCard('Approve the Final Look', 'Review the finished garment and give us your final approval.', '✅', 3),
        stepCard('Enjoy Doorstep Delivery', 'Sit back and receive your custom-stitched dress right at your door.', '🚚', 4),
      ],
    } },
  { type: 'custom', label: 'Custom content', icon: 'create-outline', help: 'Your own heading, text and button.',
    defaults: { heading: 'A note from the atelier', body: '', align: 'left', bg: '#FFFFFF', color: '#111827', button_label: '', button_link: '' } },
];

/** Ready-made colours for the main (active tab / buttons) colour. */
const PALETTES = [
  { name: 'Midnight', color: '#0F172A', color2: '#1E293B' },
  { name: 'Emerald', color: '#065F46', color2: '#10B981' },
  { name: 'Royal blue', color: '#1D4ED8', color2: '#60A5FA' },
  { name: 'Plum', color: '#6B21A8', color2: '#C084FC' },
  { name: 'Burgundy', color: '#6D3737', color2: '#F08484' },
  { name: 'Teal', color: '#0F766E', color2: '#2DD4BF' },
  { name: 'Copper', color: '#B45309', color2: '#FBBF24' },
  { name: 'Charcoal', color: '#374151', color2: '#9CA3AF' },
];

/** Ready-made looks for the whole customer app: colours, fonts and button style in one click. */
const THEME_PRESETS: { name: string; theme: ClientTheme }[] = [
  { name: 'Midnight atelier', theme: { primary: '#0F172A', primary_2: '#1E293B', primary_text: '#FFFFFF', accent: '#7C5CBF', badge_bg: '#EF4444', badge_bg_2: '#EF4444', badge_text: '#FFFFFF', notification_bg: '#1C2B23', notification_bg_2: '#1C2B23', notification_text: '#FFFFFF', body_font: 'Jost', heading_font: 'Cormorant Garamond', font_size: 15, heading_size: 32, button_style: 'solid' } },
  { name: 'Lavender', theme: { primary: '#7C3AED', primary_2: '#C084FC', primary_text: '#FFFFFF', accent: '#8B5CF6', badge_bg: '#EF4444', badge_bg_2: '#F87171', badge_text: '#FFFFFF', notification_bg: '#2E1065', notification_bg_2: '#4C1D95', notification_text: '#FFFFFF', body_font: 'Jost', heading_font: 'Cormorant Garamond', font_size: 15, heading_size: 34, button_style: 'fade' } },
  { name: 'Emerald', theme: { primary: '#065F46', primary_2: '#10B981', primary_text: '#FFFFFF', accent: '#059669', badge_bg: '#F59E0B', badge_bg_2: '#FBBF24', badge_text: '#111827', notification_bg: '#064E3B', notification_bg_2: '#065F46', notification_text: '#FFFFFF', body_font: 'Nunito', heading_font: 'Lora', font_size: 15, heading_size: 32, button_style: 'solid' } },
  { name: 'Royal blue', theme: { primary: '#1D4ED8', primary_2: '#60A5FA', primary_text: '#FFFFFF', accent: '#2563EB', badge_bg: '#EF4444', badge_bg_2: '#F87171', badge_text: '#FFFFFF', notification_bg: '#1E3A8A', notification_bg_2: '#1D4ED8', notification_text: '#FFFFFF', body_font: 'Manrope', heading_font: 'Playfair Display', font_size: 15, heading_size: 30, button_style: 'outline' } },
  { name: 'Rose', theme: { primary: '#BE185D', primary_2: '#F472B6', primary_text: '#FFFFFF', accent: '#DB2777', badge_bg: '#7C3AED', badge_bg_2: '#A78BFA', badge_text: '#FFFFFF', notification_bg: '#500724', notification_bg_2: '#831843', notification_text: '#FFFFFF', body_font: 'DM Sans', heading_font: 'Lora', font_size: 15, heading_size: 32, button_style: 'fade' } },
  { name: 'Sunset', theme: { primary: '#C2410C', primary_2: '#FB923C', primary_text: '#FFFFFF', accent: '#EA580C', badge_bg: '#0F766E', badge_bg_2: '#14B8A6', badge_text: '#FFFFFF', notification_bg: '#431407', notification_bg_2: '#7C2D12', notification_text: '#FFFFFF', body_font: 'Nunito', heading_font: 'Playfair Display', font_size: 15, heading_size: 32, button_style: 'solid' } },
  { name: 'Teal fresh', theme: { primary: '#0F766E', primary_2: '#2DD4BF', primary_text: '#FFFFFF', accent: '#0D9488', badge_bg: '#E11D48', badge_bg_2: '#FB7185', badge_text: '#FFFFFF', notification_bg: '#134E4A', notification_bg_2: '#0F766E', notification_text: '#FFFFFF', body_font: 'Poppins', heading_font: 'Merriweather', font_size: 14, heading_size: 30, button_style: 'fade' } },
  { name: 'Gold and black', theme: { primary: '#111111', primary_2: '#3F3F46', primary_text: '#F7E7B4', accent: '#B8860B', badge_bg: '#B8860B', badge_bg_2: '#E5B94E', badge_text: '#111111', notification_bg: '#111111', notification_bg_2: '#27272A', notification_text: '#F7E7B4', body_font: 'Jost', heading_font: 'Cormorant Garamond', font_size: 16, heading_size: 36, button_style: 'solid' } },
  { name: 'Plum', theme: { primary: '#6B21A8', primary_2: '#C084FC', primary_text: '#FFFFFF', accent: '#9333EA', badge_bg: '#F43F5E', badge_bg_2: '#FB7185', badge_text: '#FFFFFF', notification_bg: '#3B0764', notification_bg_2: '#581C87', notification_text: '#FFFFFF', body_font: 'Montserrat', heading_font: 'Playfair Display', font_size: 15, heading_size: 32, button_style: 'outline' } },
  { name: 'Mocha', theme: { primary: '#7A5238', primary_2: '#B08968', primary_text: '#FFFFFF', accent: '#A47551', badge_bg: '#C2410C', badge_bg_2: '#EA580C', badge_text: '#FFFFFF', notification_bg: '#3B2A22', notification_bg_2: '#5A4033', notification_text: '#FFFFFF', body_font: 'Lato', heading_font: 'Merriweather', font_size: 15, heading_size: 30, button_style: 'solid' } },
  { name: 'Ocean', theme: { primary: '#0369A1', primary_2: '#38BDF8', primary_text: '#FFFFFF', accent: '#0EA5E9', badge_bg: '#F97316', badge_bg_2: '#FB923C', badge_text: '#FFFFFF', notification_bg: '#0C4A6E', notification_bg_2: '#0369A1', notification_text: '#FFFFFF', body_font: 'Open Sans', heading_font: 'Lora', font_size: 15, heading_size: 30, button_style: 'fade' } },
  { name: 'Charcoal', theme: { primary: '#374151', primary_2: '#9CA3AF', primary_text: '#FFFFFF', accent: '#4B5563', badge_bg: '#EF4444', badge_bg_2: '#EF4444', badge_text: '#FFFFFF', notification_bg: '#111827', notification_bg_2: '#1F2937', notification_text: '#FFFFFF', body_font: 'Inter', heading_font: 'Playfair Display', font_size: 15, heading_size: 30, button_style: 'solid' } },
];

/** Ready-made colours for the soft surfaces (draft order, order details, profile, inbox). */
const ACCENTS = [
  { name: 'Lavender', color: '#7C5CBF' },
  { name: 'Sky', color: '#3B82F6' },
  { name: 'Mint', color: '#10B981' },
  { name: 'Rose', color: '#E11D74' },
  { name: 'Coral', color: '#F97360' },
  { name: 'Amber', color: '#D97706' },
  { name: 'Teal', color: '#0EA5A5' },
  { name: 'Slate', color: '#64748B' },
];

/** Shown in the preview until the saved theme has loaded. */
const FALLBACK_THEME: ClientTheme = {
  primary: '#0F172A', primary_2: '#1E293B', primary_text: '#FFFFFF', badge_bg: '#EF4444', badge_bg_2: '#EF4444', badge_text: '#FFFFFF',
  notification_bg: '#1C2B23', notification_bg_2: '#1C2B23', notification_text: '#FFFFFF', body_font: 'Jost', heading_font: 'Cormorant Garamond', font_size: 15, button_style: 'solid', accent: '#7C5CBF',
};

type ThemeColorKey = 'accent' | 'primary' | 'primary_2' | 'primary_text' | 'badge_bg' | 'badge_bg_2' | 'badge_text' | 'notification_bg' | 'notification_bg_2' | 'notification_text';

const hexToRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const mix = (hex: string, target: string, amount: number) => {
  const a = hexToRgb(hex);
  const b = hexToRgb(target);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, '0')).join('');
};

const newId = () => 'sec-' + Math.random().toString(36).slice(2, 10);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

@Component({
  selector: 'app-admin-home-layout',
  standalone: true,
  imports: [NgTemplateOutlet, CdkDropList, CdkDrag, CdkDragHandle, IonIcon, IonSpinner, EmptyStateComponent],
  templateUrl: './home-layout.page.html',
  styleUrls: ['./home-layout.page.scss'],
})
export class AdminHomeLayoutPage implements OnInit {
  private admin = inject(AdminService);
  private ui = inject(UiService);
  private route = inject(ActivatedRoute);

  readonly metas = SECTION_META;
  readonly sections = signal<HomeLayoutSection[]>([]);
  readonly saved = signal('[]');
  /** Articles already seen (used by the layout or listed in the picker), so names and pictures show without loading everything. */
  private readonly articleCache = signal<Record<string, HomeLayoutArticle>>({});
  readonly types = signal<{ id: string; name: string }[]>([]);
  /** Every banner (shown or hidden) for the banner section's editor; the preview and the home page use the shown ones. */
  readonly allBanners = signal<Banner[]>([]);
  readonly banners = computed(() => this.allBanners().filter((b) => b.is_active));
  readonly bannerForm = signal<BannerForm | null>(null);
  readonly bannerSaving = signal(false);
  readonly bannerBusy = signal<string | null>(null);
  readonly bannerFileError = signal<string | null>(null);
  readonly appPages = APP_PAGES;
  readonly bannerLinkValid = computed(() => {
    const link = this.bannerForm()?.link_url.trim();
    if (!link || link.startsWith('/app/')) return true;
    try {
      return ['http:', 'https:'].includes(new URL(link).protocol);
    } catch {
      return false;
    }
  });
  readonly bannerButtonLinkValid = computed(() => {
    const link = this.bannerForm()?.button_link.trim();
    if (!link || link.startsWith('/app/')) return true;
    try {
      return ['http:', 'https:'].includes(new URL(link).protocol);
    } catch {
      return false;
    }
  });
  readonly bannerFormValid = computed(() => !!this.bannerForm()?.preview && this.bannerLinkValid() && this.bannerButtonLinkValid());
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  readonly uploading = signal(false);
  readonly selectedId = signal<string | null>(null);
  /** Position a new section will be inserted at while the "Add section" dialog is open (null = closed). */
  readonly addAt = signal<number | null>(null);
  /** Article picker state: the catalogue is loaded one page at a time and searched on the server. */
  readonly pickItems = signal<HomeLayoutArticle[]>([]);
  readonly pickMeta = signal<Paged<HomeLayoutArticle>['meta'] | null>(null);
  readonly pickLoading = signal(false);
  readonly pickError = signal<string | null>(null);
  readonly pickSearch = signal('');
  readonly pickType = signal('');
  readonly emojis = ['✨', '🎉', '🔥', '💥', '🛍️', '🧵', '🪡', '👗', '👘', '🧥', '✂️', '📦', '🚚', '🌍', '❤️', '⭐', '🌟', '🎁', '💎', '👑', '🌸', '🌙', '🕌', '🎊', '🏷️', '💯', '✅', '📢', '🔔', '⚡', '🆕', '💬', '🤝', '🙏', '😍', '😊'];
  readonly emojiOpen = signal(false);
  /** "How it works" cards: the colours to choose from, which card is open for editing, and which card's picture is uploading. */
  readonly stepColors = STEP_COLORS;
  readonly stepOpen = signal(0);
  readonly iconUploading = signal<number | null>(null);
  private pickTimer: ReturnType<typeof setTimeout> | null = null;
  private pickSeq = 0;

  readonly selected = computed(() => this.sections().find((s) => s.id === this.selectedId()) ?? null);
  readonly dirty = computed(() => JSON.stringify(this.sections()) !== this.saved());

  // ── appearance (colours and fonts) ──
  readonly tab = signal<'layout' | 'appearance'>('layout');
  /** Each menu entry opens only its own part (App builder = home layout, Theme customization = colours, fonts, buttons). */
  readonly palettes = PALETTES;
  readonly accents = ACCENTS;
  readonly sampleText = 'Every order from placement to delivery, in one place.';
  readonly themePresets = THEME_PRESETS;
  readonly myThemes = signal<ClientThemePreset[]>([]);
  readonly namingTheme = signal(false);
  readonly newThemeName = signal('');
  readonly savingTheme = signal(false);
  readonly themeData = signal<ClientThemeData | null>(null);
  readonly theme = signal<ClientTheme | null>(null);
  readonly themeSaved = signal<ClientTheme | null>(null);
  readonly themeDirty = computed(() => JSON.stringify(this.theme()) !== JSON.stringify(this.themeSaved()));
  readonly anyDirty = computed(() => this.dirty() || this.themeDirty());
  /** The theme the preview uses (a plain default until the saved one arrives). */
  readonly tv = computed(() => this.theme() ?? FALLBACK_THEME);
  readonly softPrimary = computed(() => mix(this.tv().primary, '#ffffff', 0.92));
  readonly unreadBg = computed(() => mix(this.tv().notification_bg, '#ffffff', 0.9));
  readonly fonts = computed(() => {
    const f = this.themeData()?.fonts;
    return f ? [...f.sans, ...f.serif] : [];
  });
  /** Loads the chosen fonts so the preview really shows them. */
  readonly fontsHref = computed(() => {
    const th = this.tv();
    const fam = (f: string) => 'family=' + f.split(' ').join('+') + ':wght@400;500;600;700';
    return 'https://fonts.googleapis.com/css2?' + fam(th.body_font) + '&' + fam(th.heading_font) + '&display=swap';
  });

  constructor() {
    effect(() => {
      const href = this.fontsHref();
      let link = document.getElementById('appearance-fonts') as HTMLLinkElement | null;
      if (!link) {
        link = document.createElement('link');
        link.id = 'appearance-fonts';
        link.rel = 'stylesheet';
        document.head.appendChild(link);
      }
      if (link.href !== href) link.href = href;
    });
    addIcons({
      megaphoneOutline, cloudUploadOutline, sparklesOutline, textOutline, radioButtonOnOutline, chatbubbleEllipsesOutline, colorPaletteOutline, swapHorizontalOutline, imagesOutline, imageOutline, albumsOutline, shirtOutline, gridOutline, createOutline,
      reorderTwoOutline, eyeOutline, eyeOffOutline, trashOutline, addOutline, closeOutline, copyOutline,
      mailOutline, notificationsOutline, home, cubeOutline, optionsOutline, personOutline, footstepsOutline, chevronUpOutline, chevronDownOutline,
    });
  }

  ngOnInit(): void {
    const mode = this.route.snapshot.data['mode'];
    if (mode === 'appearance' || mode === 'layout') this.tab.set(mode);
    else if (this.route.snapshot.queryParamMap.get('tab') === 'appearance') this.tab.set('appearance');
    this.load();
    this.loadBanners();
  }

  loadBanners(): void {
    this.admin.listBanners().subscribe({ next: (rows) => this.allBanners.set(rows), error: () => undefined });
  }

  openNewBanner(): void {
    this.bannerFileError.set(null);
    this.bannerForm.set({ id: null, title: '', link_url: '', is_active: true, preview: null, upload: null, ...BANNER_COPY_DEFAULTS });
  }

  openEditBanner(b: Banner): void {
    this.bannerFileError.set(null);
    this.bannerForm.set({
      id: b.id, title: b.title || '', link_url: b.link_url || '', is_active: b.is_active, preview: b.image_url, upload: null,
      heading: b.heading || '', subheading: b.subheading || '', button_label: b.button_label || '', button_link: b.button_link || '',
      text_color: b.text_color || '#FFFFFF', button_bg: b.button_bg || '#FFFFFF', button_color: b.button_color || '#62003E', overlay: b.overlay ?? 35, text_align: b.text_align === 'center' ? 'center' : 'left', focus_x: b.focus_x ?? 50, focus_y: b.focus_y ?? 50,
    });
  }

  /** Any text, button or dark layer on a banner (for the small preview of the banner). */
  bannerHasCopy(b: { heading?: string | null; subheading?: string | null; button_label?: string | null }): boolean {
    return !!(b.heading || b.subheading || b.button_label);
  }

  // ── dragging the banner picture to choose what stays in view ──
  private bnDrag: { x: number; y: number; fx: number; fy: number; ox: number; oy: number } | null = null;
  readonly bnDragging = signal(false);

  bnDragStart(e: PointerEvent): void {
    const box = e.currentTarget as HTMLElement;
    const img = box.querySelector('img');
    const f = this.bannerForm();
    if (!img || !f || !img.naturalWidth) return;
    // how much of the picture is cut off on each side at this size: that is the room there is to move it
    const scale = Math.max(box.clientWidth / img.naturalWidth, box.clientHeight / img.naturalHeight);
    this.bnDrag = { x: e.clientX, y: e.clientY, fx: f.focus_x, fy: f.focus_y, ox: img.naturalWidth * scale - box.clientWidth, oy: img.naturalHeight * scale - box.clientHeight };
    this.bnDragging.set(true);
    box.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  bnDragMove(e: PointerEvent): void {
    const d = this.bnDrag;
    if (!d) return;
    const clamp = (n: number) => Math.round(Math.min(100, Math.max(0, n)));
    // dragging the picture down shows more of its top: the kept point moves up
    this.patchBanner({
      focus_x: d.ox > 1 ? clamp(d.fx - ((e.clientX - d.x) / d.ox) * 100) : d.fx,
      focus_y: d.oy > 1 ? clamp(d.fy - ((e.clientY - d.y) / d.oy) * 100) : d.fy,
    });
  }

  bnDragEnd(): void {
    this.bnDrag = null;
    this.bnDragging.set(false);
  }

  patchBanner(patch: Partial<BannerForm>): void {
    this.bannerForm.update((f) => (f ? { ...f, ...patch } : f));
  }

  async onBannerFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.bannerFileError.set(null);
    try {
      const upload = await compressImage(file, 1600);
      this.patchBanner({ upload, preview: upload.dataUrl });
    } catch (err) {
      this.bannerFileError.set(err instanceof Error ? err.message : 'Could not read that picture.');
    }
  }

  saveBanner(): void {
    const f = this.bannerForm();
    if (!f || !this.bannerFormValid() || this.bannerSaving()) return;
    const body = {
      title: f.title.trim(), link_url: f.link_url.trim(), is_active: f.is_active, ...(f.upload ? { image_upload: f.upload } : {}),
      heading: f.heading.trim(), subheading: f.subheading.trim(), button_label: f.button_label.trim(), button_link: f.button_link.trim(),
      text_color: f.text_color, button_bg: f.button_bg, button_color: f.button_color, overlay: f.overlay, text_align: f.text_align, focus_x: f.focus_x, focus_y: f.focus_y,
    };
    this.bannerSaving.set(true);
    const req = f.id ? this.admin.updateBanner(f.id, body) : this.admin.createBanner(body);
    req.subscribe({
      next: (res) => {
        this.bannerSaving.set(false);
        this.bannerForm.set(null);
        this.ui.success(res.message || 'Saved.');
        this.loadBanners();
      },
      error: (err) => {
        this.bannerSaving.set(false);
        this.ui.error(err);
      },
    });
  }

  toggleBanner(b: Banner): void {
    this.bannerBusy.set(b.id);
    this.admin.updateBanner(b.id, { is_active: !b.is_active }).subscribe({
      next: () => {
        this.bannerBusy.set(null);
        this.allBanners.update((list) => list.map((x) => (x.id === b.id ? { ...x, is_active: !b.is_active } : x)));
      },
      error: (err) => {
        this.bannerBusy.set(null);
        this.ui.error(err);
      },
    });
  }

  moveBanner(index: number, dir: -1 | 1): void {
    const before = this.allBanners();
    const other = index + dir;
    if (other < 0 || other >= before.length) return;
    const list = [...before];
    [list[index], list[other]] = [list[other], list[index]];
    const reordered = list.map((b, i) => ({ ...b, sort_order: i }));
    this.allBanners.set(reordered);
    reordered
      .filter((b) => b.sort_order !== before.find((x) => x.id === b.id)?.sort_order)
      .forEach((b) => this.admin.updateBanner(b.id, { sort_order: b.sort_order }).subscribe({ error: (err) => { this.ui.error(err); this.loadBanners(); } }));
  }

  async removeBanner(b: Banner): Promise<void> {
    const ok = await this.ui.confirm({ title: 'Delete this banner?', message: 'It disappears from the customer app straight away.', confirmText: 'Delete', danger: true });
    if (!ok) return;
    this.bannerBusy.set(b.id);
    this.admin.deleteBanner(b.id).subscribe({
      next: () => {
        this.bannerBusy.set(null);
        this.loadBanners();
      },
      error: (err) => {
        this.bannerBusy.set(null);
        this.ui.error(err);
      },
    });
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.admin.getClientTheme().subscribe({
      next: (d) => {
        this.themeData.set(d);
        this.myThemes.set(d.presets ?? []);
        this.theme.set({ ...d.theme });
        this.themeSaved.set({ ...d.theme });
      },
      error: () => undefined,
    });
    this.admin.getHomeLayout().subscribe({
      next: (d) => {
        this.sections.set(d.layout.sections);
        this.saved.set(JSON.stringify(d.layout.sections));
        this.remember(d.articles);
        this.types.set(d.types);
        this.selectedId.set(d.layout.sections[0]?.id ?? null);
        this.ensurePicker();
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.message || 'Could not load the home layout.');
        this.loading.set(false);
      },
    });
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.addAt() !== null) this.addAt.set(null);
  }

  meta(type: string): SectionMeta {
    return SECTION_META.find((m) => m.type === type) ?? SECTION_META[0];
  }

  /** One-line description of a section for the list. */
  summary(s: HomeLayoutSection): string {
    const v = s.settings;
    switch (s.type) {
      case 'announcement':
      case 'marquee':
        return v['text'] || 'No text yet';
      case 'banners':
        return this.banners().length ? `${this.banners().length} active banner${this.banners().length === 1 ? '' : 's'}` : 'No active banners';
      case 'hero':
      case 'image_text':
      case 'custom':
        return v['heading'] || 'No heading yet';
      case 'steps':
        return `${v['title'] || 'Cards'} · ${(v['items'] ?? []).length} card${(v['items'] ?? []).length === 1 ? '' : 's'}`;
      case 'articles':
      case 'collection':
        return `${v['article_ids'].length} article${v['article_ids'].length === 1 ? '' : 's'} · ${v['layout']}`;
    }
  }

  // ── structure ──
  openAdd(index: number): void {
    this.addAt.set(index);
  }

  addSection(type: HomeSectionType): void {
    const at = this.addAt();
    if (at === null) return;
    const section: HomeLayoutSection = { id: newId(), type, settings: clone(this.meta(type).defaults), hidden: false };
    this.sections.update((list) => [...list.slice(0, at), section, ...list.slice(at)]);
    this.selectedId.set(section.id);
    this.addAt.set(null);
    this.ensurePicker();
  }

  drop(event: CdkDragDrop<HomeLayoutSection[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    this.sections.update((list) => {
      const next = [...list];
      moveItemInArray(next, event.previousIndex, event.currentIndex);
      return next;
    });
  }

  toggleHidden(s: HomeLayoutSection, event: Event): void {
    event.stopPropagation();
    this.sections.update((list) => list.map((x) => (x.id === s.id ? { ...x, hidden: !x.hidden } : x)));
  }

  duplicate(s: HomeLayoutSection, event: Event): void {
    event.stopPropagation();
    const copy: HomeLayoutSection = { ...clone(s), id: newId() };
    this.sections.update((list) => {
      const i = list.findIndex((x) => x.id === s.id);
      return [...list.slice(0, i + 1), copy, ...list.slice(i + 1)];
    });
    this.selectedId.set(copy.id);
  }

  async remove(s: HomeLayoutSection, event: Event): Promise<void> {
    event.stopPropagation();
    const ok = await this.ui.confirm({ title: `Remove "${this.meta(s.type).label}"?`, message: 'It leaves the home page when you save.', confirmText: 'Remove', danger: true });
    if (!ok) return;
    this.sections.update((list) => list.filter((x) => x.id !== s.id));
    if (this.selectedId() === s.id) this.selectedId.set(null);
  }

  select(id: string): void {
    this.selectedId.set(id);
    this.ensurePicker();
  }

  // ── settings of the selected section ──
  set(key: string, value: unknown): void {
    const id = this.selectedId();
    this.sections.update((list) => list.map((s) => (s.id === id ? { ...s, settings: { ...s.settings, [key]: value } } : s)));
  }

  str(key: string): string {
    return String(this.selected()?.settings[key] ?? '');
  }

  toggleArticle(a: HomeLayoutArticle): void {
    this.remember([a]);
    const current: string[] = this.selected()?.settings['article_ids'] ?? [];
    this.set('article_ids', current.includes(a.id) ? current.filter((x) => x !== a.id) : [...current, a.id].slice(0, 24));
  }

  articleById(id: string): HomeLayoutArticle | undefined {
    return this.articleCache()[id];
  }

  /** Put an emoji into a text box at the cursor (or at the end). */
  insertEmoji(key: string, emoji: string, box: HTMLInputElement): void {
    const value = this.str(key);
    const start = box.selectionStart ?? value.length;
    const end = box.selectionEnd ?? start;
    this.set(key, value.slice(0, start) + emoji + value.slice(end));
    // put the cursor after the emoji once Angular has written the new value
    setTimeout(() => {
      box.focus();
      box.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  removeId(id: string): void {
    this.set('article_ids', (this.selected()?.settings['article_ids'] ?? []).filter((x: string) => x !== id));
  }

  private remember(items: HomeLayoutArticle[]): void {
    this.articleCache.update((c) => ({ ...c, ...Object.fromEntries(items.map((a) => [a.id, a])) }));
  }

  // ── article picker (server-side search + pages) ──
  /** Load the first page the first time a section that picks articles is opened. */
  private ensurePicker(): void {
    const type = this.selected()?.type;
    if ((type === 'articles' || type === 'collection') && !this.pickMeta() && !this.pickLoading()) this.loadPick(1);
  }

  loadPick(page: number): void {
    const seq = ++this.pickSeq;
    this.pickLoading.set(true);
    this.pickError.set(null);
    this.admin.listHomeArticles({ page, limit: 8, search: this.pickSearch().trim(), type_id: this.pickType() }).subscribe({
      next: ({ items, meta }) => {
        if (seq !== this.pickSeq) return;
        this.remember(items);
        this.pickItems.set(items);
        this.pickMeta.set(meta);
        this.pickLoading.set(false);
      },
      error: (err) => {
        if (seq !== this.pickSeq) return;
        this.pickError.set(err?.message || 'Could not load articles.');
        this.pickLoading.set(false);
      },
    });
  }

  onPickSearch(value: string): void {
    this.pickSearch.set(value);
    if (this.pickTimer) clearTimeout(this.pickTimer);
    this.pickTimer = setTimeout(() => this.loadPick(1), 300);
  }

  setPickType(value: string): void {
    this.pickType.set(value);
    this.loadPick(1);
  }

  moveArticle(index: number, dir: -1 | 1): void {
    const ids = [...(this.selected()?.settings['article_ids'] ?? [])];
    const to = index + dir;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    this.set('article_ids', ids);
  }

  // ── "How it works" cards ──
  steps(): HomeStepItem[] {
    return (this.selected()?.settings['items'] as HomeStepItem[]) ?? [];
  }

  private setSteps(items: HomeStepItem[]): void {
    this.set('items', items);
  }

  patchStep(i: number, patch: Partial<HomeStepItem>): void {
    this.setSteps(this.steps().map((it, n) => (n === i ? { ...it, ...patch } : it)));
  }

  addStep(): void {
    const items = this.steps();
    if (items.length >= 12) return;
    const c = STEP_COLORS[items.length % STEP_COLORS.length];
    this.setSteps([...items, { title: 'New step', text: '', icon_url: '', emoji: '✨', bg: c.bg, bg2: c.bg2, color: '#1F2937', link: '' }]);
    this.stepOpen.set(items.length);
  }

  async removeStep(i: number): Promise<void> {
    const ok = await this.ui.confirm({ title: 'Remove this card?', message: this.steps()[i]?.title || 'This card', confirmText: 'Remove', danger: true });
    if (!ok) return;
    this.setSteps(this.steps().filter((_, n) => n !== i));
    this.stepOpen.set(Math.max(0, Math.min(this.stepOpen(), this.steps().length - 1)));
  }

  moveStep(i: number, dir: -1 | 1): void {
    const items = [...this.steps()];
    const to = i + dir;
    if (to < 0 || to >= items.length) return;
    [items[i], items[to]] = [items[to], items[i]];
    this.setSteps(items);
    this.stepOpen.set(to);
  }

  toggleStep(i: number): void {
    this.stepOpen.set(this.stepOpen() === i ? -1 : i);
  }

  stepGradient(it: { bg: string; bg2: string }): string {
    return `linear-gradient(135deg, ${it.bg}, ${it.bg2})`;
  }

  /** The two colours of the card start from one of the ready-made pairs. */
  pickStepColor(i: number, c: { bg: string; bg2: string }): void {
    this.patchStep(i, { bg: c.bg, bg2: c.bg2 });
  }

  /** The heading cut around the highlighted word, for the preview. */
  titleParts(title: string, word: string): [string, string, string] {
    const t = title ?? '';
    const w = (word ?? '').trim();
    const at = w ? t.toLowerCase().indexOf(w.toLowerCase()) : -1;
    return at < 0 ? [t, '', ''] : [t.slice(0, at), t.slice(at, at + w.length), t.slice(at + w.length)];
  }

  async onStepIcon(i: number, input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.iconUploading.set(i);
    try {
      const upload = await prepareIcon(file);
      this.admin.uploadHomeIcon(upload).subscribe({
        next: (res) => {
          this.patchStep(i, { icon_url: res.data.url });
          this.iconUploading.set(null);
        },
        error: (err) => {
          this.iconUploading.set(null);
          this.ui.error(err);
        },
      });
    } catch (err) {
      this.iconUploading.set(null);
      this.ui.error(err);
    }
  }

  async onImage(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.uploading.set(true);
    try {
      const upload = await compressImage(file, 1600);
      this.admin.uploadHomeImage(upload).subscribe({
        next: (res) => {
          this.set('image_url', res.data.url);
          this.uploading.set(false);
        },
        error: (err) => {
          this.uploading.set(false);
          this.ui.error(err);
        },
      });
    } catch (err) {
      this.uploading.set(false);
      this.ui.error(err);
    }
  }

  /** Saves whatever changed: the home layout, the colours and fonts, or both. */
  async save(): Promise<void> {
    if (this.saving() || !this.anyDirty()) return;
    this.saving.set(true);
    try {
      if (this.dirty()) {
        const res = await firstValueFrom(this.admin.saveHomeLayout(this.sections()));
        const cleaned = res.data.layout.sections;
        const keep = this.selectedId();
        this.sections.set(cleaned);
        this.saved.set(JSON.stringify(cleaned));
        // the server keeps ids that are valid; fall back to nothing selected if one was replaced
        if (keep && !cleaned.some((s) => s.id === keep)) this.selectedId.set(null);
      }
      if (this.themeDirty() && this.theme()) {
        const res = await firstValueFrom(this.admin.saveClientTheme(this.theme()!));
        this.themeSaved.set({ ...res.data.theme });
      }
      this.ui.success('Saved. Customers see it the next time they open the app.');
    } catch (err) {
      this.ui.error(err);
    } finally {
      this.saving.set(false);
    }
  }

  discard(): void {
    this.sections.set(JSON.parse(this.saved()));
    const saved = this.themeSaved();
    if (saved) this.theme.set({ ...saved });
  }

  // ── ready-made themes ──
  isThemePreset(p: ClientTheme): boolean {
    const t = this.theme();
    if (!t) return false;
    return (Object.keys(p) as (keyof ClientTheme)[]).every((k) => (p[k] ?? '') === (t[k] ?? ''));
  }

  useThemePreset(p: ClientTheme): void {
    this.theme.update((t) => (t ? { ...t, ...p } : t));
  }

  saveThemeAsPreset(): void {
    const t = this.theme();
    const name = this.newThemeName().trim();
    if (!t || name.length < 2 || this.savingTheme()) return;
    this.savingTheme.set(true);
    this.admin.createClientThemePreset(name, t).subscribe({
      next: (res) => {
        this.savingTheme.set(false);
        this.myThemes.set(res.data.presets ?? []);
        this.newThemeName.set('');
        this.namingTheme.set(false);
        this.ui.success(res.message || 'Theme saved.');
      },
      error: (err) => {
        this.savingTheme.set(false);
        this.ui.error(err);
      },
    });
  }

  async deleteThemePreset(p: ClientThemePreset): Promise<void> {
    const ok = await this.ui.confirm({ title: `Delete "${p.name}"?`, message: 'This only removes it from your list. The customer app keeps its current look.', confirmText: 'Delete', danger: true });
    if (!ok) return;
    this.admin.deleteClientThemePreset(p.id).subscribe({
      next: (res) => this.myThemes.set(res.data.presets ?? []),
      error: (err) => this.ui.error(err),
    });
  }

  // ── appearance helpers ──
  /** CSS gradient for a colour pair (the same colour twice looks solid). */
  grad(a: string | undefined, b: string | undefined): string {
    return `linear-gradient(135deg, ${a} 0%, ${b || a} 100%)`;
  }

  setTheme(patch: Partial<ClientTheme>): void {
    this.theme.update((th) => (th ? { ...th, ...patch } : th));
  }

  setThemeColor(key: ThemeColorKey, value: string): void {
    if (/^#[0-9a-fA-F]{6}$/.test(value)) this.setTheme({ [key]: value.toUpperCase() } as Partial<ClientTheme>);
  }

  resetTheme(): void {
    const d = this.themeData()?.defaults;
    if (d) this.theme.set({ ...d });
  }

  initial(name: string): string {
    return (name || '?').trim().charAt(0).toUpperCase();
  }
}
