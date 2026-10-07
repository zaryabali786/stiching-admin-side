import { Component, DestroyRef, ElementRef, HostListener, OnDestroy, inject, input, model, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IonSpinner } from '@ionic/angular';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { apiErrorMessage } from '../../../core/services/api.service';
import { CatalogueService, LookupRow } from '../../../core/services/catalogue.service';

export interface CourierRef {
  id: string;
  name: string;
}

const PAGE_LIMIT = 8;
let nextId = 0;

/**
 * Searchable dropdown of the managed couriers (Catalogue > Couriers). Search and paging run on the server.
 *   <app-courier-select [(selected)]="courier" />
 * The list floats above the page, anchored under the button (it is moved to <body> while open), so it never changes the
 * height of a modal or drawer and is never clipped by their scroll areas.
 */
@Component({
  selector: 'app-courier-select',
  standalone: true,
  imports: [RouterLink, IonSpinner],
  template: `
    <div class="cs">
      <div class="cs-row" #anchor>
        <button type="button" class="cs-btn" [class.placeholder]="!selected()" [attr.aria-expanded]="open()" [attr.aria-controls]="uid + '-list'" aria-haspopup="listbox"
          [disabled]="disabled()" (click)="toggle()" [attr.aria-label]="label() + ': ' + (selected()?.name || 'none chosen')">
          <span class="cs-text">{{ selected()?.name || placeholder() }}</span>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" class="chev" [class.up]="open()"><path fill="currentColor" d="m7 10 5 5 5-5H7Z"/></svg>
        </button>
        @if (selected() && !disabled()) {
          <button type="button" class="cs-clear" (click)="clear()" aria-label="Clear the chosen courier">×</button>
        }
      </div>

      @if (open()) {
        <div class="cs-panel" [id]="uid + '-panel'">
          <div class="cs-search">
            <input type="search" class="input" [value]="term()" placeholder="Search couriers…" aria-label="Search couriers" (input)="onSearch($any($event.target).value)" (keydown.escape)="close()" #box />
          </div>

          @if (loading() && !items().length) {
            <div class="cs-skel" aria-hidden="true">@for (i of [1, 2, 3]; track i) { <span class="skeleton"></span> }</div>
          } @else if (error()) {
            <div class="cs-state err" role="alert">
              <p>{{ error() }}</p>
              <button type="button" class="btn btn-sm" (click)="reload()">Try again</button>
            </div>
          } @else if (!items().length) {
            <div class="cs-state">
              @if (term()) {
                <p>No courier matches “{{ term() }}”.</p>
              } @else {
                <p>No couriers yet. Add one under <a routerLink="/partner/couriers">Catalogue → Couriers</a>.</p>
              }
            </div>
          } @else {
            <ul class="cs-list" role="listbox" [id]="uid + '-list'" [attr.aria-label]="label()">
              @for (c of items(); track c.id) {
                <li role="presentation">
                  <button type="button" role="option" class="cs-opt" [class.on]="selected()?.id === c.id" [attr.aria-selected]="selected()?.id === c.id" (click)="choose(c)">
                    <span>{{ c.name }}</span>
                    @if (c.requires_tracking === false) { <span class="cs-sub">no tracking number needed</span> }
                  </button>
                </li>
              }
            </ul>
            @if (hasMore()) {
              <div class="cs-more">
                <button type="button" class="btn btn-sm" [disabled]="loading()" (click)="loadMore()">
                  @if (loading()) { <ion-spinner name="crescent" /> } Load more
                </button>
              </div>
            }
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .cs-row { display: flex; align-items: center; gap: 6px; }
    .cs-btn { flex: 1; min-width: 0; min-height: 40px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 12px; border: 1px solid var(--c-line); border-radius: 10px; background: var(--c-surface); color: var(--c-ink); font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
    .cs-btn.placeholder { color: var(--c-faint); }
    .cs-btn:hover:not(:disabled) { border-color: var(--c-line-hover); }
    .cs-btn:focus-visible { outline: none; border-color: var(--c-green); box-shadow: var(--focus-ring); }
    .cs-btn:disabled { background: var(--c-bg-soft); color: var(--c-muted); cursor: not-allowed; }
    .cs-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chev { flex-shrink: 0; transition: transform .15s; } .chev.up { transform: rotate(180deg); }
    .cs-clear { flex-shrink: 0; width: 40px; height: 40px; border: none; border-radius: 50%; background: transparent; color: var(--c-muted); font-size: 20px; cursor: pointer; }
    .cs-clear:hover { background: var(--c-line-soft); } .cs-clear:focus-visible { outline: none; box-shadow: var(--focus-ring); }
    .cs-panel { border: 1px solid var(--c-line); border-radius: 12px; background: var(--c-surface); box-shadow: var(--shadow-lg); overflow: hidden; }
    .cs-search { padding: 8px; border-bottom: 1px solid var(--c-line-soft); }
    .cs-list { list-style: none; margin: 0; padding: 4px; max-height: 240px; overflow-y: auto; flex: 1 1 auto; min-height: 0; }
    .cs-opt { width: 100%; min-height: 40px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 1px; padding: 6px 10px; border: none; border-radius: 8px; background: transparent; font: inherit; font-size: 14px; color: var(--c-ink); text-align: left; cursor: pointer; }
    .cs-opt:hover { background: var(--c-bg-soft); } .cs-opt:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--c-green); }
    .cs-opt.on { background: var(--c-green-soft); font-weight: 600; }
    .cs-sub { font-size: 11.5px; color: var(--c-muted); font-weight: 400; }
    .cs-state { padding: 16px; text-align: center; font-size: 13px; color: var(--c-muted); }
    .cs-state p { margin: 0 0 8px; } .cs-state.err p { color: var(--c-red); } .cs-state a { color: var(--c-green); font-weight: 600; }
    .cs-skel { display: flex; flex-direction: column; gap: 6px; padding: 10px; } .cs-skel .skeleton { height: 36px; }
    .cs-more { display: flex; justify-content: center; padding: 6px 8px 10px; }
  `],
})
export class CourierSelectComponent implements OnDestroy {
  /** The chosen courier (two-way). */
  readonly selected = model<CourierRef | null>(null);
  readonly label = input('Courier');
  readonly placeholder = input('Choose a courier');
  readonly disabled = input(false);

  private catalogue = inject(CatalogueService);
  private host = inject(ElementRef<HTMLElement>);
  private destroyRef = inject(DestroyRef);
  readonly uid = `cs${++nextId}`;

  readonly open = signal(false);
  readonly term = signal('');
  readonly items = signal<LookupRow[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly hasMore = signal(false);
  private page = 1;
  private reqId = 0;
  private search$ = new Subject<string>();

  constructor() {
    this.search$.pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef)).subscribe((t) => {
      this.term.set(t);
      this.load(true);
    });
  }

  private panelEl: HTMLElement | null = null;
  private readonly reposition = () => this.place();

  toggle(): void {
    if (this.open()) return this.close();
    this.open.set(true);
    if (!this.items().length) this.load(true);
    // once the panel is rendered: lift it out of the modal (so it cannot stretch or be clipped by it) and anchor it
    setTimeout(() => {
      this.panelEl = (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>('.cs-panel');
      if (this.panelEl) {
        document.body.appendChild(this.panelEl);
        this.place();
        window.addEventListener('resize', this.reposition);
        window.addEventListener('scroll', this.reposition, true);
      }
      this.panelEl?.querySelector<HTMLInputElement>('input[type=search]')?.focus();
    }, 0);
  }

  close(): void {
    this.open.set(false);
    this.release();
  }

  ngOnDestroy(): void {
    this.release();
  }

  private release(): void {
    window.removeEventListener('resize', this.reposition);
    window.removeEventListener('scroll', this.reposition, true);
    this.panelEl?.remove();
    this.panelEl = null;
  }

  /** Under the button, or above it when there is not enough room below. */
  private place(): void {
    const panel = this.panelEl;
    const anchor = (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>('.cs-row');
    if (!panel || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const above = r.top;
    const flip = below < 320 && above > below;
    Object.assign(panel.style, {
      position: 'fixed',
      zIndex: '2000',
      left: `${r.left}px`,
      width: `${r.width}px`,
      top: flip ? 'auto' : `${r.bottom + 6}px`,
      bottom: flip ? `${window.innerHeight - r.top + 6}px` : 'auto',
      maxHeight: `${Math.max(180, (flip ? above : below) - 16)}px`,
      display: 'flex',
      flexDirection: 'column',
    });
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent): void {
    const t = e.target as Node;
    if (this.open() && !(this.host.nativeElement as HTMLElement).contains(t) && !this.panelEl?.contains(t)) this.close();
  }

  onSearch(v: string): void {
    this.search$.next(v.trim());
  }

  choose(c: LookupRow): void {
    this.selected.set({ id: c.id, name: c.name });
    this.close();
  }

  clear(): void {
    this.selected.set(null);
  }

  reload(): void {
    this.load(true);
  }

  loadMore(): void {
    if (!this.loading() && this.hasMore()) this.load(false);
  }

  /** Server-side search and paging: only active couriers, 8 at a time. */
  private load(reset: boolean): void {
    const token = ++this.reqId;
    if (reset) {
      this.page = 1;
      this.error.set(null);
    }
    this.loading.set(true);
    this.catalogue.listLookup('couriers', { status: 'active', search: this.term(), page: reset ? 1 : this.page + 1, limit: PAGE_LIMIT, sort: 'name', dir: 'asc' }).subscribe({
      next: ({ items, meta }) => {
        if (token !== this.reqId) return;
        this.page = meta.page || (reset ? 1 : this.page + 1);
        this.items.update((cur) => (reset ? items : [...cur, ...items.filter((x) => !cur.some((c) => c.id === x.id))]));
        this.hasMore.set(!!meta.hasMore);
        this.loading.set(false);
      },
      error: (err) => {
        if (token !== this.reqId) return;
        this.loading.set(false);
        this.error.set(apiErrorMessage(err, 'Could not load couriers.'));
      },
    });
  }
}
