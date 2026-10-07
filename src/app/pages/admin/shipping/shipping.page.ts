import { Component, DestroyRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { distinctUntilChanged, map } from 'rxjs';
import { AdminService, ShippingRate, ShippingRateInput } from '../../../core/services/admin.service';
import { UiService } from '../../../core/services/ui.service';
import { HumanizePipe, PkrPipe } from '../../../shared/pipes';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { PaginationComponent } from '../../../shared/components/pagination.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { PagedList, SKELETON_ROWS, intParam, setQuery } from '../admin-list';

interface RateForm {
  id: string | null;
  courier: string;
  zone: string;
  countries: string;
  service: 'express' | 'standard';
  transit_time: string;
  max_weight_kg: string;
  base_rate: string;
  per_extra_kg: string;
  ddp_available: boolean;
  ddp_fee: string;
  is_active: boolean;
}

@Component({
  selector: 'app-admin-shipping',
  standalone: true,
  imports: [IonSpinner, PkrPipe, HumanizePipe, SearchInputComponent, PaginationComponent, EmptyStateComponent],
  templateUrl: './shipping.page.html',
  styleUrls: ['./shipping.page.scss'],
})
export class AdminShippingPage implements OnInit {
  private admin = inject(AdminService);
  private ui = inject(UiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly skeleton = SKELETON_ROWS;
  readonly list = new PagedList<ShippingRate>();
  readonly query = signal<{ search: string; page: number }>({ search: '', page: 1 });
  readonly busyId = signal<string | null>(null);
  readonly form = signal<RateForm | null>(null);
  readonly saving = signal(false);

  readonly formValid = computed(() => {
    const f = this.form();
    if (!f) return false;
    const nums = [f.max_weight_kg, f.base_rate, f.per_extra_kg, f.ddp_available ? f.ddp_fee : '0'].map((v) => parseFloat(v || '0'));
    return !!f.courier.trim() && !!f.zone.trim() && nums.every((n) => Number.isFinite(n) && n >= 0);
  });

  ngOnInit(): void {
    const q$ = this.route.queryParamMap.pipe(
      map((p) => ({ search: p.get('search') || '', page: intParam(p, 'page', 1) })),
      distinctUntilChanged((a, b) => a.search === b.search && a.page === b.page)
    );
    this.list.connect(
      q$,
      (q) => {
        this.query.set(q);
        return this.admin.listShippingRates({ search: q.search, page: q.page, limit: 20 });
      },
      this.destroyRef
    );
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (!this.ui.confirmState() && this.form() && !this.saving()) this.form.set(null);
  }

  onSearch(search: string): void {
    setQuery(this.router, this.route, { search: search || null, page: null });
  }

  goTo(page: number): void {
    setQuery(this.router, this.route, { page: page > 1 ? page : null });
  }

  openNew(): void {
    this.form.set({
      id: null, courier: '', zone: '', countries: '', service: 'express', transit_time: '',
      max_weight_kg: '1.5', base_rate: '', per_extra_kg: '', ddp_available: false, ddp_fee: '', is_active: true,
    });
  }

  openEdit(r: ShippingRate): void {
    this.form.set({
      id: r.id,
      courier: r.courier,
      zone: r.zone,
      countries: (r.countries || []).join(', '),
      service: r.service,
      transit_time: r.transit_time || '',
      max_weight_kg: String(r.max_weight_kg ?? ''),
      base_rate: String(r.base_rate ?? ''),
      per_extra_kg: String(r.per_extra_kg ?? ''),
      ddp_available: r.ddp_available,
      ddp_fee: String(r.ddp_fee ?? ''),
      is_active: r.is_active,
    });
  }

  patchForm(patch: Partial<RateForm>): void {
    this.form.update((f) => (f ? { ...f, ...patch } : f));
  }

  save(): void {
    const f = this.form();
    if (!f || !this.formValid() || this.saving()) return;
    const n = (v: string) => parseFloat(v || '0') || 0;
    const body: ShippingRateInput = {
      courier: f.courier.trim(),
      zone: f.zone.trim(),
      countries: f.countries.split(',').map((c) => c.trim()).filter(Boolean),
      service: f.service,
      transit_time: f.transit_time.trim(),
      max_weight_kg: n(f.max_weight_kg),
      base_rate: n(f.base_rate),
      per_extra_kg: n(f.per_extra_kg),
      ddp_available: f.ddp_available,
      ddp_fee: f.ddp_available ? n(f.ddp_fee) : 0,
      is_active: f.is_active,
    };
    this.saving.set(true);
    const req = f.id ? this.admin.updateShippingRate(f.id, body) : this.admin.createShippingRate(body);
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

  toggleActive(r: ShippingRate): void {
    this.busyId.set(r.id);
    this.admin.updateShippingRate(r.id, { is_active: !r.is_active }).subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.list.patch((x) => x.id === r.id, (x) => ({ ...x, is_active: res.data?.is_active ?? !r.is_active }));
        this.ui.success(!r.is_active ? `${r.courier} · ${r.zone} is active.` : `${r.courier} · ${r.zone} is no longer offered.`);
      },
      error: (err) => {
        this.busyId.set(null);
        this.ui.error(err);
      },
    });
  }

  async remove(r: ShippingRate): Promise<void> {
    const ok = await this.ui.confirm({
      title: `Delete ${r.courier} · ${r.zone}?`,
      message: 'If shipments already used this rate it is deactivated instead of deleted.',
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    this.busyId.set(r.id);
    this.admin.deleteShippingRate(r.id).subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.ui.success(res.message || 'Shipping rate deleted.');
        this.list.reload();
      },
      error: (err) => {
        this.busyId.set(null);
        this.ui.error(err);
      },
    });
  }
}
