import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs';
import { AdminService, InvoiceListMeta, InvoiceListRow, InvoiceTab } from '../../../core/services/admin.service';
import { DayPipe, PkrPipe, TimeAgoPipe } from '../../../shared/pipes';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { PaginationComponent } from '../../../shared/components/pagination.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { StatusBadgeComponent } from '../../../shared/components/status-badge.component';
import { PagedList, SKELETON_ROWS, intParam, oneOf, setQuery } from '../admin-list';
import { InvoiceBuilderComponent } from './invoice-builder.component';

const TABS: readonly InvoiceTab[] = ['to_invoice', 'issued', 'paid'];

interface InvoiceQuery {
  tab: InvoiceTab;
  search: string;
  page: number;
}

@Component({
  selector: 'app-admin-invoices',
  standalone: true,
  imports: [DayPipe, PkrPipe, TimeAgoPipe, SearchInputComponent, PaginationComponent, EmptyStateComponent, StatusBadgeComponent, InvoiceBuilderComponent],
  templateUrl: './invoices.page.html',
  styleUrls: ['./invoices.page.scss'],
})
export class AdminInvoicesPage implements OnInit {
  private admin = inject(AdminService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly tabs: { key: InvoiceTab; label: string }[] = [
    { key: 'to_invoice', label: 'To invoice' },
    { key: 'issued', label: 'Issued' },
    { key: 'paid', label: 'Paid' },
  ];
  readonly skeleton = SKELETON_ROWS;
  readonly list = new PagedList<InvoiceListRow, InvoiceListMeta>();
  readonly query = signal<InvoiceQuery>({ tab: 'to_invoice', search: '', page: 1 });
  readonly openOrderId = signal<string | null>(null);

  ngOnInit(): void {
    const q$ = this.route.queryParamMap.pipe(
      map((p): InvoiceQuery => ({
        tab: oneOf(p.get('tab'), TABS, 'to_invoice'),
        search: p.get('search') || '',
        page: intParam(p, 'page', 1),
      })),
      distinctUntilChanged((a, b) => a.tab === b.tab && a.search === b.search && a.page === b.page)
    );
    this.list.connect(
      q$,
      (q) => {
        this.query.set(q);
        return this.admin.listInvoices({ tab: q.tab, search: q.search, page: q.page, limit: 15 });
      },
      this.destroyRef
    );

    this.route.queryParamMap
      .pipe(map((p) => p.get('order') || null), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((id) => this.openOrderId.set(id));
  }

  /** One line telling the admin what to do on the current tab. */
  tabHint(): string {
    switch (this.query().tab) {
      case 'to_invoice':
        return 'Open a packed order, add the charges from the price list and shipping, then issue the invoice. The customer is notified to pay.';
      case 'issued':
        return 'These customers have not paid yet. Open an invoice to record a bank transfer or cash payment — paid orders move to the warehouse.';
      default:
        return 'Paid invoices are final. Open one to print it; revenue and margin feed into Reports.';
    }
  }

  count(tab: InvoiceTab): number | null {
    return this.list.meta()?.counts?.[tab] ?? null;
  }

  setTab(tab: InvoiceTab): void {
    setQuery(this.router, this.route, { tab: tab === 'to_invoice' ? null : tab, page: null });
  }

  onSearch(search: string): void {
    setQuery(this.router, this.route, { search: search || null, page: null });
  }

  goTo(page: number): void {
    setQuery(this.router, this.route, { page: page > 1 ? page : null });
  }

  open(row: InvoiceListRow): void {
    const id = row.order?.id;
    if (id) setQuery(this.router, this.route, { order: id });
  }

  closeBuilder(): void {
    setQuery(this.router, this.route, { order: null });
  }
}
