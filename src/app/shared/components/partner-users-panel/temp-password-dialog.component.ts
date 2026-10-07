import { AfterViewInit, Component, ElementRef, input, output, signal, viewChild } from '@angular/core';

/**
 * One-time "share this temporary password" dialog, shown after a login is created or its password is reset.
 * The parent owns the value: closing the dialog (output `closed`) must clear it, so it can never be seen again.
 *
 *   <app-temp-password-dialog [email]="c.email" [password]="c.password" (closed)="credential.set(null)" />
 */
@Component({
  selector: 'app-temp-password-dialog',
  standalone: true,
  template: `
    <div class="modal-backdrop tp-backdrop">
      <div #dialog class="modal" role="alertdialog" aria-modal="true" aria-labelledby="tpTitle" aria-describedby="tpDesc" tabindex="-1">
        <div class="modal-head">
          <div>
            <span class="eyebrow">One-time password</span>
            <h3 id="tpTitle">{{ title() }}</h3>
          </div>
        </div>
        <div class="modal-body">
          <p id="tpDesc" class="tp-warn"><strong>Share this temporary password now. It will not be shown again.</strong></p>

          <dl class="tp-kv">
            @if (name()) {
              <dt>Name</dt>
              <dd>{{ name() }}</dd>
            }
            <dt>Login email</dt>
            <dd>{{ email() }}</dd>
            <dt>Temporary password</dt>
            <dd>
              <span class="tp-row">
                <code #pw class="tp-pw" (click)="selectText()">{{ password() }}</code>
                <button type="button" class="btn btn-sm" (click)="copy()">{{ copied() ? 'Copied' : 'Copy' }}</button>
              </span>
            </dd>
          </dl>
          <span class="sr-only" role="status" aria-live="polite">{{ copied() ? 'Password copied to the clipboard.' : '' }}</span>
          @if (copyFailed()) { <p class="tp-note" role="status">Your browser blocked copying. The password is selected: press Ctrl+C.</p> }

          <p class="tp-note">They must choose their own password the first time they sign in.</p>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-primary" (click)="closed.emit()">Done, I have shared it</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .tp-backdrop { z-index: 1100; }
    .tp-warn { margin: 0 0 14px; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--c-amber-soft); color: var(--c-amber); font-size: 13px; }
    .tp-kv { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 10px 14px; align-items: center; margin: 0 0 12px; font-size: 13px; }
    .tp-kv dt { color: var(--c-muted); }
    .tp-kv dd { margin: 0; font-weight: 500; min-width: 0; overflow-wrap: anywhere; }
    .tp-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .tp-pw { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 16px; font-weight: 600; letter-spacing: .02em; padding: 8px 12px; border-radius: 10px; background: var(--c-bg-soft); border: 1px solid var(--c-line); user-select: all; overflow-wrap: anywhere; }
    .tp-note { margin: 8px 0 0; font-size: 12.5px; color: var(--c-muted); }
    @media (max-width: 640px) { .tp-kv { grid-template-columns: 1fr; gap: 2px; } .tp-kv dt { margin-top: 8px; } }
  `],
})
export class TempPasswordDialogComponent implements AfterViewInit {
  readonly title = input('Temporary password');
  readonly name = input<string | null>(null);
  readonly email = input.required<string>();
  readonly password = input.required<string>();
  readonly closed = output<void>();

  readonly copied = signal(false);
  readonly copyFailed = signal(false);

  private readonly dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');
  private readonly pw = viewChild.required<ElementRef<HTMLElement>>('pw');

  ngAfterViewInit(): void {
    this.dialog().nativeElement.focus();
  }

  async copy(): Promise<void> {
    this.copyFailed.set(false);
    try {
      await navigator.clipboard.writeText(this.password());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2500);
    } catch {
      this.copied.set(false);
      this.copyFailed.set(true);
      this.selectText();
    }
  }

  selectText(): void {
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(this.pw().nativeElement);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}
