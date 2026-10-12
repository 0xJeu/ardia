// The rename changed the app's bundle id, so macOS no longer counts it as the default browser. When the old app was
// the default, the launch migration leaves default-browser-offer.json in the data folder
// (packages/sync/ios/Core/LegacyMigration.swift); once the first window is up, the app asks once to be the default
// again, the way onboarding and Settings do (macOS's own confirmation), and records that it asked.
// appIntegration.ts runs it with the live dependencies.

export const DEFAULT_BROWSER_OFFER = "default-browser-offer.json";

type Offer = { version: 1; askedAt: number | null };

type OfferOutcome = "none" | "testInstance" | "onboarding" | "alreadyDefault" | "asked";

type OfferDeps = {
  read(name: string): string | null;
  /** Resolves once it's on disk; rejects when it can't be written (then it never asks). */
  save(name: string, contents: string): Promise<void>;
  /** A test instance (hidden or on its own data dir): macOS's question would come up on the owner's screen. */
  testInstance: boolean;
  /** Onboarding is showing, or hasn't been done: its own step asks. */
  onboarding: boolean;
  isDefault(): Promise<boolean>;
  setDefault(): Promise<boolean>;
};

export async function offerDefaultBrowserAgain(deps: OfferDeps): Promise<OfferOutcome> {
  let offer: Offer | null = null;
  try {
    offer = JSON.parse(deps.read(DEFAULT_BROWSER_OFFER) ?? "null") as Offer | null;
  } catch {}
  if (!offer || offer.askedAt) return "none";
  if (deps.testInstance) return "testInstance";
  // Before it's recorded: a question that fails (or a quit) here leaves the offer for the next launch.
  const isDefault = deps.onboarding ? false : await deps.isDefault();
  // Recorded on disk before macOS asks: whatever happens next, it never asks again.
  await deps.save(DEFAULT_BROWSER_OFFER, JSON.stringify({ ...offer, askedAt: Date.now() } satisfies Offer));
  if (deps.onboarding) return "onboarding";
  if (isDefault) return "alreadyDefault";
  await deps.setDefault();
  return "asked";
}
