import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs';
import { ShopAdminService, ShopBrand, ShopProductRow } from '../../../core/services/shop-admin.service';
import { UiService } from '../../../core/services/ui.service';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { PaginationComponent } from '../../../shared/components/pagination.component';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { PAGE_SIZES, PagedList, SKELETON_ROWS, intParam, oneOf, setQuery } from '../admin-list';
import { priceRange } from './shop-format';

const AVAILABILITY = ['all', 'in_stock', 'out'] as const;
const VISIBILITY = ['all', 'visible', 'hidden'] as const;

interface ProductQuery {
  search: string;
  store: string;
  availability: (typeof AVAILABILITY)[number];
  visibility: (typeof VISIBILITY)[number];
  page: number;
  limit: number;
}

/** Ecommerce > Shop Products: the unified catalogue of every approved brand, with a switch to hide a product from OUR shop only. */
@Component({
  selector: 'app-admin-shop-products',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, SearchInputComponent, PaginationComponent, EmptyStateComponent],
  styleUrls: ['./ecommerce.page.scss'],
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <span class="eyebrow">Ecommerce</span>
          <h1>Shop products</h1>
          <p class="subtitle">Products synced from every approved brand. Hiding a product removes it from our Shop only: nothing changes in the brand's own store.</p>
        </div>
        <a class="btn" routerLink="/admin/shop-brands">Brands &amp; sync →</a>
      </header>

      <div class="toolbar">
        <app-search-input placeholder="Search product or brand…" [value]="query().search" (search)="set({ search: $event })" />
        @if (list.meta(); as m) { <span class="result-count">{{ m.total }} {{ m.total === 1 ? 'product' : 'products' }}</span> }
        <label class="page-size">
          Rows
          <select class="select" (change)="set({ limit: $any($event.target).value })">
            @for (s of pageSizes; track s) { <option [value]="s" [selected]="s === query().limit">{{ s }}</option> }
          </select>
        </label>
      </div>

      <div class="filters">
        <label>Brand
          <select class="select" aria-label="Filter by brand" (change)="set({ store: $any($event.target).value })">
            <option value="" [selected]="!query().store">All brands</option>
            @for (b of brands(); track b.store_id) { <option [value]="b.store_id" [selected]="b.store_id === query().store">{{ b.brand_name }}</option> }
          </select>
        </label>
        <label>Stock
          <select class="select" aria-label="Filter by availability" (change)="set({ availability: $any($event.target).value })">
            <option value="all" [selected]="query().availability === 'all'">Any</option>
            <option value="in_stock" [selected]="query().availability === 'in_stock'">In stock</option>
            <option value="out" [selected]="query().availability === 'out'">Out of stock</option>
          </select>
        </label>
        <label>Visibility
          <select class="select" aria-label="Filter by visibility" (change)="set({ visibility: $any($event.target).value })">
            <option value="all" [selected]="query().visibility === 'all'">All</option>
            <option value="visible" [selected]="query().visibility === 'visible'">Shown in the Shop</option>
            <option value="hidden" [selected]="query().visibility === 'hidden'">Hidden by us</option>
          </select>
        </label>
      </div>

      <div class="table-card" [class.refreshing]="list.refreshing()">
        @if (list.error()) {
          <app-empty-state kind="error" [message]="list.error()" (retry)="list.reload()" />
        } @else {
          <div class="table-scroll" [class.sticky-head]="query().limit > 15">
            <table class="data-table">
              <caption class="sr-only">Shop products</caption>
              <thead>
                <tr><th>Product</th><th>Brand</th><th>Price</th><th>Stock</th><th class="num">Variants</th><th>Synced</th><th>In our Shop</th></tr>
              </thead>
              <tbody>
                @if (list.loading()) {
                  @for (i of skeleton; track i) { <tr>@for (c of [1, 2, 3, 4, 5, 6, 7]; track c) { <td><span class="skeleton"></span></td> }</tr> }
                } @else {
                  @for (p of list.items(); track p.id) {
                    <tr>
                      <td>
                        <div class="product-cell">
                          @if (p.image_url) { <img class="thumb" [src]="p.image_url" alt="" loading="lazy" /> } @else { <span class="thumb blank"></span> }
                          <span class="cell-main">{{ p.title }}
                            <span class="cell-sub">Shopify status: {{ p.shopify_status || 'unknown' }}</span>
                          </span>
                        </div>
                      </td>
                      <td>{{ p.brand.name }}</td>
                      <td class="nowrap">{{ price(p) }}</td>
                      <td><span class="badge" [class.green]="p.in_stock" [class.red]="!p.in_stock">{{ p.in_stock ? 'In stock' : 'Out of stock' }}</span></td>
                      <td class="num">{{ p.variants_count }}</td>
                      <td class="nowrap">{{ p.synced_at ? (p.synced_at | date: 'MMM d, h:mm a') : '—' }}</td>
                      <td class="nowrap">
                        <button type="button" class="switch" [class.on]="!p.hidden" role="switch" [attr.aria-checked]="!p.hidden" [attr.aria-label]="(p.hidden ? 'Show ' : 'Hide ') + p.title + ' in the Shop'" [disabled]="busy() === p.id" (click)="toggle(p)"><span></span></button>
                        <span class="switch-label">{{ p.hidden ? 'Hidden' : 'Shown' }}</span>
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="7">
                      <app-empty-state [title]="filtered() ? 'No matching products' : 'No products yet'"
                        [message]="filtered() ? 'Try a different search or filter.' : 'Approve a brand and sync its products on the Brands page.'" />
                    </td></tr>
                  }
                }
              </tbody>
            </table>
          </div>
          <app-pagination [meta]="list.meta()" (pageChange)="set({ page: $event })" />
        }
      </div>
    </div>
  `,
})
export class AdminShopProductsPage implements OnInit {
  private shop = inject(ShopAdminService);
  private ui = inject(UiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly skeleton = SKELETON_ROWS;
  readonly pageSizes = PAGE_SIZES;
  readonly list = new PagedList<ShopProductRow>();
  readonly query = signal<ProductQuery>({ search: '', store: '', availability: 'all', visibility: 'all', page: 1, limit: 15 });
  readonly brands = signal<ShopBrand[]>([]);
  readonly busy = signal<string | null>(null);

  ngOnInit(): void {
    this.shop.brands().subscribe({ next: (b) => this.brands.set(b), error: () => undefined });
    const q$ = this.route.queryParamMap.pipe(
      map((p): ProductQuery => ({
        search: p.get('search') || '',
        store: p.get('store') || '',
        availability: oneOf(p.get('availability'), AVAILABILITY, 'all'),
        visibility: oneOf(p.get('visibility'), VISIBILITY, 'all'),
        page: intParam(p, 'page', 1),
        limit: intParam(p, 'limit', 15, PAGE_SIZES),
      })),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
    );
    this.list.connect(
      q$,
      (q) => {
        this.query.set(q);
        return this.shop.products({ search: q.search, store: q.store, availability: q.availability, visibility: q.visibility, page: q.page, limit: q.limit });
      },
      this.destroyRef
    );
  }

  /** Change one filter; any filter other than the page goes back to page 1. */
  set(patch: Partial<Record<keyof ProductQuery, string | number>>): void {
    const reset = 'page' in patch ? {} : { page: 1 };
    setQuery(this.router, this.route, { ...patch, ...reset });
  }

  filtered(): boolean {
    const q = this.query();
    return !!(q.search || q.store || q.availability !== 'all' || q.visibility !== 'all');
  }

  price(p: ShopProductRow): string {
    return priceRange(p.price_min, p.price_max, p.currency);
  }

  toggle(p: ShopProductRow): void {
    this.busy.set(p.id);
    this.shop.setHidden(p.id, !p.hidden).subscribe({
      next: (row) => {
        this.list.patch((r) => r.id === p.id, (r) => ({ ...r, hidden: row?.hidden ?? !p.hidden }));
        this.busy.set(null);
        this.ui.success(p.hidden ? 'Shown in the Shop again.' : 'Hidden from the Shop. It is unchanged in the brand\'s store.');
      },
      error: (err) => {
        this.busy.set(null);
        this.ui.error(err, 'Could not change the product.');
      },
    });
  }
}
