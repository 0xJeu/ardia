import Foundation
import XCTest
@testable import ArdiaSyncCore

/// A disk holding `files`; on a case-insensitive one, any spelling of a file is that file. `unknown` paths can't be
/// looked at (no permission); `looked` lists every path asked about.
final class FakeDisk {
  var looked: [String] = []
  func disk(_ files: Set<String>, unknown: Set<String> = [], caseInsensitive: Bool = true) -> LegacyDockTile.Disk {
    let key = { (path: String) in caseInsensitive ? path.lowercased() : path }
    let known = Set(files.map(key)), hidden = Set(unknown.map(key))
    return LegacyDockTile.Disk(
      identity: { path in
        self.looked.append(path)
        if hidden.contains(key(path)) { return .unknown }
        return known.contains(key(path)) ? .file(key(path)) : .absent
      },
      caseInsensitive: caseInsensitive)
  }
}

func fakeDisk(_ files: Set<String>, unknown: Set<String> = [], caseInsensitive: Bool = true) -> LegacyDockTile.Disk {
  FakeDisk().disk(files, unknown: unknown, caseInsensitive: caseInsensitive)
}

/// The Dock's persistent-apps as fixtures, shaped like a real list (the old names come from LegacyName).
final class LegacyDockTileTests: XCTestCase {
  let app = URL(fileURLWithPath: "/Applications/Ardia.app", isDirectory: true)
  let bundleId = "com.ardia.browser"
  let oldURL = "file:///Applications/\(LegacyName.appFileName)/"
  let oldAppPath = "/Applications/\(LegacyName.appFileName)"

  func tile(_ id: String, _ url: String, label: String, guid: Int = 1) -> [String: Any] {
    [
      "GUID": guid,
      "tile-type": "file-tile",
      "tile-data": [
        "book": Data([0x62, 0x6f, 0x6f, 0x6b]),
        "bundle-identifier": id,
        "dock-extra": 1,
        "file-data": ["_CFURLString": url, "_CFURLStringType": 15],
        "file-label": label,
        "file-mod-date": 200720580963911,
        "file-type": 41,
        "is-beta": 0,
        "parent-mod-date": 205938966538965,
      ] as [String: Any],
    ]
  }

  var messages: [String: Any] { tile("com.apple.MobileSMS", "file:///System/Applications/Messages.app/", label: "Messages", guid: 10) }
  var dia: [String: Any] { tile("company.thebrowser.dia", "file:///Applications/Dia.app/", label: "Dia", guid: 11) }
  var oldTile: [String: Any] { tile(LegacyName.bundleId, oldURL, label: LegacyName.appName, guid: 12) }
  var ardiaTile: [String: Any] { tile(bundleId, "file:///Applications/Ardia.app/", label: "Ardia", guid: 13) }

  func repoint(_ tiles: [[String: Any]], disk: LegacyDockTile.Disk? = nil) -> LegacyDockTile.Result {
    LegacyDockTile.repointed(tiles, app: app, bundleId: bundleId, label: "Ardia", disk: disk ?? fakeDisk(["/Applications/Ardia.app"]))
  }

  func data(_ tile: [String: Any]) -> [String: Any] { tile["tile-data"] as! [String: Any] }
  func ids(_ tiles: [[String: Any]]?) -> [String]? { tiles?.map { data($0)["bundle-identifier"] as! String } }
  func with(_ tile: [String: Any], _ change: (inout [String: Any]) -> Void) -> [String: Any] {
    var tile = tile, fields = data(tile)
    change(&fields)
    tile["tile-data"] = fields
    return tile
  }

  func testTheOldTileIsRewrittenInPlace() throws {
    let result = repoint([messages, oldTile, dia])
    let tiles = try XCTUnwrap(result.tiles)
    XCTAssertFalse(result.keptLive)
    XCTAssertEqual(ids(tiles), ["com.apple.MobileSMS", bundleId, "company.thebrowser.dia"])
    let rewritten = tiles[1], fields = data(rewritten)
    XCTAssertEqual(fields["file-label"] as? String, "Ardia")
    XCTAssertEqual(fields["file-data"] as? [String: AnyHashable], ["_CFURLString": "file:///Applications/Ardia.app/", "_CFURLStringType": 15])
    // What the Dock rebuilds for the new app goes; what places and describes the tile stays.
    for key in ["book", "file-mod-date", "parent-mod-date"] { XCTAssertNil(fields[key], key) }
    XCTAssertEqual(rewritten["GUID"] as? Int, 12)
    XCTAssertEqual(rewritten["tile-type"] as? String, "file-tile")
    XCTAssertEqual(fields["file-type"] as? Int, 41)
    XCTAssertEqual(fields["dock-extra"] as? Int, 1)
    XCTAssertEqual(NSArray(array: [tiles[0], tiles[2]]), NSArray(array: [messages, dia]))
  }

  func testWhenArdiaIsPinnedTooTheOldTileGoes() throws {
    XCTAssertEqual(NSArray(array: try XCTUnwrap(repoint([oldTile, messages, ardiaTile]).tiles)), NSArray(array: [messages, ardiaTile]))
    // Pinned by its file alone, in another spelling, counts too.
    let byFile = with(ardiaTile) {
      $0["bundle-identifier"] = "something.else"
      $0["file-data"] = ["_CFURLString": "file:///Applications/ARDIA.app", "_CFURLStringType": 15]
    }
    XCTAssertEqual(NSArray(array: try XCTUnwrap(repoint([oldTile, byFile]).tiles)), NSArray(array: [byFile]))
  }

  func testNoOldTileChangesNothing() {
    for tiles in [[messages, dia], [messages, ardiaTile], []] {
      let result = repoint(tiles)
      XCTAssertNil(result.tiles)
      XCTAssertFalse(result.keptLive)
    }
  }

  func testAnOldAppStillThereKeepsItsTileAndIsLookedAtAgain() {
    let result = repoint([messages, oldTile], disk: fakeDisk(["/Applications/Ardia.app", oldAppPath]))
    XCTAssertNil(result.tiles)
    XCTAssertTrue(result.keptLive)
    // Matched by its file alone (another id), still there.
    let byPath = with(oldTile) { $0["bundle-identifier"] = "" }
    let alone = repoint([byPath], disk: fakeDisk(["/Applications/Ardia.app", oldAppPath]))
    XCTAssertNil(alone.tiles)
    XCTAssertTrue(alone.keptLive)
    // Once it's gone, the same tile is repointed.
    XCTAssertEqual(ids(repoint([byPath]).tiles), [bundleId])
  }

  func testADeadOldTileIsRepointedWhileALiveOneStays() throws {
    let live = tile(LegacyName.bundleId, "file:///Users/me/Old/\(LegacyName.appFileName)/", label: LegacyName.appName, guid: 20)
    let result = repoint([oldTile, live], disk: fakeDisk(["/Applications/Ardia.app", "/Users/me/Old/\(LegacyName.appFileName)"]))
    XCTAssertEqual(ids(result.tiles), [bundleId, LegacyName.bundleId])
    XCTAssertEqual(NSArray(array: [try XCTUnwrap(result.tiles)[1]]), NSArray(array: [live]))
    XCTAssertTrue(result.keptLive)
  }

  func testOldTilesAreFoundByIdOrByPath() throws {
    // The old id anywhere (a copy that's gone), in any case.
    let elsewhere = tile(LegacyName.bundleId.uppercased(), "file:///Users/me/Downloads/\(LegacyName.appFileName)/", label: LegacyName.appName)
    XCTAssertEqual(ids(repoint([elsewhere]).tiles), [bundleId])
    // The Dock followed the rename through its bookmark but kept the old id and label.
    let followed = tile(LegacyName.bundleId, "file:///Applications/Ardia.app/", label: LegacyName.appName)
    XCTAssertEqual(data(try XCTUnwrap(repoint([followed]).tiles)[0])["file-label"] as? String, "Ardia")
    // A POSIX path (type 0) reads as one.
    let posix = with(oldTile) { $0["file-data"] = ["_CFURLString": self.oldAppPath, "_CFURLStringType": 0] }
    XCTAssertNil(repoint([posix], disk: fakeDisk(["/Applications/Ardia.app", oldAppPath])).tiles)
    XCTAssertEqual(ids(repoint([posix]).tiles), [bundleId])
    // Another app of that name elsewhere isn't ours.
    XCTAssertNil(repoint([tile("other.app", "file:///Users/me/\(LegacyName.appFileName)/", label: "x")]).tiles)
  }

  func testATileWithoutAFileURLIsLeftAlone() {
    let malformed: [[String: Any]] = [
      with(oldTile) { $0.removeValue(forKey: "file-data") },
      with(oldTile) { $0["file-data"] = ["_CFURLString": "https://example.com/", "_CFURLStringType": 15] },
      with(oldTile) { $0["file-data"] = ["_CFURLString": "", "_CFURLStringType": 15] },
      with(oldTile) { $0["file-data"] = ["_CFURLString": "relative/path", "_CFURLStringType": 0] },
      with(oldTile) { $0["file-data"] = ["_CFURLString": oldURL] },
      // Relative file URLs, and one on another host.
      with(oldTile) { $0["file-data"] = ["_CFURLString": "file:\(LegacyName.appFileName)/", "_CFURLStringType": 15] },
      with(oldTile) { $0["file-data"] = ["_CFURLString": "file:Applications/\(LegacyName.appFileName)/", "_CFURLStringType": 15] },
      with(oldTile) { $0["file-data"] = ["_CFURLString": "file://server/Applications/\(LegacyName.appFileName)/", "_CFURLStringType": 15] },
      ["tile-type": "spacer-tile", "tile-data": [:] as [String: Any]],
    ]
    for tile in malformed {
      let result = repoint([tile])
      XCTAssertNil(result.tiles)
      XCTAssertFalse(result.keptLive)
    }
  }

  func testOnACaseSensitiveVolumeOnlyTheSameFileMatches() {
    let sensitive = fakeDisk(["/Applications/Ardia.app"], caseInsensitive: false)
    // Another spelling of the old name is another file there.
    let lower = tile("", "file:///Applications/\(LegacyName.appFileName.lowercased())/", label: "x")
    XCTAssertNil(repoint([lower], disk: sensitive).tiles)
    XCTAssertEqual(ids(repoint([lower]).tiles), [bundleId])
    // So is another spelling of this app: an old tile next to it isn't "already pinned".
    let other = tile("something.else", "file:///Applications/ardia.app/", label: "ardia")
    XCTAssertEqual(ids(repoint([oldTile, other], disk: sensitive).tiles), [bundleId, "something.else"])
    XCTAssertEqual(ids(repoint([oldTile, other]).tiles), ["something.else"])
  }

  func testAnOldAppThatCantBeLookedAtKeepsItsTile() {
    // Not "missing": a copy there may be live (no permission to look, a volume that didn't answer).
    let result = repoint([messages, oldTile], disk: fakeDisk(["/Applications/Ardia.app"], unknown: [oldAppPath]))
    XCTAssertNil(result.tiles)
    XCTAssertTrue(result.keptLive)
  }

  func testOnlyTilesNamedLikeEitherAppAreLookedUp() {
    let disk = FakeDisk()
    let share = tile("", "file:///Volumes/Gone/Folder/", label: "Folder")
    _ = LegacyDockTile.repointed([messages, dia, share, oldTile, ardiaTile], app: app, bundleId: bundleId, label: "Ardia",
                                 disk: disk.disk(["/Applications/Ardia.app"]))
    XCTAssertFalse(disk.looked.contains { $0.hasPrefix("/Volumes") || $0.hasPrefix("/System") || $0.hasSuffix("Dia.app") }, "\(disk.looked)")
  }

  func testAFileURLOnThisMacMayNameLocalhost() {
    let localhost = with(oldTile) { $0["file-data"] = ["_CFURLString": "file://localhost/Applications/\(LegacyName.appFileName)/", "_CFURLStringType": 15] }
    XCTAssertEqual(ids(repoint([localhost]).tiles), [bundleId])
  }

  func testADeadArdiaTileIsntPinnedAndGoesLikeTheOldOne() throws {
    let downloads = "/Users/me/Downloads/Ardia.app"
    let deadArdia = tile(bundleId, "file://\(downloads)/", label: "Ardia", guid: 30)
    // Not "already pinned": the old tile becomes this app's, and the dead Ardia goes.
    let result = try XCTUnwrap(repoint([oldTile, messages, deadArdia]).tiles)
    XCTAssertEqual(ids(result), [bundleId, "com.apple.MobileSMS"])
    XCTAssertEqual(result[0]["GUID"] as? Int, 12)
    XCTAssertEqual(data(result[0])["file-data"] as? [String: AnyHashable], ["_CFURLString": "file:///Applications/Ardia.app/", "_CFURLStringType": 15])
    // The first dead tile of either app becomes this app's, in its place.
    let first = try XCTUnwrap(repoint([deadArdia, messages, oldTile]).tiles)
    XCTAssertEqual(ids(first), [bundleId, "com.apple.MobileSMS"])
    XCTAssertEqual(first[0]["GUID"] as? Int, 30)
    XCTAssertEqual(data(first[0])["file-data"] as? [String: AnyHashable], ["_CFURLString": "file:///Applications/Ardia.app/", "_CFURLStringType": 15])
    // Without an old tile it's none of this repair's business.
    XCTAssertNil(repoint([deadArdia, messages]).tiles)
    // An Ardia that's there is pinned; one that can't be looked at is left alone and isn't counted.
    XCTAssertEqual(ids(repoint([oldTile, deadArdia], disk: fakeDisk(["/Applications/Ardia.app", downloads])).tiles), [bundleId])
    XCTAssertEqual(data(try XCTUnwrap(repoint([oldTile, deadArdia], disk: fakeDisk(["/Applications/Ardia.app", downloads])).tiles)[0])["file-data"]
      as? [String: AnyHashable], ["_CFURLString": "file://\(downloads)/", "_CFURLStringType": 15])
    let unknown = try XCTUnwrap(repoint([oldTile, deadArdia], disk: fakeDisk(["/Applications/Ardia.app"], unknown: [downloads])).tiles)
    XCTAssertEqual(NSArray(array: [unknown[1]]), NSArray(array: [deadArdia]))
    XCTAssertEqual(data(unknown[0])["file-data"] as? [String: AnyHashable], ["_CFURLString": "file:///Applications/Ardia.app/", "_CFURLStringType": 15])
  }

  func testTwoDeadOldTilesBecomeOne() {
    let second = tile(LegacyName.bundleId, "file:///Users/me/Applications/\(LegacyName.appFileName)/", label: LegacyName.appName)
    XCTAssertEqual(ids(repoint([oldTile, messages, second]).tiles), [bundleId, "com.apple.MobileSMS"])
  }

  // MARK: The launch

  /// The Dock's preferences as cfprefsd has them (`tiles`) and as this process last read them: a read is stale until
  /// a synchronize.
  final class FakeDock {
    var tiles: [[String: Any]]?
    private var cached: [[String: Any]]?
    private var everSynchronized = false
    var writes = 0, restarts = 0, synchronizes = 0
    var events: [String] = []
    /// Runs as each synchronize starts (another app changing the Dock meanwhile).
    var onSynchronize: ((Int) -> Void)?
    var writeWorks = true, restartWorks = true
    var flags: [String: Bool] = [:]
    var disk = fakeDisk(["/Applications/Ardia.app"])

    var seams: LegacyDockTile.Seams {
      let disk = self.disk
      return LegacyDockTile.Seams(
        synchronize: {
          self.synchronizes += 1
          self.onSynchronize?(self.synchronizes)
          self.events.append("sync")
          self.cached = self.tiles
          self.everSynchronized = true
        },
        read: {
          self.events.append("read")
          return self.everSynchronized ? self.cached : self.tiles
        },
        write: { tiles in
          self.writes += 1
          self.events.append("write")
          if self.writeWorks { self.tiles = tiles; self.cached = tiles }
          return self.writeWorks
        },
        restart: {
          self.restarts += 1
          self.events.append("restart")
          return self.restartWorks
        },
        flag: { self.flags[$0] ?? false },
        setFlag: {
          self.flags[$0] = $1 ? true : nil
          self.events.append("\($0)=\($1)")
        },
        disk: LegacyDockTile.Disk(identity: { path in
          self.events.append("stat")
          return disk.identity(path)
        }, caseInsensitive: disk.caseInsensitive))
    }
    var done: Bool { flags[LegacyDockTile.doneKey] == true }
    var state: String { "writes \(writes), restarts \(restarts), done \(done)" }
  }

  func launch(_ dock: FakeDock) { LegacyDockTile.run(dock.seams, app: app, bundleId: bundleId) }

  func testALaunchRepointsRestartsAndIsDone() {
    let dock = FakeDock()
    dock.tiles = [messages, oldTile]
    launch(dock)
    XCTAssertEqual(dock.state, "writes 1, restarts 1, done true")
    XCTAssertEqual(ids(dock.tiles), ["com.apple.MobileSMS", bundleId])
    launch(dock)
    XCTAssertEqual(dock.state, "writes 1, restarts 1, done true")
  }

  func testNothingToDoIsDoneWithoutARestart() {
    let dock = FakeDock()
    dock.tiles = [messages, ardiaTile]
    launch(dock)
    XCTAssertEqual(dock.state, "writes 0, restarts 0, done true")
  }

  func testAnUnreadableListOrAFailedWriteIsTriedAgain() {
    let dock = FakeDock()
    launch(dock)
    XCTAssertEqual(dock.state, "writes 0, restarts 0, done false")
    dock.tiles = [oldTile]
    dock.writeWorks = false
    launch(dock)
    XCTAssertEqual(dock.state, "writes 1, restarts 0, done false")
    dock.writeWorks = true
    launch(dock)
    XCTAssertEqual(dock.state, "writes 2, restarts 1, done true")
  }

  func testAFailedRestartIsRetriedWithoutWritingAgain() {
    let dock = FakeDock()
    dock.tiles = [oldTile]
    dock.restartWorks = false
    launch(dock)
    XCTAssertEqual(dock.state, "writes 1, restarts 1, done false")
    XCTAssertEqual(dock.flags[LegacyDockTile.restartKey], true)
    dock.restartWorks = true
    launch(dock)
    XCTAssertEqual(dock.state, "writes 1, restarts 2, done true")
    XCTAssertNil(dock.flags[LegacyDockTile.restartKey])
  }

  func testAKeptOldTileIsLookedAtAgainWithoutRestarts() {
    let dock = FakeDock()
    dock.tiles = [oldTile]
    dock.disk = fakeDisk(["/Applications/Ardia.app", oldAppPath])
    launch(dock)
    launch(dock)
    XCTAssertEqual(dock.state, "writes 0, restarts 0, done false")
    // The old copy is gone: repointed, once.
    dock.disk = fakeDisk(["/Applications/Ardia.app"])
    launch(dock)
    launch(dock)
    XCTAssertEqual(dock.state, "writes 1, restarts 1, done true")
  }

  func testTheRestartIsPendingBeforeTheListIsWritten() {
    let dock = FakeDock()
    dock.tiles = [oldTile]
    launch(dock)
    let steps = dock.events.filter { $0 != "stat" }
    XCTAssertEqual(steps, ["sync", "read", "\(LegacyDockTile.restartKey)=true", "sync", "read", "write", "restart",
                           "\(LegacyDockTile.restartKey)=false", "\(LegacyDockTile.doneKey)=true"])
    // The critical section (the second synchronize to the write) waits on nothing: no disk, no flags.
    let section = dock.events.lastIndex(of: "sync")!
    XCTAssertEqual(Array(dock.events[section...].prefix(3)), ["sync", "read", "write"])
  }

  func testALaunchThatStoppedAfterWritingRestartsTheDockNext() {
    // The list was written and the launch stopped before the restart.
    let dock = FakeDock()
    dock.tiles = repoint([oldTile]).tiles
    dock.flags[LegacyDockTile.restartKey] = true
    launch(dock)
    XCTAssertEqual(dock.state, "writes 0, restarts 1, done true")
    // One that stopped before writing writes it then.
    let early = FakeDock()
    early.tiles = [oldTile]
    early.flags[LegacyDockTile.restartKey] = true
    launch(early)
    XCTAssertEqual(early.state, "writes 1, restarts 1, done true")
  }

  func testAFailedWriteLeavesNoRestartPending() {
    let dock = FakeDock()
    dock.tiles = [oldTile]
    dock.writeWorks = false
    launch(dock)
    XCTAssertNil(dock.flags[LegacyDockTile.restartKey])
    XCTAssertEqual(dock.state, "writes 1, restarts 0, done false")
  }

  func testTheListIsReadAgainRightBeforeTheWrite() {
    // A tile pinned meanwhile stays.
    let dock = FakeDock()
    dock.tiles = [oldTile]
    dock.onSynchronize = { if $0 == 2 { dock.tiles = [self.messages, self.oldTile] } }
    launch(dock)
    XCTAssertEqual(ids(dock.tiles), ["com.apple.MobileSMS", bundleId])
    // Repointed meanwhile (by hand, say): nothing to write, nothing to restart.
    let fixed = FakeDock()
    fixed.tiles = [oldTile]
    fixed.onSynchronize = { if $0 == 2 { fixed.tiles = [self.ardiaTile] } }
    launch(fixed)
    XCTAssertEqual(fixed.state, "writes 0, restarts 0, done true")
    // Unreadable then: tried again later.
    let gone = FakeDock()
    gone.tiles = [oldTile]
    gone.onSynchronize = { if $0 == 2 { gone.tiles = nil } }
    launch(gone)
    XCTAssertEqual(gone.state, "writes 0, restarts 0, done false")
  }

  func testATileThatWasntLookedUpStopsTheWrite() {
    // Pinned between the two reads, so the first pass never looked at its file: no write, no restart, next launch.
    let other = "/Users/me/Applications/Ardia.app"
    let dock = FakeDock()
    dock.tiles = [oldTile]
    dock.onSynchronize = { if $0 == 2 { dock.tiles = [self.oldTile, self.tile(self.bundleId, "file://\(other)/", label: "Ardia")] } }
    launch(dock)
    XCTAssertEqual(dock.state, "writes 0, restarts 0, done false")
    XCTAssertNil(dock.flags[LegacyDockTile.restartKey])
    // The next launch looks it up: it's there, so it's the pinned one and the old tile goes.
    dock.onSynchronize = nil
    dock.disk = fakeDisk(["/Applications/Ardia.app", other])
    launch(dock)
    XCTAssertEqual(dock.state, "writes 1, restarts 1, done true")
    XCTAssertEqual(ids(dock.tiles), [bundleId])
  }

  func testAStaleReadNeverOverwritesAPin() {
    // cfprefsd has a newer list than this process read: a write from the stale one would drop Messages.
    let dock = FakeDock()
    dock.tiles = [oldTile]
    dock.onSynchronize = { if $0 == 2 { dock.tiles = [self.oldTile, self.messages] } }
    launch(dock)
    XCTAssertEqual(ids(dock.tiles), [bundleId, "com.apple.MobileSMS"])
  }

  // MARK: Who may

  func testTestInstancesNeverQualifyEvenWithEmptyValues() {
    XCTAssertFalse(LegacyDockTile.isTestInstance([:]))
    XCTAssertFalse(LegacyDockTile.isTestInstance(["HOME": "/Users/me"]))
    for env in [["ARDIA_DATA_DIR": "/tmp/x"], ["ARDIA_DATA_DIR": ""], ["ARDIA_BACKGROUND": "1"], ["ARDIA_BACKGROUND": ""]] {
      XCTAssertTrue(LegacyDockTile.isTestInstance(env), "\(env)")
    }
  }

  func testOnlyTheInstalledCopyQualifies() {
    let home = FileManager.default.homeDirectoryForCurrentUser
    XCTAssertTrue(LegacyDockTile.isInstalled(URL(fileURLWithPath: "/Applications/Ardia.app")))
    XCTAssertTrue(LegacyDockTile.isInstalled(home.appendingPathComponent("Applications/Ardia.app")))
    XCTAssertFalse(LegacyDockTile.isInstalled(URL(fileURLWithPath: oldAppPath)))
    XCTAssertFalse(LegacyDockTile.isInstalled(URL(fileURLWithPath: "/tmp/build/Ardia.app")))
    XCTAssertFalse(LegacyDockTile.isInstalled(home.appendingPathComponent("Library/Developer/Xcode/DerivedData/x/Ardia.app")))
    XCTAssertFalse(LegacyDockTile.isInstalled(URL(fileURLWithPath: "/private/var/folders/x/T/AppTranslocation/0000/d/Ardia.app")))
  }
}
