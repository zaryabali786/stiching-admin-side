/** Thin wrapper over MediaRecorder with friendly errors and a live level meter. No Angular here. */

/** Formats that play on the most devices first: AAC in mp4 plays on iPhones and everywhere else; WebM/Opus only on newer Safari. */
const MIME_CANDIDATES = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

/** Peak (0..1) below which the clip counts as silence. Quiet speech peaks far higher than this. */
export const SILENCE_PEAK = 0.03;
export const SILENCE_MESSAGE = "We couldn't hear anything. Check that the right microphone is selected and not muted, then try again.";

export interface Recording {
  blob: Blob;
  /** Seconds, measured from start to stop (webm clips carry no duration metadata). */
  duration: number;
  mime: string;
  /** Loudest moment (0..1), or null when the browser cannot meter the microphone. */
  peak: number | null;
}

export class VoiceError extends Error {}

export function isSilent(clip: { peak: number | null }): boolean {
  return clip.peak !== null && clip.peak < SILENCE_PEAK;
}

/** Best supported mime in the preferred order; null when MediaRecorder is missing, '' when none is listed (browser default). */
export function bestAudioMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
}

export function voiceSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

function friendly(err: unknown): VoiceError {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return new VoiceError('Microphone access is blocked. Allow the microphone for this site in your browser settings, then try again.');
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return new VoiceError('No microphone was found. Connect one and try again.');
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return new VoiceError('The microphone is busy or unavailable. Close other apps that use it and try again.');
  }
  return new VoiceError('Could not start recording. Please try again.');
}

export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private result: Promise<Recording> | null = null;

  // level meter (Web Audio)
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private samples: Uint8Array<ArrayBuffer> | null = null;
  private raf = 0;
  /** Current loudness 0..1 (updated while recording). */
  level = 0;
  /** Loudest moment so far (0..1). */
  peak = 0;
  /** False when the browser cannot meter (then silence cannot be detected and nothing is blocked). */
  metered = false;

  /** Ask for the microphone and start recording. Throws VoiceError with a user-readable message. */
  async start(): Promise<void> {
    if (!voiceSupported()) throw new VoiceError('Voice messages are not supported in this browser. Try a recent Chrome, Edge, Firefox or Safari over https.');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      throw friendly(err);
    }
    try {
      const mime = bestAudioMime();
      this.recorder = mime ? new MediaRecorder(this.stream, { mimeType: mime }) : new MediaRecorder(this.stream);
      this.chunks = [];
      this.recorder.ondataavailable = (e) => {
        if (e.data?.size) this.chunks.push(e.data);
      };
      this.recorder.start(250);
      this.startedAt = performance.now();
      this.startMeter();
    } catch (err) {
      this.release();
      throw friendly(err);
    }
  }

  /** Stop and return the clip (safe to call twice: the same result is returned). */
  finish(): Promise<Recording> {
    if (this.result) return this.result;
    const recorder = this.recorder;
    if (!recorder) return Promise.reject(new VoiceError('Nothing was recorded.'));
    this.result = new Promise<Recording>((resolve, reject) => {
      const duration = (performance.now() - this.startedAt) / 1000;
      recorder.onstop = () => {
        const mime = recorder.mimeType || this.chunks[0]?.type || 'audio/mp4';
        const blob = new Blob(this.chunks, { type: mime });
        const peak = this.metered ? this.peak : null;
        this.release();
        if (!blob.size) reject(new VoiceError('The recording was empty. Please try again.'));
        else resolve({ blob, duration, mime, peak });
      };
      recorder.onerror = () => {
        this.release();
        reject(new VoiceError('Recording failed. Please try again.'));
      };
      if (recorder.state !== 'inactive') recorder.stop();
      else recorder.onstop?.(new Event('stop'));
    });
    return this.result;
  }

  /** Throw the clip away. */
  cancel(): void {
    const r = this.recorder;
    if (r) {
      r.ondataavailable = null;
      r.onstop = null;
      r.onerror = null;
      if (r.state !== 'inactive') {
        try {
          r.stop();
        } catch {
          /* already stopped */
        }
      }
    }
    this.release();
    this.chunks = [];
    this.result = null;
    this.recorder = null;
  }

  private startMeter(): void {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx || !this.stream) return;
      this.ctx = new Ctx();
      void this.ctx.resume?.();
      const source = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      source.connect(this.analyser);
      this.samples = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
      this.metered = true;
      const tick = () => {
        if (!this.analyser || !this.samples) return;
        this.analyser.getByteTimeDomainData(this.samples);
        let max = 0;
        for (let i = 0; i < this.samples.length; i++) max = Math.max(max, Math.abs(this.samples[i] - 128) / 128);
        this.level = max;
        if (max > this.peak) this.peak = max;
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    } catch {
      this.metered = false; // no meter: recording still works, silence just cannot be detected
    }
  }

  private release(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.analyser = null;
    void this.ctx?.close?.().catch(() => undefined);
    this.ctx = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the recording.'));
    reader.readAsDataURL(blob);
  });
}
