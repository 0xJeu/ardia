// Copyright 2026 Ardia. Apache-2.0.

#ifndef CHROME_BROWSER_ARDIA_AC_SCRIPTS_POLICY_H_
#define CHROME_BROWSER_ARDIA_AC_SCRIPTS_POLICY_H_

class Profile;

namespace extensions {
class ManagementPolicy;
}

namespace ardia {

void RegisterManagementPolicyProviders(Profile* profile,
                                       extensions::ManagementPolicy* policy);

}

#endif
