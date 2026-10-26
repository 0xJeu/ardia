import AppKit
import ExpoModulesCore

enum ChromeWindows {
  private static let host = NSClassFromString("ArdiaChromeWindowHost") as? NSObject.Type

  static func makeWindow(profile: String?, chromeWindow: String? = nil, appWindow: String? = nil) -> NSWindow? {
    guard let host else { return nil }
    let profile = profile ?? ""
    installCloseHandler(host)
    let withAppWindow = NSSelectorFromString("makeWindowForProfile:chromeWindow:appWindow:")
    if let appWindow, (host as AnyObject).responds(to: withAppWindow),
      let make = (host as AnyObject).method(for: withAppWindow) {
      typealias Make = @convention(c) (AnyObject, Selector, NSString, NSString?, NSString) -> Unmanaged<NSWindow>?
      return unsafeBitCast(make, to: Make.self)(host, withAppWindow, profile as NSString, chromeWindow as NSString?, appWindow as NSString)?
        .takeUnretainedValue()
    }
    let claiming = NSSelectorFromString("makeWindowForProfile:chromeWindow:")
    if let chromeWindow, (host as AnyObject).responds(to: claiming) {
      return host.perform(claiming, with: profile, with: chromeWindow)?.takeUnretainedValue() as? NSWindow
    }
    let selector = NSSelectorFromString("makeWindowForProfile:")
    return host.perform(selector, with: profile)?.takeUnretainedValue() as? NSWindow
  }

  private static var closeHandlerInstalled = false
  private static func installCloseHandler(_ host: NSObject.Type) {
    guard !closeHandlerInstalled else { return }
    closeHandlerInstalled = true
    let handler: @convention(block) (NSWindow) -> Bool = { WindowManager.shared.windowShouldClose($0) }
    (host as AnyObject).setValue(handler, forKey: "shouldCloseHandler")
    guard (host as AnyObject).responds(to: NSSelectorFromString("setRefusesUnhandledKeyHandler:")) else { return }
    let refuses: @convention(block) (NSWindow, NSEvent) -> Bool = { FocusHandoff.shared.refusesUnhandledKey($1, in: $0) }
    (host as AnyObject).setValue(refuses, forKey: "refusesUnhandledKeyHandler")
  }

  static func takeDismissed(appWindow: String) -> Bool {
    let selector = NSSelectorFromString("takeDismissedAppWindow:")
    guard let host, (host as AnyObject).responds(to: selector), let take = (host as AnyObject).method(for: selector) else { return false }
    typealias Take = @convention(c) (AnyObject, Selector, NSString) -> ObjCBool
    return unsafeBitCast(take, to: Take.self)(host, selector, appWindow as NSString).boolValue
  }

  static func fullScreenIsForPage(_ window: NSWindow) -> Bool {
    let selector = NSSelectorFromString("windowFullScreenIsForPage:")
    guard let host, (host as AnyObject).responds(to: selector), let call = (host as AnyObject).method(for: selector) else { return false }
    typealias Call = @convention(c) (AnyObject, Selector, NSWindow) -> ObjCBool
    return unsafeBitCast(call, to: Call.self)(host, selector, window).boolValue
  }

  static func forgetLaunchPictures() {
    guard let host, (host as AnyObject).responds(to: NSSelectorFromString("forgetLaunchPictures")) else { return }
    host.perform(NSSelectorFromString("forgetLaunchPictures"))
  }

  static func recordLaunchLayout() {
    guard let host, (host as AnyObject).responds(to: NSSelectorFromString("recordLaunchLayout")) else { return }
    host.perform(NSSelectorFromString("recordLaunchLayout"))
  }

  static func embed(_ root: NSView, in window: NSWindow) {
    host?.perform(NSSelectorFromString("embedRootView:inWindow:"), with: root, with: window)
  }

  static func root(of window: NSWindow) -> NSView? {
    guard let host else { return nil }
    return host.perform(NSSelectorFromString("rootViewOfWindow:"), with: window)?.takeUnretainedValue() as? NSView
  }

  static func close(_ window: NSWindow) {
    host?.perform(NSSelectorFromString("closeWindow:"), with: window)
  }

  static func showProfile(_ profile: String, in window: NSWindow) {
    host?.perform(NSSelectorFromString("showProfile:inWindow:"), with: profile, with: window)
  }

  private static let drawnMoves = KillSwitch.isOn("sidebarSlideLean")

  static func setTrafficLightsCenter(_ center: NSPoint?, in window: NSWindow) {
    let move = NSSelectorFromString("moveTrafficLightsCenter:inWindow:")
    let selector = drawnMoves && (host as AnyObject?)?.responds(to: move) == true ? move : NSSelectorFromString("setTrafficLightsCenter:inWindow:")
    host?.perform(selector, with: center.map { NSValue(point: $0) }, with: window)
  }

  static func prepare(_ profiles: [String], for window: NSWindow) {
    guard !profiles.isEmpty else { return }
    host?.perform(NSSelectorFromString("prepareProfiles:forWindow:"), with: profiles, with: window)
  }

  private static var swapHandlerInstalled = false
  static func onSwap(_ handler: @escaping (NSWindow, NSWindow) -> Void) {
    guard !swapHandlerInstalled, let host else { return }
    swapHandlerInstalled = true
    let block: @convention(block) (NSWindow, NSWindow) -> Void = handler
    (host as AnyObject).setValue(block, forKey: "swappedHandler")
  }

  static func removeRoot(of window: NSWindow) {
    host?.perform(NSSelectorFromString("removeRootViewOfWindow:"), with: window)
  }
}
