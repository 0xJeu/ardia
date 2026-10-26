import { startCustomize, watchCustomize, type CustomizeState } from "./customizeFlow";
import { playNudge } from "./nudge";

type Inbound = { type: "ardia-demo:customize" } | { type: "ardia-demo:hello" } | { type: "ardia-demo:nudge" };

function guardFocus(engaged: () => boolean) {
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function guardedFocus(options?: FocusOptions) {
    if (!engaged()) return;
    focus.call(this, { ...options, preventScroll: true });
  };
}

export function startEmbed() {
  const host = window.parent;
  if (host === window) return;
  document.documentElement.classList.add("embed");

  const post = (message: object) => host.postMessage(message, "*");
  let engaged = false;
  let nudged = false;
  const nudge = new AbortController();
  const engage = () => {
    if (engaged) return;
    engaged = true;
    nudge.abort();
    post({ type: "ardia-demo:engaged" });
  };
  guardFocus(() => engaged);
  addEventListener("pointerdown", engage, { capture: true });
  addEventListener("keydown", engage, { capture: true });

  let state: CustomizeState = { active: false, code: null };
  const publish = () => post({ type: "ardia-demo:customize-state", ...state });
  watchCustomize((next) => {
    state = next;
    publish();
  });

  addEventListener("message", (event: MessageEvent<Inbound>) => {
    if (event.source !== host || !event.data || typeof event.data !== "object") return;
    if (event.data.type === "ardia-demo:hello") return publish();
    if (event.data.type === "ardia-demo:nudge") {
      if (engaged || nudged) return;
      nudged = true;
      void playNudge(nudge.signal);
      return;
    }
    if (event.data.type === "ardia-demo:customize") {
      engage();
      startCustomize();
    }
  });

  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      publish();
      post({ type: "ardia-demo:ready" });
    }),
  );
}
