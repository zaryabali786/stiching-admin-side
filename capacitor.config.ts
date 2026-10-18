import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.stitchnship.admin',
  appName: 'StitchNShip Admin',
  webDir: 'www',
  plugins: {
    LiveUpdates: {
      appId: 'f938d50b',
      channel: 'Production',
      autoUpdateMethod: 'background',
      maxVersions: 2
    }
  }
};

export default config;
