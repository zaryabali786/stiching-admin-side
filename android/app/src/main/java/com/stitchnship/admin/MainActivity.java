package com.stitchnship.admin;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int MEDIA_PERMISSIONS_REQUEST = 4101;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Android cannot grant camera, microphone and gallery at install time; ask on first launch instead.
        java.util.List<String> wanted = new java.util.ArrayList<>();
        wanted.add(Manifest.permission.CAMERA);
        wanted.add(Manifest.permission.RECORD_AUDIO);
        if (Build.VERSION.SDK_INT >= 33) {
            wanted.add(Manifest.permission.READ_MEDIA_IMAGES);
            wanted.add(Manifest.permission.READ_MEDIA_VIDEO);
        } else {
            wanted.add(Manifest.permission.READ_EXTERNAL_STORAGE);
        }
        java.util.List<String> missing = new java.util.ArrayList<>();
        for (String p : wanted) {
            if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) missing.add(p);
        }
        if (!missing.isEmpty()) {
            ActivityCompat.requestPermissions(this, missing.toArray(new String[0]), MEDIA_PERMISSIONS_REQUEST);
        }
    }
}
