// Copyright 2026 Ardia. Apache-2.0.

#include "chrome/browser/ardia/ac_scripts_policy.h"

#include <limits.h>
#include <stdlib.h>
#include <sys/stat.h>

#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "base/containers/fixed_flat_set.h"
#include "base/files/file_path.h"
#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/path_service.h"
#include "base/strings/string_split.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/values.h"
#include "chrome/common/chrome_paths.h"
#include "components/crx_file/id_util.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/navigation_throttle.h"
#include "content/public/browser/navigation_throttle_registry.h"
#include "content/public/browser/web_contents.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/browser/management_policy.h"
#include "extensions/common/constants.h"
#include "extensions/common/extension.h"
#include "extensions/common/manifest.h"
#include "extensions/common/manifest_handlers/permissions_parser.h"
#include "extensions/common/permissions/permission_set.h"
#include "extensions/common/permissions/permissions_data.h"
#include "url/gurl.h"

namespace ardia {
namespace {

using extensions::Extension;

constexpr size_t kMaxContentScripts = 256;
constexpr size_t kMaxFilesPerList = 256;

constexpr auto kManifestKeys = base::MakeFixedFlatSet<std::string_view>(
    {"content_scripts", "description", "manifest_version", "name",
     "version"});

constexpr auto kContentScriptKeys = base::MakeFixedFlatSet<std::string_view>(
    {"all_frames", "css", "exclude_globs", "exclude_matches", "include_globs",
     "js", "match_about_blank", "match_origin_as_fallback", "matches",
     "run_at", "world"});

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
    const bool last = i + 1 == parts.size();
    if (LinkType(path) != (last ? S_IFREG : S_IFDIR)) {
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
  if (list->size() > kMaxFilesPerList) {
    return std::string(key) + " lists too many files";
  }
  for (const base::Value& item : *list) {
    if (!item.is_string()) {
      return std::string(key) + " must list strings";
    }
  }
  return std::nullopt;
}

bool NamesFolder(const base::FilePath& path) {
  const base::FilePath folder = path.StripTrailingSeparators();
  return base::EqualsCaseInsensitiveASCII(folder.BaseName().value(),
                                          "extension") &&
         base::EqualsCaseInsensitiveASCII(folder.DirName().BaseName().value(),
                                          "Scripts");
}

std::u16string Refusal(const std::string& problem) {
  return base::UTF8ToUTF16("Ardia Scripts can only hold content scripts: " +
                           problem);
}

class ScriptsPolicyProvider : public extensions::ManagementPolicy::Provider {
 public:
  ScriptsPolicyProvider() {
    base::FilePath user_data;
    if (base::PathService::Get(chrome::DIR_USER_DATA, &user_data) &&
        !user_data.empty()) {
      scripts_ = user_data.DirName().Append("Scripts");
      folder_ = scripts_.Append("extension");
      designated_id_ = crx_file::id_util::GenerateIdForPath(folder_);
    }
  }

  const base::FilePath& folder() const { return folder_; }
  const base::FilePath& scripts() const { return scripts_; }

  void BeginInstall() { ++installs_pending_; }
  void EndInstall() { --installs_pending_; }

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
      *error = Refusal(*problem);
    }
    return false;
  }

  void UserMayInstall(
      scoped_refptr<const Extension> extension,
      base::OnceCallback<void(extensions::ManagementPolicy::Decision)> callback)
      const override {
    if (installs_pending_ > 0 &&
        extensions::Manifest::IsUnpackedLocation(extension->location()) &&
        extension->path().StripTrailingSeparators() != folder_) {
      std::move(callback).Run(
          {false, Refusal("Scripts/extension changed while it was "
                          "installing")});
      return;
    }
    Provider::UserMayInstall(std::move(extension), std::move(callback));
  }

  bool IsScriptsExtension(const Extension& extension) const {
    if (folder_.empty()) {
      return false;
    }
    if (extension.id() == designated_id_) {
      return true;
    }
    if (!extensions::Manifest::IsUnpackedLocation(extension.location()) ||
        !NamesFolder(extension.path())) {
      return false;
    }
    const base::FilePath path = extension.path().StripTrailingSeparators();
    if (base::EqualsCaseInsensitiveASCII(path.value(), folder_.value())) {
      return true;
    }
    const std::optional<base::FilePath> real_folder = RealPath(folder_);
    const std::optional<base::FilePath> real_path = RealPath(path);
    return real_folder && real_path && *real_folder == *real_path;
  }

  bool IsDesignatedId(const std::string& id) const {
    return !designated_id_.empty() && id == designated_id_;
  }

 private:
  std::optional<std::string> Problem(const Extension& extension) const {
    if (!extensions::Manifest::IsUnpackedLocation(extension.location())) {
      return "it must be loaded unpacked from Scripts/extension";
    }
    if (LinkType(scripts_) != S_IFDIR || LinkType(folder_) != S_IFDIR) {
      return "Scripts/extension must be a plain folder";
    }
    const std::optional<base::FilePath> real_folder = RealPath(folder_);
    const std::optional<base::FilePath> real_path =
        RealPath(extension.path());
    if (!real_folder || !real_path || *real_folder != *real_path) {
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
    return ScriptFilesProblem(extension, *real_folder);
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
    if (entries->size() > kMaxContentScripts) {
      return "content_scripts has too many entries";
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
  base::FilePath folder_;
  std::string designated_id_;
  int installs_pending_ = 0;
};

ScriptsPolicyProvider& Scripts() {
  static base::NoDestructor<ScriptsPolicyProvider> scripts;
  return *scripts;
}

class ScriptsPagesThrottle : public content::NavigationThrottle {
 public:
  explicit ScriptsPagesThrottle(content::NavigationThrottleRegistry& registry)
      : content::NavigationThrottle(registry) {}

  ThrottleCheckResult WillStartRequest() override { return Check(); }
  ThrottleCheckResult WillRedirectRequest() override { return Check(); }
  const char* GetNameForLogging() override {
    return "ArdiaScriptsPagesThrottle";
  }

 private:
  ThrottleCheckResult Check() {
    const GURL& url = navigation_handle()->GetURL();
    if (!url.SchemeIs(extensions::kExtensionScheme)) {
      return PROCEED;
    }
    const std::string id(url.host());
    if (Scripts().IsDesignatedId(id)) {
      return BLOCK_REQUEST;
    }
    const Extension* extension =
        extensions::ExtensionRegistry::Get(
            navigation_handle()->GetWebContents()->GetBrowserContext())
            ->GetExtensionById(id, extensions::ExtensionRegistry::EVERYTHING);
    if (extension && Scripts().IsScriptsExtension(*extension)) {
      return BLOCK_REQUEST;
    }
    return PROCEED;
  }
};

}

void RegisterManagementPolicyProviders(Profile*,
                                       extensions::ManagementPolicy* policy) {
  policy->RegisterProvider(&Scripts());
}

void AddScriptsPagesThrottle(content::NavigationThrottleRegistry& registry) {
  registry.AddThrottle(std::make_unique<ScriptsPagesThrottle>(registry));
}

bool NamesScriptsFolder(const base::FilePath& path) {
  const base::FilePath folder = Scripts().folder();
  if (folder.empty() || !NamesFolder(path)) {
    return false;
  }
  if (base::EqualsCaseInsensitiveASCII(path.StripTrailingSeparators().value(),
                                       folder.value())) {
    return true;
  }
  const std::optional<base::FilePath> real_path = RealPath(path);
  const std::optional<base::FilePath> real_folder = RealPath(folder);
  return real_path && real_folder && *real_path == *real_folder;
}

base::FilePath ScriptsFolder() {
  return Scripts().folder();
}

std::optional<std::string> ScriptsFolderInstallProblem(
    const base::FilePath& path) {
  const base::FilePath folder = Scripts().folder();
  if (folder.empty()) {
    return "Ardia has no data folder";
  }
  if (LinkType(path.StripTrailingSeparators().DirName()) != S_IFDIR ||
      LinkType(path.StripTrailingSeparators()) != S_IFDIR ||
      LinkType(Scripts().scripts()) != S_IFDIR ||
      LinkType(folder) != S_IFDIR) {
    return "Ardia Scripts: Scripts/extension must be a plain folder";
  }
  const std::optional<base::FilePath> real_path = RealPath(path);
  const std::optional<base::FilePath> real_folder = RealPath(folder);
  if (!real_path || !real_folder || *real_path != *real_folder) {
    return "Ardia Scripts: that isn't this Ardia's Scripts/extension folder";
  }
  return std::nullopt;
}

base::ScopedClosureRunner BeginScriptsInstall() {
  Scripts().BeginInstall();
  return base::ScopedClosureRunner(
      base::BindOnce([] { Scripts().EndInstall(); }));
}

}
