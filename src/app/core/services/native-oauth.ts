import { Capacitor } from '@capacitor/core';
import { environment } from '../../../environments/environment';

/**
 * Google sign-in inside the phone app uses the phone's own Google account picker (Android Credential Manager / iOS
 * Google Sign-In), not a web page in a browser. The app gets a signed Google id_token and hands it to the API
 * (POST /auth/google { idToken }), which verifies it and answers like a normal login. The website keeps its redirect flow.
 */
export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

export class GoogleSignInCancelled extends Error {
  constructor() {
    super('Google sign-in was cancelled.');
    this.name = 'GoogleSignInCancelled';
  }
}

let initializedFor: string | null = null;

/** Opens the native Google account picker and returns the id_token. Throws GoogleSignInCancelled when the person backs out. */
export async function nativeGoogleIdToken(webClientId: string, apiIosClientId?: string | null): Promise<string> {
  // the iOS client belongs to this app's bundle id: the app's own setting wins over the API's single shared value
  const iOSClientId = environment.googleIosClientId || apiIosClientId;
  const { SocialLogin } = await import('@capgo/capacitor-social-login');
  const key = `${webClientId}|${iOSClientId ?? ''}`;
  if (initializedFor !== key) {
    await SocialLogin.initialize({ google: { webClientId, ...(iOSClientId ? { iOSClientId, iOSServerClientId: webClientId } : {}) } });
    initializedFor = key;
  }
  try {
    const { result } = await SocialLogin.login({ provider: 'google', options: {} });
    const idToken = result.responseType === 'online' ? result.idToken : null;
    if (!idToken) throw new Error('Google did not return a sign-in token. Please try again.');
    return idToken;
  } catch (err) {
    const text = String((err as { message?: unknown; code?: unknown })?.message ?? '') + ' ' + String((err as { code?: unknown })?.code ?? '');
    if (/cancel|dismiss|user closed|12501|-5/i.test(text)) throw new GoogleSignInCancelled();
    throw err;
  }
}
