// The Dock tile of the app's former name. Beside LegacyMigration.swift: the old names come from LegacyName there.
//
// The Dock keeps a pinned app as a tile in com.apple.dock's persistent-apps: its URL, label and bundle id, plus a
// bookmark and dates it rebuilds when they're missing. An install updated across the rename (0.2.33) renamed itself
// to Ardia.app (LegacyMigration.moveToNewName), but a tile pinned before still names the old app: the Dock shows it
// with the old icon and label, dead, and the running app as a second, unpinned tile. Once per Mac, shortly after
// launch, the installed copy points that tile at itself where it stands (or drops it when this app is already pinned)
// and restarts the Dock so it reads the change.
import AppKit
import Foundation

public enum LegacyDockTile {
  static let dockDomain = "com.apple.dock" as CFString
  static let dockBundleId = "com.apple.dock"
  static let persistentApps = "persistent-apps" as CFString
  /// Set in this app's defaults once the Dock has the repointed list (or never had an old tile); never looked at again.
  static let doneKey = "LegacyDockTileChecked"
  /// Set before the list is written, cleared once the Dock has restarted: a launch that stopped in between restarts it.
  static let restartKey = "LegacyDockTileRestartPending"

  /// What a path holds: a file (its identity, so two spellings of one file match on any volume), nothing, or what
  /// couldn't be told (no permission, say: never taken for nothing).
  enum Identity: Hashable {
    case file(String)
    case absent
    case unknown
  }

  /// What the repointing needs to know of the disk, and whether `app`'s folder ignores case, for a path that's gone.
  struct Disk {
    let identity: (String) -> Identity
    let caseInsensitive: Bool

    /// The real disk, for an app in `folder`.
    static func live(folder: URL) -> Disk {
      let values = try? folder.resourceValues(forKeys: [.volumeSupportsCaseSensitiveNamesKey])
      return Disk(
        identity: { path in
          var info = stat()
          if stat(path, &info) == 0 { return .file("\(info.st_dev):\(info.st_ino)") }
          return errno == ENOENT || errno == ENOTDIR ? .absent : .unknown
        },
        caseInsensitive: values?.volumeSupportsCaseSensitiveNames == false)
    }
  }

  struct Result {
    /// The new list; nil when nothing changes.
    let tiles: [[String: Any]]?
    /// An old app's tile stays because that app is still there (or it couldn't be told): look again on a later launch.
    let keptLive: Bool
  }

  enum Kind { case other, dead, live }

  /// The persistent-apps list with the old app's dead tiles pointed at `app` (or removed when it's already pinned). A
  /// pure function of the list and `disk`, so it's tested on fixtures (LegacyDockTileTests).
  ///
  /// The old app's tile: one with the old bundle id, or whose URL is the old file name in `app`'s folder; one without
  /// an absolute file URL is left alone. It's dead when nothing is at its URL, or `app` itself is (the Dock followed
  /// the rename through its bookmark but kept the old id and label); one of an old copy still on disk, or whose file
  /// can't be looked at, stays as it is. The first dead tile becomes this app's, in its place, unless a tile already is
  /// (by bundle id or file); every other dead tile goes. Only tiles named like the old app or this one are looked up on
  /// disk: a pinned folder on a server that's gone never holds it up.
  static func repointed(_ tiles: [[String: Any]], app: URL, bundleId: String, label: String, disk: Disk) -> Result {
    let appPath = standardized(app.path)
    let oldPath = standardized(app.deletingLastPathComponent().appendingPathComponent(LegacyName.appFileName).path)
    let appID = disk.identity(appPath), oldID = disk.identity(oldPath)
    func named(_ path: String, like other: String) -> Bool {
      (path as NSString).lastPathComponent.lowercased() == (other as NSString).lastPathComponent.lowercased()
    }
    /// The same file: by identity when both are there, else by spelling (any case where the volume ignores it).
    func same(_ path: String, _ id: Identity, _ other: String, _ otherID: Identity) -> Bool {
      if case .file = id, case .file = otherID { return id == otherID }
      return disk.caseInsensitive ? path.lowercased() == other.lowercased() : path == other
    }
    func kind(_ tile: [String: Any]) -> Kind {
      guard let data = tile["tile-data"] as? [String: Any], let path = filePath(data) else { return .other }
      let byId = (data["bundle-identifier"] as? String)?.lowercased() == LegacyName.bundleId
      guard byId || named(path, like: oldPath) else { return .other }
      let id = disk.identity(path)
      guard byId || same(path, id, oldPath, oldID) else { return .other }
      switch id {
      case .absent: return .dead
      case .file: return id == appID ? .dead : .live
      case .unknown: return .live
      }
    }
    func isOurs(_ tile: [String: Any]) -> Bool {
      guard let data = tile["tile-data"] as? [String: Any] else { return false }
      if (data["bundle-identifier"] as? String)?.lowercased() == bundleId.lowercased() { return true }
      guard let path = filePath(data), named(path, like: appPath) else { return false }
      return same(path, disk.identity(path), appPath, appID)
    }
    let kinds = tiles.map(kind)
    let keptLive = kinds.contains(.live)
    guard kinds.contains(.dead) else { return Result(tiles: nil, keptLive: keptLive) }
    var pinned = tiles.indices.contains { kinds[$0] != .dead && isOurs(tiles[$0]) }
    var result: [[String: Any]] = []
    for (tile, kind) in zip(tiles, kinds) {
      guard kind == .dead else {
        result.append(tile)
        continue
      }
      if pinned { continue }
      pinned = true
      result.append(rewritten(tile, app: app, bundleId: bundleId, label: label))
    }
    return Result(tiles: result, keptLive: keptLive)
  }

  /// `tile` as this app's, in its place (its GUID, tile type, file type and Dock tile plug-in flag stay): its URL,
  /// label and id. The bookmark and the dates are the old app's; without them the Dock makes them anew for this one.
  static func rewritten(_ tile: [String: Any], app: URL, bundleId: String, label: String) -> [String: Any] {
    var tile = tile
    var data = (tile["tile-data"] as? [String: Any]) ?? [:]
    for key in ["book", "file-mod-date", "parent-mod-date"] { data.removeValue(forKey: key) }
    data["bundle-identifier"] = bundleId
    data["file-label"] = label
    data["file-data"] = ["_CFURLString": URL(fileURLWithPath: app.path, isDirectory: true).absoluteString, "_CFURLStringType": 15]
    tile["tile-data"] = data
    return tile
  }

  /// A tile's absolute file path: `_CFURLString` is a file URL on this Mac (type 15) or a POSIX path (type 0); nil
  /// for anything else (another scheme, a relative URL or path, another host).
  static func filePath(_ data: [String: Any]) -> String? {
    guard let file = data["file-data"] as? [String: Any], let string = file["_CFURLString"] as? String, !string.isEmpty,
      let type = file["_CFURLStringType"] as? Int else { return nil }
    switch type {
    case 0: return string.hasPrefix("/") ? standardized(string) : nil
    case 15:
      guard string.lowercased().hasPrefix("file:///") || string.lowercased().hasPrefix("file://localhost/"),
        let url = URL(string: string), url.isFileURL, url.path.hasPrefix("/") else { return nil }
      return standardized(url.path)
    default: return nil
    }
  }

  /// No trailing slash, no `.` or `..`.
  static func standardized(_ path: String) -> String { (path as NSString).standardizingPath }

  /// The installed copy, once per Mac: repoints the old tile (repointed) in com.apple.dock and restarts the Dock. Called
  /// once the app has finished launching (Chromium's single-instance check is behind it, so a second launch never gets
  /// here), it waits a few seconds and works on a background queue: nothing in it can hold up startup. A development
  /// build, a test instance, a translocated copy, one still under the old name and one outside /Applications and
  /// ~/Applications never touch the Dock.
  public static func repointSoon(bundle: Bundle = .main) {
    #if !DEBUG
    // A development build is never the installed copy (and needs a data dir to start at all).
    guard !isTestInstance(ProcessInfo.processInfo.environment), let bundleId = bundle.bundleIdentifier,
      bundleId.lowercased() != LegacyName.bundleId else { return }
    let defaults = UserDefaults.standard
    guard !defaults.bool(forKey: doneKey) else { return }
    let app = bundle.bundleURL
    guard isInstalled(app) else { return }
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 5) {
      run(Seams(
        read: { CFPreferencesCopyAppValue(persistentApps, dockDomain) as? [[String: Any]] },
        write: { tiles in
          CFPreferencesSetAppValue(persistentApps, tiles as CFArray, dockDomain)
          return CFPreferencesAppSynchronize(dockDomain)
        },
        restart: restartDock,
        flag: { defaults.bool(forKey: $0) },
        // On disk before the next step: a launch that stops right after still finds it.
        setFlag: { key, value in
          if value { defaults.set(true, forKey: key) } else { defaults.removeObject(forKey: key) }
          defaults.synchronize()
        },
        disk: .live(folder: app.deletingLastPathComponent())),
        app: app, bundleId: bundleId)
    }
    #endif
  }

  /// A hidden test instance: ARDIA_DATA_DIR or ARDIA_BACKGROUND set at all, even empty (ArdiaCoreActivation.mm checks
  /// only that it's there).
  static func isTestInstance(_ env: [String: String]) -> Bool { env["ARDIA_DATA_DIR"] != nil || env["ARDIA_BACKGROUND"] != nil }

  /// The Dock's preferences, its restart and this app's flags (the real ones, or a test's).
  struct Seams {
    let read: () -> [[String: Any]]?
    /// Written through to cfprefsd: true once it has them.
    let write: ([[String: Any]]) -> Bool
    let restart: () -> Bool
    let flag: (String) -> Bool
    let setFlag: (String, Bool) -> Void
    let disk: Disk
  }

  /// One launch's try. Done (doneKey) once the Dock has restarted with the new list, or never had a dead old tile,
  /// and no old tile is kept for an old copy still on disk. Until then a later launch tries again: an unreadable list
  /// or a failed write changes nothing, and the Dock restarts only after a write, or when the last launch stopped or
  /// failed between writing and restarting (restartKey), so never on every launch.
  static func run(_ seams: Seams, app: URL, bundleId: String) {
    guard !seams.flag(doneKey), let tiles = seams.read() else { return }
    let label = app.deletingPathExtension().lastPathComponent
    let repoint = { (tiles: [[String: Any]]) in repointed(tiles, app: app, bundleId: bundleId, label: label, disk: seams.disk) }
    var result = repoint(tiles)
    if result.tiles != nil {
      // The list as it is now (a tile pinned meanwhile stays), and only if it still needs it.
      guard let fresh = seams.read() else { return }
      result = repoint(fresh)
      if let updated = result.tiles {
        seams.setFlag(restartKey, true)
        guard seams.write(updated) else {
          NSLog("Ardia: couldn't repoint the Dock's \(LegacyName.appName) tile; trying again next launch")
          seams.setFlag(restartKey, false)
          return
        }
        NSLog("Ardia: the Dock's \(LegacyName.appName) tile now opens \(app.path); restarting the Dock")
      }
    }
    if seams.flag(restartKey) {
      guard seams.restart() else {
        NSLog("Ardia: couldn't restart the Dock; trying again next launch")
        return
      }
      seams.setFlag(restartKey, false)
    }
    if !result.keptLive { seams.setFlag(doneKey, true) }
  }

  /// Quits the Dock (SIGTERM, as `killall Dock` does); launchd starts it again and it reads its preferences anew. A
  /// signal, not a quit Apple event: that would ask the user to let Ardia control the Dock. True when every Dock
  /// process got it or was gone already, and when none runs (it reads them when it starts).
  static func restartDock() -> Bool {
    NSRunningApplication.runningApplications(withBundleIdentifier: dockBundleId).allSatisfy { dock in
      dock.isTerminated || kill(dock.processIdentifier, SIGTERM) == 0 || errno == ESRCH
    }
  }

  /// In /Applications or ~/Applications, not translocated, under its new name.
  static func isInstalled(_ app: URL) -> Bool {
    let path = app.standardizedFileURL.path
    guard !path.contains("/AppTranslocation/"), app.lastPathComponent != LegacyName.appFileName else { return false }
    let resolved = { (url: URL) in url.resolvingSymlinksInPath().standardizedFileURL.path }
    let folder = resolved(app.deletingLastPathComponent())
    let home = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications")
    return folder == resolved(URL(fileURLWithPath: "/Applications")) || folder == resolved(home)
  }
}
