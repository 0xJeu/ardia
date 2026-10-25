import Foundation
import WebKit

extension WebKitHub {
  static let httpOnlyCookieKey = HTTPCookiePropertyKey("HttpOnly")

  static func httpCookie(fromEngine cookie: [String: Any]) -> HTTPCookie? {
    guard cookie["partitionKey"] == nil || cookie["partitionKey"] is NSNull, cookie["partitionKeyOpaque"] as? Bool != true,
      let name = cookie["name"] as? String, !name.isEmpty,
      let value = cookie["value"] as? String,
      let domain = cookie["domain"] as? String, !domain.isEmpty
    else { return nil }
    let path = (cookie["path"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "/"
    var properties: [HTTPCookiePropertyKey: Any] = [.name: name, .value: value, .domain: domain, .path: path]
    if cookie["secure"] as? Bool == true { properties[.secure] = "TRUE" }
    if cookie["httpOnly"] as? Bool == true { properties[httpOnlyCookieKey] = "TRUE" }
    if cookie["session"] as? Bool != true, let expires = cookie["expires"] as? Double, expires > 0 {
      guard expires > Date().timeIntervalSince1970 else { return nil }
      properties[.expires] = Date(timeIntervalSince1970: expires)
    }
    switch cookie["sameSite"] as? String {
    case "Strict": properties[.sameSitePolicy] = HTTPCookieStringPolicy.sameSiteStrict.rawValue
    case "Lax": properties[.sameSitePolicy] = HTTPCookieStringPolicy.sameSiteLax.rawValue
    default: break
    }
    return HTTPCookie(properties: properties)
  }

  func importCookies(_ cookies: [[String: Any]], profile: String, completion: @escaping (Int) -> Void) {
    let made = cookies.compactMap(Self.httpCookie(fromEngine:))
    guard !made.isEmpty else { return completion(0) }
    let store = dataStore(for: profile).httpCookieStore
    let group = DispatchGroup()
    for cookie in made {
      group.enter()
      store.setCookie(cookie) { group.leave() }
    }
    group.notify(queue: .main) { completion(made.count) }
  }
}
