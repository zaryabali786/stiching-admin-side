import { Injectable, signal } from '@angular/core';
import { VoiceNote } from '../models/chat.models';
import { apiErrorMessage } from './api.service';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  /** Ask for a text value (e.g. a note); the promise resolves to the text. */
  input?: { label: string; placeholder?: string; required?: boolean; multiline?: boolean; value?: string; voice?: boolean };
}

/** Result of `confirmNote`: the typed text plus an optional voice note. */
export interface NoteResult {
  text: string;
  audio: VoiceNote | null;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: string | boolean | null) => void;
}

/**
 * Toasts and the confirm dialog used across both portals.
 * Rendered once by <app-ui-host> in each layout.
 */
@Injectable({ providedIn: 'root' })
export class UiService {
  readonly toasts = signal<Toast[]>([]);
  readonly confirmState = signal<ConfirmState | null>(null);
  private nextId = 1;

  success(message: string): void {
    this.push('success', message);
  }

  info(message: string): void {
    this.push('info', message);
  }

  error(err: unknown, fallback?: string): void {
    this.push('error', typeof err === 'string' ? err : apiErrorMessage(err, fallback));
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  /** Resolves true/false (or the entered text when `input` is set; null when cancelled). */
  confirm(options: ConfirmOptions & { input: NonNullable<ConfirmOptions['input']> }): Promise<string | null>;
  confirm(options: ConfirmOptions): Promise<boolean>;
  confirm(options: ConfirmOptions): Promise<any> {
    return new Promise((resolve) => this.confirmState.set({ ...options, resolve }));
  }

  /** Like confirm() with a text field, plus a voice note next to it. With `required`, text OR a voice note is enough. */
  confirmNote(options: ConfirmOptions & { input: NonNullable<ConfirmOptions['input']> }): Promise<NoteResult | null> {
    return new Promise((resolve) => this.confirmState.set({ ...options, input: { ...options.input, voice: true }, resolve: resolve as ConfirmState['resolve'] }));
  }

  closeConfirm(result: string | boolean | null, audio: VoiceNote | null = null): void {
    const state = this.confirmState();
    if (!state) return;
    this.confirmState.set(null);
    if (state.input?.voice) state.resolve(result === false ? null : ({ text: String(result ?? ''), audio } as NoteResult) as never);
    else if (state.input) state.resolve(result === false ? null : result);
    else state.resolve(!!result);
  }

  private push(kind: Toast['kind'], message: string): void {
    const id = this.nextId++;
    this.toasts.update((list) => [...list.slice(-3), { id, kind, message }]);
    setTimeout(() => this.dismiss(id), kind === 'error' ? 6000 : 3500);
  }
}
