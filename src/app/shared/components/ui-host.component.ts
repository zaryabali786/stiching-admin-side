import { Component, effect, inject, signal } from '@angular/core';
import { VoiceNote } from '../../core/models/chat.models';
import { UiService } from '../../core/services/ui.service';
import { VoiceNoteFieldComponent } from './voice-note-field/voice-note-field.component';

/** Renders toasts and the confirm dialog. Placed once in each portal layout. */
@Component({
  selector: 'app-ui-host',
  standalone: true,
  imports: [VoiceNoteFieldComponent],
  template: `
    <div class="toast-stack" aria-live="polite">
      @for (t of ui.toasts(); track t.id) {
        <div class="toast" [class]="'toast ' + t.kind" role="status">
          <span class="dot"></span>
          <span class="msg">{{ t.message }}</span>
          <button type="button" (click)="ui.dismiss(t.id)" aria-label="Dismiss">×</button>
        </div>
      }
    </div>

    @if (ui.confirmState(); as c) {
      <div class="modal-backdrop" (click)="ui.closeConfirm(false)">
        <div class="modal" role="dialog" aria-modal="true" (click)="$event.stopPropagation()">
          <div class="modal-head"><h3>{{ c.title }}</h3></div>
          <div class="modal-body">
            @if (c.message) { <p class="confirm-msg">{{ c.message }}</p> }
            @if (c.input) {
              <div class="field">
                <label>{{ c.input.label }}</label>
                @if (c.input.multiline) {
                  <textarea class="textarea" [placeholder]="c.input.placeholder || ''" [value]="text()" (input)="text.set($any($event.target).value)"></textarea>
                } @else {
                  <input class="input" [placeholder]="c.input.placeholder || ''" [value]="text()" (input)="text.set($any($event.target).value)" (keydown.enter)="submit()" />
                }
                @if (c.input.voice) { <app-voice-note-field class="vn" [(value)]="audio" [(pending)]="voiceBusy" /> }
              </div>
            }
          </div>
          <div class="modal-foot">
            <button type="button" class="btn btn-ghost" (click)="ui.closeConfirm(false)">{{ c.cancelText || 'Cancel' }}</button>
            <button type="button" class="btn" [class.btn-danger]="c.danger" [class.btn-primary]="!c.danger"
              [disabled]="voiceBusy() || (!!c.input?.required && !text().trim() && !audio())" (click)="submit()">{{ c.confirmText || 'Confirm' }}</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .toast-stack { position: fixed; top: 16px; right: 16px; z-index: 2000; display: flex; flex-direction: column; gap: 8px; max-width: min(420px, calc(100vw - 32px)); }
    .toast { display: flex; align-items: flex-start; gap: 10px; background: var(--c-dark); color: #fff; padding: 12px 14px; border-radius: 12px; box-shadow: var(--shadow-lg); font-size: 13px; animation: popIn .2s ease both; }
    .toast .dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; flex-shrink: 0; background: #7FD3A8; }
    .toast.error .dot { background: #F08A78; }
    .toast.info .dot { background: var(--c-gold); }
    .toast .msg { flex: 1; line-height: 1.4; }
    .toast button { background: none; border: none; color: rgba(255,255,255,.6); font-size: 18px; line-height: 1; cursor: pointer; padding: 0; }
    .vn { margin-top: 8px; }
    .confirm-msg { margin: 0 0 8px; color: var(--c-ink-2); line-height: 1.5; font-size: 13.5px; }
  `],
})
export class UiHostComponent {
  readonly ui = inject(UiService);
  readonly text = signal('');
  readonly audio = signal<VoiceNote | null>(null);
  readonly voiceBusy = signal(false);

  constructor() {
    effect(() => {
      const c = this.ui.confirmState();
      this.text.set(c?.input?.value || '');
      this.audio.set(null);
      this.voiceBusy.set(false);
    });
  }

  submit(): void {
    const c = this.ui.confirmState();
    if (!c) return;
    if (c.input) {
      if (this.voiceBusy()) return;
      if (c.input.required && !this.text().trim() && !this.audio()) return;
      this.ui.closeConfirm(this.text().trim(), this.audio());
    } else {
      this.ui.closeConfirm(true);
    }
  }
}
