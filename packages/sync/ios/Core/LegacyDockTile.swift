// The Dock tile of the app's former name. Beside LegacyMigration.swift: the old names come from LegacyName there.
//
// The Dock keeps a pinned app as a tile in com.apple.dock's persistent-apps: its URL, label and bundle id, plus a
// bookmark and dates it rebuilds when they're missing. An install updated across the rename (0.2.33) renamed itself
// to Ardia.app (LegacyMigration.moveToNewName), but a tile pinned before still names the old app: the Dock shows it
// with the old icon and label, dead, and the running app as a second, unpinned tile. Once per Mac, at launch, the
// installed copy points that tile at itself where it stands (or drops it when this app is already pinned) and restarts
// the Dock so it reads the change.
import AppKit
import Foundation

public enum LegacyDockTile {
  static let dockDomain = "com.apple.dock" as CFString
  static let persistentApps = "persistent-apps" as CFString
  /// Set in this app's defaults once the Dock has the repointed list (or never had an old tile); never looked at again.
  static let doneKey = "LegacyDockTileChecked"
  /// The list was written but the Dock didn't restart: the next launch restarts it (and doesn't write again).
  static let restartKey = "LegacyDockTileRestartPending"

  /// What the repointing needs to know of the disk: a file's identity (nil: nothing there), so two spellings of one
  /// path match on any volume, and whether `app`'s folder ignores case, for a path that's gone.
  struct Disk {
    let identity: (String) -> AnyHashable?
    let caseInsensitive: Bool

    /// The real disk, for an app in `folder`.
    static func live(folder: URL) -> Disk {
      let values = try? folder.resourceValues(forKeys: [.volumeSupportsCaseSensitiveNamesKey])
      return Disk(
        identity: { path in
          var info = stat()
          guard stat(path, &info) == 0 else { return nil }
          return "\(info.st_dev):\(info.st_ino)"
        },
        caseInsensitive: values?.volumeSupportsCaseSensitiveNames == false)
    }
  }

  struct Result {
    /// The new list; nil when nothing changes.
    let tiles: [[String: Any]]?
    /// An old app's tile stays because that app is still there: look again on a later launch.
    let keptLive: Bool
  }

  enum Kind { case other, dead, live }

  /// The persistent-apps list with the old app's dead tiles pointed at `app` (or removed when it's already pinned). A
  /// pure function of the list and `disk`, so it's tested on fixtures (LegacyDockTileTests).
  ///
  /// The old app's tile: one with the old bundle id, or whose URL is the old file name in `app`'s folder; one without
  /// a file URL is left alone. It's dead when its URL leads nowhere, or to `app` itself (the Dock followed the rename
  /// through its bookmark but kept the old id and label); one of an old copy still on disk stays as it is. The first
  /// dead tile becomes this app's, in its place, unless a tile already is (by bundle id or file); every other dead
  /// tile goes.
  static func repointed(_ tiles: [[String: Any]], app: URL, bundleId: String, label: String, disk: Disk) -> Result {
    let appPath = standardized(app.path)
    let oldPath = standardized(app.deletingLastPathComponent().appendingPathComponent(LegacyName.appFileName).path)
    let appID = disk.identity(appPath), oldID = disk.identity(oldPath)
    func same(_ path: String, _ other: String, _ otherID: AnyHashable?) -> Bool {
      if let id = disk.identity(path), let otherID { return id == otherID }
      return disk.caseInsensitive ? path.lowercased() == other.lowercased() : path == other
    }
    func kind(_ tile: [String: Any]) -> Kind {
      guard let data = tile["tile-data"] as? [String: Any], let path = filePath(data) else { return .other }
      let byId = (data["bundle-identifier"] as? String)?.lowercased() == LegacyName.bundleId
      guard byId || same(path, oldPath, oldID) else { return .other }
      if let appID, disk.identity(path) == appID { return .dead }
      return disk.identity(path) == nil ? .dead : .live
    }
    func isOurs(_ tile: [String: Any]) -> Bool {
      guard let data = tile["tile-data"] as? [String: Any] else { return false }
      if (data["bundle-identifier"] as? String)?.lowercased() == bundleId.lowercased() { return true }
      return filePath(data).map { same($0, appPath, appID) } ?? false
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

  /// A tile's file path: `_CFURLString` is a file URL (type 15) or a POSIX path (type 0); nil for anything else.
  static func filePath(_ data: [String: Any]) -> String? {
    guard let file = data["file-data"] as? [String: Any], let string = file["_CFURLString"] as? String, !string.isEmpty,
      let type = file["_CFURLStringType"] as? Int else { return nil }
    switch type {
    case 0: return string.hasPrefix("/") ? standardized(string) : nil
    case 15:
      guard let url = URL(string: string), url.isFileURL, !url.path.isEmpty else { return nil }
      return standardized(url.path)
    default: return nil
    }
  }

  /// No trailing slash, no `.` or `..`.
  static func standardized(_ path: String) -> String { (path as NSString).standardizingPath }

  /// The installed copy, once per Mac: repoints the old tile (repointed) in com.apple.dock and restarts the Dock. A
  /// development build, a test instance, a translocated copy, one still under the old name and one outside
  /// /Applications and ~/Applications never touch the Dock.
  public static func repointAtLaunch(bundle: Bundle = .main) {
    #if DEBUG
    // A development build is never the installed copy (and needs a data dir to start at all).
    return
    #else
    guard !isTestInstance(ProcessInfo.processInfo.environment), let bundleId = bundle.bundleIdentifier,
      bundleId.lowercased() != LegacyName.bundleId else { return }
    let defaults = UserDefaults.standard
    guard !defaults.bool(forKey: doneKey) else { return }
    let app = bundle.bundleURL
    guard isInstalled(app) else { return }
    run(Seams(
      read: { CFPreferencesCopyAppValue(persistentApps, dockDomain) as? [[String: Any]] },
      write: { tiles in
        CFPreferencesSetAppValue(persistentApps, tiles as CFArray, dockDomain)
        return CFPreferencesAppSynchronize(dockDomain)
      },
      restart: restartDock,
      flag: { defaults.bool(forKey: $0) },
      setFlag: { key, value in value ? defaults.set(true, forKey: key) : defaults.removeObject(forKey: key) },
      disk: .live(folder: app.deletingLastPathComponent())),
      app: app, bundleId: bundleId)
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
  /// or a failed write changes nothing, and the Dock restarts only after a write, or when the last restart failed
  /// (restartKey), so never on every launch.
  static func run(_ seams: Seams, app: URL, bundleId: String) {
    guard !seams.flag(doneKey), let tiles = seams.read() else { return }
    let label = app.deletingPathExtension().lastPathComponent
    let result = repointed(tiles, app: app, bundleId: bundleId, label: label, disk: seams.disk)
    if let updated = result.tiles {
      guard seams.write(updated) else {
        NSLog("Ardia: couldn't repoint the Dock's \(LegacyName.appName) tile; trying again next launch")
        return
      }
      NSLog("Ardia: the Dock's \(LegacyName.appName) tile now opens \(app.path); restarting the Dock")
      seams.setFlag(restartKey, true)
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

  /// `killall Dock`: launchd starts it again, and it reads its preferences anew. True when it quit, or wasn't running
  /// (it reads them when it starts).
  static func restartDock() -> Bool {
    let killall = Process()
    killall.executableURL = URL(fileURLWithPath: "/usr/bin/killall")
    killall.arguments = ["Dock"]
    killall.standardOutput = FileHandle.nullDevice
    killall.standardError = FileHandle.nullDevice
    guard (try? killall.run()) != nil else { return false }
    killall.waitUntilExit()
    return killall.terminationStatus <= 1
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
