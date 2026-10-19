// Copyright 2026 Ardia. Apache-2.0.

#include "chrome/browser/ardia/ac_scripts_policy.h"

#include <limits.h>
#include <stdlib.h>
#include <sys/stat.h>

#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "base/containers/fixed_flat_set.h"
#include "base/files/file_path.h"
#include "base/no_destructor.h"
#include "base/path_service.h"
#include "base/strings/string_split.h"
#include "base/strings/utf_string_conversions.h"
#include "base/values.h"
#include "chrome/common/chrome_paths.h"
#include "extensions/browser/management_policy.h"
#include "extensions/common/extension.h"
#include "extensions/common/manifest.h"
#include "extensions/common/manifest_handlers/permissions_parser.h"
#include "extensions/common/permissions/permission_set.h"
#include "extensions/common/permissions/permissions_data.h"

namespace ardia {
namespace {

using extensions::Extension;

constexpr auto kManifestKeys = base::MakeFixedFlatSet<std::string_view>(
    {"content_scripts", "description", "manifest_version", "name",
     "version"});

constexpr auto kContentScriptKeys = base::MakeFixedFlatSet<std::string_view>(
    {"all_frames", "css", "exclude_globs", "exclude_matches", "include_globs",
     "js", "match_about_blank", "match_origin_as_fallback", "matches",
     "run_at", "world"});

struct FileIdentity {
  dev_t device;
  ino_t inode;
  bool operator==(const FileIdentity&) const = default;
};

std::optional<FileIdentity> IdentityOf(const base::FilePath& path) {
  struct stat info;
  if (stat(path.value().c_str(), &info) != 0) {
    return std::nullopt;
  }
  return FileIdentity{info.st_dev, info.st_ino};
}

std::optional<base::FilePath> RealPath(const base::FilePath& path) {
  char resolved[PATH_MAX];
  if (!realpath(path.value().c_str(), resolved)) {
    return std::nullopt;
  }
  return base::FilePath(resolved);
}

std::optional<mode_t> LinkType(const base::FilePath& path) {
  struct stat info;
  if (lstat(path.value().c_str(), &info) != 0) {
    return std::nullopt;
  }
  return info.st_mode & S_IFMT;
}

bool IsSameOrInside(const base::FilePath& dir, const base::FilePath& path) {
  return dir == path || dir.IsParent(path);
}

bool IsEmpty(const extensions::PermissionSet& permissions) {
  return permissions.apis().empty() &&
         permissions.manifest_permissions().empty() &&
         permissions.explicit_hosts().is_empty();
}

std::optional<std::string> ScriptFileProblem(const base::FilePath& root,
                                             const std::string& relative) {
  if (relative.empty() || relative.front() == '/') {
    return "\"" + relative + "\" isn't a path inside the folder";
  }
  const std::vector<std::string> parts = base::SplitString(
      relative, "/", base::KEEP_WHITESPACE, base::SPLIT_WANT_ALL);
  base::FilePath path = root;
  for (size_t i = 0; i < parts.size(); ++i) {
    const std::string& part = parts[i];
    if (part.empty() || part == "." || part == "..") {
      return "\"" + relative + "\" isn't a plain path inside the folder";
    }
    path = path.Append(part);
    const std::optional<mode_t> type = LinkType(path);
    const bool last = i + 1 == parts.size();
    if (type != (last ? S_IFREG : S_IFDIR)) {
      return "\"" + relative + "\" isn't a plain file inside the folder";
    }
  }
  return std::nullopt;
}

std::optional<std::string> StringListProblem(const base::DictValue& entry,
                                             std::string_view key) {
  const base::Value* value = entry.Find(key);
  if (!value) {
    return std::nullopt;
  }
  const base::ListValue* list = value->GetIfList();
  if (!list) {
    return std::string(key) + " must be a list";
  }
  for (const base::Value& item : *list) {
    if (!item.is_string()) {
      return std::string(key) + " must list strings";
    }
  }
  return std::nullopt;
}

class ScriptsPolicyProvider : public extensions::ManagementPolicy::Provider {
 public:
  ScriptsPolicyProvider() {
    base::FilePath user_data;
    if (base::PathService::Get(chrome::DIR_USER_DATA, &user_data) &&
        !user_data.empty()) {
      scripts_ = user_data.DirName().Append("Scripts");
    }
  }

  std::string GetDebugPolicyProviderName() const override {
    return "Ardia Scripts";
  }

  bool UserMayLoad(const Extension* extension,
                   std::u16string* error) const override {
    if (!IsScriptsExtension(*extension)) {
      return true;
    }
    const std::optional<std::string> problem = Problem(*extension);
    if (!problem) {
      return true;
    }
    if (error) {
      *error = base::UTF8ToUTF16("Ardia Scripts can only hold content scripts: " +
                                 *problem);
    }
    return false;
  }

 private:
  base::FilePath ExtensionDir() const {
    return scripts_.Append("extension");
  }

  bool IsScriptsExtension(const Extension& extension) const {
    if (scripts_.empty() ||
        !extensions::Manifest::IsUnpackedLocation(extension.location())) {
      return false;
    }
    const base::FilePath dir = ExtensionDir();
    const base::FilePath path = extension.path().StripTrailingSeparators();
    if (IsSameOrInside(dir, path)) {
      return true;
    }
    const std::optional<base::FilePath> real_dir = RealPath(dir);
    const std::optional<base::FilePath> real_path = RealPath(path);
    if (real_path && (IsSameOrInside(dir, *real_path) ||
                      (real_dir && IsSameOrInside(*real_dir, *real_path)))) {
      return true;
    }
    const std::optional<FileIdentity> dir_identity = IdentityOf(dir);
    if (!dir_identity) {
      return false;
    }
    for (base::FilePath walk = real_path.value_or(path);;
         walk = walk.DirName()) {
      if (IdentityOf(walk) == dir_identity) {
        return true;
      }
      if (walk.DirName() == walk) {
        return false;
      }
    }
  }

  std::optional<std::string> Problem(const Extension& extension) const {
    const base::FilePath dir = ExtensionDir();
    if (LinkType(scripts_) != S_IFDIR || LinkType(dir) != S_IFDIR) {
      return "Scripts/extension must be a plain folder";
    }
    const std::optional<base::FilePath> real_dir = RealPath(dir);
    const std::optional<base::FilePath> real_path =
        RealPath(extension.path());
    if (!real_dir || !real_path || *real_dir != *real_path) {
      return "the extension must be the Scripts/extension folder itself";
    }
    if (std::optional<std::string> problem = ManifestProblem(extension)) {
      return problem;
    }
    if (!IsEmpty(extensions::PermissionsParser::GetRequiredPermissions(
            &extension)) ||
        !IsEmpty(extensions::PermissionsParser::GetOptionalPermissions(
            &extension)) ||
        !IsEmpty(extension.permissions_data()->active_permissions()) ||
        !IsEmpty(extension.permissions_data()->withheld_permissions())) {
      return "it may not ask for permissions or host permissions";
    }
    return ScriptFilesProblem(extension, *real_dir);
  }

  std::optional<std::string> ManifestProblem(const Extension& extension) const {
    const base::DictValue& manifest = *extension.manifest()->value();
    for (const auto [key, value] : manifest) {
      if (!kManifestKeys.contains(key)) {
        return "manifest.json may not contain \"" + key + "\"";
      }
    }
    const std::optional<int> version = manifest.FindInt("manifest_version");
    if (!version || *version != 3) {
      return "manifest_version must be 3";
    }
    if (!manifest.FindString("name") || !manifest.FindString("version")) {
      return "name and version must be strings";
    }
    const base::Value* description = manifest.Find("description");
    if (description && !description->is_string()) {
      return "description must be a string";
    }
    const base::ListValue* entries = manifest.FindList("content_scripts");
    if (!entries) {
      return "content_scripts must be a list";
    }
    for (const base::Value& item : *entries) {
      const base::DictValue* entry = item.GetIfDict();
      if (!entry) {
        return "each content_scripts entry must be an object";
      }
      for (const auto [key, value] : *entry) {
        if (!kContentScriptKeys.contains(key)) {
          return "a content_scripts entry may not contain \"" + key + "\"";
        }
      }
      for (std::string_view key : {"js", "css"}) {
        if (std::optional<std::string> problem =
                StringListProblem(*entry, key)) {
          return problem;
        }
      }
    }
    return std::nullopt;
  }

  std::optional<std::string> ScriptFilesProblem(
      const Extension& extension,
      const base::FilePath& root) const {
    const base::ListValue* entries =
        extension.manifest()->value()->FindList("content_scripts");
    for (const base::Value& item : *entries) {
      for (std::string_view key : {"js", "css"}) {
        const base::ListValue* files = item.GetDict().FindList(key);
        if (!files) {
          continue;
        }
        for (const base::Value& file : *files) {
          if (std::optional<std::string> problem =
                  ScriptFileProblem(root, file.GetString())) {
            return problem;
          }
        }
      }
    }
    return std::nullopt;
  }

  base::FilePath scripts_;
};

}

void RegisterManagementPolicyProviders(Profile*,
                                       extensions::ManagementPolicy* policy) {
  static base::NoDestructor<ScriptsPolicyProvider> scripts;
  policy->RegisterProvider(scripts.get());
}

}
