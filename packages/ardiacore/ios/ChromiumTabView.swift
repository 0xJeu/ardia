import AppKit
import ExpoModulesCore

final class ChromiumTabView: ExpoView, ArdiaWebViewDelegate {
  static let events = [
    "onNavigationChange",
    "onProgress",
    "onFavicon",
    "onMedia",
    "onNowPlaying",
    "onMediaAccess",
    "onOpenWindow",
    "onPopupBlocked",
    "onFindResult",
    "onFullscreen",
    "onStatus",
    "onCrashed",
    "onUnresponsive",
    "onResponsive",
    "onLoadError",
    "onSecurity",
    "onZoom",
    "onContentBlocked",
    "onDownloadNavigation",
    "onNotification",
    "onNotificationClose",
    "onPictureInPicture",
    "onActivateRequest",
    "onDisplayMediaRequest",
    "onWindowClose",
    "onCommand",
    "onPageFocus",
    "onPageMessage",
    "onReady",
    "onDiscarded",
    "onPasswordPrompt",
    "onAutofillPrompt",
    "onExternalApp",
    "onPreferredSize",
  ]

  let browser = ArdiaWebView(frame: .zero)

  let onNavigationChange = EventDispatcher()
  let onProgress = EventDispatcher()
  let onFavicon = EventDispatcher()
  let onMedia = EventDispatcher()
  let onNowPlaying = EventDispatcher()
  let onMediaAccess = EventDispatcher()
  let onOpenWindow = EventDispatcher()
  let onPopupBlocked = EventDispatcher()
  let onFindResult = EventDispatcher()
  let onFullscreen = EventDispatcher()
  let onStatus = EventDispatcher()
  let onCrashed = EventDispatcher()
  let onUnresponsive = EventDispatcher()
  let onResponsive = EventDispatcher()
  let onLoadError = EventDispatcher()
  let onSecurity = EventDispatcher()
  let onZoom = EventDispatcher()
  let onContentBlocked = EventDispatcher()
  let onDownloadNavigation = EventDispatcher()
  let onNotification = EventDispatcher()
  let onNotificationClose = EventDispatcher()
  let onPictureInPicture = EventDispatcher()
  let onActivateRequest = EventDispatcher()
  let onDisplayMediaRequest = EventDispatcher()
  let onWindowClose = EventDispatcher()
  let onCommand = EventDispatcher()
  let onPageFocus = EventDispatcher()
  let onPageMessage = EventDispatcher()
  let onReady = EventDispatcher()
  let onDiscarded = EventDispatcher()
  let onPasswordPrompt = EventDispatcher()
  let onAutofillPrompt = EventDispatcher()
  let onExternalApp = EventDispatcher()
  let onPreferredSize = EventDispatcher()

  private var propsReady = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    browser.delegate = self
    wantsLayer = true
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    browser.frame = bounds
  }

  func propsDidUpdate() {
    guard !propsReady else { return }
    propsReady = true
    browser.frame = bounds
    addSubview(browser)
  }

  deinit {
    browser.closeBrowser()
  }

  func webView(_ view: ArdiaWebView, event name: String, payload: [String: Any]) {
    switch name {
    case "navigation": onNavigationChange(payload)
    case "progress": onProgress(payload)
    case "favicon": onFavicon(payload)
    case "media": onMedia(payload)
    case "nowPlaying": onNowPlaying(payload)
    case "mediaAccess": onMediaAccess(payload)
    case "openWindow": onOpenWindow(payload)
    case "popupBlocked": onPopupBlocked(payload)
    case "find": onFindResult(payload)
    case "fullscreen": onFullscreen(payload)
    case "status": onStatus(payload)
    case "crashed": onCrashed(payload)
    case "unresponsive": onUnresponsive(payload)
    case "responsive": onResponsive(payload)
    case "loadError": onLoadError(payload)
    case "security": onSecurity(payload)
    case "zoom": onZoom(payload)
    case "contentBlocked": onContentBlocked(payload)
    case "downloadNavigation": onDownloadNavigation(payload)
    case "notification": onNotification(payload)
    case "notificationClose": onNotificationClose(payload)
    case "pictureInPicture": onPictureInPicture(payload)
    case "activateRequest": onActivateRequest(payload)
    case "displayMediaRequest": onDisplayMediaRequest(payload)
    case "windowClose": onWindowClose(payload)
    case "command": onCommand(payload)
    case "focus": onPageFocus(payload)
    case "pageMessage": onPageMessage(payload)
    case "ready": onReady(payload)
    case "discarded": onDiscarded(payload)
    case "passwordPrompt": onPasswordPrompt(payload)
    case "autofillPrompt": onAutofillPrompt(payload)
    case "externalApp": onExternalApp(payload)
    case "preferredSize": onPreferredSize(payload)
    default: break
    }
  }
}
