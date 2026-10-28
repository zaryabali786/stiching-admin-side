import UserNotifications

/// Shows the picture of a push notification on iPhone (Android and the browser do it by themselves).
/// The server sends `mutable-content: 1` and the picture address in `fcm_options.image`; iOS then runs this
/// extension before showing the notification. It downloads the picture and attaches it. If anything goes
/// wrong (no picture, slow network) the notification is shown as it is: title and message, never lost.
class NotificationService: UNNotificationServiceExtension {
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var bestAttempt: UNMutableNotificationContent?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        self.contentHandler = contentHandler
        bestAttempt = (request.content.mutableCopy() as? UNMutableNotificationContent)

        guard let content = bestAttempt,
              let options = request.content.userInfo["fcm_options"] as? [String: Any],
              let text = options["image"] as? String,
              let url = URL(string: text),
              url.scheme == "https" else {
            contentHandler(request.content)
            return
        }

        URLSession.shared.downloadTask(with: url) { [weak self] file, response, _ in
            defer { self?.finish() }
            guard let file = file else { return }
            let ext = (response?.mimeType == "image/png") ? "png" : (response?.mimeType == "image/webp" ? "webp" : "jpg")
            let target = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(UUID().uuidString + "." + ext)
            do {
                try FileManager.default.moveItem(at: file, to: target)
                let attachment = try UNNotificationAttachment(identifier: "picture", url: target, options: nil)
                content.attachments = [attachment]
            } catch {
                // the picture could not be attached: the notification still goes out without it
            }
        }.resume()
    }

    /// iOS gives the extension about 30 seconds; whatever is ready by then is shown.
    override func serviceExtensionTimeWillExpire() {
        finish()
    }

    private func finish() {
        guard let handler = contentHandler, let content = bestAttempt else { return }
        contentHandler = nil
        handler(content)
    }
}
