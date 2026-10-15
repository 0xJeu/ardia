#include "ardia/core/ac_main_delegate.h"

#include <memory>
#include <optional>
#include <utility>

#include "base/command_line.h"
#include "base/files/file_util.h"
#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/path_service.h"
#include "base/run_loop.h"
#include "base/task/single_thread_task_runner.h"
#include "base/time/time.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/browser_process_impl.h"
#include "chrome/browser/chrome_browser_main.h"
#include "chrome/browser/chrome_browser_main_extra_parts.h"
#include "chrome/browser/chrome_content_browser_client.h"
#include "chrome/common/chrome_paths.h"
#include "chrome/common/chrome_paths_internal.h"
#include "chrome/common/chrome_switches.h"
#include "chrome/common/profiler/main_thread_stack_sampling_profiler.h"
#include "components/component_updater/component_updater_paths.h"
#include "components/keep_alive_registry/keep_alive_types.h"
#include "components/keep_alive_registry/scoped_keep_alive.h"
#include "content/public/browser/browser_context.h"
#include "content/public/browser/browser_main_parts.h"
#include "content/public/common/content_switches.h"
#include "content/public/common/result_codes.h"
#include "services/cert_verifier/public/mojom/cert_verifier_service_factory.mojom.h"
#include "services/network/public/mojom/network_context.mojom.h"
#include "ardia/core/ac_hooks.h"
#include "ardia/core/ac_lifetime.h"
#include "ardia/core/ac_context_menu.h"
#include "ardia/core/ac_navigation_hold.h"
#include "ardia/core/ac_page_channel.h"
#include "ardia/core/ac_seams.h"
#include "ardia/core/ac_strings.h"
#include "content/public/browser/web_contents_view_delegate.h"
#include "ardia/core/renderer/ac_content_renderer_client.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_registry.h"

namespace ardiacore {

namespace {

EngineCallbacks& Callbacks() {
  static base::NoDestructor<EngineCallbacks> callbacks;
  return *callbacks;
}

bool g_browser_started = false;

std::unique_ptr<ScopedKeepAlive>& AppKeepAlive() {
  static base::NoDestructor<std::unique_ptr<ScopedKeepAlive>> keep_alive;
  return *keep_alive;
}

class ACBrowserMainExtraParts : public ChromeBrowserMainExtraParts {
 public:
  void PreBrowserStart() override {
    AppKeepAlive() = std::make_unique<ScopedKeepAlive>(
        KeepAliveOrigin::APP_CONTROLLER, KeepAliveRestartOption::DISABLED);
    StartLifetimeObservers();
  }
  void PostBrowserStart() override {
    g_browser_started = true;
    if (Callbacks().started) {
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
          FROM_HERE, std::move(Callbacks().started));
    }
  }
  void PostMainMessageLoopRun() override {
    if (Callbacks().shutting_down) {
      std::move(Callbacks().shutting_down).Run();
    }
  }
};

class ACBrowserMainParts : public content::BrowserMainParts {
 public:
  explicit ACBrowserMainParts(std::unique_ptr<content::BrowserMainParts> chrome)
      : chrome_(std::move(chrome)) {}

  int PreEarlyInitialization() override {
    return chrome_->PreEarlyInitialization();
  }
  void PostEarlyInitialization() override {
    chrome_->PostEarlyInitialization();
  }
  void ToolkitInitialized() override { chrome_->ToolkitInitialized(); }
  void PreCreateMainMessageLoop() override {
    chrome_->PreCreateMainMessageLoop();
  }
  void PostCreateMainMessageLoop() override {
    chrome_->PostCreateMainMessageLoop();
  }
  int PreCreateThreads() override { return chrome_->PreCreateThreads(); }
  void PostCreateThreads() override { chrome_->PostCreateThreads(); }
  int PreMainMessageLoopRun() override {
    result_ = chrome_->PreMainMessageLoopRun();
    return result_;
  }
  bool ShouldInterceptMainMessageLoopRun() override {
    return result_ == content::RESULT_CODE_NORMAL_EXIT && g_browser_started;
  }
  void WillRunMainMessageLoop(std::unique_ptr<base::RunLoop>& run_loop) override {
    chrome_->WillRunMainMessageLoop(run_loop);
    if (!run_loop) {
      run_loop = std::make_unique<base::RunLoop>();
      static_cast<BrowserProcessImpl*>(g_browser_process)
          ->SetQuitClosure(run_loop->QuitWhenIdleClosure());
    }
  }
  void OnFirstIdle() override { chrome_->OnFirstIdle(); }
  void PostMainMessageLoopRun() override { chrome_->PostMainMessageLoopRun(); }
  void PostDestroyThreads() override { chrome_->PostDestroyThreads(); }

 private:
  std::unique_ptr<content::BrowserMainParts> chrome_;
  int result_ = content::RESULT_CODE_NORMAL_EXIT;
};

class ACContentBrowserClient : public ChromeContentBrowserClient {
 public:
  void RenderProcessWillLaunch(content::RenderProcessHost* host) override {
    ChromeContentBrowserClient::RenderProcessWillLaunch(host);
    SendPageScript(host);
  }
  void RegisterAssociatedInterfaceBindersForRenderFrameHost(
      content::RenderFrameHost& render_frame_host,
      blink::AssociatedInterfaceRegistry& associated_registry) override {
    ChromeContentBrowserClient::
        RegisterAssociatedInterfaceBindersForRenderFrameHost(
            render_frame_host, associated_registry);
    RegisterPageChannelBinders(render_frame_host, associated_registry);
  }
  std::unique_ptr<content::WebContentsViewDelegate> GetWebContentsViewDelegate(
      content::WebContents* web_contents) override {
    return CreateViewDelegate(web_contents);
  }
  void CreateThrottlesForNavigation(
      content::NavigationThrottleRegistry& registry) override {
    ChromeContentBrowserClient::CreateThrottlesForNavigation(registry);
    AddAppSchemeThrottle(registry);
    MaybeAddNavigationHoldThrottle(registry);
  }
  std::optional<base::TimeDelta> GetSpareRendererDelayForSiteURL(
      const GURL& site_url) override {
    std::optional<base::TimeDelta> delay =
        ChromeContentBrowserClient::GetSpareRendererDelayForSiteURL(site_url);
    return delay ? delay : std::optional<base::TimeDelta>(base::Milliseconds(500));
  }

  void ConfigureNetworkContextParams(
      content::BrowserContext* context,
      bool in_memory,
      const base::FilePath& relative_partition_path,
      network::mojom::NetworkContextParams* network_context_params,
      cert_verifier::mojom::CertVerifierCreationParams*
          cert_verifier_creation_params) override {
    ChromeContentBrowserClient::ConfigureNetworkContextParams(
        context, in_memory, relative_partition_path, network_context_params,
        cert_verifier_creation_params);
    if (!in_memory && relative_partition_path.empty() &&
        !context->IsOffTheRecord()) {
      network_context_params->restore_old_session_cookies = true;
      network_context_params->persist_session_cookies = true;
    }
  }

  std::unique_ptr<content::BrowserMainParts> CreateBrowserMainParts(
      bool is_integration_test) override {
    std::unique_ptr<content::BrowserMainParts> chrome =
        ChromeContentBrowserClient::CreateBrowserMainParts(is_integration_test);
    static_cast<ChromeBrowserMainParts*>(chrome.get())
        ->AddParts(std::make_unique<ACBrowserMainExtraParts>());
    return std::make_unique<ACBrowserMainParts>(std::move(chrome));
  }
};

}

void SetEngineCallbacks(EngineCallbacks callbacks) {
  Callbacks() = std::move(callbacks);
}

void ReleaseAppKeepAlive() {
  AppKeepAlive().reset();
}

ACMainDelegate::ACMainDelegate(const StartupTimestamps& timestamps)
    : ChromeMainDelegate(timestamps) {
  g_ardia_embedder = true;
  g_ardia_resource_bundle_delegate = ProductStrings();
}

ACMainDelegate::~ACMainDelegate() = default;

std::optional<int> ACMainDelegate::BasicStartupComplete() {
  base::CommandLine* command_line = base::CommandLine::ForCurrentProcess();
  if (!command_line->HasSwitch(switches::kProcessType)) {
    command_line->AppendSwitch(switches::kNoStartupWindow);
    command_line->AppendSwitch(switches::kNoFirstRun);
    command_line->AppendSwitch(switches::kNoDefaultBrowserCheck);
    command_line->RemoveSwitch(switches::kMakeDefaultBrowser);
  }
  return ChromeMainDelegate::BasicStartupComplete();
}

void ACMainDelegate::PreSandboxStartup() {
  const base::CommandLine& command_line =
      *base::CommandLine::ForCurrentProcess();
  const std::string process_type =
      command_line.GetSwitchValueASCII(switches::kProcessType);
  if (chrome::ProcessNeedsProfileDir(process_type)) {
    base::FilePath dir = command_line.GetSwitchValuePath(switches::kUserDataDir);
    if (dir.empty() && !process_type.empty()) {
      base::FilePath scratch;
      if (base::GetTempDir(&scratch)) {
        base::PathService::OverrideAndCreateIfNeeded(
            chrome::DIR_USER_DATA, scratch.Append("ardiacore-helper"),
            true, false);
      }
      ChromeMainDelegate::PreSandboxStartup();
      return;
    }
    CHECK(!dir.empty()) << "ArdiaCore needs --user-data-dir";
    CHECK(base::CreateDirectory(dir));
    dir = base::MakeAbsoluteFilePath(dir);
    CHECK(base::PathService::OverrideAndCreateIfNeeded(
        chrome::DIR_USER_DATA, dir, true, false));
    base::PathService::Override(chrome::DIR_CRASH_DUMPS,
                                dir.Append(FILE_PATH_LITERAL("Crashpad")));
    component_updater::RegisterPathProvider(chrome::DIR_COMPONENTS,
                                            chrome::DIR_USER_DATA);
  }
  if (process_type.empty()) {
    InstallAppOverrides();
    InstallChromeHooks();
    g_ardia_user_agent_brand = "Google Chrome";
  }
  ChromeMainDelegate::PreSandboxStartup();
}

content::ContentRendererClient* ACMainDelegate::CreateContentRendererClient() {
  static base::NoDestructor<ACContentRendererClient> client;
  return client.get();
}

content::ContentBrowserClient* ACMainDelegate::CreateContentBrowserClient() {
  chrome_content_browser_client_ = std::make_unique<ACContentBrowserClient>();
  if (sampling_profiler_) {
    chrome_content_browser_client_->SetSamplingProfiler(
        std::move(sampling_profiler_));
  }
  return chrome_content_browser_client_.get();
}

}
