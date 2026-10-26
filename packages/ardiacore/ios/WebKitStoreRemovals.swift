import Foundation
import WebKit

enum WebKitStoreRemovals {
  private static var file: URL { URL(fileURLWithPath: ArdiaHost.dataDirectory).appendingPathComponent("WebKitStoreRemovals.json") }

  private static func pending() -> [String] {
    guard let data = try? Data(contentsOf: file) else { return [] }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String] ?? []
  }

  private static func save(_ identifiers: [String]) {
    if identifiers.isEmpty {
      try? FileManager.default.removeItem(at: file)
      return
    }
    guard let data = try? JSONSerialization.data(withJSONObject: identifiers) else { return }
    try? data.write(to: file, options: .atomic)
  }

  static func exists(_ identifier: UUID, done: @escaping (Bool) -> Void) {
    WKWebsiteDataStore.fetchAllDataStoreIdentifiers { identifiers in
      DispatchQueue.main.async { done(identifiers.contains(identifier)) }
    }
  }

  static func remove(_ identifier: UUID, tries: Int, done: @escaping (Bool) -> Void) {
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
    let ids = pending()
    if !ids.contains(identifier.uuidString) { save(ids + [identifier.uuidString]) }
  }

  static func runQueued() {
    let ids = pending().compactMap(UUID.init(uuidString:))
    guard !ids.isEmpty, !ArdiaHost.dataDirectory.isEmpty else { return }
    var left = Set(ids)
    for id in ids {
      remove(id, tries: 1) { removed in
        exists(id) { stillThere in
          if removed || !stillThere { left.remove(id) }
          save(left.map(\.uuidString))
        }
      }
    }
  }
}
