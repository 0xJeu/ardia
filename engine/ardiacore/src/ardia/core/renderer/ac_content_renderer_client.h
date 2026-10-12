// ArdiaCore's renderer side (what CEF's renderer process handler gave packages/cef): Chrome's
// renderer client, plus the page script in every frame's main world and the page channel
// (ardia/core/mojom/ardiacore.mojom).

#ifndef ARDIA_CORE_RENDERER_AC_CONTENT_RENDERER_CLIENT_H_
#define ARDIA_CORE_RENDERER_AC_CONTENT_RENDERER_CLIENT_H_

#include <memory>

#include "chrome/renderer/chrome_content_renderer_client.h"

namespace ardiacore {

class ACRenderThreadObserver;

class ACContentRendererClient : public ChromeContentRendererClient {
 public:
  ACContentRendererClient();
  ~ACContentRendererClient() override;

  // ChromeContentRendererClient:
  void RenderThreadStarted() override;
  void RenderFrameCreated(content::RenderFrame* render_frame) override;

 private:
  std::unique_ptr<ACRenderThreadObserver> observer_;
};

}  // namespace ardiacore

#endif  // ARDIA_CORE_RENDERER_AC_CONTENT_RENDERER_CLIENT_H_
