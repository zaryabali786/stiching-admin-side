import { Component, DestroyRef, ElementRef, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { IonSpinner } from '@ionic/angular';
import jsQR from 'jsqr';

const SAME_CODE_PAUSE_MS = 3000;

/**
 * The phone / tablet camera as a QR reader. It starts when `active` turns on and stops when it turns off (or the screen is
 * left), and emits what each code says. The same code is reported once, then ignored for a few seconds, because the camera
 * sees it in many frames in a row.
 */
@Component({
  selector: 'app-qr-scanner',
  standalone: true,
  imports: [IonSpinner],
  template: `
    <div class="camera" [class.off]="!on()">
      <video #video playsinline muted></video>
      <div class="frame" aria-hidden="true"></div>
      @if (!on()) {
        <div class="cam-msg">
          @if (error()) { <p>{{ error() }}</p> }
          <button type="button" class="btn btn-primary" (click)="start()">Start camera</button>
        </div>
      }
      @if (busy()) { <div class="cam-busy"><ion-spinner name="crescent" /></div> }
    </div>
  `,
  styles: `
    :host { display: block; }
    .camera { position: relative; aspect-ratio: 4 / 3; max-height: 46vh; width: 100%; border-radius: 16px; overflow: hidden; background: #111; }
    .camera video { width: 100%; height: 100%; object-fit: cover; display: block; }
    .camera.off video { visibility: hidden; }
    .frame { position: absolute; inset: 18%; border: 3px solid rgba(255, 255, 255, 0.85); border-radius: 18px; box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.28); pointer-events: none; }
    .cam-msg { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 20px; text-align: center; color: #fff; background: rgba(0, 0, 0, 0.7); }
    .cam-msg p { margin: 0; max-width: 32ch; }
    .cam-busy { position: absolute; top: 10px; right: 10px; background: rgba(0, 0, 0, 0.55); color: #fff; border-radius: 999px; padding: 8px; display: flex; }
    @media (max-width: 640px) { .camera { max-height: 38vh; } }
  `,
})
export class QrScannerComponent {
  private destroyRef = inject(DestroyRef);

  /** The camera runs while this is true. */
  readonly active = input(false);
  /** While the last code is being handled new codes are ignored. */
  readonly busy = input(false);
  readonly scanned = output<string>();

  private video = viewChild<ElementRef<HTMLVideoElement>>('video');
  readonly on = signal(false);
  readonly error = signal<string | null>(null);

  private stream: MediaStream | null = null;
  private raf = 0;
  private canvas = document.createElement('canvas');
  private lastCode = '';
  private lastAt = 0;

  constructor() {
    effect(() => {
      if (this.active()) untracked(() => setTimeout(() => void this.start(), 60)); // wait for the <video> element
      else untracked(() => this.stop());
    });
    this.destroyRef.onDestroy(() => this.stop());
  }

  async start(): Promise<void> {
    this.error.set(null);
    const el = this.video()?.nativeElement;
    if (!el || this.stream) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.error.set('This device cannot open the camera here. Type the code instead.');
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      el.srcObject = this.stream;
      await el.play();
      this.on.set(true);
      this.tick();
    } catch {
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.on.set(false);
      this.error.set('The camera could not be opened. Allow camera access, or type the code instead.');
    }
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.on.set(false);
  }

  private tick = (): void => {
    const el = this.video()?.nativeElement;
    if (!el || !this.stream) return;
    if (el.readyState >= 2 && el.videoWidth) {
      const w = Math.min(640, el.videoWidth);
      const h = Math.round((el.videoHeight / el.videoWidth) * w);
      this.canvas.width = w;
      this.canvas.height = h;
      const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(el, 0, 0, w, h);
        const hit = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
        if (hit?.data) this.report(hit.data.trim());
      }
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private report(code: string): void {
    const now = Date.now();
    if (!code || this.busy() || (code === this.lastCode && now - this.lastAt < SAME_CODE_PAUSE_MS)) return;
    this.lastCode = code;
    this.lastAt = now;
    this.scanned.emit(code);
  }
}
