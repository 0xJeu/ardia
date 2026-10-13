#ifndef ARDIA_CORE_AC_AUTOFILL_TRIGGER_H_
#define ARDIA_CORE_AC_AUTOFILL_TRIGGER_H_

namespace content {
class WebContents;
}

namespace ardiacore {

void TrackAutofillFocus(content::WebContents* contents);
bool ShowAutofillSuggestions(content::WebContents* contents, bool passwords);

}

#endif
