import { AuthService } from '../../../core/services/auth.service';
import { CanDirective } from '../../../shared/can.directive';
import { Component, DestroyRef, ElementRef, HostListener, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { Observable, Subject, catchError, distinctUntilChanged, filter, map, of, switchMap, tap } from 'rxjs';

import {
  Card,
  CardDetail,
  CardPatch,
  MediaRef,
  Member,
  PRODUCTION_STAGES,
  ProductionService,
  ProductionStage,
  QcChecklist,
  Suggestions,
  Teams,
} from '../../../core/services/production.service';
import { ConfirmOptions, UiService } from '../../../core/services/ui.service';
import { LanguageService } from '../../../core/services/language.service';
import { BadgeService } from '../../../core/services/badge.service';
import { PartnerService } from '../../../core/services/partner.service';
import { apiErrorMessage } from '../../../core/services/api.service';
import { ApprovalStatus, approvalLook } from '../../../core/utils/approval';
import { ApprovalChipComponent } from '../../../shared/components/approval-chip.component';
import { chartTitle, groupMeasurements } from '../../../core/utils/measurements';
import { VoiceNote, voicePayload } from '../../../core/models/chat.models';
import { VoiceNoteFieldComponent } from '../../../shared/components/voice-note-field/voice-note-field.component';
import { VoiceNotePlayComponent } from '../../../shared/components/voice-note-field/voice-note-play.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state.component';
import { HumanizePipe, TimeAgoPipe } from '../../../shared/pipes';
import {
  MAX_UPLOADS,
  PreparedUpload,
  STAGE_META,
  cardDisplayLabel,
  initial,
  masterLabel,
  prepareUpload,
  shortDate,
  shortDateTime,
  swatchBackground,
} from '../production/production.utils';

type StepState = 'done' | 'now' | 'next';

interface Step {
  key: string;
  label: string;
  person: string;
  sub: string;
  avatar: string;
  at: string | null;
  state: StepState;
}

interface DesignBox {
  label: string;
  value: string;
}

type ActionKey = 'primary' | 'pack' | 'fail' | 'ask' | 'patch' | 'send' | 'comment';


const STEP_INDEX: Record<ProductionStage, number> = { to_assign: 0, cutting: 1, stitching: 2, qc: 3, packed: 4 };

@Component({
  selector: 'app-partner-job-detail',
  standalone: true,
  imports: [CanDirective, RouterLink, IonSpinner, EmptyStateComponent, TimeAgoPipe, HumanizePipe, VoiceNoteFieldComponent, VoiceNotePlayComponent, ApprovalChipComponent],
  templateUrl: './job-detail.page.html',
  styleUrls: ['./job-detail.page.scss'],
})
export class PartnerJobDetailPage implements OnInit {
  private production = inject(ProductionService);
  private partnerApi = inject(PartnerService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private ui = inject(UiService);
  private badges = inject(BadgeService);
  private destroyRef = inject(DestroyRef);
  readonly lang = inject(LanguageService);
  private auth = inject(AuthService);
  /** May this person change things here? View-only people see the data but no working buttons (the server re-checks every request). */
  readonly canEdit = computed(() => this.auth.can('production.update'));

  readonly card = signal<CardDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly notFound = signal(false);

  readonly teams = signal<Teams | null>(null);
  readonly suggestion = signal<Suggestions | null>(null);
  readonly action = signal<ActionKey | null>(null);
  readonly checklist = signal<QcChecklist>({});
  readonly savingItem = signal<string | null>(null);
  readonly commentText = signal('');
  readonly commentAudio = signal<VoiceNote | null>(null);
  readonly voiceBusy = signal(false);
  readonly canComment = computed(() => (!!this.commentText().trim() || !!this.commentAudio()) && !this.voiceBusy() && !this.action());

  readonly lightbox = signal<MediaRef | null>(null);
  readonly photoModal = signal(false);
  readonly uploads = signal<PreparedUpload[]>([]);
  readonly preparing = signal(false);

  private fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private load$ = new Subject<{ id: string; silent: boolean }>();
  private currentId = '';

  readonly masterLabel = masterLabel;
  readonly initial = initial;
  readonly shortDate = shortDate;
  readonly shortDateTime = shortDateTime;
  readonly maxUploads = MAX_UPLOADS;

  // ───────── Derived view data ─────────

  readonly swatch = computed(() => {
    const c = this.card();
    return swatchBackground(c ? c.unit_id || c.id : '');
  });

  readonly lineNo = computed(() => {
    const c = this.card();
    if (!c) return 1;
    if (c.unit?.line_no) return c.unit.line_no;
    const i = (c.order_cards || []).findIndex((s) => s.id === c.id);
    return i >= 0 ? i + 1 : 1;
  });

  readonly jobCode = computed(() => {
    const c = this.card();
    if (!c) return '';
    return [c.customer_code || c.order?.customer_code, c.order_reference, this.lineNo()].filter(Boolean).join('-');
  });

  readonly pieces = computed(() => this.card()?.order_cards?.length ?? 0);

  readonly destination = computed(() => {
    const o = this.card()?.order;
    return [o?.destination_city, o?.destination_country].filter(Boolean).join(', ');
  });

  readonly stageMeta = computed(() => {
    const c = this.card();
    return c ? STAGE_META[c.stage] : null;
  });

  readonly steps = computed<Step[]>(() => {
    const c = this.card();
    if (!c) return [];
    const current = c.stage === 'packed' ? 5 : STEP_INDEX[c.stage];
    const state = (i: number): StepState => (i < current ? 'done' : i === current ? 'now' : 'next');
    const master = c.master ? masterLabel(c.master.name) : null;
    const receivedAt = c.unit?.received_at || c.order?.received_at || c.created_at;
    return [
      { key: 'received', label: 'Received', person: 'Receiving desk', sub: c.stage === 'to_assign' ? 'Needs a master' : 'Checked in', avatar: 'R', at: receivedAt, state: state(0) },
      { key: 'cutting', label: 'Cutting', person: master || 'Not assigned', sub: 'Master · cutting', avatar: c.master ? initial(c.master.name) : '?', at: c.cutting_at, state: state(1) },
      { key: 'stitching', label: 'Stitching', person: c.tailor?.name || 'Not assigned', sub: 'Tailor · stitching', avatar: c.tailor ? initial(c.tailor.name) : '?', at: c.stitching_at, state: state(2) },
      {
        key: 'qc',
        label: 'Quality check',
        person: master || 'QC staff',
        sub: c.qc_passed ? 'Passed' : 'Checks measurements',
        avatar: c.master ? initial(c.master.name) : 'Q',
        at: c.qc_at,
        state: state(3),
      },
      { key: 'packed', label: 'Packed', person: 'Warehouse team', sub: 'Packed & weighed', avatar: 'W', at: c.packed_at, state: state(4) },
    ];
  });

  readonly allChecked = computed(() => {
    const c = this.card();
    const items = c?.qc_items || [];
    const list = this.checklist();
    return items.length > 0 && items.every((i) => !!list[i.key]);
  });

  readonly checkedCount = computed(() => {
    const list = this.checklist();
    return (this.card()?.qc_items || []).filter((i) => !!list[i.key]).length;
  });

  /** This ticket's own approval state (each article is approved on its own). */
  readonly approvalStatus = computed<ApprovalStatus>(() => this.card()?.approval_status ?? 'none');
  readonly approval = computed(() => approvalLook(this.approvalStatus()));
  /** Photos sent for THIS ticket; older orders only have the order-level photos. */
  readonly approvalPhotos = computed(() => {
    const c = this.card();
    const own = (c?.approval_photos || []).filter((r) => !!r?.url);
    return own.length ? own : (c?.order?.approval_photos || []).filter((r) => !!r?.url);
  });
  /** The customer's change request for this ticket (falls back to the order's for old orders). */
  readonly changeText = computed(() => this.card()?.change_request || this.card()?.order?.change_request || null);
  readonly changeAudio = computed(() => this.card()?.change_request_audio || this.card()?.order?.change_request_audio || null);
  /** QC passed and not yet approved: staff can send (or resend) photos for this ticket. */
  readonly canSendPhotos = computed(() => {
    const c = this.card();
    return !!c && this.canEdit() && c.stage === 'qc' && c.qc_passed && this.approvalStatus() !== 'approved';
  });

  readonly nextText = computed(() => {
    const c = this.card();
    if (!c) return '';
    const master = c.master ? masterLabel(c.master.name) : 'the master';
    const tailor = c.tailor?.name || 'a tailor';
    switch (c.stage) {
      case 'to_assign': {
        const s = this.suggestion()?.master;
        return s
          ? `Cutting is next. ${masterLabel(s.name)} is the least busy master (${s.load_pct}% load) and would cut it.`
          : 'Cutting is next. Assign a master to start.';
      }
      case 'cutting':
        return `Stitching is next. ${master} cuts the fabric, then ${tailor} stitches it.`;
      case 'stitching':
        return `QC is next. ${tailor} stitches it, then ${master} checks it against the measurements.`;
      case 'qc':
        return c.qc_passed
          ? this.approvalStatus() === 'pending'
            ? 'Photos are with the customer. Waiting for them to approve this piece or ask for changes.'
            : this.approvalStatus() === 'approved'
              ? this.pieces() <= 1
                ? 'The customer approved this piece. It is the only piece in this order, so you can pack the order now.'
                : 'The customer approved this piece. Pack the order once every piece is ready.'
              : 'QC passed. Send finished photos of this piece so the customer can approve it.'
          : `QC is in progress. ${master} checks it against the measurements, then the customer approves photos.`;
      case 'packed': {
        const progress = cardDisplayLabel(c);
        return progress ? `Done at the workshop. The order is now: ${progress}.` : 'Packed and handed to the warehouse team.';
      }
    }
  });

  /** Shirt / Trouser groups from the order's own copy of the chart (labels come from core/utils/measurements). */
  readonly measureGroups = computed(() => groupMeasurements(this.card()?.unit?.size_chart?.measurements));
  readonly chartHeading = computed(() => chartTitle(this.card()?.unit?.size_chart));

  /** Every chosen article, whatever the type is called (design = { <type_name>: <article name> }). */
  readonly designBoxes = computed<DesignBox[]>(() =>
    Object.entries(this.card()?.unit?.design || {})
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
      .map(([k, v]) => ({ label: humanizeKey(k), value: String(v) }))
  );

  readonly referenceImages = computed(() => (this.card()?.unit?.reference_images || []).filter((r) => !!r?.url));

  readonly masterOptions = computed<Member[]>(() => {
    const t = this.teams();
    const c = this.card();
    const list: Member[] = (t?.masters || []).map((m) => m as Member);
    if (c?.master && !list.some((m) => m.id === c.master!.id)) list.push(placeholderMember(c.master.id, c.master.name, 'master'));
    return list;
  });

  readonly tailorGroups = computed(() => {
    const t = this.teams();
    const c = this.card();
    const groups = (t?.masters || [])
      .filter((m) => m.tailors?.length)
      .map((m) => ({ label: `${masterLabel(m.name)}'s team`, tailors: m.tailors }));
    if (t?.unassignedTailors?.length) groups.push({ label: 'No team', tailors: t.unassignedTailors });
    const all = groups.flatMap((g) => g.tailors);
    if (c?.tailor && !all.some((m) => m.id === c.tailor!.id)) {
      groups.push({ label: 'Current', tailors: [placeholderMember(c.tailor.id, c.tailor.name, 'tailor')] });
    }
    return groups;
  });

  readonly dueDateValue = computed(() => (this.card()?.due_date || '').slice(0, 10));

  ngOnInit(): void {
    this.load$
      .pipe(
        tap(({ silent }) => {
          if (!silent) {
            this.loading.set(true);
            this.error.set(null);
            this.notFound.set(false);
          }
        }),
        switchMap(({ id, silent }) =>
          this.production.card(id).pipe(
            map((card) => ({ card, err: null as unknown, silent })),
            catchError((err) => of({ card: null, err, silent }))
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ card, err, silent }) => {
        this.loading.set(false);
        if (card) {
          this.card.set(card);
          this.checklist.set({ ...(card.qc_checklist || {}) });
          this.error.set(null);
          if (card.stage === 'to_assign' && !this.suggestion()) this.loadSuggestion();
          return;
        }
        if (silent && this.card()) {
          this.ui.error(err);
          return;
        }
        this.card.set(null);
        this.notFound.set(err instanceof HttpErrorResponse && (err.status === 404 || err.status === 400));
        this.error.set(apiErrorMessage(err));
      });

    this.route.paramMap
      .pipe(
        map((p) => p.get('id') || ''),
        filter(Boolean),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((id) => {
        this.currentId = id;
        this.commentText.set('');
        this.load$.next({ id, silent: false });
      });

    this.production
      .teams()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (t) => this.teams.set(t), error: () => this.teams.set(null) });
  }

  reload(silent = true): void {
    if (this.currentId) this.load$.next({ id: this.currentId, silent });
  }

  private loadSuggestion(): void {
    this.production
      .suggestions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (s) => this.suggestion.set(s), error: () => this.suggestion.set(null) });
  }

  /** What to call this article: its production stage, or (once it left production) the order's own progress, e.g. Shipped. */
  cardLabel(c: { stage: ProductionStage; display_status?: string | null; display_label?: string | null }): string {
    return cardDisplayLabel(c) ?? this.stageLabel(c.stage);
  }

  stageLabel(stage: ProductionStage): string {
    const m = STAGE_META[stage];
    return m ? this.lang.t(m.en, m.ur) : stage;
  }

  stageColor(stage: ProductionStage): string {
    return STAGE_META[stage]?.color || 'var(--c-muted)';
  }

  isVideo(m: MediaRef): boolean {
    return m.type === 'video' || /\.(mp4|mov|webm)(\?|$)/i.test(m.url);
  }

  // ───────── Pack the order (same call as Quality check > Pack) ─────────

  readonly packWeight = signal<number | null>(null);

  /** The piece passed QC and the customer approved it: the order can be weighed and packed from here. */
  readonly canPack = computed(() => {
    const c = this.card();
    return !!c && c.stage === 'qc' && c.qc_passed && this.approvalStatus() === 'approved' && this.auth.can('quality.update');
  });

  setPackWeight(value: string): void {
    const n = parseFloat(value);
    this.packWeight.set(Number.isFinite(n) ? n : null);
  }

  packOrder(): void {
    const c = this.card();
    const w = this.packWeight();
    if (!c || !this.canPack()) return;
    if (!w || w <= 0 || w >= 50) {
      this.ui.error('Enter the parcel weight in kg (for example 1.2).');
      return;
    }
    this.run('pack', this.partnerApi.packOrder(c.order_id, w), (r) => r.message);
  }

  // ───────── Actions ─────────

  /** Run an API action with a busy flag, success toast, silent reload and badge refresh. */
  private run<T>(key: ActionKey, request: Observable<T>, success: (result: T) => string | null, after?: (result: T) => void): void {
    if (this.action()) return;
    this.action.set(key);
    request.subscribe({
      next: (result) => {
        this.action.set(null);
        const msg = success(result);
        if (msg) this.ui.success(msg);
        this.reload();
        this.badges.refresh();
        after?.(result);
      },
      error: (err) => {
        this.action.set(null);
        this.ui.error(err);
      },
    });
  }

  primaryAction(): void {
    const c = this.card();
    if (!c) return;
    switch (c.stage) {
      case 'to_assign':
        this.run('primary', this.production.assign(c.id), (r) => r.message, () => this.loadSuggestion());
        break;
      case 'cutting':
        this.run('primary', this.production.move(c.id, 'stitching', null, null), (r) => r.message);
        break;
      case 'stitching':
        this.run('primary', this.production.move(c.id, 'qc', null, null), (r) => r.message);
        break;
      case 'qc':
        if (c.qc_passed) {
          this.openPhotos();
          return;
        }
        if (!this.allChecked()) {
          this.ui.error('Tick every item of the QC checklist first.');
          return;
        }
        this.run('primary', this.production.passQc(c.id), (r) => r.message, () => this.openPhotos(false));
        break;
    }
  }

  primaryLabel(c: Card): string {
    switch (c.stage) {
      case 'to_assign': {
        const s = this.suggestion()?.master;
        return s ? `Assign to ${masterLabel(s.name)}` : 'Assign to suggested master';
      }
      case 'cutting':
        return 'Cutting done → send to stitching';
      case 'stitching':
        return 'Stitching done → send to QC';
      case 'qc':
        return c.qc_passed ? (this.approvalStatus() === 'pending' ? 'Resend photos' : 'Send photos to the customer') : 'QC passed · send photos';
      default:
        return '';
    }
  }

  async needsFixing(): Promise<void> {
    const c = this.card();
    if (!c || this.action()) return;
    const res = await this.ui.confirmNote({
      title: 'Send back to the tailor?',
      message: 'The job card goes back to Stitching with your note.',
      confirmText: 'Send back',
      danger: true,
      input: { label: 'What needs fixing?', placeholder: 'e.g. Sleeve length is 1" short on the left side', required: true, multiline: true },
    });
    if (!res || (!res.text.trim() && !res.audio)) return;
    this.run('fail', this.production.failQc(c.id, res.text.trim(), voicePayload(res.audio)), (r) => r.message);
  }

  async askCustomer(): Promise<void> {
    const c = this.card();
    if (!c || this.action()) return;
    const message = await this.askText({
      title: 'Ask the customer',
      message: `${c.order?.customer_name || 'The customer'} gets a notification and the question shows in their order timeline.`,
      confirmText: 'Send question',
      input: { label: 'Your question', placeholder: 'e.g. Should the sleeves have the lace border from the dupatta?', required: true, multiline: true },
    });
    if (!message?.trim()) return;
    this.run('ask', this.production.askCustomer(c.id, message.trim()), (r) => r.message || 'Question sent to the customer.');
  }

  /** UiService.confirm with an input resolves to the entered text (null when cancelled). */
  private async askText(options: ConfirmOptions & { input: NonNullable<ConfirmOptions['input']> }): Promise<string | null> {
    const result: unknown = await this.ui.confirm(options);
    return typeof result === 'string' ? result : null;
  }

  print(): void {
    window.print();
  }

  // ───────── Team, due date, rush ─────────

  patch(body: CardPatch): void {
    const c = this.card();
    if (!c) return;
    this.run('patch', this.production.update(c.id, body), (r) => r.message);
  }

  onMasterChange(value: string): void {
    const c = this.card();
    if (!c || (value || null) === c.master_id) return;
    this.patch({ master_id: value || null });
  }

  onTailorChange(value: string): void {
    const c = this.card();
    if (!c || (value || null) === c.tailor_id) return;
    this.patch({ tailor_id: value || null });
  }

  onDueChange(value: string): void {
    const c = this.card();
    if (!c || (value || null) === (c.due_date ? c.due_date.slice(0, 10) : null)) return;
    this.patch({ due_date: value || null });
  }

  onRushChange(checked: boolean): void {
    this.patch({ priority: checked ? 'rush' : 'normal' });
  }

  // ───────── QC checklist (optimistic) ─────────

  toggleItem(key: string, checked: boolean): void {
    const c = this.card();
    if (!c) return;
    const before = this.checklist();
    this.checklist.set({ ...before, [key]: checked });
    this.savingItem.set(key);
    this.production.updateChecklist(c.id, { [key]: checked }).subscribe({
      next: (r) => {
        this.savingItem.set(null);
        if (r?.qc_checklist) this.checklist.set({ ...r.qc_checklist });
      },
      error: (err) => {
        this.savingItem.set(null);
        this.checklist.set({ ...before });
        this.ui.error(err);
      },
    });
  }

  // ───────── Photos for the customer ─────────

  openPhotos(pick = true): void {
    this.uploads.set([]);
    this.photoModal.set(true);
    if (pick) this.pickFiles();
  }

  closePhotos(): void {
    if (this.action() === 'send') return;
    this.photoModal.set(false);
    this.uploads.set([]);
  }

  pickFiles(): void {
    this.fileInput()?.nativeElement.click();
  }

  async onFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length) return;
    if (!this.photoModal()) this.photoModal.set(true);

    const room = MAX_UPLOADS - this.uploads().length;
    if (room <= 0) {
      this.ui.error(`You can send up to ${MAX_UPLOADS} files at a time.`);
      return;
    }
    if (files.length > room) this.ui.info(`Only the first ${room} file(s) were added (max ${MAX_UPLOADS}).`);

    this.preparing.set(true);
    for (const file of files.slice(0, room)) {
      try {
        const prepared = await prepareUpload(file);
        this.uploads.update((list) => [...list, prepared]);
      } catch (err) {
        this.ui.error(err);
      }
    }
    this.preparing.set(false);
  }

  removeUpload(index: number): void {
    this.uploads.update((list) => list.filter((_, i) => i !== index));
  }

  sendPhotos(): void {
    const c = this.card();
    const files = this.uploads();
    if (!c || !files.length) return;
    this.run(
      'send',
      this.production.requestCardApproval(c.id, files.map(({ name, dataUrl }) => ({ name, dataUrl }))),
      (r) => r.message || 'Photos sent to the customer.',
      () => {
        this.photoModal.set(false);
        this.uploads.set([]);
      }
    );
  }

  // ───────── Comments ─────────

  addComment(): void {
    const c = this.card();
    const body = this.commentText().trim();
    const audio = this.commentAudio();
    if (!c || (!body && !audio) || this.voiceBusy() || this.action()) return;
    this.action.set('comment');
    this.production.addComment(c.id, body, voicePayload(audio)).subscribe({
      next: (row) => {
        this.action.set(null);
        this.commentText.set('');
        this.commentAudio.set(null);
        this.card.update((cur) =>
          cur && cur.id === c.id
            ? { ...cur, activity: [row, ...(cur.activity || [])], comments_count: (cur.comments_count || 0) + 1 }
            : cur
        );
      },
      error: (err) => {
        this.action.set(null);
        this.ui.error(err);
      },
    });
  }

  onCommentKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.addComment();
    }
  }

  // ───────── Misc ─────────

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.lightbox()) this.lightbox.set(null);
    else if (this.photoModal()) this.closePhotos();
  }

  back(): void {
    this.router.navigate(['/partner/production']);
  }

  readonly stages = PRODUCTION_STAGES;
}

function humanizeKey(key: string): string {
  const s = key.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function placeholderMember(id: string, name: string, role: 'master' | 'tailor'): Member {
  return { id, name, role, master_id: null, daily_capacity: 0, is_active: false, assigned: 0, load_pct: 0, load_status: 'free' };
}
