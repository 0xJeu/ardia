import Foundation
import WebKit

enum WebKitStoreRemovals {
  private struct State: Codable {
    var queued: [String] = []
    var generations: [String: Int] = [:]
  }

  private static var file: URL? {
    ArdiaHost.dataDirectory.isEmpty ? nil : URL(fileURLWithPath: ArdiaHost.dataDirectory).appendingPathComponent("WebKitStoreRemovals.json")
  }

  private static var state: State = file.flatMap { try? Data(contentsOf: $0) }.flatMap { try? JSONDecoder().decode(State.self, from: $0) } ?? State()

  private static func update(_ change: (inout State) -> Void) {
    change(&state)
    guard let file else { return }
    if state.queued.isEmpty && state.generations.isEmpty {
      try? FileManager.default.removeItem(at: file)
    } else if let data = try? JSONEncoder().encode(state) {
      try? data.write(to: file, options: .atomic)
    }
  }

  private static let webKitStarted: Void = { _ = WKWebsiteDataStore.nonPersistent() }()

  static func generation(of profile: String) -> Int { state.generations[profile] ?? 0 }

  static func retire(_ profile: String) { update { $0.generations[profile, default: 0] += 1 } }

  static func exists(_ identifiers: [UUID], done: @escaping (Bool) -> Void) {
    webKitStarted
    WKWebsiteDataStore.fetchAllDataStoreIdentifiers { stores in
      DispatchQueue.main.async { done(identifiers.contains(where: stores.contains)) }
    }
  }

  static func remove(_ identifier: UUID, tries: Int, done: @escaping (Bool) -> Void) {
    webKitStarted
    WKWebsiteDataStore.remove(forIdentifier: identifier) { error in
      DispatchQueue.main.async {
        if error == nil { return done(true) }
        guard tries > 1 else {
          NSLog("[webkit] the data store %@ is still in use: %@", identifier.uuidString, error.map { "\($0)" } ?? "")
          return done(false)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { remove(identifier, tries: tries - 1, done: done) }
      }
    }
  }

  static func queue(_ identifier: UUID) {
    update { if !$0.queued.contains(identifier.uuidString) { $0.queued.append(identifier.uuidString) } }
  }

  private static func unqueue(_ identifier: UUID) {
    update { $0.queued.removeAll { $0 == identifier.uuidString } }
  }

  static func runQueued() {
    for id in state.queued.compactMap(UUID.init(uuidString:)) {
      remove(id, tries: 1) { removed in
        exists([id]) { stillThere in
          if removed || !stillThere { unqueue(id) }
        }
      }
    }
  }
}
