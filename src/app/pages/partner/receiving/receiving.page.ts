import { CanDirective } from '../../../shared/can.directive';
import { VoiceNote, voicePayload } from '../../../core/models/chat.models';
import { VoiceNoteFieldComponent } from '../../../shared/components/voice-note-field/voice-note-field.component';
import { VoiceNotePlayComponent } from '../../../shared/components/voice-note-field/voice-note-play.component';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { Observable, Subject, catchError, combineLatest, map, of, startWith, switchMap, tap } from 'rxjs';
import { PageMeta } from '../../../core/models/api.models';
import { apiErrorMessage } from '../../../core/services/api.service';
import { BadgeService } from '../../../core/services/badge.service';
import { LanguageService } from '../../../core/services/language.service';
import {
  ISSUE_TYPES,
  IssueType,
  PartnerService,
  ReceivingMeta,
  ReceivingOrder,
  ReceivingTab,
  ReceivingUnit,
  UnmatchedParcel,
  UploadFile,
  filesToUploads,
} from '../../../core/services/partner.service';
import { UiService } from '../../../core/services/ui.service';
import { DayPipe, TimeAgoPipe } from '../../../shared/pipes';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { PaginationComponent } from '../../../shared/components/pagination.component';
import { SearchInputComponent } from '../../../shared/components/search-input.component';
import { StatusBadgeComponent } from '../../../shared/components/status-badge.component';

const TABS: { value: ReceivingTab; en: string; ur: string }[] = [
  { value: 'expected', en: 'Expected', ur: 'متوقع' },
  { value: 'issues', en: 'Issues', ur: 'مسائل' },
  { value: 'recent', en: 'Recently received', ur: 'حال ہی میں وصول' },
];

const MAX_MEDIA = 4;

interface IssueForm {
  order: ReceivingOrder;
  unit: ReceivingUnit;
  issueType: IssueType;
  note: string;
  audio: VoiceNote | null;
  media: UploadFile[];
}

@Component({
  selector: 'app-partner-receiving',
  standalone: true,
  imports: [CanDirective, FormsModule, IonSpinner, DayPipe, TimeAgoPipe, EmptyStateComponent, PaginationComponent, SearchInputComponent, StatusBadgeComponent, VoiceNoteFieldComponent, VoiceNotePlayComponent],
  templateUrl: './receiving.page.html',
  styleUrls: ['./receiving.page.scss'],
})
export class PartnerReceivingPage implements OnInit {
  readonly lang = inject(LanguageService);
  private partner = inject(PartnerService);
  private ui = inject(UiService);
  private badges = inject(BadgeService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly tabs = TABS;
  readonly issueTypes = ISSUE_TYPES;
  readonly maxMedia = MAX_MEDIA;

  // List state (mirrors the URL)
  readonly tab = signal<ReceivingTab>('expected');
  readonly search = signal('');
  readonly page = signal(1);

  readonly orders = signal<ReceivingOrder[]>([]);
  readonly meta = signal<(PageMeta & ReceivingMeta) | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  private reload$ = new Subject<void>();
  private silent = false;

  /** "Suggested team" banner on the Expected tab. */
  readonly suggestion = computed(() => {
    const s = this.meta()?.suggestion;
    return this.tab() === 'expected' && s?.master ? { master: s.master, tailor: s.tailor } : null;
  });

  // Unmatched parcels
  readonly unmatched = signal<UnmatchedParcel[]>([]);
  readonly unmatchedTotal = signal(0);
  readonly unmatchedLoading = signal(true);
  readonly unmatchedError = signal<string | null>(null);
  private unmatchedReload$ = new Subject<void>();

  // Actions
  readonly busy = signal<Set<string>>(new Set());

  // Issue modal
  readonly issue = signal<IssueForm | null>(null);
  readonly issueSaving = signal(false);
  readonly voiceBusy = signal(false);
  readonly mediaReading = signal(false);
  readonly issueTouched = signal(false);

  // Unmatched modal
  readonly unmatchedForm = signal<{ label_text: string; brand: string; tracking_number: string; notes: string } | null>(null);
  readonly unmatchedSaving = signal(false);

  ngOnInit(): void {
    combineLatest([this.route.queryParamMap, this.reload$.pipe(startWith(undefined))])
      .pipe(
        map(([q]) => {
          const t = q.get('tab') as ReceivingTab;
          return {
            tab: TABS.some((x) => x.value === t) ? t : ('expected' as ReceivingTab),
            search: (q.get('search') || '').trim(),
            page: Math.max(1, parseInt(q.get('page') || '1', 10) || 1),
          };
        }),
        tap((s) => {
          this.tab.set(s.tab);
          this.search.set(s.search);
          this.page.set(s.page);
          this.error.set(null);
          if (!this.silent) this.loading.set(true);
          this.silent = false;
        }),
        switchMap((s) =>
          this.partner.receiving({ tab: s.tab, search: s.search, page: s.page, limit: 10 }).pipe(
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
        // The last item on a page was handled → step back a page.
        if (!r.items.length && r.meta.page > 1) {
          this.go({ page: r.meta.totalPages > 1 ? Math.min(r.meta.page - 1, r.meta.totalPages) : null });
          return;
        }
        this.orders.set(r.items);
        this.meta.set(r.meta);
      });

    this.unmatchedReload$
      .pipe(
        startWith(undefined),
        tap(() => this.unmatchedError.set(null)),
        switchMap(() =>
          this.partner.unmatched({ limit: 5 }).pipe(
            map((r) => ({ r, err: null as string | null })),
            catchError((e) => of({ r: null, err: apiErrorMessage(e) }))
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ r, err }) => {
        this.unmatchedLoading.set(false);
        if (err || !r) this.unmatchedError.set(err);
        else {
          this.unmatched.set(r.items);
          this.unmatchedTotal.set(r.meta.total);
        }
      });
  }

  // ───────────── Navigation / filters ─────────────

  private go(params: Record<string, string | number | null>): void {
    this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge', replaceUrl: true });
  }

  setTab(tab: ReceivingTab): void {
    if (tab !== this.tab()) this.go({ tab: tab === 'expected' ? null : tab, page: null });
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

  count(tab: ReceivingTab): number {
    return this.meta()?.counts?.[tab] ?? 0;
  }

  // ───────────── Helpers ─────────────

  isBusy(key: string): boolean {
    return this.busy().has(key);
  }

  private setBusy(key: string, on: boolean): void {
    this.busy.update((s) => {
      const next = new Set(s);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  private run(key: string, req: Observable<{ message: string }>, after?: () => void): void {
    if (this.isBusy(key)) return;
    this.setBusy(key, true);
    req.subscribe({
      next: (res) => {
        this.setBusy(key, false);
        this.ui.success(res.message || 'Saved.');
        after?.();
        this.refresh();
      },
      error: (e) => {
        this.setBusy(key, false);
        this.ui.error(e);
      },
    });
  }

  pendingCount(order: ReceivingOrder): number {
    return order.units.filter((u) => u.status === 'pending').length;
  }

  receivedCount(order: ReceivingOrder): number {
    return order.units.filter((u) => u.status === 'received').length;
  }

  issueCount(order: ReceivingOrder): number {
    return order.units.filter((u) => u.status === 'issue').length;
  }

  issueLabel(type: IssueType | null): string {
    const t = ISSUE_TYPES.find((x) => x.value === type);
    return t ? this.lang.t(t.en, t.ur) : 'Issue';
  }

  unitTone(status: ReceivingUnit['status']): string {
    return status === 'received' ? 'green' : status === 'issue' ? 'red' : '';
  }

  unitLabel(status: ReceivingUnit['status']): string {
    return status === 'received' ? this.lang.t('Received', 'وصول') : status === 'issue' ? this.lang.t('Issue', 'مسئلہ') : this.lang.t('Pending', 'باقی');
  }

  destination(o: ReceivingOrder): string {
    return [o.destination_city, o.destination_country].filter(Boolean).join(', ');
  }

  // ───────────── Unit actions ─────────────

  receiveUnit(unit: ReceivingUnit): void {
    this.run(`unit:${unit.id}`, this.partner.receiveUnit(unit.id));
  }

  async receiveAll(order: ReceivingOrder): Promise<void> {
    const pending = this.pendingCount(order);
    const ok = await this.ui.confirm({
      title: `Mark all received?`,
      message: `${pending} pending unit${pending === 1 ? '' : 's'} of ${order.reference} will be marked as received.`,
      confirmText: 'Mark all received',
    });
    if (ok) this.run(`order:${order.id}`, this.partner.receiveAll(order.id));
  }

  // ───────────── Issue modal ─────────────

  openIssue(order: ReceivingOrder, unit: ReceivingUnit): void {
    this.issueTouched.set(false);
    this.issue.set({ order, unit, issueType: unit.issue_type || 'piece_missing', note: '', audio: null, media: [] });
  }

  closeIssue(): void {
    if (this.issueSaving()) return;
    this.issue.set(null);
  }

  patchIssue(patch: Partial<IssueForm>): void {
    this.issue.update((f) => (f ? { ...f, ...patch } : f));
  }

  async onMediaPicked(input: HTMLInputElement): Promise<void> {
    const form = this.issue();
    const files = input.files;
    if (!form || !files?.length) return;
    const room = MAX_MEDIA - form.media.length;
    if (room <= 0) {
      this.ui.error(`You can add up to ${MAX_MEDIA} photos or videos.`);
      input.value = '';
      return;
    }
    const picked = Array.from(files).slice(0, room);
    if (files.length > room) this.ui.info(`Only the first ${room} file(s) were added (max ${MAX_MEDIA}).`);
    this.mediaReading.set(true);
    try {
      const uploads = await filesToUploads(picked, { allowVideo: true });
      this.issue.update((f) => (f ? { ...f, media: [...f.media, ...uploads].slice(0, MAX_MEDIA) } : f));
    } catch (e) {
      this.ui.error(e);
    } finally {
      this.mediaReading.set(false);
      input.value = '';
    }
  }

  removeMedia(index: number): void {
    this.issue.update((f) => (f ? { ...f, media: f.media.filter((_, i) => i !== index) } : f));
  }

  isVideo(file: UploadFile): boolean {
    return file.dataUrl.startsWith('data:video');
  }

  submitIssue(): void {
    const f = this.issue();
    if (!f) return;
    this.issueTouched.set(true);
    if ((!f.note.trim() && !f.audio) || this.voiceBusy()) return;
    this.issueSaving.set(true);
    this.partner
      .reportIssue(f.unit.id, { issue_type: f.issueType, note: f.note.trim() || undefined, notes_audio: voicePayload(f.audio), media: f.media.length ? f.media : undefined })
      .subscribe({
        next: (res) => {
          this.issueSaving.set(false);
          this.issue.set(null);
          this.ui.success(res.message || 'Issue reported.');
          this.refresh();
        },
        error: (e) => {
          this.issueSaving.set(false);
          this.ui.error(e);
        },
      });
  }

  // ───────────── Unmatched parcels ─────────────

  openUnmatched(): void {
    this.unmatchedForm.set({ label_text: '', brand: '', tracking_number: '', notes: '' });
  }

  closeUnmatched(): void {
    if (!this.unmatchedSaving()) this.unmatchedForm.set(null);
  }

  patchUnmatched(key: 'label_text' | 'brand' | 'tracking_number' | 'notes', value: string): void {
    this.unmatchedForm.update((f) => (f ? { ...f, [key]: value } : f));
  }

  submitUnmatched(): void {
    const f = this.unmatchedForm();
    if (!f) return;
    if (!f.label_text.trim() && !f.tracking_number.trim()) {
      this.ui.error('Enter what is written on the label or the tracking number.');
      return;
    }
    this.unmatchedSaving.set(true);
    this.partner
      .logUnmatched({
        label_text: f.label_text.trim() || undefined,
        brand: f.brand.trim() || undefined,
        tracking_number: f.tracking_number.trim() || undefined,
        notes: f.notes.trim() || undefined,
      })
      .subscribe({
        next: (res) => {
          this.unmatchedSaving.set(false);
          this.unmatchedForm.set(null);
          this.ui.success(res.message || 'Parcel logged.');
          this.unmatchedReload$.next();
        },
        error: (e) => {
          this.unmatchedSaving.set(false);
          this.ui.error(e);
        },
      });
  }

  retryUnmatched(): void {
    this.unmatchedLoading.set(true);
    this.unmatchedReload$.next();
  }
}
