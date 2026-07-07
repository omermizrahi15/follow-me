import UIKit
import UserNotifications
import UserNotificationsUI

/**
 * Custom expanded view for the "post-review" notification category.
 * Shows every attached photo in a 2-column grid when the user long-presses
 * the notification (the default iOS view only shows the first attachment).
 */
class NotificationViewController: UIViewController, UNNotificationContentExtension {
    private static let columns = 2
    private static let gap: CGFloat = 4
    private static let inset: CGFloat = 8

    private let grid = UIStackView()

    override func viewDidLoad() {
        super.viewDidLoad()
        grid.axis = .vertical
        grid.spacing = Self.gap
        grid.distribution = .fillEqually
        grid.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(grid)
        NSLayoutConstraint.activate([
            grid.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: Self.inset),
            grid.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -Self.inset),
            grid.topAnchor.constraint(equalTo: view.topAnchor, constant: Self.inset),
            grid.bottomAnchor.constraint(lessThanOrEqualTo: view.bottomAnchor, constant: -Self.inset),
        ])
    }

    func didReceive(_ notification: UNNotification) {
        // Attachment files live outside our sandbox — scoped access is required.
        let images: [UIImage] = notification.request.content.attachments.compactMap { attachment in
            guard attachment.url.startAccessingSecurityScopedResource() else { return nil }
            defer { attachment.url.stopAccessingSecurityScopedResource() }
            guard let data = try? Data(contentsOf: attachment.url) else { return nil }
            return UIImage(data: data)
        }

        grid.arrangedSubviews.forEach { $0.removeFromSuperview() }
        guard !images.isEmpty else { return }

        var currentRow: UIStackView?
        for (i, image) in images.enumerated() {
            if i % Self.columns == 0 {
                let row = UIStackView()
                row.axis = .horizontal
                row.spacing = Self.gap
                row.distribution = .fillEqually
                grid.addArrangedSubview(row)
                currentRow = row
            }
            let imageView = UIImageView(image: image)
            imageView.contentMode = .scaleAspectFill
            imageView.clipsToBounds = true
            imageView.layer.cornerRadius = 8
            currentRow?.addArrangedSubview(imageView)
        }
        // Keep the last cell square when the photo count is odd.
        if images.count % Self.columns != 0 {
            currentRow?.addArrangedSubview(UIView())
        }

        // Square cells: height = rows × cellSide (+ gaps + insets).
        let width = view.bounds.width > 0 ? view.bounds.width : UIScreen.main.bounds.width
        let cellSide = (width - Self.inset * 2 - Self.gap * CGFloat(Self.columns - 1)) / CGFloat(Self.columns)
        let rows = CGFloat((images.count + Self.columns - 1) / Self.columns)
        let height = rows * cellSide + (rows - 1) * Self.gap + Self.inset * 2
        preferredContentSize = CGSize(width: width, height: height)
    }
}
