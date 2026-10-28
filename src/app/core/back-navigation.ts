import { Location } from '@angular/common';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

const OVERLAYS = 'ion-modal, ion-popover, ion-alert, ion-action-sheet, ion-loading, ion-toast';

/** Closes the top-most Ionic overlay (modal, alert, sheet). Returns true when there was one to close. */
const closeTopOverlay = (): boolean => {
  const all = document.querySelectorAll<HTMLElement & { dismiss?: () => Promise<boolean> }>(OVERLAYS);
  const top = all[all.length - 1];
  if (!top || typeof top.dismiss !== 'function') return false;
  void top.dismiss();
  return true;
};

/**
 * Phone "back": the Android back button / back swipe, and on iPhone a swipe in from the left edge.
 * A sheet or modal that is open closes first; otherwise the app goes back one page; on the first page Android leaves the app.
 */
export const initBackNavigation = (location: Location): void => {
  if (!Capacitor.isNativePlatform()) return;

  const goBack = (canGoBack: boolean): boolean => {
    if (closeTopOverlay()) return true;
    if (canGoBack) {
      location.back();
      return true;
    }
    return false;
  };

  void App.addListener('backButton', ({ canGoBack }) => {
    if (!goBack(canGoBack)) void App.exitApp();
  });

  // iPhone: the web view has no back swipe of its own, so a swipe from the left edge does the same as the back button
  if (Capacitor.getPlatform() === 'ios') {
    let startX = 0;
    let startY = 0;
    let tracking = false;
    document.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      tracking = e.touches.length === 1 && t.clientX < 24;
      startX = t.clientX;
      startY = t.clientY;
    }, { passive: true });
    document.addEventListener('touchend', (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      if (t.clientX - startX > 70 && Math.abs(t.clientY - startY) < 60) goBack(window.history.length > 1);
    }, { passive: true });
  }
};
