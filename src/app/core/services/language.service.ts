import { Injectable, signal } from '@angular/core';

const KEY = 'v360_partner_lang';

/**
 * English / Urdu toggle for the partner portal.
 * Usage in templates: {{ lang.t('Production', 'پیداوار') }} and add class "urdu" when lang.isUrdu().
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  readonly language = signal<'en' | 'ur'>(readLang());

  isUrdu(): boolean {
    return this.language() === 'ur';
  }

  set(lang: 'en' | 'ur'): void {
    this.language.set(lang);
    try {
      localStorage.setItem(KEY, lang);
    } catch {
      /* ignore */
    }
  }

  t(en: string, ur: string): string {
    return this.language() === 'ur' ? ur : en;
  }
}

function readLang(): 'en' | 'ur' {
  try {
    return localStorage.getItem(KEY) === 'ur' ? 'ur' : 'en';
  } catch {
    return 'en';
  }
}
