import UIKit
import UserNotifications
import UserNotificationsUI
import ImageIO

/// Custom UI for the expanded "batch ready to review" push: a grid of the
/// batch's photos, so the publisher can see the post without opening the app.
/// Bound to the `post-review` category via Info.plist.
///
/// Payload contract (see supabase/functions/auto-post/index.ts → pushApprovalBatch).
/// Expo nests the push `data` object under `userInfo["body"]` as a JSON string,
/// which we decode before reading:
///   gallery : [String]                        — compact photo URLs (preferred)
///   batch   : [{ url: String, ... }]          — legacy full objects (fallback)
///
/// Notes:
///   - Content extensions run under a tight (~24MB) memory budget, so photos are
///     downsampled to small thumbnails via ImageIO (never decoded full-size),
///     downloads are throttled, and the grid is capped.
///   - preferredContentSize MUST be sized from a real width. At didReceive the
///     view isn't laid out (bounds are zero), so an initial estimate is taken
///     from the screen width and then corrected in viewDidLayoutSubviews — a
///     zero height here makes iOS expand then immediately collapse the banner.
class NotificationViewController: UIViewController, UNNotificationContentExtension {
  private let columns = 3
  private let spacing: CGFloat = 3
  private let maxPhotos = 6
  private let thumbnailPixels: CGFloat = 400

  private let grid = UIStackView()
  private var cells: [UIImageView] = []
  private var rowsCount = 0

  // Bound concurrent downloads so several full-size JPEG buffers don't coexist
  // and blow the extension's memory budget.
  private let downloadGate = DispatchSemaphore(value: 3)

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
    let urls = Array(galleryURLs(from: data).prefix(maxPhotos))
    guard !urls.isEmpty else { return }

    buildGrid(count: urls.count)
    // Initial estimate from the screen width; corrected in viewDidLayoutSubviews
    // once the banner's real width is known.
    setPreferredHeight(forWidth: UIScreen.main.bounds.width)

    for (index, url) in urls.enumerated() {
      loadThumbnail(from: url, into: index)
    }
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    guard rowsCount > 0, view.bounds.width > 1 else { return }
    setPreferredHeight(forWidth: view.bounds.width)
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
    guard count > 0 else { rowsCount = 0; return }

    rowsCount = Int(ceil(Double(count) / Double(columns)))
    var made = 0
    for _ in 0..<rowsCount {
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
          imageView.alpha = 0 // pad the final row, keeping equal cell sizing
        }
        row.addArrangedSubview(imageView)
      }
      grid.addArrangedSubview(row)
    }
  }

  private func setPreferredHeight(forWidth width: CGFloat) {
    guard rowsCount > 0, width > 1 else { return }
    let cellWidth = (width - spacing * CGFloat(columns - 1)) / CGFloat(columns)
    let height = cellWidth * CGFloat(rowsCount) + spacing * CGFloat(rowsCount - 1)
    let rounded = height.rounded()
    if abs(preferredContentSize.height - rounded) > 0.5 {
      preferredContentSize = CGSize(width: width, height: rounded)
    }
  }

  // MARK: - Image loading

  private func loadThumbnail(from url: URL, into index: Int) {
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      guard let self = self else { return }
      self.downloadGate.wait()
      let task = URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
        defer { self?.downloadGate.signal() }
        guard let self = self, let data = data,
              let image = Self.downsample(data, maxPixel: self.thumbnailPixels) else { return }
        DispatchQueue.main.async {
          guard index < self.cells.count else { return }
          self.cells[index].image = image
        }
      }
      task.resume()
    }
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
