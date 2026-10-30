package com.stitchnship.admin;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * Nothing is requested at launch (that put several system boxes on screen at once and covered the splash). Notifications are asked
 * after sign-in; the camera and microphone are asked by the WebView when a feature first uses them; the gallery is asked by
 * MediaAccessPlugin the first time a photo or video is picked.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaAccessPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
