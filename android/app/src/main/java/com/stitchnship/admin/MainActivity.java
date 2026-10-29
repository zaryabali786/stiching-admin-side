package com.stitchnship.admin;

import com.getcapacitor.BridgeActivity;

/**
 * Camera, microphone and gallery access are NOT requested here any more. Asking for them at launch put a system permission box on
 * screen at the same moment as the notification permission box (Android shows one at a time, so one of them was dropped and the
 * phone never registered for push), and it covered the splash. The permissions stay declared in the manifest; Android asks for each
 * one when a feature first needs it (the voice recorder, a photo picker), through Capacitor's WebView.
 */
public class MainActivity extends BridgeActivity {
}
