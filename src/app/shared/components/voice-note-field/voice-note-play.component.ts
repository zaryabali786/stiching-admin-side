import { Component, input } from '@angular/core';
import { VoiceNote } from '../../../core/models/chat.models';
import { VoicePlayerComponent } from '../chat-panel/voice-player.component';
import { formatClock } from '../chat-panel/chat.logic';

/**
 * Read-only player for a voice note that sits next to a text note (customer notes, QC notes, issue notes...).
 * Audio cannot be printed, so the printed job card shows "Voice note attached" instead.
 *   <app-voice-note-play [note]="unit.notes_audio" />
 */
@Component({
  selector: 'app-voice-note-play',
  standalone: true,
  imports: [VoicePlayerComponent],
  template: `
    @if (note(); as n) {
      <div class="vnp" role="group" [attr.aria-label]="label()">
        <span class="lbl">{{ label() }}</span>
        @if (n.url) {
          <app-voice-player class="player no-print" [url]="n.url" [duration]="n.duration" [mime]="n.mime" />
        } @else {
          <span class="no-print unavailable">Voice note attached ({{ clock(n.duration) }})</span>
        }
        <span class="print-note">Voice note attached (play it in the app)</span>
      </div>
    }
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .vnp { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 4px 8px 4px 10px; margin-top: 6px; border: 1px solid var(--c-line); border-radius: 12px; background: var(--c-surface); max-width: 460px; }
    .lbl { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--c-muted); }
    .player { flex: 1 1 240px; min-width: 0; }
    .unavailable { font-size: 12.5px; color: var(--c-ink-2); font-weight: 600; }
    .print-note { display: none; font-size: 12px; font-weight: 600; color: #000; }
    @media print {
      .no-print { display: none !important; }
      .print-note { display: inline; }
      .vnp { border: 1px solid #000; background: none; }
    }
  `],
})
export class VoiceNotePlayComponent {
  readonly note = input<VoiceNote | null | undefined>(null);
  readonly label = input('Voice note');
  readonly clock = formatClock;
}
