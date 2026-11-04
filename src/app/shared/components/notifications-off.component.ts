import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { openAppSettings } from '../../core/services/native-permissions';
import { PushService } from '../../core/services/push.service';

/**
 * Shown in the phone app (never on the website) while notifications are switched off for it: without them no order update, payment
 * request or approval reaches the phone. "Turn on" opens the phone's settings; coming back registers the device by itself.
 */
@Component({
  selector: 'app-notifications-off',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (show()) {
      <div class="bar" role="alert">
        <span class="msg">Notifications are off, so you will not get order updates.</span>
        <button type="button" class="on" (click)="open()">Turn on</button>
        <button type="button" class="x" (click)="hidden.set(true)" aria-label="Dismiss">×</button>
      </div>
    }
  `,
  styles: `
    .bar {
      position: fixed;
      z-index: 2000;
      left: 12px;
      right: 12px;
      top: calc(env(safe-area-inset-top, 0px) + 8px);
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 12px;
      background: #111827;
      color: #fff;
      font-size: 13px;
      line-height: 1.35;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    }
    .msg { flex: 1; }
    button { border: 0; font: inherit; cursor: pointer; }
    .on { padding: 7px 12px; border-radius: 99px; background: #fff; color: #62003e; font-weight: 700; }
    .x { background: none; color: #d1d5db; font-size: 20px; line-height: 1; padding: 0 4px; }
  `,
})
export class NotificationsOffComponent {
  private push = inject(PushService);
  protected hidden = signal(false);

  protected show(): boolean {
    return Capacitor.isNativePlatform() && this.push.blocked() && !this.hidden();
  }

  protected open(): void {
    void openAppSettings();
  }
}
