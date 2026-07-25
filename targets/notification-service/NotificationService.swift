import UserNotifications
import UIKit

/// Downloads the lead photo referenced by the push payload and attaches it, so
/// the "batch ready to review" notification shows a thumbnail while collapsed
/// and a full image on long-press. Falls back to the plain text notification if
/// there's no usable image URL or the download fails / times out.
///
/// Payload contract (see supabase/functions/auto-post/index.ts → pushApprovalBatch).
/// Expo nests the push `data` object under `userInfo["body"]` as a JSON string,
/// so we decode that first, then read:
///   imageUrl : String            — lead photo (preferred)
///   batch    : [{ url: String }] — full batch (fallback source for the URL)
class NotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var bestAttempt: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    self.bestAttempt = request.content.mutableCopy() as? UNMutableNotificationContent

    guard let content = bestAttempt else {
      contentHandler(request.content)
      return
    }

    let data = ExpoPushData.extract(from: content.userInfo)
    guard let imageURL = leadImageURL(from: data) else {
      contentHandler(content)
      return
    }

    let task = URLSession.shared.downloadTask(with: imageURL) { [weak self] location, _, _ in
      defer { self?.deliver() }
      guard let location = location else { return }

      // iOS keys the attachment renderer off the file extension, so copy the
      // download into a uniquely-named .jpg before attaching.
      let dest = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString + ".jpg")
      try? FileManager.default.moveItem(at: location, to: dest)

      if let attachment = try? UNNotificationAttachment(identifier: "lead", url: dest, options: nil) {
        content.attachments = [attachment]
      }
    }
    task.resume()
  }

  /// The system's ~30s budget is up — deliver whatever we have so far.
  override func serviceExtensionTimeWillExpire() {
    deliver()
  }

  private func deliver() {
    guard let handler = contentHandler, let content = bestAttempt else { return }
    contentHandler = nil // guard against a double call from timeout + completion
    handler(content)
  }

  private func leadImageURL(from data: [String: Any]) -> URL? {
    if let direct = data["imageUrl"] as? String, let url = URL(string: direct) {
      return url
    }
    if let batch = data["batch"] as? [[String: Any]],
       let first = batch.first?["url"] as? String,
       let url = URL(string: first) {
      return url
    }
    return nil
  }
}

/// Expo push service nests the JS `data` object inside APNs `userInfo["body"]`
/// as a JSON-encoded string. This unwraps it, falling back to the raw userInfo
/// for the (rare) case where keys arrive at the top level.
enum ExpoPushData {
  static func extract(from userInfo: [AnyHashable: Any]) -> [String: Any] {
    if let jsonString = userInfo["body"] as? String,
       let jsonData = jsonString.data(using: .utf8),
       let parsed = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] {
      return parsed
    }
    if let dict = userInfo["body"] as? [String: Any] {
      return dict
    }
    return userInfo as? [String: Any] ?? [:]
  }
}
