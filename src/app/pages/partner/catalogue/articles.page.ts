import { CanDirective } from '../../../shared/can.directive';
import { Component, DestroyRef, ElementRef, HostListener, OnInit, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { IonIcon, IonSpinner } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { createOutline, trashOutline, imageOutline, cloudUploadOutline } from 'ionicons/icons';
import { distinctUntilChanged, filter, map } from 'rxjs';
import {
  Article, ArticleInput, ArticleType, ArticleTypeInput, CatalogueService, CatalogueStatus, StatusFilter,
} from '../../../core/services/catalogue.service';
import { apiErrorMessage } from '../../../core/services/api.service';
import { UiService } from '../../../core/services/ui.service';
import { AuthService } from '../../../core/services/auth.service';
import { compressImage } from '../../../core/utils/image';
import { PkrPipe } from '../../../shared/pipes';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { PaginationComponent } from '../../../shared/components/pagination.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { StatusBadgeComponent } from '../../../shared/components/status-badge.component';
import { PagedList, SKELETON_ROWS, intParam, oneOf, setQuery } from '../../admin/admin-list';

const STATUSES: readonly StatusFilter[] = ['all', 'active', 'inactive'];
const TYPE_LIMIT = 12;
const ARTICLE_LIMIT = 15;
const NAME_MAX = 120;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

interface TypeQuery {
  tsearch: string;
  tpage: number;
}

interface ArticleQuery {
  type: string;
  search: string;
  status: StatusFilter;
  page: number;
}

interface TypeForm {
  id: string | null;
  name: string;
  active: boolean;
  sort_order: string;
}

interface ArticleForm {
  id: string | null;
  name: string;
  customer_price: string;
  partner_cost: string;
  sort_order: string;
  active: boolean;
  /** Picture already stored on the server (edit). */
  currentImage: string | null;
  /** New compressed picture waiting to be uploaded. */
  upload: { name: string; dataUrl: string } | null;
  removeImage: boolean;
}

/**
 * Article types (master) and their articles (detail). Types are plain data: a type created here
 * (e.g. "Collar") becomes a dropdown on the customer order form with no code change.
 */
@Component({
  selector: 'app-partner-articles',
  standalone: true,
  imports: [CanDirective, IonIcon, IonSpinner, PkrPipe, SearchInputComponent, PaginationComponent, EmptyStateComponent, StatusBadgeComponent],
  templateUrl: './articles.page.html',
  styleUrls: ['./articles.page.scss'],
})
export class PartnerArticlesPage implements OnInit {
  private catalogue = inject(CatalogueService);
  private ui = inject(UiService);
  private auth = inject(AuthService);

  /** Rows with no partner are shared by everyone; only an admin may change them. */
  isShared(row: { partner_id?: string | null }): boolean {
    return row.partner_id === null;
  }

  isLocked(row: { partner_id?: string | null }): boolean {
    return row.partner_id === null && !this.auth.isAdmin();
  }
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly statuses = STATUSES;
  readonly nameMax = NAME_MAX;
  readonly skeleton = SKELETON_ROWS;
  readonly detail = viewChild<ElementRef<HTMLElement>>('detail');
  readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  // ── Types (left) ──
  readonly types = new PagedList<ArticleType>();
  readonly tq = signal<TypeQuery>({ tsearch: '', tpage: 1 });
  readonly typeBusy = signal<string | null>(null);
  readonly typeNotice = signal<{ typeId: string; name: string; message: string } | null>(null);
  readonly typeForm = signal<TypeForm | null>(null);
  readonly typeSaving = signal(false);
  readonly typeFormError = signal<string | null>(null);
  readonly typeShowErrors = signal(false);
  readonly typeNameError = computed(() => this.nameError(this.typeForm()?.name ?? '', 'type'));
  readonly typeOrderError = computed(() => this.orderError(this.typeForm()?.sort_order ?? ''));

  // ── Articles (right) ──
  readonly articles = new PagedList<Article>();
  readonly aq = signal<ArticleQuery>({ type: '', search: '', status: 'all', page: 1 });
  readonly selectedType = signal<ArticleType | null>(null);
  readonly selectedName = computed(() => this.selectedType()?.name ?? this.articles.items()[0]?.type?.name ?? 'this type');
  readonly articleBusy = signal<string | null>(null);
  readonly articleForm = signal<ArticleForm | null>(null);
  readonly articleSaving = signal(false);
  readonly articleFormError = signal<string | null>(null);
  readonly articleShowErrors = signal(false);
  readonly imageBusy = signal(false);
  readonly imageError = signal<string | null>(null);
  readonly dragging = signal(false);
  readonly articleNameError = computed(() => this.nameError(this.articleForm()?.name ?? '', 'article'));
  readonly customerPriceError = computed(() => this.moneyError(this.articleForm()?.customer_price ?? '', 'customer price'));
  readonly partnerCostError = computed(() => this.moneyError(this.articleForm()?.partner_cost ?? '', 'partner cost'));
  /** Live margin (customer price − partner cost); null until both are valid numbers. Never sent to the server. */
  readonly formMargin = computed(() => {
    const f = this.articleForm();
    if (!f) return null;
    return this.marginOf(this.toNumber(f.customer_price), this.toNumber(f.partner_cost));
  });
  readonly articleOrderError = computed(() => this.orderError(this.articleForm()?.sort_order ?? ''));
  readonly preview = computed(() => {
    const f = this.articleForm();
    if (!f || f.removeImage) return null;
    return f.upload?.dataUrl ?? f.currentImage;
  });

  constructor() {
    addIcons({ createOutline, trashOutline, imageOutline, cloudUploadOutline });

    // Keep the highlighted type in step with the loaded list, and pick the first type when none is chosen yet.
    effect(() => {
      const items = this.types.items();
      const loading = this.types.loading();
      const typeId = this.aq().type;
      untracked(() => {
        const match = items.find((t) => t.id === typeId);
        if (match) this.selectedType.set(match);
        else if (!typeId && items.length && !loading) this.selectType(items[0], false);
      });
    });
  }

  ngOnInit(): void {
    const types$ = this.route.queryParamMap.pipe(
      map((p): TypeQuery => ({ tsearch: p.get('tsearch') || '', tpage: intParam(p, 'tpage', 1) })),
      distinctUntilChanged((a, b) => a.tsearch === b.tsearch && a.tpage === b.tpage)
    );
    this.types.connect(
      types$,
      (q) => {
        this.tq.set(q);
        return this.catalogue.listTypes({ search: q.tsearch, page: q.tpage, limit: TYPE_LIMIT, sort: 'sort_order', dir: 'asc' });
      },
      this.destroyRef
    );

    const parse = (p: ParamMap): ArticleQuery => ({
      type: p.get('type') || '',
      search: p.get('search') || '',
      status: oneOf(p.get('status'), STATUSES, 'all'),
      page: intParam(p, 'page', 1),
    });
    // Track the chosen type even before the article request is made
    this.route.queryParamMap.pipe(map(parse)).subscribe((q) => this.aq.set(q));

    const articles$ = this.route.queryParamMap.pipe(
      map(parse),
      filter((q) => !!q.type),
      distinctUntilChanged((a, b) => a.type === b.type && a.search === b.search && a.status === b.status && a.page === b.page)
    );
    this.articles.connect(
      articles$,
      (q) => this.catalogue.listArticles(q.type, { search: q.search, status: q.status, page: q.page, limit: ARTICLE_LIMIT, sort: 'sort_order', dir: 'asc' }),
      this.destroyRef
    );
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.ui.confirmState()) return;
    if (this.articleForm() && !this.articleSaving()) this.closeArticleForm();
    else if (this.typeForm() && !this.typeSaving()) this.closeTypeForm();
  }

  /** Margin shown in the list: the server's value, or computed when an older response omits it. */
  articleMargin(a: Article): number | null {
    return a.margin ?? this.marginOf(a.customer_price ?? null, a.partner_cost ?? null);
  }

  statusLabel(s: string): string {
    return s === 'all' ? 'All' : s === 'active' ? 'Active' : 'Inactive';
  }

  // ═════════ Types ═════════

  onTypeSearch(tsearch: string): void {
    setQuery(this.router, this.route, { tsearch: tsearch || null, tpage: null });
  }

  goToTypePage(page: number): void {
    setQuery(this.router, this.route, { tpage: page > 1 ? page : null });
  }

  selectType(t: ArticleType, scroll = true): void {
    this.selectedType.set(t);
    this.typeNotice.set(null);
    setQuery(this.router, this.route, { type: t.id, search: null, status: null, page: null });
    if (scroll && typeof window !== 'undefined' && window.matchMedia('(max-width: 980px)').matches) {
      setTimeout(() => this.detail()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    }
  }

  openNewType(): void {
    this.typeFormError.set(null);
    this.typeShowErrors.set(false);
    this.typeForm.set({ id: null, name: '', active: true, sort_order: '' });
  }

  openEditType(t: ArticleType): void {
    this.typeFormError.set(null);
    this.typeShowErrors.set(false);
    this.typeForm.set({ id: t.id, name: t.name, active: t.status === 'active', sort_order: String(t.sort_order ?? '') });
  }

  closeTypeForm(): void {
    this.typeForm.set(null);
  }

  patchType(patch: Partial<TypeForm>): void {
    this.typeFormError.set(null);
    this.typeForm.update((f) => (f ? { ...f, ...patch } : f));
  }

  saveType(): void {
    const f = this.typeForm();
    if (!f || this.typeSaving()) return;
    this.typeShowErrors.set(true);
    if (this.typeNameError() || this.typeOrderError()) return;
    const body: ArticleTypeInput = { name: f.name.trim(), status: f.active ? 'active' : 'inactive' };
    if (f.sort_order.trim() !== '') body.sort_order = Number(f.sort_order);
    this.typeSaving.set(true);
    this.typeFormError.set(null);
    const req = f.id ? this.catalogue.updateType(f.id, body) : this.catalogue.createType(body);
    req.subscribe({
      next: (res) => {
        this.typeSaving.set(false);
        this.typeForm.set(null);
        this.ui.success(res.message || 'Saved.');
        this.types.reload();
        // A brand-new type is the natural next thing to fill in
        if (!f.id && res.data?.id) this.selectType({ ...res.data, articles_count: res.data.articles_count ?? 0 });
        else if (f.id && f.id === this.selectedType()?.id) this.selectedType.update((t) => (t ? { ...t, ...res.data } : t));
      },
      error: (err) => {
        this.typeSaving.set(false);
        this.typeFormError.set(apiErrorMessage(err));
      },
    });
  }

  async removeType(t: ArticleType): Promise<void> {
    const ok = await this.ui.confirm({
      title: `Delete the type “${t.name}”?`,
      message: t.articles_count
        ? `It still has ${t.articles_count} ${t.articles_count === 1 ? 'article' : 'articles'}. The server will refuse until they are deleted; you can set the type to Inactive instead.`
        : 'Customers will no longer see it on the order form.',
      confirmText: 'Delete type',
      danger: true,
    });
    if (!ok) return;
    this.typeBusy.set(t.id);
    this.typeNotice.set(null);
    this.catalogue.deleteType(t.id).subscribe({
      next: (res) => {
        this.typeBusy.set(null);
        this.ui.success(res.message || `${t.name} deleted.`);
        if (this.selectedType()?.id === t.id) {
          this.selectedType.set(null);
          setQuery(this.router, this.route, { type: null, search: null, status: null, page: null });
        }
        this.types.reload();
      },
      error: (err) => {
        this.typeBusy.set(null);
        if (err instanceof HttpErrorResponse && err.status === 409) {
          this.typeNotice.set({ typeId: t.id, name: t.name, message: apiErrorMessage(err) });
        } else {
          this.ui.error(err);
        }
      },
    });
  }

  /** Offered next to the 409 "still has articles" message. */
  deactivateType(typeId: string): void {
    this.typeBusy.set(typeId);
    this.catalogue.updateType(typeId, { status: 'inactive' }).subscribe({
      next: (res) => {
        this.typeBusy.set(null);
        this.typeNotice.set(null);
        this.ui.success(res.message || 'Type set to inactive.');
        this.types.reload();
      },
      error: (err) => {
        this.typeBusy.set(null);
        this.ui.error(err);
      },
    });
  }

  // ═════════ Articles ═════════

  onArticleSearch(search: string): void {
    setQuery(this.router, this.route, { search: search || null, page: null });
  }

  setArticleStatus(status: StatusFilter): void {
    setQuery(this.router, this.route, { status: status === 'all' ? null : status, page: null });
  }

  goToArticlePage(page: number): void {
    setQuery(this.router, this.route, { page: page > 1 ? page : null });
  }

  openNewArticle(): void {
    this.resetArticleForm();
    this.articleForm.set({ id: null, name: '', customer_price: '', partner_cost: '', sort_order: '', active: true, currentImage: null, upload: null, removeImage: false });
  }

  openEditArticle(a: Article): void {
    this.resetArticleForm();
    this.articleForm.set({
      id: a.id,
      name: a.name,
      customer_price: a.customer_price === null || a.customer_price === undefined ? '' : String(a.customer_price),
      partner_cost: a.partner_cost === null || a.partner_cost === undefined ? '' : String(a.partner_cost),
      sort_order: String(a.sort_order ?? ''),
      active: a.status === 'active',
      currentImage: a.image_url,
      upload: null,
      removeImage: false,
    });
  }

  closeArticleForm(): void {
    this.articleForm.set(null);
  }

  patchArticle(patch: Partial<ArticleForm>): void {
    this.articleFormError.set(null);
    this.articleForm.update((f) => (f ? { ...f, ...patch } : f));
  }

  browse(): void {
    this.fileInput()?.nativeElement.click();
  }

  onFile(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    void this.takeFile(file);
  }

  onDragOver(e: DragEvent): void {
    e.preventDefault();
    this.dragging.set(true);
  }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    this.dragging.set(false);
    void this.takeFile(e.dataTransfer?.files?.[0]);
  }

  removePicture(): void {
    this.imageError.set(null);
    this.patchArticle({ upload: null, removeImage: true });
  }

  private async takeFile(file: File | undefined): Promise<void> {
    if (!file) return;
    this.imageError.set(null);
    if (!IMAGE_TYPES.includes(file.type)) {
      this.imageError.set('Use a JPG, PNG or WebP picture.');
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      this.imageError.set('This picture is larger than 8 MB. Choose a smaller one.');
      return;
    }
    this.imageBusy.set(true);
    try {
      const upload = await compressImage(file);
      this.patchArticle({ upload, removeImage: false });
    } catch (err) {
      this.imageError.set(err instanceof Error ? err.message : 'Could not read this picture.');
    } finally {
      this.imageBusy.set(false);
    }
  }

  saveArticle(): void {
    const f = this.articleForm();
    const typeId = this.aq().type;
    if (!f || this.articleSaving() || !typeId) return;
    this.articleShowErrors.set(true);
    if (this.articleNameError() || this.customerPriceError() || this.partnerCostError() || this.articleOrderError()) return;

    const body: ArticleInput = {
      name: f.name.trim(),
      customer_price: f.customer_price.trim() === '' ? null : Number(f.customer_price),
      partner_cost: f.partner_cost.trim() === '' ? null : Number(f.partner_cost),
      status: f.active ? 'active' : 'inactive',
    };
    if (f.sort_order.trim() !== '') body.sort_order = Number(f.sort_order);
    if (f.upload) body.image_upload = f.upload;
    else if (f.id && f.removeImage) body.remove_image = true;
    if (!f.id) body.article_type_id = typeId;

    this.articleSaving.set(true);
    this.articleFormError.set(null);
    const req = f.id ? this.catalogue.updateArticle(f.id, body) : this.catalogue.createArticle(body);
    req.subscribe({
      next: (res) => {
        this.articleSaving.set(false);
        this.articleForm.set(null);
        this.ui.success(res.message || 'Saved.');
        this.articles.reload();
        this.types.reload();
      },
      error: (err) => {
        this.articleSaving.set(false);
        this.articleFormError.set(apiErrorMessage(err));
      },
    });
  }

  toggleArticle(a: Article): void {
    const next: CatalogueStatus = a.status === 'active' ? 'inactive' : 'active';
    this.articleBusy.set(a.id);
    this.catalogue.updateArticle(a.id, { status: next }).subscribe({
      next: (res) => {
        this.articleBusy.set(null);
        this.articles.patch((x) => x.id === a.id, (x) => ({ ...x, status: res.data?.status ?? next }));
        this.ui.success(next === 'active' ? `${a.name} is active again.` : `${a.name} is hidden from the order form.`);
        if (this.aq().status !== 'all') this.articles.reload();
      },
      error: (err) => {
        this.articleBusy.set(null);
        this.ui.error(err);
      },
    });
  }

  async removeArticle(a: Article): Promise<void> {
    const ok = await this.ui.confirm({
      title: `Delete “${a.name}”?`,
      message: 'If orders already use this article it is switched off instead, so past orders stay intact.',
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    this.articleBusy.set(a.id);
    this.catalogue.deleteArticle(a.id).subscribe({
      next: (res) => {
        this.articleBusy.set(null);
        const fallback = res.deactivated ? `${a.name} is used by orders, so it was switched off.` : `${a.name} deleted.`;
        if (res.deactivated) this.ui.info(res.message || fallback);
        else this.ui.success(res.message || fallback);
        this.articles.reload();
        this.types.reload();
      },
      error: (err) => {
        this.articleBusy.set(null);
        this.ui.error(err);
      },
    });
  }

  // ═════════ helpers ═════════

  private resetArticleForm(): void {
    this.articleFormError.set(null);
    this.articleShowErrors.set(false);
    this.imageError.set(null);
    this.dragging.set(false);
  }

  private toNumber(value: string): number | null {
    const v = value.trim();
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  private marginOf(customer: number | null, cost: number | null): number | null {
    if (customer === null || cost === null) return null;
    return Math.round((customer - cost) * 100) / 100;
  }

  private moneyError(value: string, what: string): string {
    const v = value.trim();
    if (!v) return '';
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? '' : `Enter ${what} as 0 or more, or leave it empty.`;
  }

  private nameError(value: string, what: string): string {
    const n = value.trim();
    if (!n) return `Enter the ${what} name.`;
    if (n.length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`;
    return '';
  }

  private orderError(value: string): string {
    const v = value.trim();
    if (!v) return '';
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 ? '' : 'Use a whole number, 0 or more.';
  }
}
