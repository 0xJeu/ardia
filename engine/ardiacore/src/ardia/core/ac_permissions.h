// Chrome's permission prompts for the host's tabs go to the host (as CEF's
// OnShowPermissionPrompt did) instead of Chrome's bubble, which anchors to a toolbar our
// Browsers don't have. Chrome still decides first: a remembered allow or block never asks.

#ifndef ARDIA_CORE_AC_PERMISSIONS_H_
#define ARDIA_CORE_AC_PERMISSIONS_H_

#import <Foundation/Foundation.h>

#include <string>

namespace content {
class WebContents;
}

namespace ardiacore {

// Installs ArdiaCore's prompt factory (the g_ardia_create_permission_prompt hook in Chrome's
// permission_prompt_factory.cc, engine/ardiacore/apply.sh).
void InstallPermissionPrompts();

// "accept" | "deny" | "dismiss"; `remember` keeps the decision for the site (a
// one-time grant where Chrome supports one; a forgotten "deny" is a dismissal).
void ResolvePermission(const std::string& request_id,
                       const std::string& result,
                       bool remember);

// Implemented by the API (ardiacore_api.mm): tell the host.
void HostPermissionRequest(content::WebContents* contents, NSDictionary* request);
void HostPermissionRequestDismissed(NSString* request_id);

}  // namespace ardiacore

#endif  // ARDIA_CORE_AC_PERMISSIONS_H_
