import UserNotifications

class NotificationService: UNNotificationServiceExtension {
    var contentHandler: ((UNNotificationContent) -> Void)?
    var bestAttemptContent: UNMutableNotificationContent?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        self.contentHandler = contentHandler
        bestAttemptContent = request.content.mutableCopy() as? UNMutableNotificationContent

        guard
            let content = bestAttemptContent,
            let urlString = request.content.userInfo["imageUrl"] as? String,
            let imageURL = URL(string: urlString)
        else {
            contentHandler(request.content)
            return
        }

        URLSession.shared.downloadTask(with: imageURL) { tmpURL, _, _ in
            defer { contentHandler(content) }
            guard let tmpURL else { return }

            // Move to a permanent temp path with a known extension so iOS accepts it.
            let dest = URL(fileURLWithPath: NSTemporaryDirectory())
                .appendingPathComponent("notification-photo.jpg")
            try? FileManager.default.removeItem(at: dest)
            try? FileManager.default.moveItem(at: tmpURL, to: dest)

            if let attachment = try? UNNotificationAttachment(
                identifier: "photo",
                url: dest,
                options: [UNNotificationAttachmentOptionsThumbnailHiddenKey: false]
            ) {
                content.attachments = [attachment]
            }
        }.resume()
    }

    override func serviceExtensionTimeWillExpire() {
        if let handler = contentHandler, let content = bestAttemptContent {
            handler(content)
        }
    }
}
