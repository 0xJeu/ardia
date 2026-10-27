import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

final class FadeLabel: ExpoView {
  private let field = NSTextField(labelWithString: "")
  private let fade = CAGradientLayer()

  var text = "" { didSet { update() } }
  var fontSize: Double = 13 { didSet { update() } }
  var weight = "regular" { didSet { update() } }
  var color: NSColor = .labelColor { didSet { field.textColor = color } }
  var fadeWidth: Double = 24 { didSet { relayout() } }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
    clipsToBounds = true
    field.lineBreakMode = .byClipping
    field.maximumNumberOfLines = 1
    field.cell?.truncatesLastVisibleLine = false
    field.isSelectable = false
    addSubview(field)
    fade.colors = [NSColor.black.cgColor, NSColor.black.cgColor, NSColor.clear.cgColor]
    fade.startPoint = CGPoint(x: 0, y: 0.5)
    fade.endPoint = CGPoint(x: 1, y: 0.5)
    update()
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    relayout()
  }

  private func update() {
    let weights: [String: NSFont.Weight] = [
      "light": .light, "regular": .regular, "medium": .medium, "semibold": .semibold, "bold": .bold,
    ]
    field.font = .monospacedDigitSystemFont(ofSize: fontSize, weight: weights[weight] ?? .regular)
    field.stringValue = text
    field.textColor = color
    relayout()
  }

  private func relayout() {
    let fitting = field.fittingSize
    field.frame = NSRect(x: 0, y: (bounds.height - fitting.height) / 2, width: max(bounds.width, fitting.width), height: fitting.height)
    field.wantsLayer = true
    guard bounds.width > 0, fitting.width > bounds.width + 0.5 else {
      field.layer?.mask = nil
      return
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    fade.frame = CGRect(x: 0, y: 0, width: bounds.width, height: field.frame.height)
    let start = max(0, 1 - fadeWidth / bounds.width)
    fade.locations = [0, NSNumber(value: start), 1]
    field.layer?.mask = fade
    CATransaction.commit()
  }
}

final class FadeMask: ExpoView {
  private let fade = CAGradientLayer()

  var leading: Double = 0 { didSet { relayout() } }
  var trailing: Double = 0 { didSet { relayout() } }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
    clipsToBounds = true
    fade.startPoint = CGPoint(x: 0, y: 0.5)
    fade.endPoint = CGPoint(x: 1, y: 0.5)
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    relayout()
  }

  private func relayout() {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    defer { CATransaction.commit() }
    guard bounds.width > 0, leading > 0 || trailing > 0 else {
      layer?.mask = nil
      return
    }
    let edge = min(12 / bounds.width, 0.5)
    fade.frame = bounds
    fade.locations = [0, NSNumber(value: Double(edge)), NSNumber(value: Double(1 - edge)), 1]
    fade.colors = [
      NSColor.black.withAlphaComponent(CGFloat(1 - min(1, max(0, leading)))).cgColor,
      NSColor.black.cgColor,
      NSColor.black.cgColor,
      NSColor.black.withAlphaComponent(CGFloat(1 - min(1, max(0, trailing)))).cgColor,
    ]
    layer?.mask = fade
  }
}
