// Our hooks in Chrome's code (ac_seams.mm).

#ifndef ARDIA_CORE_AC_SEAMS_H_
#define ARDIA_CORE_AC_SEAMS_H_

namespace ardiacore {

// Sets the g_ardia_* hooks our patches add to Chrome's code. The browser process calls it
// in ACMainDelegate::PreSandboxStartup, whichever entry point started ChromeMain: before any
// Browser exists.
void InstallChromeHooks();

}  // namespace ardiacore

#endif  // ARDIA_CORE_AC_SEAMS_H_
