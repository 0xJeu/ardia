type Option = { value: string; label: string; hint?: string; disabled?: boolean };
type Control =
  | { kind: "choice"; id: string; label: string; value: string; options: Option[] }
  | { kind: "action"; id: string; label: string; hint: string; on?: boolean };
type Outbound = { type: "ardia-demo:ready" } | { type: "ardia-demo:controls"; controls: Control[] };

const MIN_LOGICAL_WIDTH = 1100;
const REVEAL_FALLBACK_MS = 1500;

const root = document.querySelector<HTMLElement>("[data-demo]");
const stage = root?.querySelector<HTMLElement>("[data-demo-stage]");
const poster = root?.querySelector<HTMLElement>("[data-demo-poster]");
const bar = document.querySelector<HTMLElement>("[data-demo-controls]");
const roomy = matchMedia("(hover: hover) and (pointer: fine) and (min-width: 900px)");

function fit(frame: HTMLIFrameElement, box: HTMLElement) {
  const { width, height } = box.getBoundingClientRect();
  if (!width || !height) return;
  const logicalWidth = Math.max(width, MIN_LOGICAL_WIDTH);
  const scale = width / logicalWidth;
  frame.style.width = `${logicalWidth}px`;
  frame.style.height = `${height / scale}px`;
  frame.style.transform = `scale(${scale})`;
  box.style.setProperty("--demo-scale", String(scale));
}

function title(label: string, hint?: string) {
  return hint ? `${label} (${hint})` : label;
}

function button(control: Control, option?: Option) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "demo-control";
  el.dataset.track = "demo_control";
  el.dataset.trackControl = control.id;
  if (option) {
    el.setAttribute("role", "radio");
    el.dataset.value = option.value;
    el.dataset.trackValue = option.value;
    el.textContent = option.label;
    el.title = title(`${control.label}: ${option.label}`, option.hint);
  } else if (control.kind === "action") {
    el.textContent = control.label;
    el.title = title(control.label, control.hint);
  }
  el.addEventListener("mousedown", (e) => e.preventDefault());
  return el;
}

function renderControls(frame: HTMLIFrameElement, controls: Control[], target: HTMLElement) {
  const shape = JSON.stringify(controls.map((c) => [c.id, c.kind === "choice" ? c.options.map((o) => o.value + o.label) : c.label]));
  if (target.dataset.shape !== shape) {
    target.dataset.shape = shape;
    target.replaceChildren();
    let actions: HTMLElement | null = null;
    for (const control of controls) {
      if (control.kind === "action") {
        if (!actions) {
          actions = document.createElement("div");
          actions.className = "demo-group";
          target.append(actions);
        }
        const el = button(control);
        el.addEventListener("click", () => {
          if (control.id === "command") frame.focus();
          frame.contentWindow?.postMessage({ type: "ardia-demo:control", id: control.id }, "*");
        });
        actions.append(el);
        continue;
      }
      const group = document.createElement("div");
      group.className = "demo-group";
      group.setAttribute("role", "radiogroup");
      group.setAttribute("aria-label", control.label);
      const label = document.createElement("span");
      label.className = "label demo-label";
      label.textContent = control.label;
      group.append(label);
      for (const option of control.options) {
        const el = button(control, option);
        el.addEventListener("click", () => frame.contentWindow?.postMessage({ type: "ardia-demo:control", id: control.id, value: option.value }, "*"));
        group.append(el);
      }
      target.append(group);
    }
  }
  const buttons = [...target.querySelectorAll<HTMLButtonElement>("button")];
  for (const control of controls) {
    const mine = buttons.filter((b) => b.dataset.trackControl === control.id);
    if (control.kind === "action") {
      for (const b of mine) b.setAttribute("aria-pressed", String(!!control.on));
      continue;
    }
    for (const b of mine) {
      const option = control.options.find((o) => o.value === b.dataset.value);
      b.setAttribute("aria-checked", String(control.value === b.dataset.value));
      b.disabled = !!option?.disabled;
    }
  }
}

function mount(box: HTMLElement, src: string) {
  const frame = document.createElement("iframe");
  frame.src = src;
  frame.title = "Ardia, live: try the sidebar, split view and the command bar";
  frame.className = "demo-frame";
  box.append(frame);
  fit(frame, box);
  new ResizeObserver(() => fit(frame, box)).observe(box);

  let ready = false;
  let loaded = false;
  const reveal = () => {
    if (!root || root.dataset.live === "") return;
    root.dataset.live = "";
    poster?.setAttribute("inert", "");
    if (bar) bar.hidden = false;
    document.querySelector("[data-band-lead]")?.replaceChildren("That was a demo. ");
  };
  frame.addEventListener("load", () => {
    loaded = true;
    if (ready) reveal();
  });
  addEventListener("message", (event: MessageEvent<Outbound>) => {
    if (event.source !== frame.contentWindow || !event.data || typeof event.data !== "object") return;
    if (event.data.type === "ardia-demo:ready") {
      ready = true;
      if (loaded) reveal();
      else setTimeout(reveal, REVEAL_FALLBACK_MS);
    }
    if (event.data.type === "ardia-demo:controls" && bar) renderControls(frame, event.data.controls, bar);
  });
}

function start() {
  if (!root || !stage || root.dataset.mounted === "") return;
  if (!roomy.matches || document.documentElement.dataset.device === "phone") return;
  root.dataset.mounted = "";
  const src = root.dataset.demoSrc!;
  const near = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      near.disconnect();
      mount(stage, src);
    },
    { rootMargin: "100% 0px" },
  );
  near.observe(root);
}

function afterLoad(run: () => void) {
  const idle = () => ("requestIdleCallback" in window ? requestIdleCallback(run, { timeout: 2000 }) : setTimeout(run, 200));
  if (document.readyState === "complete") idle();
  else addEventListener("load", idle, { once: true });
}

afterLoad(start);
roomy.addEventListener("change", start);
