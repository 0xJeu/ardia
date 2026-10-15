#ifndef ARDIA_CORE_AC_CONTEXT_MENU_H_
#define ARDIA_CORE_AC_CONTEXT_MENU_H_

#include <memory>

namespace content {
class WebContents;
class WebContentsViewDelegate;
}

namespace ardiacore {

std::unique_ptr<content::WebContentsViewDelegate> CreateViewDelegate(
    content::WebContents* contents);

}

#endif
