import AppKit
import CryptoKit
import WebKit

final class WebKitHub: NSObject, WKScriptMessageHandler {
  static let shared = WebKitHub()
  static let world = WKContentWorld.world(name: "ardia")
  static let background = ProcessInfo.processInfo.environment["ARDIA_BACKGROUND"] == "1"

  var events: ((String, [String: Any]) -> Void)?
  let downloads = WebKitDownloads()

  private final class WeakTab {
    weak var tab: WebKitTab?
    init(_ tab: WebKitTab) { self.tab = tab }
  }

  private struct PrivateSession {
    let store: WKWebsiteDataStore
    let token: String
  }

  private struct PendingPermission {
    let browserId: Int32
    let keys: [String]
    let store: WKWebsiteDataStore
    let decide: (Bool) -> Void
  }

  private struct PendingExternal {
    let url: URL
    let allowance: String?
  }

  private var lastBrowserId: Int32 = -1000
  private var persistentStores: [String: WKWebsiteDataStore] = [:]
  private var privateSessions: [String: PrivateSession] = [:]
  private var owners: [ObjectIdentifier: WeakTab] = [:]
  private var liveByKey: [String: WeakTab] = [:]
  private let transferLock = NSLock()
  private var prepared = Set<String>()
  private var parked: [String: WKWebView] = [:]
  private var offered: [String: WKWebView] = [:]
  private var lastOffer = 0
  private var pendingPermissions: [String: PendingPermission] = [:]
  private var rememberedPermissions: [String: Bool] = [:]
  private var lastPermission = 0
  private var zoomByHost: [String: Double] = [:]
  private var pendingExternal: [String: PendingExternal] = [:]
  private var externalAllowances = Set<String>()
  private var lastExternal = 0
  private var resumeHosts: [String: WKWebView] = [:]

  func nextBrowserId() -> Int32 {
    lastBrowserId -= 1
    return lastBrowserId
  }

  static func isPrivate(_ profile: String) -> Bool { profile.hasPrefix("incognito:") }

  static func privateSession(_ profile: String) -> String {
    guard let at = profile.range(of: "@", options: .backwards) else { return "" }
    return String(profile[at.upperBound...])
  }

  static func regularProfile(_ profile: String) -> String { isPrivate(profile) ? privateSession(profile) : profile }

  private func session(_ name: String) -> PrivateSession {
    if let live = privateSessions[name] { return live }
    let made = PrivateSession(store: .nonPersistent(), token: UUID().uuidString)
    privateSessions[name] = made
    return made
  }

  func storeKey(_ profile: String) -> String {
    guard Self.isPrivate(profile) else { return profile }
    let name = Self.privateSession(profile)
    return "private@\(name)#\(session(name).token)"
  }

  static func storeIdentifier(_ profile: String) -> UUID {
    let scope = ProcessInfo.processInfo.environment["ARDIA_DATA_DIR"] ?? ""
    var bytes = Array(SHA256.hash(data: Data("ardia.webkit|\(scope)|\(profile)".utf8)).prefix(16))
    bytes[6] = (bytes[6] & 0x0F) | 0x50
    bytes[8] = (bytes[8] & 0x3F) | 0x80
    return bytes.withUnsafeBufferPointer { NSUUID(uuidBytes: $0.baseAddress!) as UUID }
  }

  func dataStore(for profile: String) -> WKWebsiteDataStore {
    if Self.isPrivate(profile) { return session(Self.privateSession(profile)).store }
    if let store = persistentStores[profile] { return store }
    let store = WKWebsiteDataStore(forIdentifier: Self.storeIdentifier(profile))
    persistentStores[profile] = store
    return store
  }

  func endPrivateSession(_ name: String) {
    guard let ended = privateSessions.removeValue(forKey: name) else { return }
    let prefix = "private@\(name)#\(ended.token)|"
    rememberedPermissions = rememberedPermissions.filter { !$0.key.hasPrefix(prefix) }
    zoomByHost = zoomByHost.filter { !$0.key.hasPrefix(prefix) }
    externalAllowances = externalAllowances.filter { !$0.hasPrefix(prefix) }
    let uses = { (view: WKWebView) in view.configuration.websiteDataStore === ended.store }
    for (key, view) in parked where uses(view) {
      parked.removeValue(forKey: key)
      Self.close(view)
    }
    for (id, view) in offered where uses(view) {
      offered.removeValue(forKey: id)
      Self.close(view)
    }
    for (key, view) in resumeHosts where uses(view) {
      resumeHosts.removeValue(forKey: key)
      Self.close(view)
    }
    for (id, pending) in pendingPermissions where pending.store === ended.store {
      pendingPermissions.removeValue(forKey: id)
      pending.decide(false)
      events?("onPermissionDismissed", ["id": id])
    }
    for tab in owners.values.compactMap(\.tab) where tab.webView.map(uses) == true { tab.close() }
    ended.store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {}
  }

  static let safariVersion: String = {
    let paths = ["/Applications/Safari.app", "/System/Volumes/Preboot/Cryptexes/App/System/Applications/Safari.app"]
    for path in paths {
      if let version = Bundle(path: path)?.infoDictionary?["CFBundleShortVersionString"] as? String {
        return version.split(separator: ".").prefix(2).joined(separator: ".")
      }
    }
    return "18.6"
  }()

  static let passkeysEntitled: Bool = {
    guard let task = SecTaskCreateFromSelf(nil) else { return false }
    let value = SecTaskCopyValueForEntitlement(task, "com.apple.developer.web-browser.public-key-credential" as CFString, nil)
    return (value as? Bool) == true
  }()

  static let hidePasskeys = "(() => { try { delete window.PublicKeyCredential; } catch (e) {} })();"

  func configuration(profile: String) -> WKWebViewConfiguration {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = dataStore(for: profile)
    let controller = WKUserContentController()
    controller.addUserScript(WKUserScript(source: WebKitPageScript.source, injectionTime: .atDocumentStart, forMainFrameOnly: false, in: Self.world))
    controller.add(self, contentWorld: Self.world, name: "ardia")
    if !Self.passkeysEntitled {
      controller.addUserScript(WKUserScript(source: Self.hidePasskeys, injectionTime: .atDocumentStart, forMainFrameOnly: false, in: .page))
    }
    config.userContentController = controller
    config.applicationNameForUserAgent = "Version/\(Self.safariVersion) Safari/605.1.15"
    config.mediaTypesRequiringUserActionForPlayback = []
    config.allowsAirPlayForMediaPlayback = true
    config.preferences.isElementFullscreenEnabled = !Self.background
    config.preferences.javaScriptCanOpenWindowsAutomatically = false
    config.preferences.isFraudulentWebsiteWarningEnabled = false
    config.defaultWebpagePreferences.preferredContentMode = .desktop
    return config
  }

  func register(_ webView: WKWebView, tab: WebKitTab) { owners[ObjectIdentifier(webView)] = WeakTab(tab) }

  func unregister(_ webView: WKWebView) { owners.removeValue(forKey: ObjectIdentifier(webView)) }

  func owner(of webView: WKWebView) -> WebKitTab? { owners[ObjectIdentifier(webView)]?.tab }

  func noteLive(_ tab: WebKitTab, key: String) { liveByKey[key] = WeakTab(tab) }

  func forgetLive(_ tab: WebKitTab, key: String) {
    if liveByKey[key]?.tab === tab || liveByKey[key]?.tab == nil { liveByKey.removeValue(forKey: key) }
  }

  func liveTab(_ key: String) -> WebKitTab? { liveByKey[key]?.tab }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let webView = message.webView, let tab = owner(of: webView), let body = message.body as? [String: Any],
      let kind = body["kind"] as? String
    else { return }
    tab.pageMessage(kind, data: body["data"], frame: body["frame"] as? String ?? "", frameInfo: message.frameInfo)
  }

  func prepareTransfer(_ key: String) {
    transferLock.lock()
    prepared.insert(key)
    transferLock.unlock()
  }

  func releaseTransfer(_ key: String) {
    transferLock.lock()
    prepared.remove(key)
    transferLock.unlock()
    DispatchQueue.main.async {
      if let webView = self.parked.removeValue(forKey: key) { Self.close(webView) }
    }
  }

  func isPrepared(_ key: String) -> Bool {
    transferLock.lock()
    defer { transferLock.unlock() }
    return prepared.contains(key)
  }

  func park(_ webView: WKWebView, key: String) {
    if let old = parked[key], old !== webView { Self.close(old) }
    parked[key] = webView
  }

  func claimParked(_ key: String) -> WKWebView? {
    transferLock.lock()
    prepared.remove(key)
    transferLock.unlock()
    return parked.removeValue(forKey: key)
  }

  func offer(_ webView: WKWebView) -> String {
    lastOffer += 1
    let id = "webkit:\(lastOffer)"
    offered[id] = webView
    DispatchQueue.main.asyncAfter(deadline: .now() + 60) { [weak self] in
      if let left = self?.offered.removeValue(forKey: id) { Self.close(left) }
    }
    return id
  }

  func claimOffered(_ id: String) -> WKWebView? { offered.removeValue(forKey: id) }

  static func close(_ webView: WKWebView) {
    WebKitHub.shared.unregister(webView)
    webView.navigationDelegate = nil
    webView.uiDelegate = nil
    webView.stopLoading()
    webView.pauseAllMediaPlayback(completionHandler: nil)
    webView.closeAllMediaPresentations(completionHandler: nil)
    webView.removeFromSuperview()
  }

  func resumeHost(for profile: String) -> WKWebView {
    let key = storeKey(profile)
    if let host = resumeHosts[key] { return host }
    let host = WKWebView(frame: .zero, configuration: configuration(profile: profile))
    resumeHosts[key] = host
    return host
  }

  func zoom(profile: String, host: String) -> Double { zoomByHost[storeKey(profile) + "|" + host] ?? 1 }

  func setZoom(_ zoom: Double, profile: String, host: String) {
    let key = storeKey(profile) + "|" + host
    if zoom == 1 { zoomByHost.removeValue(forKey: key) } else { zoomByHost[key] = zoom }
  }

  static let permissionKinds = ["camera", "microphone"]

  private func permissionKey(_ profile: String, _ origin: String, _ kind: String) -> String { storeKey(profile) + "|" + origin + "|" + kind }

  func requestPermission(browserId: Int32, profile: String, origin: String, kinds: [String], decide: @escaping (Bool) -> Void) {
    let keys = kinds.map { permissionKey(profile, origin, $0) }
    let answers = keys.map { rememberedPermissions[$0] }
    if answers.contains(false) { return decide(false) }
    if answers.allSatisfy({ $0 == true }) { return decide(true) }
    lastPermission += 1
    let id = "wk-permission-\(lastPermission)"
    pendingPermissions[id] = PendingPermission(browserId: browserId, keys: keys, store: dataStore(for: profile), decide: decide)
    events?("onPermission", ["id": id, "browserId": Int(browserId), "origin": origin, "permissions": kinds])
  }

  func resolvePermission(_ id: String, result: String, remember: Bool) {
    guard let pending = pendingPermissions.removeValue(forKey: id) else { return }
    let allowed = result == "accept"
    if remember && result != "dismiss" { for key in pending.keys { rememberedPermissions[key] = allowed } }
    pending.decide(allowed)
  }

  func dropPermissions(browserId: Int32) {
    for (id, pending) in pendingPermissions where pending.browserId == browserId {
      pendingPermissions.removeValue(forKey: id)
      pending.decide(false)
      events?("onPermissionDismissed", ["id": id])
    }
  }

  func sitePermissions(profile: String, origin: String) -> [String: [String: Any]] {
    var settings: [String: [String: Any]] = [:]
    for kind in Self.permissionKinds {
      let answer = rememberedPermissions[permissionKey(profile, origin, kind)]
      settings[kind] = ["value": answer.map { $0 ? "allow" : "block" } ?? "ask", "isDefault": answer == nil]
    }
    return settings
  }

  func setSitePermission(profile: String, origin: String, kind: String, value: String) {
    guard Self.permissionKinds.contains(kind) else { return }
    let key = permissionKey(profile, origin, kind)
    switch value {
    case "allow": rememberedPermissions[key] = true
    case "block": rememberedPermissions[key] = false
    default: rememberedPermissions.removeValue(forKey: key)
    }
    guard value == "block" else { return }
    let store = dataStore(for: profile)
    for tab in owners.values.compactMap(\.tab) where tab.webView?.configuration.websiteDataStore === store && tab.origin == origin {
      tab.stopCapture(kind)
    }
  }

  static let blockedSchemes: Set<String> = [
    "afp", "cifs", "disk", "disks", "hcp", "ms-help", "nfs", "res", "shell", "smb", "vbscript", "view-source", "vnc",
    "x-man-page", "x-apple.systempreferences",
  ]

  func externalAppRequest(url: URL, origin: String?, profile: String) -> [String: Any]? {
    let scheme = url.scheme?.lowercased() ?? ""
    if scheme.isEmpty || Self.blockedSchemes.contains(scheme) {
      NSLog("[webkit] refused a link to the %@: scheme", scheme)
      return nil
    }
    let app = NSWorkspace.shared.urlForApplication(toOpen: url)
    let name = app.map { (FileManager.default.displayName(atPath: $0.path) as NSString).deletingPathExtension }
    let trusted = origin.map { $0.hasPrefix("https://") || $0.hasPrefix("http://localhost") } ?? false
    let allowance = app != nil && trusted && !Self.isPrivate(profile) ? storeKey(profile) + "|" + origin! + "|" + scheme : nil
    if let allowance, externalAllowances.contains(allowance) {
      open(url)
      return nil
    }
    lastExternal += 1
    let id = "wk-external-\(lastExternal)"
    if app != nil {
      if pendingExternal.count >= 50 { pendingExternal.removeAll() }
      pendingExternal[id] = PendingExternal(url: url, allowance: allowance)
    }
    let title = name.map { "Open “\($0)”?" } ?? "No application is set to open this link"
    let message = app == nil
      ? "Your Mac doesn’t have an app for “\(scheme):” links."
      : origin.map { "\($0) wants to open this application." } ?? "This page wants to open this application."
    let remember = allowance != nil ? "Always allow \(origin!) to open links of this type in \(name!)" : nil
    return [
      "id": id, "url": url.absoluteString, "scheme": scheme, "origin": origin ?? NSNull(), "app": name ?? NSNull(),
      "appPath": app?.path ?? NSNull(), "icon": app.flatMap(Self.iconURI) ?? NSNull(), "title": title,
      "message": message, "remember": remember ?? NSNull(),
    ]
  }

  func resolveExternalApp(_ id: String, open: Bool, remember: Bool) {
    guard let pending = pendingExternal.removeValue(forKey: id), open else { return }
    if remember, let allowance = pending.allowance { externalAllowances.insert(allowance) }
    self.open(pending.url)
  }

  private func open(_ url: URL) {
    if Self.background { return NSLog("[webkit] external URL (background mode, not opened): %@", url.absoluteString) }
    NSWorkspace.shared.open(url)
  }

  static func iconURI(_ app: URL) -> String? {
    let icon = NSWorkspace.shared.icon(forFile: app.path)
    let size = NSSize(width: 64, height: 64)
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 64, pixelsHigh: 64, bitsPerSample: 8, samplesPerPixel: 4,
                                     hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
    else { return nil }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    icon.draw(in: NSRect(origin: .zero, size: size))
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:]).map { "data:image/png;base64," + $0.base64EncodedString() }
  }

  static let siteDataTypes: Set<String> = WKWebsiteDataStore.allWebsiteDataTypes().subtracting([
    WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache, WKWebsiteDataTypeFetchCache,
  ])

  func clearBrowsingData(profile: String, types: [String], since: Double, completion: @escaping () -> Void) {
    var kinds = Set<String>()
    if types.contains("siteData") { kinds.formUnion(Self.siteDataTypes) }
    if types.contains("cache") { kinds.formUnion([WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache, WKWebsiteDataTypeFetchCache]) }
    if types.contains("siteData") {
      let prefix = storeKey(profile) + "|"
      rememberedPermissions = rememberedPermissions.filter { !$0.key.hasPrefix(prefix) }
      externalAllowances = externalAllowances.filter { !$0.hasPrefix(prefix) }
    }
    guard !kinds.isEmpty else { return completion() }
    dataStore(for: profile).removeData(ofTypes: kinds, modifiedSince: Date(timeIntervalSince1970: since / 1000), completionHandler: completion)
  }

  static func covers(_ domain: String, host: String) -> Bool {
    let name = domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
    return !name.isEmpty && (host == name || host.hasSuffix("." + name))
  }

  func clearSiteData(profile: String, host rawHost: String, completion: @escaping ([String: Any]) -> Void) {
    let store = dataStore(for: profile)
    let host = rawHost.lowercased()
    store.fetchDataRecords(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes()) { records in
      let matching = records.filter { Self.covers($0.displayName, host: host) }
      store.httpCookieStore.getAllCookies { cookies in
        let count = cookies.filter { Self.covers($0.domain, host: host) }.count
        store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), for: matching) {
          completion(["cookies": count, "storage": true])
        }
      }
    }
  }

  func deleteProfileData(_ profile: String, completion: @escaping (Bool) -> Void) {
    guard !Self.isPrivate(profile) else { return completion(true) }
    let store = dataStore(for: profile)
    store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {
      self.persistentStores.removeValue(forKey: profile)
      if let host = self.resumeHosts.removeValue(forKey: profile) { Self.close(host) }
      WKWebsiteDataStore.remove(forIdentifier: Self.storeIdentifier(profile)) { error in completion(error == nil) }
    }
  }
}

final class WebKitDownloads: NSObject, WKDownloadDelegate {
  private enum Phase { case running, pausing, paused, resuming, done }

  private final class Item {
    let id = "wk-download-" + UUID().uuidString
    var download: WKDownload?
    weak var webView: WKWebView?
    let url: String
    let profile: String
    var phase = Phase.running
    var filename = ""
    var path = ""
    var state = "downloading"
    var received: Int64 = 0
    var total: Int64 = 0
    var speed: Double = 0
    var mimeType = ""
    var resumeData: Data?
    var progress: NSKeyValueObservation?
    var sampledAt = Date()
    var sampledBytes: Int64 = 0
    var reportedAt = Date.distantPast

    init(url: String, profile: String) {
      self.url = url
      self.profile = profile
    }
  }

  private var items: [String: Item] = [:]
  private var byDownload: [ObjectIdentifier: String] = [:]
  private var settings: [String: (folder: URL, ask: Bool)] = [:]
  private let fallbackFolder: URL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
    ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Downloads")

  func setSettings(profile: String, folder: String, ask: Bool) {
    settings[profile] = (folder.isEmpty ? fallbackFolder : URL(fileURLWithPath: folder, isDirectory: true), ask)
  }

  private func destination(for profile: String) -> (folder: URL, ask: Bool) {
    settings[WebKitHub.regularProfile(profile)] ?? settings[""] ?? (fallbackFolder, false)
  }

  func adopt(_ download: WKDownload, profile: String, webView: WKWebView?) {
    let item = Item(url: download.originalRequest?.url?.absoluteString ?? "", profile: profile)
    item.webView = webView
    attach(download, to: item)
    items[item.id] = item
  }

  private func attach(_ download: WKDownload, to item: Item) {
    item.download = download
    byDownload[ObjectIdentifier(download)] = item.id
    download.delegate = self
    item.progress = download.progress.observe(\.completedUnitCount, options: [.new]) { [weak self, weak item] progress, _ in
      DispatchQueue.main.async {
        guard let self, let item, item.phase == .running else { return }
        item.received = progress.completedUnitCount
        item.total = max(0, progress.totalUnitCount)
        let now = Date()
        let elapsed = now.timeIntervalSince(item.sampledAt)
        if elapsed >= 0.5 {
          item.speed = Double(item.received - item.sampledBytes) / elapsed
          item.sampledAt = now
          item.sampledBytes = item.received
        }
        if now.timeIntervalSince(item.reportedAt) >= 0.25 {
          item.reportedAt = now
          self.report(item)
        }
      }
    }
  }

  private func detach(_ item: Item) {
    if let download = item.download { byDownload.removeValue(forKey: ObjectIdentifier(download)) }
    item.progress = nil
    item.download = nil
  }

  private func item(for download: WKDownload) -> Item? { byDownload[ObjectIdentifier(download)].flatMap { items[$0] } }

  private func report(_ item: Item) {
    WebKitHub.shared.events?("onDownload", [
      "id": item.id, "url": item.url, "filename": item.filename, "path": item.path, "state": item.state,
      "paused": item.phase == .pausing || item.phase == .paused || item.phase == .resuming,
      "received": Double(item.received), "total": Double(item.total), "speed": item.speed, "mimeType": item.mimeType,
      "profile": item.profile, "offTheRecord": false,
    ])
  }

  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                completionHandler: @escaping (URL?) -> Void) {
    guard let item = item(for: download) else { return completionHandler(nil) }
    if !item.path.isEmpty {
      try? FileManager.default.removeItem(atPath: item.path)
      return completionHandler(URL(fileURLWithPath: item.path))
    }
    let name = Self.safeName(suggestedFilename.isEmpty ? (response.suggestedFilename ?? "download") : suggestedFilename)
    let place = destination(for: item.profile)
    item.mimeType = response.mimeType ?? ""
    item.total = max(0, response.expectedContentLength)
    let accept = { (target: URL?) in
      guard let target else {
        completionHandler(nil)
        return
      }
      item.filename = target.lastPathComponent
      item.path = target.path
      self.report(item)
      completionHandler(target)
    }
    guard place.ask, !WebKitHub.background else { return accept(Self.unique(place.folder.appendingPathComponent(name))) }
    let panel = NSSavePanel()
    panel.directoryURL = place.folder
    panel.nameFieldStringValue = name
    panel.begin { response in
      if response == .OK, let url = panel.url {
        try? FileManager.default.removeItem(at: url)
        accept(url)
      } else {
        item.phase = .done
        item.state = "cancelled"
        accept(nil)
      }
    }
  }

  func downloadDidFinish(_ download: WKDownload) {
    guard let item = item(for: download) else { return }
    item.phase = .done
    item.state = "finished"
    if item.total < item.received { item.total = item.received }
    detach(item)
    report(item)
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    guard let item = item(for: download) else { return }
    detach(item)
    switch item.phase {
    case .pausing, .paused:
      if let resumeData { item.resumeData = resumeData }
      item.phase = .paused
    case .done:
      break
    case .running, .resuming:
      item.phase = .done
      item.state = (error as NSError).code == NSURLErrorCancelled ? "cancelled" : "failed"
    }
    report(item)
  }

  func handles(_ id: String) -> Bool { id.hasPrefix("wk-download-") }

  func command(_ action: String, id: String) {
    guard let item = items[id] else { return }
    switch action {
    case "cancel":
      guard item.phase != .done else { return }
      let download = item.download
      item.phase = .done
      item.state = "cancelled"
      item.resumeData = nil
      detach(item)
      download?.cancel(nil)
      report(item)
    case "pause":
      guard item.phase == .running, let download = item.download else { return }
      item.phase = .pausing
      report(item)
      download.cancel { [weak self] data in
        DispatchQueue.main.async {
          if let data { item.resumeData = data }
          if item.download === download { self?.detach(item) }
          if item.phase == .pausing { item.phase = .paused }
        }
      }
    case "resume":
      guard item.phase == .paused, let data = item.resumeData else { return }
      item.phase = .resuming
      item.resumeData = nil
      let host = item.webView ?? WebKitHub.shared.resumeHost(for: item.profile)
      host.resumeDownload(fromResumeData: data) { [weak self] download in
        DispatchQueue.main.async {
          guard let self else { return }
          guard item.phase == .resuming else { return download.cancel(nil) }
          item.phase = .running
          item.sampledAt = Date()
          item.sampledBytes = item.received
          self.attach(download, to: item)
          self.report(item)
        }
      }
    default: break
    }
  }

  static func safeName(_ name: String) -> String {
    let cleaned = name.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: ":", with: "_")
    let trimmed = cleaned.trimmingCharacters(in: CharacterSet(charactersIn: ". ").union(.whitespacesAndNewlines))
    return trimmed.isEmpty ? "download" : trimmed
  }

  static func unique(_ url: URL) -> URL {
    let manager = FileManager.default
    guard manager.fileExists(atPath: url.path) else { return url }
    let base = url.deletingPathExtension().lastPathComponent
    let ext = url.pathExtension
    for n in 1...9999 {
      let name = ext.isEmpty ? "\(base) (\(n))" : "\(base) (\(n)).\(ext)"
      let candidate = url.deletingLastPathComponent().appendingPathComponent(name)
      if !manager.fileExists(atPath: candidate.path) { return candidate }
    }
    return url
  }
}
