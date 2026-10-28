# Notification Service Extension (the picture in a push on iPhone)

These two files are the whole extension. Xcode has to add it to the project once (needs a Mac):

1. Open `ios/App/App.xcodeproj (admin app)` in Xcode.
2. File > New > Target > **Notification Service Extension**. Name: `NotificationServiceExtension`, Language: Swift.
   Bundle identifier: `com.stitchnship.admin.NotificationServiceExtension`. Team: the same team as the app. Embed in: App.
   (If Xcode asks to activate the scheme, choose Cancel.)
3. Xcode creates its own `NotificationService.swift` and `Info.plist`: replace their content with the files in this folder.
4. Set the extension's **iOS Deployment Target** to 15.0 (same as the app).
5. Build and run on a real iPhone (a simulator does not receive push). Send a push with a picture from the Notification Center.

Nothing else is needed on the server: it already sends `mutable-content` and the picture address.
