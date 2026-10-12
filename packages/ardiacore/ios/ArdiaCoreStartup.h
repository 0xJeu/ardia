// What packages/cef's ACCef did at startup that no JS API asks for, done for ArdiaCore before ChromeMain.
#import <Foundation/Foundation.h>

#include <string>
#include <vector>

namespace ardiacore_host {

// Before the engine starts: password managers' native messaging hosts in <userDataDir>/NativeMessagingHosts (and
// again whenever the app becomes active), and Chrome's switches for what CEF's settings set (Accept-Language from
// the system's preferred languages).
void PrepareStartup(NSString *userDataDir, std::vector<std::string> &switches);

}  // namespace ardiacore_host
