// Copyright 2026 Ardia. Apache-2.0.

#include "chrome/browser/ardia/ac_input_frame_rate.h"

#import <AppKit/AppKit.h>

#include <cstdlib>
#include <cstring>

#include "base/time/time.h"
#include "chrome/browser/performance_manager/public/user_tuning/battery_saver_mode_manager.h"

namespace ardia {

void HoldFullFrameRateDuringInput() {
  static id monitor = nil;
  if (monitor) {
    return;
  }
  const char* switch_value = getenv("ARDIA_SCROLL_FULL_RATE");
  if (switch_value && !strcmp(switch_value, "off")) {
    return;
  }
  static base::TimeTicks last_hold;
  const NSEventMask input =
      NSEventMaskScrollWheel | NSEventMaskKeyDown | NSEventMaskLeftMouseDown |
      NSEventMaskLeftMouseDragged | NSEventMaskRightMouseDown |
      NSEventMaskRightMouseDragged | NSEventMaskOtherMouseDown |
      NSEventMaskOtherMouseDragged | NSEventMaskMouseMoved |
      NSEventMaskMagnify | NSEventMaskSmartMagnify | NSEventMaskSwipe |
      NSEventMaskRotate;
  monitor = [NSEvent
      addLocalMonitorForEventsMatchingMask:input
                                   handler:^NSEvent*(NSEvent* event) {
                                     const base::TimeTicks now =
                                         base::TimeTicks::Now();
                                     if (now - last_hold >=
                                             base::Milliseconds(100) &&
                                         performance_manager::user_tuning::
                                             BatterySaverModeManager::
                                                 HasInstance()) {
                                       last_hold = now;
                                       performance_manager::user_tuning::
                                           BatterySaverModeManager::
                                               GetInstance()
                                                   ->HoldFullFrameRateForInput();
                                     }
                                     return event;
                                   }];
}

}
