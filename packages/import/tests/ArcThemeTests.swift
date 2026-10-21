import Foundation
import XCTest
@testable import ArdiaImportCore

final class ArcThemeTests: XCTestCase {
  private func firstBaseRed(_ theme: Any) -> Double? {
    var node: Any? = theme
    for key in ["background", "single", "_0", "style", "color", "_0", "blendedGradient", "_0", "baseColors"] {
      node = (node as? [String: Any])?[key]
    }
    return ((node as? [[String: Any]])?.first?["red"] as? NSNumber)?.doubleValue
  }

  func testEachSpaceCarriesItsWindowThemeVerbatim() throws {
    let sidebar = try ArcSidebar.parse(Data(contentsOf: Fixtures.support("Arc/StorableSidebar.json")))
    let byId = Dictionary(uniqueKeysWithValues: sidebar.spaces.map { ($0.id, $0) })

    for (space, fixture) in [("S-PERSONAL", "green-pink"), ("S-WORK", "blue-teal")] {
      let original = try JSONSerialization.jsonObject(with: Data(contentsOf: Fixtures.url("arc-themes/\(fixture).json")))
      let expected = try JSONSerialization.data(withJSONObject: original, options: [.sortedKeys])
      let carried = try XCTUnwrap(byId[space]?.theme)
      XCTAssertEqual(carried, String(data: expected, encoding: .utf8), space)
      let decoded = try JSONSerialization.jsonObject(with: Data(carried.utf8))
      XCTAssertEqual(firstBaseRed(decoded), firstBaseRed(original), space)
      XCTAssertNotNil(firstBaseRed(original), space)
    }
    XCTAssertNil(byId["S-UNTITLED"]?.theme)
    XCTAssertEqual(byId["S-WORK"]?.colors?.count, 2)
  }

  func testDiscoverySummariesListTheThemes() throws {
    let arc = try XCTUnwrap(Fixtures.discovery().list().first { $0.id == "arc" })
    let spaces = arc.profiles.flatMap { $0.spaces ?? [] }
    XCTAssertEqual(Set(spaces.filter { $0.theme != nil }.map(\.id)), ["S-PERSONAL", "S-WORK"])
  }

  func testAnOversizedThemeIsLeftOut() {
    let huge: [String: Any] = ["background": ["blob": String(repeating: "x", count: ArcSidebar.maxThemeBytes)]]
    XCTAssertNil(ArcSidebar.json(huge))
    XCTAssertNotNil(ArcSidebar.json(["background": [:]]))
  }
}
