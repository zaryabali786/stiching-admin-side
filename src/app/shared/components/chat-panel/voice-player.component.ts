import { Component, ElementRef, computed, effect, input, output, signal, untracked, viewChild } from '@angular/core';
import { formatClock } from './chat.logic';

/** True when this browser can play the mime type (or when the type is unknown). */
export function canPlayMime(mime: string | null | undefined): boolean {
  if (!mime || typeof document === 'undefined') return true;
  const audio = document.createElement('audio');
  if (!audio.canPlayType) return true;
  return audio.canPlayType(mime) !== '' || audio.canPlayType(mime.split(';')[0]) !== '';
}

const RATES = [1, 1.5, 2];

/**
 * Accessible audio player for voice messages: play/pause, seek bar, elapsed/total and 1x/1.5x/2x speed.
 * `duration` comes from the message (recorded clips have no usable metadata); `url` is a signed link.
 */
@Component({
  selector: 'app-voice-player',
  standalone: true,
  template: `
    <div class="vp" [class.mine]="mine()" role="group" aria-label="Voice message">
      <audio #audio [src]="url()" preload="metadata" (timeupdate)="onTime()" (ended)="onEnded()" (pause)="playing.set(false)" (play)="playing.set(true)" (error)="onError()" (loadedmetadata)="onMeta()"></audio>
      @if (!supported()) {
        <span class="vp-broken" role="alert">This device can't play this voice message format.</span>
      } @else if (broken()) {
        <span class="vp-broken" role="alert">{{ problem() }}</span>
        <button type="button" class="vp-rate" (click)="retry()">Retry</button>
      } @else {
        <button type="button" class="vp-play" (click)="toggle()" [attr.aria-label]="playing() ? 'Pause voice message' : 'Play voice message'">
          @if (playing()) {
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z"/></svg>
          } @else {
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7L8 5Z"/></svg>
          }
        </button>
        <div class="vp-main">
          <input type="range" class="vp-seek" min="0" [max]="total()" step="0.1" [value]="current()"
            (input)="seek($any($event.target).value)" aria-label="Seek voice message" [attr.aria-valuetext]="clock(current()) + ' of ' + clock(total())" />
          <span class="vp-time" aria-hidden="true">{{ clock(current()) }} / {{ clock(total()) }}</span>
        </div>
        <button type="button" class="vp-rate" (click)="cycleRate()" [attr.aria-label]="'Playback speed ' + rate() + 'x. Press to change.'">{{ rate() }}x</button>
      }
    </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .vp { display: flex; align-items: center; gap: 10px; min-width: 220px; max-width: 100%; }
    audio { display: none; }
    .vp-play { flex-shrink: 0; width: 40px; height: 40px; border-radius: 50%; border: none; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; background: var(--c-dark-2); color: #fff; }
    .vp.mine .vp-play { background: #fff; color: var(--c-dark-2); }
    .vp-play:focus-visible, .vp-rate:focus-visible { outline: 2px solid var(--c-green); outline-offset: 2px; }
    .vp.mine .vp-play:focus-visible, .vp.mine .vp-rate:focus-visible { outline-color: #fff; }
    .vp-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .vp-seek { width: 100%; height: 20px; margin: 0; accent-color: var(--c-green); cursor: pointer; }
    .vp.mine .vp-seek { accent-color: #fff; }
    .vp-time { font-size: 11.5px; font-variant-numeric: tabular-nums; color: var(--c-muted); }
    .vp.mine .vp-time { color: rgba(255, 255, 255, .85); }
    .vp-rate { flex-shrink: 0; min-width: 44px; height: 32px; padding: 0 8px; border-radius: 999px; border: 1px solid var(--c-line); background: var(--c-surface); color: var(--c-ink); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
    .vp.mine .vp-rate { background: transparent; border-color: rgba(255, 255, 255, .5); color: #fff; }
    .vp-broken { flex: 1; font-size: 12.5px; color: var(--c-red); }
    .vp.mine .vp-broken { color: #fff; }
    @media (max-width: 640px) { .vp-rate { height: 40px; } .vp { min-width: 0; } }
  `],
})
export class VoicePlayerComponent {
  readonly url = input.required<string>();
  readonly duration = input<number>(0);
  readonly mine = input(false);
  /** The clip's mime type (e.g. audio/webm;codecs=opus): checked against what this browser can play. */
  readonly mime = input<string | null | undefined>(null);
  /** The signed link failed to load (probably expired): the panel reloads history to get new links. */
  readonly failed = output<void>();

  private audio = viewChild.required<ElementRef<HTMLAudioElement>>('audio');
  readonly playing = signal(false);
  readonly current = signal(0);
  readonly rate = signal(1);
  readonly broken = signal(false);
  readonly problem = signal("This voice message can't be played.");
  /** False when the browser cannot decode this format at all (older Safari / iOS and WebM). */
  readonly supported = computed(() => canPlayMime(this.mime()));
  private metaDuration = signal(0);
  readonly total = computed(() => this.duration() || this.metaDuration() || 0);
  readonly clock = formatClock;

  constructor() {
    // a refreshed signed link replaces a broken one
    effect(() => {
      this.url();
      untracked(() => this.broken.set(false));
    });
  }

  toggle(): void {
    const el = this.audio().nativeElement;
    if (el.paused) {
      el.playbackRate = this.rate();
      void el.play().catch((err: unknown) => this.onPlayRejected(err));
    } else {
      el.pause();
    }
  }

  seek(value: string): void {
    const t = Number(value);
    this.audio().nativeElement.currentTime = t;
    this.current.set(t);
  }

  cycleRate(): void {
    const next = RATES[(RATES.indexOf(this.rate()) + 1) % RATES.length];
    this.rate.set(next);
    this.audio().nativeElement.playbackRate = next;
  }

  onTime(): void {
    this.current.set(this.audio().nativeElement.currentTime);
  }

  onMeta(): void {
    const d = this.audio().nativeElement.duration;
    if (Number.isFinite(d) && d > 0) this.metaDuration.set(d);
  }

  onEnded(): void {
    this.playing.set(false);
    this.current.set(0);
  }

  /** play() was refused: say why (unsupported format, or the browser wants another tap). */
  private onPlayRejected(err: unknown): void {
    const name = (err as { name?: string })?.name;
    this.playing.set(false);
    if (name === 'NotAllowedError') {
      this.problem.set('The browser blocked the sound. Tap play again.');
      this.broken.set(true);
      return;
    }
    if (name === 'NotSupportedError') this.problem.set("This device can't play this voice message format.");
    else this.problem.set("This voice message can't be played.");
    this.broken.set(true);
    this.failed.emit();
  }

  onError(): void {
    this.playing.set(false);
    this.problem.set("This voice message can't be played. The link may have expired.");
    this.broken.set(true);
    this.failed.emit();
  }

  retry(): void {
    this.broken.set(false);
    const el = this.audio().nativeElement;
    el.load();
  }
}
