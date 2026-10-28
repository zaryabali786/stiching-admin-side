export const environment = {
  production: true,
  // The public Privacy Policy page (App Store rule: also linked inside the app). Empty = no link is shown. Set it once the page exists.
  privacyPolicyUrl: 'https://www.stitchnship.com/privacy-policy',
  apiUrl: 'https://api.stitchnship.com/api',
  // switch on ONLY after android/app/google-services.json (Firebase) is in the project: without it the app crashes on push
  nativePush: true,
  // this app's iOS OAuth client for Google sign-in (Google Cloud Console -> Credentials -> iOS client of its bundle id)
  googleIosClientId: '1054380947096-k2q4q95um9lk92f03n50fpprc34i2r08.apps.googleusercontent.com',
  firebase: {
    apiKey: 'AIzaSyBZFEC5meXq78BXTmY2v3tC-Fz0r_Fypuk',
    projectId: 'stiching-98483',
    messagingSenderId: '894190452773',
    // Web app id: Firebase console -> Project settings -> Your apps -> Web app (browser push stays off until it is set)
    appId: '1:894190452773:android:3f69793699c7b0a171ffcc',
    // public key for web push (Cloud Messaging -> Web Push certificates)
    vapidKey: 'BK4LeE0bmcM6XmAS5gt2bk7xEwnCGMM2VWyPL5fENmX4KoRUBAoS8JpkvzyB6TmRryatIfjtm44QMlMLDSL5DGk',
  },
};
