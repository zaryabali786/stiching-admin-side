import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * The gallery permission, asked the first time a photo or video is picked (not at launch).
 * - Android: our own MediaAccess plugin (READ_MEDIA_* on Android 13+, READ_EXTERNAL_STORAGE before).
 * - iPhone: the system photo-library box, through the Camera plugin.
 * Camera and microphone need no code here: the web view asks the system for them when a feature first opens the camera (QR scanner,
 * photo capture) or the microphone (voice notes). Saying no to the gallery never blocks picking: the system picker still opens.
 */
interface MediaAccessPlugin {
  request(): Promise<{ gallery: string }>;
  openSettings(): Promise<void>;
}
const MediaAccess = registerPlugin<MediaAccessPlugin>('MediaAccess');

const ASKED_KEY = 'gallery_permission_asked';

const alreadyAsked = (): boolean => {
  try {
    return !!localStorage.getItem(ASKED_KEY);
  } catch {
    return true;
  }
};

const markAsked = (): void => {
  try {
    localStorage.setItem(ASKED_KEY, '1');
  } catch {
    /* storage unavailable */
  }
};

export async function requestGalleryPermission(): Promise<void> {
  try {
    if (Capacitor.getPlatform() === 'android') await MediaAccess.request();
    else {
      const { Camera } = await import('@capacitor/camera');
      await Camera.requestPermissions({ permissions: ['photos'] });
    }
  } catch (err) {
    console.warn('[Permissions] gallery not asked:', err);
  }
}

/**
 * Before the first file chooser opens in the phone app, ask for the gallery, then open the chooser. Every file input in the app goes
 * through this, so no screen has to remember to ask. Only the first pick is held back; after that the listener removes itself.
 */
export function installGalleryPermissionPrompt(): void {
  if (!Capacitor.isNativePlatform() || alreadyAsked()) return;
  let reopening = false;
  const onClick = (event: Event): void => {
    const input = event.target;
    if (reopening || !(input instanceof HTMLInputElement) || input.type !== 'file') return;
    if (alreadyAsked()) {
      document.removeEventListener('click', onClick, true);
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    markAsked();
    document.removeEventListener('click', onClick, true);
    void requestGalleryPermission().finally(() => {
      reopening = true;
      input.click();
      reopening = false;
    });
  };
  document.addEventListener('click', onClick, true);
}

/** Opens the phone's settings for this app (Android: its notification settings, iPhone: its settings page). */
export async function openAppSettings(): Promise<void> {
  try {
    if (Capacitor.getPlatform() === 'android') await MediaAccess.openSettings();
    // iPhone: the web view hands a link outside the app to the system, and "app-settings:" is this app's page in Settings
    else window.location.href = 'app-settings:';
  } catch (err) {
    console.warn('[Permissions] settings not opened:', err);
  }
}
