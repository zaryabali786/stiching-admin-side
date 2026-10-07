import { Component, DestroyRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { distinctUntilChanged, map } from 'rxjs';
import { AdminService, PRICE_CATEGORY_OPTIONS, PriceCategory, PriceItem, PriceItemInput } from '../../../core/services/admin.service';
import { UiService } from '../../../core/services/ui.service';
import { PkrPipe } from '../../../shared/pipes';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { PaginationComponent } from '../../../shared/components/pagination.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { PagedList, SKELETON_ROWS, intParam, oneOf, setQuery } from '../admin-list';

const CATEGORIES: readonly (PriceCategory | 'all')[] = ['all', 'stitching', 'accessory', 'accessory_stitching', 'finishing', 'other'];

interface PriceQuery {
  category: PriceCategory | 'all';
  search: string;
  page: number;
}

interface PriceForm {
  id: string | null;
  name: string;
  category: PriceCategory;
  unit: string;
  partner_cost: string;
  customer_price: string;
  is_active: boolean;
}

@Component({
  selector: 'app-admin-price-list',
  standalone: true,
  imports: [RouterLink, IonSpinner, PkrPipe, SearchInputComponent, PaginationComponent, EmptyStateComponent],
  templateUrl: './price-list.page.html',
  styleUrls: ['./price-list.page.scss'],
})
export class AdminPriceListPage implements OnInit {
  private admin = inject(AdminService);
  private ui = inject(UiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly categories = PRICE_CATEGORY_OPTIONS;
  readonly skeleton = SKELETON_ROWS;
  readonly list = new PagedList<PriceItem>();
  readonly query = signal<PriceQuery>({ category: 'all', search: '', page: 1 });
  readonly busyId = signal<string | null>(null);

  readonly form = signal<PriceForm | null>(null);
  readonly saving = signal(false);
  readonly formMargin = computed(() => {
    const f = this.form();
    if (!f) return null;
    const c = parseFloat(f.customer_price);
    const p = parseFloat(f.partner_cost);
    if (!Number.isFinite(c) || !Number.isFinite(p)) return null;
    return { amount: c - p, pct: c > 0 ? Math.round(((c - p) / c) * 100) : 0 };
  });
  readonly formValid = computed(() => {
    const f = this.form();
    if (!f) return false;
    const c = parseFloat(f.customer_price);
    const p = parseFloat(f.partner_cost);
    return !!f.name.trim() && c >= 0 && p >= 0;
  });

  ngOnInit(): void {
    const q$ = this.route.queryParamMap.pipe(
      map((p): PriceQuery => ({
        category: oneOf(p.get('category'), CATEGORIES, 'all'),
        search: p.get('search') || '',
        page: intParam(p, 'page', 1),
      })),
      distinctUntilChanged((a, b) => a.category === b.category && a.search === b.search && a.page === b.page)
    );
    this.list.connect(
      q$,
      (q) => {
        this.query.set(q);
        return this.admin.listPriceItems({ category: q.category === 'all' ? '' : q.category, search: q.search, page: q.page, limit: 20 });
      },
      this.destroyRef
    );
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (!this.ui.confirmState() && this.form() && !this.saving()) this.form.set(null);
  }

  categoryLabel(c: string): string {
    return PRICE_CATEGORY_OPTIONS.find((o) => o.value === c)?.label || c;
  }

  marginPct(p: PriceItem): number {
    const c = Number(p.customer_price);
    return c > 0 ? Math.round(((c - Number(p.partner_cost)) / c) * 100) : 0;
  }

  setCategory(category: PriceCategory | 'all'): void {
    setQuery(this.router, this.route, { category: category === 'all' ? null : category, page: null });
  }

  onSearch(search: string): void {
    setQuery(this.router, this.route, { search: search || null, page: null });
  }

  goTo(page: number): void {
    setQuery(this.router, this.route, { page: page > 1 ? page : null });
  }

  openNew(): void {
    const cat = this.query().category;
    this.form.set({ id: null, name: '', category: cat === 'all' ? 'other' : cat, unit: 'per article', partner_cost: '', customer_price: '', is_active: true });
  }

  openEdit(p: PriceItem): void {
    this.form.set({
      id: p.id,
      name: p.name,
      category: p.category,
      unit: p.unit || '',
      partner_cost: String(p.partner_cost ?? ''),
      customer_price: String(p.customer_price ?? ''),
      is_active: p.is_active,
    });
  }

  patchForm(patch: Partial<PriceForm>): void {
    this.form.update((f) => (f ? { ...f, ...patch } : f));
  }

  save(): void {
    const f = this.form();
    if (!f || !this.formValid() || this.saving()) return;
    const body: PriceItemInput = {
      name: f.name.trim(),
      category: f.category,
      unit: f.unit.trim() || 'per article',
      partner_cost: parseFloat(f.partner_cost),
      customer_price: parseFloat(f.customer_price),
      is_active: f.is_active,
    };
    this.saving.set(true);
    const req = f.id ? this.admin.updatePriceItem(f.id, body) : this.admin.createPriceItem(body);
    req.subscribe({
      next: (res) => {
        this.saving.set(false);
        this.form.set(null);
        this.ui.success(res.message || 'Saved.');
        this.list.reload();
      },
      error: (err) => {
        this.saving.set(false);
        this.ui.error(err);
      },
    });
  }

  toggleActive(p: PriceItem): void {
    this.busyId.set(p.id);
    this.admin.updatePriceItem(p.id, { is_active: !p.is_active }).subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.list.patch((r) => r.id === p.id, (r) => ({ ...r, is_active: res.data?.is_active ?? !p.is_active }));
        this.ui.success(!p.is_active ? `${p.name} is active.` : `${p.name} is hidden from the invoice builder.`);
      },
      error: (err) => {
        this.busyId.set(null);
        this.ui.error(err);
      },
    });
  }

  async remove(p: PriceItem): Promise<void> {
    const ok = await this.ui.confirm({
      title: `Delete “${p.name}”?`,
      message: 'If this item was used on an invoice it is deactivated instead, so past invoices stay intact.',
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    this.busyId.set(p.id);
    this.admin.deletePriceItem(p.id).subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.ui.success(res.message || 'Price item deleted.');
        this.list.reload();
      },
      error: (err) => {
        this.busyId.set(null);
        this.ui.error(err);
      },
    });
  }
}
