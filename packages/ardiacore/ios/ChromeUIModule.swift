import ExpoModulesCore

public class ChromeUIModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaChromeUI")
    Events("onDeviceChooser", "onCastDialog", "onCastRoutes", "onSidePanel", "onActionPopup", "onActionShortcut")

    OnCreate {
      ArdiaHost.chromeUIHandler = { [weak self] name, payload in
        switch name {
        case "sidePanel": self?.sendEvent("onSidePanel", payload)
        case "actionPopup": self?.sendEvent("onActionPopup", payload)
        case "actionShortcut": self?.sendEvent("onActionShortcut", payload)
        case "deviceChooser": self?.sendEvent("onDeviceChooser", payload)
        case "castDialog": self?.sendEvent("onCastDialog", payload)
        case "castRoutes": self?.sendEvent("onCastRoutes", payload)
        default: break
        }
      }
    }

    AsyncFunction("selectDevice") { (id: Int, index: Int) in ArdiaHost.deviceChooser(Int32(id), select: Int32(index)) }.runOnQueue(.main)
    AsyncFunction("cancelDeviceChooser") { (id: Int) in ArdiaHost.deviceChooser(Int32(id), action: "cancel") }.runOnQueue(.main)
    AsyncFunction("refreshDeviceChooser") { (id: Int) in ArdiaHost.deviceChooser(Int32(id), action: "refresh") }.runOnQueue(.main)
    AsyncFunction("openBluetoothSettings") { (id: Int) in ArdiaHost.deviceChooser(Int32(id), action: "settings") }.runOnQueue(.main)
    AsyncFunction("devShowBluetoothChooser") { (browserId: Int, unauthorized: Bool) -> Bool in
      ArdiaHost.devShowBluetoothChooser(browserId: Int32(browserId), unauthorized: unauthorized)
    }.runOnQueue(.main)
    AsyncFunction("devChooserEvents") { ArdiaHost.testChooserEvents() }.runOnQueue(.main)

    AsyncFunction("showCastDialog") { (browserId: Int) in ArdiaHost.showCastDialog(browserId: Int32(browserId)) }.runOnQueue(.main)
    AsyncFunction("startCasting") { (id: Int, sink: String, mode: Int) in
      ArdiaHost.castDialog(Int32(id), start: sink, mode: Int32(mode))
    }.runOnQueue(.main)
    AsyncFunction("stopCasting") { (id: Int, route: String) in ArdiaHost.castDialog(Int32(id), stop: route) }.runOnQueue(.main)
    AsyncFunction("closeCastDialog") { (id: Int) in ArdiaHost.closeCastDialog(Int32(id)) }.runOnQueue(.main)
    AsyncFunction("watchCastRoutes") { (profile: String) in ArdiaHost.watchCastRoutes(profile) }.runOnQueue(.main)
    AsyncFunction("terminateCastRoute") { (route: String) in ArdiaHost.terminateCastRoute(route) }.runOnQueue(.main)

    AsyncFunction("actionStates") { (browserId: Int, ids: [String]) in
      ArdiaHost.actionStates(browserId: Int32(browserId), extensions: ids)
    }.runOnQueue(.main)
    AsyncFunction("sidePanelURL") { (browserId: Int, extensionId: String) -> String? in
      ArdiaHost.sidePanelURL(browserId: Int32(browserId), extension: extensionId)
    }.runOnQueue(.main)

    AsyncFunction("changeCaptureSource") { (capturer: Int, target: Int) -> Bool in
      ArdiaHost.shareTabInstead(capturer: Int32(capturer), target: Int32(target))
    }.runOnQueue(.main)
    AsyncFunction("stopCapture") { (capturer: Int) in ArdiaHost.stopCapture(browserId: Int32(capturer)) }.runOnQueue(.main)
    AsyncFunction("showAutofillSuggestions") { (browserId: Int, passwords: Bool) in
      ArdiaHost.showAutofillSuggestions(browserId: Int32(browserId), passwords: passwords)
    }.runOnQueue(.main)
  }
}
