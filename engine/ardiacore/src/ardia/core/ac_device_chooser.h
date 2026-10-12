// Device choosers (WebUSB, WebHID, Web Serial, Web Bluetooth) for the host's tabs, to the host.

#ifndef ARDIA_CORE_AC_DEVICE_CHOOSER_H_
#define ARDIA_CORE_AC_DEVICE_CHOOSER_H_

#import <Foundation/Foundation.h>

#include <memory>

#include "base/functional/callback.h"

namespace content {
class RenderFrameHost;
class WebContents;
}  // namespace content

namespace permissions {
class ChooserController;
}

namespace ardiacore {

// The device chooser hook (g_ardia_device_chooser, ac_seams.mm): true if the host took it.
bool HandleDeviceChooser(content::RenderFrameHost* owner,
                         std::unique_ptr<permissions::ChooserController>* controller,
                         base::OnceClosure* close_closure);
void SelectDevice(int chooser_id, int index);
void CancelDeviceChooser(int chooser_id);
void RefreshDeviceChooser(int chooser_id);
void OpenDeviceChooserSettings(int chooser_id);
// Test runs (--ardia-test-bluetooth-chooser): Chrome's Bluetooth chooser for the tab's
// page with no adapter behind it (unauthorized, or one device "Ardia Test Device"), and
// what the page would have heard from it: [{event, device}].
bool ShowTestBluetoothChooser(content::WebContents* contents, bool unauthorized);
NSArray<NSDictionary*>* TestChooserEvents();

// Implemented by the API (ardiacore_api.mm).
bool HostWantsDeviceChoosers();
void HostDeviceChooser(content::WebContents* contents, NSDictionary* state);

}  // namespace ardiacore

#endif  // ARDIA_CORE_AC_DEVICE_CHOOSER_H_
