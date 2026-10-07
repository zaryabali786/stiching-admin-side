import { CanDirective } from '../../../shared/can.directive';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { Observable, Subject, catchError, combineLatest, map, of, startWith, switchMap, tap } from 'rxjs';
import { PageMeta } from '../../../core/models/api.models';
import { apiErrorMessage } from '../../../core/services/api.service';
import { BadgeService } from '../../../core/services/badge.service';
import { LanguageService } from '../../../core/services/language.service';
import {
  JobCard,
  PartnerService,
  QcMeta,
  QcStatus,
  UploadFile,
  filesToUploads,
} from '../../../core/services/partner.service';
import { ConfirmOptions, UiService } from '../../../core/services/ui.service';
import { voicePayload } from '../../../core/models/chat.models';
import { VoiceNotePlayComponent } from '../../../shared/components/voice-note-field/voice-note-play.component';
import { chartTitle, groupMeasurements } from '../../../core/utils/measurements';
import { ApprovalChipComponent } from '../../../shared/components/approval-chip.component';
import { DayPipe, humanize } from '../../../shared/pipes';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { PaginationComponent } from '../../../shared/components/pagination.component';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { StatusBadgeComponent } from '../../../shared/components/status-badge.component';

const TABS: { value: QcStatus; en: string; ur: string }[] = [
  { value: 'pending', en: 'Waiting for QC', ur: 'چیک کے منتظر' },
  { value: 'passed', en: 'Passed', ur: 'پاس شدہ' },
];

const MAX_PHOTOS = 6;

export interface QcOrderGroup {
  orderId: string;
  order: NonNullable<JobCard['order']>;
  cards: JobCard[];
}

@Component({
  selector: 'app-partner-quality-check',
  standalone: true,
  imports: [CanDirective, FormsModule, RouterLink, IonSpinner, DayPipe, EmptyStateComponent, PaginationComponent, SearchInputComponent, StatusBadgeComponent, VoiceNotePlayComponent, ApprovalChipComponent],
  templateUrl: './quality-check.page.html',
  styleUrls: ['./quality-check.page.scss'],
})
export class PartnerQualityCheckPage implements OnInit {
  readonly lang = inject(LanguageService);
  private partner = inject(PartnerService);
  private ui = inject(UiService);
  private badges = inject(BadgeService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly tabs = TABS;
  readonly maxPhotos = MAX_PHOTOS;

  readonly tab = signal<QcStatus>('pending');
  readonly search = signal('');
  readonly cards = signal<JobCard[]>([]);
  readonly meta = signal<(PageMeta & QcMeta) | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  private reload$ = new Subject<void>();
  private silent = false;

  readonly busy = signal<Set<string>>(new Set());

  /** Passed tab: cards grouped by order (within the current page). */
  readonly groups = computed<QcOrderGroup[]>(() => {
    const map = new Map<string, QcOrderGroup>();
    for (const c of this.cards()) {
      if (!c.order) continue;
      const g = map.get(c.order_id) || { orderId: c.order_id, order: c.order, cards: [] };
      g.cards.push(c);
      map.set(c.order_id, g);
    }
    return [...map.values()];
  });

  // Pack modal
  readonly packing = signal<{ group: QcOrderGroup; weight: number | null } | null>(null);
  readonly packSaving = signal(false);
  readonly packError = signal<string | null>(null);

  // Approval photos modal
  readonly approval = signal<{ card: JobCard; photos: UploadFile[] } | null>(null);
  readonly approvalSaving = signal(false);
  readonly photosReading = signal(false);

  ngOnInit(): void {
    combineLatest([this.route.queryParamMap, this.reload$.pipe(startWith(undefined))])
      .pipe(
        map(([q]) => {
          const t = q.get('tab') as QcStatus;
          return {
            tab: TABS.some((x) => x.value === t) ? t : ('pending' as QcStatus),
            search: (q.get('search') || '').trim(),
            page: Math.max(1, parseInt(q.get('page') || '1', 10) || 1),
          };
        }),
        tap((s) => {
          this.tab.set(s.tab);
          this.search.set(s.search);
          this.error.set(null);
          if (!this.silent) this.loading.set(true);
          this.silent = false;
        }),
        switchMap((s) =>
          this.partner.qcQueue({ status: s.tab, search: s.search, page: s.page, limit: 12 }).pipe(
            map((r) => ({ r, err: null as string | null })),
            catchError((e) => of({ r: null, err: apiErrorMessage(e) }))
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ r, err }) => {
        this.loading.set(false);
        if (err || !r) {
          this.error.set(err);
          return;
        }
        if (!r.items.length && r.meta.page > 1) {
          this.go({ page: r.meta.page - 1 > 1 ? r.meta.page - 1 : null });
          return;
        }
        this.cards.set(r.items);
        this.meta.set(r.meta);
      });
  }

  // ───────────── Filters ─────────────

  private go(params: Record<string, string | number | null>): void {
    this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge', replaceUrl: true });
  }

  setTab(tab: QcStatus): void {
    if (tab !== this.tab()) this.go({ tab: tab === 'pending' ? null : tab, page: null });
  }

  onSearch(text: string): void {
    this.go({ search: text || null, page: null });
  }

  goToPage(page: number): void {
    this.go({ page: page > 1 ? page : null });
  }

  retry(): void {
    this.reload$.next();
  }

  private refresh(): void {
    this.silent = true;
    this.reload$.next();
    this.badges.refresh();
  }

  count(tab: QcStatus): number {
    return this.meta()?.counts?.[tab] ?? 0;
  }

  // ───────────── Display helpers ─────────────

  /** Shirt / Trouser groups (only filled values here: QC compares what is on the chart). */
  measureGroups(c: JobCard): { key: string; label: string; rows: { label: string; value: string }[] }[] {
    return groupMeasurements(c.unit?.size_chart?.measurements).map((g) => ({
      key: g.key,
      label: g.label,
      rows: g.rows.filter((r) => r.value !== null).map((r) => ({ label: r.label, value: `${r.value}"` })),
    }));
  }

  chartTitle = chartTitle;

  design(c: JobCard): { label: string; value: string }[] {
    const d = c.unit?.design;
    if (!d) return [];
    return Object.entries(d)
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
      .map(([k, v]) => ({ label: humanize(k), value: String(v) }));
  }

  team(c: JobCard): string {
    return `${c.master?.name || 'No master'} › ${c.tailor?.name || 'No tailor'}`;
  }

  isBusy(key: string): boolean {
    return this.busy().has(key);
  }

  private setBusy(key: string, on: boolean): void {
    this.busy.update((s) => {
      const n = new Set(s);
      if (on) n.add(key);
      else n.delete(key);
      return n;
    });
  }

  private run(key: string, req: Observable<{ message: string }>): void {
    this.setBusy(key, true);
    req.subscribe({
      next: (res) => {
        this.setBusy(key, false);
        this.ui.success(res.message || 'Saved.');
        this.refresh();
      },
      error: (e) => {
        this.setBusy(key, false);
        this.ui.error(e);
      },
    });
  }

  // ───────────── Card actions ─────────────

  /** Confirm dialog with a text field → the entered text, or null when cancelled. */
  private ask(options: ConfirmOptions): Promise<string | null> {
    // UiService's first overload (boolean) wins TS overload resolution, so narrow the result explicitly.
    return this.ui.confirm(options) as unknown as Promise<string | null>;
  }

  async pass(c: JobCard): Promise<void> {
    if (this.isBusy(`card:${c.id}`)) return;
    const note = await this.ask({
      title: `Pass QC for ${c.unit_title}?`,
      message: `${c.order_reference} · ${this.team(c)}`,
      confirmText: 'Pass',
      input: { label: 'Note (optional)', multiline: true, required: false, placeholder: 'e.g. Pressed and folded' },
    });
    if (note === null) return;
    this.run(`card:${c.id}`, this.partner.passQc(c.id, note.trim() || undefined));
  }

  async sendBack(c: JobCard): Promise<void> {
    if (this.isBusy(`card:${c.id}`)) return;
    const res = await this.ui.confirmNote({
      title: `Send ${c.unit_title} back to stitching?`,
      message: `${c.tailor?.name || 'The tailor'} will see your note on the job card.`,
      confirmText: 'Send back',
      danger: true,
      input: { label: 'What needs fixing?', multiline: true, required: true, placeholder: 'e.g. Sleeve length 1 inch short' },
    });
    if (!res || (!res.text.trim() && !res.audio)) return;
    this.run(`card:${c.id}`, this.partner.failQc(c.id, res.text.trim(), voicePayload(res.audio)));
  }

  // ───────────── Pack ─────────────

  openPack(group: QcOrderGroup): void {
    this.packError.set(null);
    this.packing.set({ group, weight: null });
  }

  setPackWeight(v: number | null): void {
    this.packing.update((p) => (p ? { ...p, weight: v } : p));
  }

  closePack(): void {
    if (!this.packSaving()) this.packing.set(null);
  }

  submitPack(): void {
    const p = this.packing();
    if (!p) return;
    const w = Number(p.weight);
    if (!(w > 0 && w < 50)) {
      this.packError.set('Enter the parcel weight in kg (for example 1.2).');
      return;
    }
    this.packError.set(null);
    this.packSaving.set(true);
    this.partner.packOrder(p.group.orderId, w).subscribe({
      next: (res) => {
        this.packSaving.set(false);
        this.packing.set(null);
        this.ui.success(res.message || 'Order packed.');
        this.refresh();
      },
      error: (e) => {
        this.packSaving.set(false);
        const msg = apiErrorMessage(e);
        this.packError.set(msg);
        this.ui.error(msg);
      },
    });
  }

  // ───────────── Customer approval photos ─────────────

  /** Open the photo picker for ONE article (first send, or a resend while it is still waiting / after changes). */
  openApproval(card: JobCard): void {
    this.approval.set({ card, photos: [] });
  }

  /** Articles of this order (on this page) whose photos the customer has not decided on yet: they block packing. */
  waiting(group: QcOrderGroup): JobCard[] {
    return group.cards.filter((c) => c.approval_status === 'pending');
  }

  waitingTitles(group: QcOrderGroup): string {
    return this.waiting(group).map((c) => c.unit_title).join(', ');
  }

  approvalPhotos(c: JobCard): { url: string; name?: string }[] {
    return (c.approval_photos || []).filter((p) => !!p?.url);
  }

  closeApproval(): void {
    if (!this.approvalSaving()) this.approval.set(null);
  }

  async onPhotosPicked(input: HTMLInputElement): Promise<void> {
    const a = this.approval();
    const files = input.files;
    if (!a || !files?.length) return;
    const room = MAX_PHOTOS - a.photos.length;
    if (room <= 0) {
      input.value = '';
      return;
    }
    if (files.length > room) this.ui.info(`Only the first ${room} photo(s) were added (max ${MAX_PHOTOS}).`);
    this.photosReading.set(true);
    try {
      const uploads = await filesToUploads(Array.from(files).slice(0, room));
      this.approval.update((x) => (x ? { ...x, photos: [...x.photos, ...uploads].slice(0, MAX_PHOTOS) } : x));
    } catch (e) {
      this.ui.error(e);
    } finally {
      this.photosReading.set(false);
      input.value = '';
    }
  }

  removePhoto(i: number): void {
    this.approval.update((x) => (x ? { ...x, photos: x.photos.filter((_, j) => j !== i) } : x));
  }

  submitApproval(): void {
    const a = this.approval();
    if (!a) return;
    if (!a.photos.length) {
      this.ui.error('Add at least one photo for the customer.');
      return;
    }
    this.approvalSaving.set(true);
    this.partner.requestCardApproval(a.card.id, a.photos).subscribe({
      next: (res) => {
        this.approvalSaving.set(false);
        this.approval.set(null);
        this.ui.success(res.message || 'Photos sent to the customer.');
        this.refresh();
      },
      error: (e) => {
        this.approvalSaving.set(false);
        this.ui.error(e);
      },
    });
  }
}
