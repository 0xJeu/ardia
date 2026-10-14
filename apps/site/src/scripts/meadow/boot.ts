import { startSunrise } from "./clock";

const FALLBACK_START_MS = 2200;
const CANVAS_FADE_LEAD_MS = 260;

function afterFirstPaint(callback: () => void) {
  requestAnimationFrame(() => {
    if ("requestIdleCallback" in window) requestIdleCallback(callback, { timeout: 500 });
    else setTimeout(callback, 60);
  });
}

function boot(hero: HTMLElement) {
  const canvas = hero.querySelector<HTMLCanvasElement>("[data-meadow-canvas]");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fallbackTimer = setTimeout(() => startSunrise(hero), FALLBACK_START_MS);
  const giveUp = () => {
    clearTimeout(fallbackTimer);
    startSunrise(hero);
  };
  if (!canvas || !("WebGL2RenderingContext" in window)) return giveUp();

  afterFirstPaint(() => {
    import("./scene")
      .then(({ createMeadow }) => {
        const meadow = createMeadow({
          canvas,
          hero,
          hint: hero.querySelector<HTMLElement>("[data-sun-hint]"),
          reducedMotion,
          onFirstFrame() {
            clearTimeout(fallbackTimer);
            hero.dataset.meadow = "ready";
            if (reducedMotion) startSunrise(hero);
            else setTimeout(() => startSunrise(hero), CANVAS_FADE_LEAD_MS);
          },
        });
        if (!meadow) giveUp();
      })
      .catch(giveUp);
  });
}

const hero = document.querySelector<HTMLElement>("[data-meadow]");
if (hero) boot(hero);
