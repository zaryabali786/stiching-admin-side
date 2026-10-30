import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.stitchnship.admin',
  appName: 'S&S Admin',
  webDir: 'www',
  plugins: {
    LiveUpdate: {
      appId: '0a3ced75-b36f-4b7c-b591-841038093175',
      autoDeleteBundles: true,
      readyTimeout: 10000,
    },
  }
};

export default config;
