// @ts-ignore - the project has no Node type definitions; vitest runs these specs under Node
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Store-review guards on the native projects: these settings were fixed once and must not come back. */
const read = (path: string): string => readFileSync(path, 'utf8');

describe('native release configuration', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');

  it('declares the gallery permissions the apps rely on', () => {
    expect(manifest).toContain('READ_MEDIA_IMAGES');
    expect(manifest).toContain('READ_MEDIA_VIDEO');
  });

  it('removes the advertising ID permissions that Firebase libraries add', () => {
    expect(manifest).toMatch(/permission\.AD_ID"\s+tools:node="remove"/);
  });

  it('does not let Android back up app data', () => {
    expect(manifest).toContain('android:allowBackup="false"');
  });

  it('ships an iOS privacy manifest that is part of the Xcode project and declares no tracking', () => {
    const file = 'ios/App/App/PrivacyInfo.xcprivacy';
    expect(existsSync(file)).toBe(true);
    expect(read(file)).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
    expect(read('ios/App/App.xcodeproj/project.pbxproj')).toContain('PrivacyInfo.xcprivacy in Resources');
  });
});
