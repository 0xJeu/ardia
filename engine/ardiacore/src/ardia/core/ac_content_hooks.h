#ifndef ARDIA_CORE_AC_CONTENT_HOOKS_H_
#define ARDIA_CORE_AC_CONTENT_HOOKS_H_

#include "extensions/common/extension_id.h"

namespace content {
class BrowserContext;
class WebContents;

extern bool g_ardia_opacity_from_default_color;
}

namespace extensions {
struct WebRequestInfo;
namespace declarative_net_request {
struct RequestAction;
}
}

extern const char* g_ardia_user_agent_brand;

extern int (*g_ardia_permission_tab_shown)(content::WebContents*);

extern void (*g_ardia_dnr_rule_matched)(
    content::BrowserContext* browser_context,
    int tab_id,
    const extensions::declarative_net_request::RequestAction& action,
    const extensions::WebRequestInfo& request);

extern void (*g_ardia_dnr_rulesets_in_force)(
    content::BrowserContext* browser_context,
    const extensions::ExtensionId& extension_id,
    bool all_loaded);

#endif
