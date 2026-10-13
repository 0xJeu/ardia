// Copyright 2026 Ardia. Apache-2.0.

#ifndef CHROME_BROWSER_ARDIA_AC_SENSITIVE_ARGS_H_
#define CHROME_BROWSER_ARDIA_AC_SENSITIVE_ARGS_H_

#include <cstddef>
#include <optional>
#include <string>

#include "base/values.h"

namespace ardia {

void Cleanse(std::string& string);
void Cleanse(std::u16string& string);
void Cleanse(base::Value& value);

class SensitiveArgs {
 public:
  SensitiveArgs(const char* json, size_t max_bytes);
  SensitiveArgs(const SensitiveArgs&) = delete;
  SensitiveArgs& operator=(const SensitiveArgs&) = delete;
  ~SensitiveArgs();

  bool too_large() const { return too_large_; }
  base::DictValue* dict();

 private:
  std::optional<base::Value> value_;
  bool too_large_ = false;
};

}

#endif
