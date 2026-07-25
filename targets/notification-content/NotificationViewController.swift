import UIKit
import UserNotifications
import UserNotificationsUI
import ImageIO

/// Custom UI for the expanded "batch ready to review" push: a grid of every
/// photo in the batch, so the publisher can see the whole post without opening
/// the app. Bound to the `post-review` category via Info.plist.
///
/// Payload contract (see supabase/functions/auto-post/index.ts → pushApprovalBatch).
/// Expo nests the push `data` object under `userInfo["body"]` as a JSON string,
/// which we decode before reading:
///   gallery : [String]                        — compact photo URLs (preferred)
///   batch   : [{ url: String, ... }]          — legacy full objects (fallback)
///
/// Notes:
///   - Content extensions run under a tight memory budget, so photos are
///     downsampled to thumbnails (ImageIO) rather than decoded at full size,
///     and the grid is capped — mirroring the OOM caution from the sync path.
class NotificationViewController: UIViewController, UNNotificationContentExtension {
  private let columns = 3
  private let spacing: CGFloat = 3
  private let maxPhotos = 9

  private let grid = UIStackView()
  private var cells: [UIImageView] = []

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear

    grid.axis = .vertical
    grid.spacing = spacing
    grid.distribution = .fillEqually
    grid.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(grid)
    NSLayoutConstraint.activate([
      grid.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      grid.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      grid.topAnchor.constraint(equalTo: view.topAnchor),
      grid.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
  }

  func didReceive(_ notification: UNNotification) {
    let data = ExpoPushData.extract(from: notification.request.content.userInfo)
    let urls = galleryURLs(from: data).prefix(maxPhotos)

    buildGrid(count: urls.count)
    sizePreferredContent(count: urls.count)

    for (index, url) in urls.enumerated() {
      loadThumbnail(from: url, into: index)
    }
  }

  /// Prefers the compact `gallery` URL list; falls back to `batch[].url` for
  /// pushes emitted before the payload was slimmed (issue #71).
  private func galleryURLs(from data: [String: Any]) -> [URL] {
    if let gallery = data["gallery"] as? [String] {
      return gallery.compactMap(URL.init(string:))
    }
    if let batch = data["batch"] as? [[String: Any]] {
      return batch.compactMap { ($0["url"] as? String).flatMap(URL.init(string:)) }
    }
    return []
  }

  // MARK: - Layout

  private func buildGrid(count: Int) {
    grid.arrangedSubviews.forEach { $0.removeFromSuperview() }
    cells.removeAll()
    guard count > 0 else { return }

    let rows = Int(ceil(Double(count) / Double(columns)))
    var made = 0
    for _ in 0..<rows {
      let row = UIStackView()
      row.axis = .horizontal
      row.spacing = spacing
      row.distribution = .fillEqually
      for _ in 0..<columns {
        let imageView = UIImageView()
        imageView.contentMode = .scaleAspectFill
        imageView.clipsToBounds = true
        imageView.backgroundColor = UIColor.secondarySystemBackground
        if made < count {
          cells.append(imageView)
          made += 1
        } else {
          imageView.isHidden = true // pad the final row to keep equal sizing
        }
        row.addArrangedSubview(imageView)
      }
      grid.addArrangedSubview(row)
    }
  }

  private func sizePreferredContent(count: Int) {
    guard count > 0 else {
      preferredContentSize = CGSize(width: view.bounds.width, height: 0)
      return
    }
    let rows = CGFloat(Int(ceil(Double(count) / Double(columns))))
    let width = view.bounds.width
    let cellWidth = (width - spacing * CGFloat(columns - 1)) / CGFloat(columns)
    let height = cellWidth * rows + spacing * (rows - 1)
    preferredContentSize = CGSize(width: width, height: height)
  }

  // MARK: - Image loading

  private func loadThumbnail(from url: URL, into index: Int) {
    URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
      guard let self = self, let data = data,
            let image = Self.downsample(data, maxPixel: 600) else { return }
      DispatchQueue.main.async {
        guard index < self.cells.count else { return }
        self.cells[index].image = image
      }
    }.resume()
  }

  /// Decodes `data` straight to a thumbnail no larger than `maxPixel` on its
  /// long edge — avoids holding a full-resolution bitmap per photo.
  private static func downsample(_ data: Data, maxPixel: CGFloat) -> UIImage? {
    let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
    guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else { return nil }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceShouldCacheImmediately: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: maxPixel,
    ]
    guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
      return nil
    }
    return UIImage(cgImage: cgImage)
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
