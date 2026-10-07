import { Component, OnDestroy, computed, inject, input, model, signal } from '@angular/core';
import { IonSpinner } from '@ionic/angular';
import { VoiceNote, VoiceUpload } from '../../../core/models/chat.models';
import { ApiService, apiErrorMessage } from '../../../core/services/api.service';
import { MAX_VOICE_SECONDS, MIN_VOICE_SECONDS, formatClock } from '../chat-panel/chat.logic';
import { Recording, SILENCE_MESSAGE, SILENCE_PEAK, VoiceError, VoiceRecorder, blobToDataUrl, isSilent, voiceSupported } from '../chat-panel/voice-recorder';
import { LevelMeterComponent } from '../chat-panel/level-meter.component';
import { VoicePlayerComponent } from '../chat-panel/voice-player.component';

type Phase = 'idle' | 'starting' | 'recording' | 'uploading' | 'failed' | 'silent';

/**
 * A compact voice-note control to put next to a notes box.
 *   <app-voice-note-field [(value)]="audio" [(pending)]="voiceBusy" />
 * `value` is the voice note (stored reference + playable url) or null. `pending` is true while a clip is being
 * recorded or uploaded, so the form can keep its submit button disabled.
 * It can also show an already saved note from the API ({ mime, duration, size, url }, no path).
 */
@Component({
  selector: 'app-voice-note-field',
  standalone: true,
  imports: [IonSpinner, VoicePlayerComponent, LevelMeterComponent],
  template: `
    <div class="vnf">
      @if (warnNoSound()) { <p class="nosound" role="alert">We can't hear you yet. Speak closer to the microphone, or check that it isn't muted.</p> }
      @switch (phase()) {
        @case ('starting') {
          <div class="row" role="status"><ion-spinner name="crescent" /> <span>Waiting for the microphone…</span></div>
        }
        @case ('recording') {
          <div class="row rec" role="group" aria-label="Voice recorder">
            <span class="sr-only" role="status">{{ limitHit() ? 'Maximum length reached' : 'Recording' }}</span>
            <span class="dot" [class.stopped]="limitHit()" aria-hidden="true"></span>
            <span class="time" aria-hidden="true">{{ clock(seconds()) }}<small> / {{ clock(max) }}</small></span>
            <app-level-meter [level]="level()" [quiet]="!heard()" />
            <span class="hint">{{ limitHit() ? 'Maximum length reached' : 'Recording…' }}</span>
            <span class="grow"></span>
            <button type="button" class="btn btn-sm" (click)="cancel()">Cancel</button>
            <button type="button" class="btn btn-sm btn-primary" (click)="stop()">Stop</button>
          </div>
        }
        @case ('silent') {
          <div class="row err" role="alert">
            <span class="msg">{{ silenceMessage }}</span>
            <span class="grow"></span>
            <button type="button" class="btn btn-sm btn-primary" (click)="start()">Record again</button>
            <button type="button" class="btn btn-sm btn-ghost" (click)="discard()">Dismiss</button>
          </div>
        }
        @case ('uploading') {
          <div class="row" role="status"><ion-spinner name="crescent" /> <span>Saving voice note…</span></div>
        }
        @case ('failed') {
          <div class="row err" role="alert">
            <span class="msg">{{ error() }}</span>
            <span class="grow"></span>
            <button type="button" class="btn btn-sm btn-primary" (click)="retry()">Retry</button>
            <button type="button" class="btn btn-sm btn-ghost" (click)="discard()">Discard</button>
          </div>
        }
        @default {
          @if (value(); as v) {
            <div class="row saved">
              @if (v.url) {
                <app-voice-player class="player" [url]="v.url" [duration]="v.duration" [mime]="v.mime" />
              } @else {
                <span class="attached">Voice note attached ({{ clock(v.duration) }})</span>
              }
              <button type="button" class="icon-btn" (click)="rerecord()" [disabled]="!supported" aria-label="Record the voice note again" title="Record again">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V22h2v-3.08A7 7 0 0 0 19 12h-2Z"/></svg>
              </button>
              <button type="button" class="icon-btn danger" (click)="remove()" aria-label="Remove the voice note" title="Remove">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>
              </button>
            </div>
          } @else {
            <button type="button" class="mic-btn" (click)="start()" [disabled]="disabled()" [attr.aria-label]="label()">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V22h2v-3.08A7 7 0 0 0 19 12h-2Z"/></svg>
              <span>{{ label() }}</span>
            </button>
          }
          @if (error()) { <p class="msg err-line" role="alert">{{ error() }}</p> }
        }
      }
    </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .vnf { min-width: 0; }
    .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-height: 44px; font-size: 13px; color: var(--c-ink-2); }
    .row.saved { flex-wrap: nowrap; padding: 4px 6px 4px 8px; border: 1px solid var(--c-line); border-radius: 12px; background: var(--c-bg-soft); }
    .row.rec { padding: 4px 6px 4px 10px; border: 1px solid color-mix(in srgb, var(--c-red) 35%, var(--c-line)); border-radius: 12px; background: var(--c-red-soft); }
    .row.err { padding: 6px 8px 6px 10px; border-radius: 12px; background: var(--c-red-soft); color: var(--c-red); }
    .player { flex: 1; min-width: 0; }
    .attached { flex: 1; font-weight: 600; }
    .grow { flex: 1; }
    .msg { font-weight: 500; line-height: 1.35; }
    .err-line { margin: 4px 0 0; color: var(--c-red); font-size: 12.5px; }
    .mic-btn { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 6px 14px; border: 1px solid var(--c-line); border-radius: 999px; background: var(--c-surface); color: var(--c-ink); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
    .mic-btn svg { color: var(--c-green); }
    .mic-btn:hover:not(:disabled) { border-color: var(--c-ink-2); }
    .mic-btn:focus-visible, .icon-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }
    .mic-btn:disabled { opacity: .5; cursor: not-allowed; }
    .icon-btn { flex-shrink: 0; width: 40px; height: 40px; border: none; border-radius: 50%; background: transparent; color: var(--c-ink-2); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
    .icon-btn:hover:not(:disabled) { background: var(--c-line-soft); }
    .icon-btn.danger { color: var(--c-red); }
    .icon-btn:disabled { opacity: .45; cursor: not-allowed; }
    .dot { width: 11px; height: 11px; border-radius: 50%; background: var(--c-red); animation: pulse 1.2s infinite ease-in-out; flex-shrink: 0; }
    .dot.stopped { animation: none; }
    @keyframes pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(.7); opacity: .55; } }
    .time { font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .time small { font-size: 12px; font-weight: 500; color: var(--c-muted); }
    .hint { font-size: 12.5px; color: var(--c-muted); }
    .nosound { margin: 0 0 6px; padding: 6px 10px; border-radius: 8px; background: var(--c-amber-soft); color: var(--c-ink); font-size: 12.5px; font-weight: 600; }
    @media (max-width: 640px) { .hint { display: none; } }
  `],
})
export class VoiceNoteFieldComponent implements OnDestroy {
  /** The voice note (two-way). */
  readonly value = model<VoiceNote | null>(null);
  /** True while recording or uploading (two-way): keep the submit button disabled. */
  readonly pending = model(false);
  readonly label = input('Voice note');
  readonly disabled = input(false);
  /** Upload endpoint: the partner one by default. */
  readonly uploadPath = input('/partner/voice-upload');

  private api = inject(ApiService);
  readonly phase = signal<Phase>('idle');
  readonly seconds = signal(0);
  readonly limitHit = signal(false);
  readonly error = signal<string | null>(null);
  /** Live microphone level 0..1 and whether any sound was heard yet. */
  readonly level = signal(0);
  readonly heard = signal(false);
  readonly warnNoSound = computed(() => this.phase() === 'recording' && this.seconds() >= 3 && !this.heard() && this.metered());
  private metered = signal(false);
  readonly silenceMessage = SILENCE_MESSAGE;
  readonly supported = voiceSupported();
  readonly max = MAX_VOICE_SECONDS;
  readonly clock = formatClock;
  readonly busy = computed(() => this.phase() !== 'idle');

  private recorder: VoiceRecorder | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private clip: Recording | null = null;

  private setPhase(p: Phase): void {
    this.phase.set(p);
    this.pending.set(p === 'starting' || p === 'recording' || p === 'uploading' || p === 'failed');
    if (p !== 'recording') {
      this.level.set(0);
      this.heard.set(false);
      this.metered.set(false);
    }
  }

  ngOnDestroy(): void {
    this.stopTimer();
    this.recorder?.cancel();
  }

  async start(): Promise<void> {
    if (this.phase() !== 'idle') return;
    this.error.set(null);
    this.limitHit.set(false);
    this.setPhase('starting');
    const recorder = new VoiceRecorder();
    try {
      await recorder.start();
    } catch (err) {
      this.setPhase('idle');
      this.error.set(err instanceof VoiceError ? err.message : 'Could not start recording.');
      return;
    }
    this.recorder = recorder;
    this.seconds.set(0);
    this.setPhase('recording');
    this.metered.set(recorder.metered);
    const startedAt = Date.now();
    this.timer = setInterval(() => {
      const s = (Date.now() - startedAt) / 1000;
      this.level.set(recorder.level);
      if (recorder.peak >= SILENCE_PEAK) this.heard.set(true);
      if (s >= MAX_VOICE_SECONDS) {
        this.seconds.set(MAX_VOICE_SECONDS);
        this.stopTimer();
        this.limitHit.set(true);
        void this.stop(); // 5 minutes reached: stop and save
      } else {
        this.seconds.set(s);
      }
    }, 100);
  }

  rerecord(): void {
    void this.start();
  }

  cancel(): void {
    this.stopTimer();
    this.recorder?.cancel();
    this.recorder = null;
    this.limitHit.set(false);
    this.setPhase('idle');
  }

  async stop(): Promise<void> {
    const recorder = this.recorder;
    if (!recorder || this.phase() !== 'recording') return;
    this.stopTimer();
    this.setPhase('uploading');
    try {
      this.clip = await recorder.finish();
    } catch (err) {
      this.recorder = null;
      this.clip = null;
      this.setPhase('idle');
      this.error.set(err instanceof VoiceError ? err.message : 'The recording failed. Please try again.');
      return;
    }
    this.recorder = null;
    this.limitHit.set(false);
    if (isSilent(this.clip)) {
      // nothing was heard: do not upload, ask to record again
      this.clip = null;
      this.setPhase('silent');
      return;
    }
    if (this.clip.duration < MIN_VOICE_SECONDS) {
      this.clip = null;
      this.setPhase('idle');
      this.error.set('That was too short. Record at least a second, then press Stop.');
      return;
    }
    await this.upload();
  }

  retry(): void {
    void this.upload();
  }

  /** Give up on a failed upload and keep whatever note was there before. */
  discard(): void {
    this.clip = null;
    this.error.set(null);
    this.setPhase('idle');
  }

  remove(): void {
    this.error.set(null);
    this.value.set(null);
  }

  private async upload(): Promise<void> {
    const clip = this.clip;
    if (!clip) return;
    this.error.set(null);
    this.setPhase('uploading');
    const duration = Math.min(clip.duration, MAX_VOICE_SECONDS);
    try {
      const dataUrl = await blobToDataUrl(clip.blob);
      const up = await new Promise<VoiceUpload>((resolve, reject) =>
        this.api.post<VoiceUpload>(this.uploadPath(), { audio: { dataUrl, duration } }).subscribe({ next: resolve, error: reject })
      );
      this.value.set({ path: up.path, duration: up.duration, mime: up.mime, size: up.size, url: up.url });
      this.clip = null;
      this.setPhase('idle');
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'The voice note could not be saved.'));
      this.setPhase('failed');
    }
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
