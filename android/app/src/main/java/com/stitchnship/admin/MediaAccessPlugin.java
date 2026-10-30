package com.stitchnship.admin;

import android.Manifest;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * The gallery permission, asked when a photo or video is first picked (not at launch).
 * Android 13+ uses READ_MEDIA_IMAGES / READ_MEDIA_VIDEO, older versions READ_EXTERNAL_STORAGE. Picking still works through the
 * system picker if the person says no, so the answer only changes what the app may read directly.
 */
@CapacitorPlugin(
    name = "MediaAccess",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO }, alias = "media"),
        @Permission(strings = { Manifest.permission.READ_EXTERNAL_STORAGE }, alias = "storage")
    }
)
public class MediaAccessPlugin extends Plugin {

    private String alias() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ? "media" : "storage";
    }

    private JSObject state() {
        JSObject result = new JSObject();
        result.put("gallery", getPermissionState(alias()) == PermissionState.GRANTED ? "granted" : "prompt");
        return result;
    }

    @PluginMethod
    public void check(PluginCall call) {
        call.resolve(state());
    }

    @PluginMethod
    public void request(PluginCall call) {
        if (getPermissionState(alias()) == PermissionState.GRANTED) {
            call.resolve(state());
            return;
        }
        requestPermissionForAlias(alias(), call, "afterRequest");
    }

    @PermissionCallback
    private void afterRequest(PluginCall call) {
        JSObject result = new JSObject();
        result.put("gallery", getPermissionState(alias()) == PermissionState.GRANTED ? "granted" : "denied");
        call.resolve(result);
    }
}
