#ifndef ARDIA_CORE_AC_CONTENT_HOOKS_H_
#define ARDIA_CORE_AC_CONTENT_HOOKS_H_

#include <stddef.h>

#include <string>
#include <string_view>

#include "extensions/common/extension_id.h"

namespace content {
class BrowserContext;
class DevToolsSocketFactory;
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

extern int g_ardia_disk_space_check_seconds;

extern bool g_ardia_lazy_storage_usage;

extern bool g_ardia_begin_frame_bridge;

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

extern bool (*g_ardia_devtools_token_factory)(
    const content::DevToolsSocketFactory* factory);

extern bool (*g_ardia_devtools_token_accepts)(
    const content::DevToolsSocketFactory* factory,
    std::string_view token);

extern void (*g_ardia_devtools_token_server)(
    const content::DevToolsSocketFactory* factory,
    std::string_view browser_path,
    int port,
    size_t connections);

extern bool (*g_ardia_devtools_active_target)(
    const content::DevToolsSocketFactory* factory,
    std::string_view token,
    std::string* target_id);

#endif
