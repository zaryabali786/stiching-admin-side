import { Component, DestroyRef, ElementRef, HostListener, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  gridOutline, cubeOutline, documentTextOutline, fileTrayStackedOutline, peopleOutline, cutOutline, pricetagsOutline,
  airplaneOutline, barChartOutline, settingsOutline, downloadOutline, layersOutline, shieldCheckmarkOutline, walletOutline,
  searchOutline, menuOutline, chevronBackOutline, chevronForwardOutline, swapHorizontalOutline, logOutOutline, personCircleOutline,
  chatbubblesOutline, businessOutline, bicycleOutline, shirtOutline, idCardOutline, imagesOutline, colorPaletteOutline, constructOutline, colorFillOutline, albumsOutline,
} from 'ionicons/icons';
import { filter } from 'rxjs';
import { AuthService } from '../core/services/auth.service';
import { BadgeService } from '../core/services/badge.service';
import { ChatSocketService } from '../core/services/chat-socket.service';
import { LanguageService } from '../core/services/language.service';
import { ApiService } from '../core/services/api.service';
import { ActivePartnerService } from '../core/services/active-partner.service';
import { NotificationBellComponent } from '../shared/components/notification-bell.component';
import { UiHostComponent } from '../shared/components/ui-host.component';

type Portal = 'admin' | 'partner';

interface NavItem {
  path: string;
  label: string;
  urdu?: string;
  icon: string;
  badge?: number;
  /** Partner portal: the permission needed to see this entry (admins always see everything). */
  permission?: string;
  /** badge tone: amber = needs action, red = problem */
  tone?: 'amber' | 'red';
}

interface NavGroup {
  label: string;
  urdu?: string;
  items: NavItem[];
}

const COLLAPSE_KEY = 'v360_sidebar_collapsed';

/**
 * Persistent layout for both portals: sidebar + top bar stay mounted across navigation,
 * only the routed page inside <router-outlet> changes (with a short enter animation).
 */
@Component({
  selector: 'app-portal-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IonIcon, NotificationBellComponent, UiHostComponent],
  templateUrl: './portal-shell.component.html',
  styleUrls: ['./portal-shell.component.scss'],
})
export class PortalShellComponent implements OnInit, OnDestroy {
  readonly auth = inject(AuthService);
  readonly badges = inject(BadgeService);
  readonly lang = inject(LanguageService);
  private api = inject(ApiService);
  readonly activePartner = inject(ActivePartnerService);
  /** Creating it here connects the live channel as soon as a portal opens. */
  private chat = inject(ChatSocketService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);

  readonly portal: Portal = this.route.snapshot.data['portal'] === 'partner' ? 'partner' : 'admin';
  readonly navOpen = signal(false);
  readonly collapsed = signal(readCollapsed());
  readonly userMenuOpen = signal(false);
  readonly pageTitle = signal('');
  /** Fallback label (platform config) when the signed-in person has no partner, e.g. an admin looking at the partner portal. */
  private readonly configPartnerName = signal('Partner');
  readonly partnerName = computed(() => this.auth.partner()?.name || this.configPartnerName());
  readonly quickSearch = signal('');
  /** Current path (no query), used to hide the floating Messages button on the messages pages. */
  private readonly currentPath = signal(this.router.url.split('?')[0]);
  readonly messagesPath = this.portal === 'partner' ? '/partner/messages' : '/admin/messages';
  readonly showMessagesFab = computed(() => this.auth.can('messages.view') && !this.currentPath().startsWith(this.messagesPath));
  /** Conversations with unread customer messages (from the sidebar badge poll). */
  readonly unreadMessages = computed(() => (this.portal === 'partner' ? this.badges.partner()?.messages : this.badges.admin()?.messages) ?? 0);
  readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('searchBox');
  readonly isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  private lastPath = '';

  constructor() {
    addIcons({
      gridOutline, cubeOutline, documentTextOutline, fileTrayStackedOutline, peopleOutline, cutOutline, pricetagsOutline,
      airplaneOutline, barChartOutline, settingsOutline, downloadOutline, layersOutline, shieldCheckmarkOutline, walletOutline,
      searchOutline, menuOutline, chevronBackOutline, chevronForwardOutline, swapHorizontalOutline, logOutOutline, personCircleOutline,
      chatbubblesOutline, businessOutline, bicycleOutline, shirtOutline, idCardOutline, imagesOutline, colorPaletteOutline, constructOutline, colorFillOutline,
    });
  }

  /** Navigation grouped by job-to-be-done, in the order work flows through the business. */
  readonly navGroups = computed<NavGroup[]>(() => {
    if (this.portal === 'admin') {
      const b = this.badges.admin();
      return [
        { label: '', items: [{ path: '/admin/overview', label: 'Overview', icon: 'grid-outline' }] },
        {
          label: 'Operations',
          items: [
            { path: '/admin/orders', label: 'Orders', icon: 'cube-outline', badge: b?.orders, tone: 'red' },
            { path: '/admin/messages', label: 'Messages', icon: 'chatbubbles-outline', badge: b?.messages, tone: 'amber' },
            { path: '/admin/warehouse', label: 'Warehouse', icon: 'file-tray-stacked-outline', badge: b?.warehouse, tone: 'amber' },
          ],
        },
        {
          label: 'Finance',
          items: [
            { path: '/admin/invoices', label: 'Invoices', icon: 'document-text-outline', badge: b?.invoices, tone: 'amber' },
            { path: '/admin/reports', label: 'Reports', icon: 'bar-chart-outline' },
          ],
        },
        {
          label: 'People',
          items: [
            { path: '/admin/customers', label: 'Customers', icon: 'people-outline' },
            { path: '/admin/partners', label: 'Partners & teams', icon: 'cut-outline' },
          ],
        },
        {
          label: 'Setup',
          items: [
            { path: '/admin/price-list', label: 'Price list', icon: 'pricetags-outline' },
            { path: '/admin/shipping', label: 'Shipping rates', icon: 'airplane-outline' },
            { path: '/admin/portal-theme', label: 'Portal theme', icon: 'color-fill-outline' },
            { path: '/admin/settings', label: 'Settings', icon: 'settings-outline' },
          ],
        },
        {
          label: 'App builder',
          items: [
            { path: '/admin/home-layout', label: 'Build', icon: 'construct-outline' },
          ],
        },
      ];
    }
    const p = this.badges.partner();
    const groups: NavGroup[] = [
      { label: '', items: [{ path: '/partner/overview', label: 'Overview', urdu: 'جائزہ', icon: 'grid-outline', permission: 'overview.view' }] },
      {
        label: 'Daily work',
        urdu: 'روزانہ کام',
        items: [
          { path: '/partner/receiving', label: 'Receiving', urdu: 'وصولی', icon: 'download-outline', badge: p?.receiving, tone: 'amber', permission: 'receiving.view' },
          { path: '/partner/production', label: 'Production', urdu: 'پیداوار', icon: 'layers-outline', permission: 'production.view' },
          { path: '/partner/quality-check', label: 'Quality check', urdu: 'کوالٹی چیک', icon: 'shield-checkmark-outline', badge: p?.qualityCheck, tone: 'amber', permission: 'quality.view' },
          { path: '/partner/warehouse', label: 'Warehouse', urdu: 'گودام', icon: 'file-tray-stacked-outline', badge: p?.warehouse, tone: 'amber', permission: 'warehouse.view' },
          { path: '/partner/messages', label: 'Messages', urdu: 'پیغامات', icon: 'chatbubbles-outline', badge: p?.messages, tone: 'amber', permission: 'messages.view' },
        ],
      },
      {
        label: 'Catalogue',
        urdu: 'کیٹلاگ',
        items: [
          { path: '/partner/brands', label: 'Brands', urdu: 'برانڈز', icon: 'business-outline', permission: 'catalogue.view' },
          { path: '/partner/couriers', label: 'Couriers', urdu: 'کوریئرز', icon: 'bicycle-outline', permission: 'catalogue.view' },
          { path: '/partner/articles', label: 'Articles', urdu: 'آرٹیکلز', icon: 'shirt-outline', permission: 'catalogue.view' },
        ],
      },
      {
        label: 'Team & money',
        urdu: 'ٹیم اور کمائی',
        items: [
          { path: '/partner/teams', label: 'Teams', urdu: 'ٹیمیں', icon: 'people-outline', permission: 'teams.view' },
          { path: '/partner/users', label: 'Users', urdu: 'صارفین', icon: 'id-card-outline', permission: 'users.view' },
          { path: '/partner/earnings', label: 'Earnings', urdu: 'کمائی', icon: 'wallet-outline', permission: 'earnings.view' },
        ],
      },
    ];
    // Only what this person may open; a group with nothing left disappears. The server re-checks every request.
    return groups
      .map((g) => ({ ...g, items: g.items.filter((i) => !i.permission || this.auth.can(i.permission)) }))
      .filter((g) => g.items.length > 0);
  });

  readonly searchPlaceholder = computed(() =>
    this.portal === 'admin' ? 'Find order, customer code…' : this.lang.t('Find job card, order or code…', 'آرڈر یا کوڈ تلاش کریں…')
  );

  ngOnInit(): void {
    this.badges.start(this.portal);
    if (this.auth.isAdmin()) this.activePartner.load();
    this.updateTitle();
    this.lastPath = this.router.url.split('?')[0];

    if (this.portal === 'partner') {
      this.api.get<{ partnerName: string }>('/config').subscribe({
        next: (c) => this.configPartnerName.set(c.partnerName || 'Partner'),
        error: () => undefined,
      });
    }

    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef))
      .subscribe((e) => {
        this.navOpen.set(false);
        this.userMenuOpen.set(false);
        this.updateTitle();
        const path = e.urlAfterRedirects.split('?')[0];
        this.currentPath.set(path);
        if (path !== this.lastPath) this.scroller()?.nativeElement.scrollTo({ top: 0 });
        this.lastPath = path;
      });
  }

  ngOnDestroy(): void {
    this.badges.stop();
  }

  label(item: { label: string; urdu?: string }): string {
    return this.portal === 'partner' && item.urdu ? this.lang.t(item.label, item.urdu) : item.label;
  }

  onPartnerPick(event: Event): void {
    this.activePartner.select((event.target as HTMLSelectElement).value || null);
  }

  toggleCollapsed(): void {
    const next = !this.collapsed();
    this.collapsed.set(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  /** Jump straight to an order / job card: SA-1042 opens it, anything else filters the list. */
  runQuickSearch(): void {
    const q = this.quickSearch().trim();
    if (!q) return;
    if (this.portal === 'admin') {
      const isRef = /^SA-\d+$/i.test(q);
      this.router.navigate(['/admin/orders'], { queryParams: isRef ? { ref: q.toUpperCase() } : { search: q } });
    } else {
      this.router.navigate(['/partner/production'], { queryParams: { search: q } });
    }
    this.quickSearch.set('');
    this.searchBox()?.nativeElement.blur();
  }

  logout(): void {
    this.auth.logout();
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.searchBox()?.nativeElement.focus();
    }
    if (e.key === 'Escape') {
      this.userMenuOpen.set(false);
      this.navOpen.set(false);
    }
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (this.userMenuOpen() && !target.closest('.user-menu')) this.userMenuOpen.set(false);
  }

  private updateTitle(): void {
    let r = this.route;
    while (r.firstChild) r = r.firstChild;
    this.pageTitle.set(r.snapshot.data['title'] || '');
  }
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}
