// Chrome's Cast dialog for the host's tabs, to the host (ac_cast_dialog.mm).

#ifndef ARDIA_CORE_AC_CAST_DIALOG_H_
#define ARDIA_CORE_AC_CAST_DIALOG_H_

#import <Foundation/Foundation.h>

#include <string>

class Profile;

namespace content {
class WebContents;
}

namespace media_router {
class MediaRouterUI;
}

namespace ardiacore {

// The Cast dialog hooks (g_ardia_wants_cast_dialog / g_ardia_cast_dialog, ac_seams.mm).
bool WantsCastDialog(content::WebContents* initiator);
bool HandleCastDialog(content::WebContents* initiator, media_router::MediaRouterUI* ui);
// Chrome's Cast dialog for a tab (as its toolbar button).
bool ShowCastDialog(content::WebContents* contents);
void StartCasting(int dialog_id, const std::string& sink_id, int cast_mode);
void StopCasting(int dialog_id, const std::string& route_id);
void CloseCastDialog(int dialog_id);

// A profile's Cast routes, to the host (HostCastRoutes) now and on every change.
void WatchCastRoutes(Profile* profile);
void TerminateCastRoute(const std::string& route_id);

// Implemented by the API (ardiacore_api.mm).
void HostCastRoutes(Profile* profile, NSArray* routes);
bool HostWantsCastDialogs();
void HostCastDialog(content::WebContents* contents, NSDictionary* state);

}  // namespace ardiacore

#endif  // ARDIA_CORE_AC_CAST_DIALOG_H_
