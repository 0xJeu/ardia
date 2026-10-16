import type { LinkRoute } from "@ardia/ardiacore";
import { useBrowser } from "../store/browser";
import { engineProfile } from "../store/model";

export type RoutedLinks = { profileId: string | null; adoptIds: (string | undefined)[] };

export function routedLinks(route: LinkRoute, count: number): RoutedLinks {
  const s = useBrowser.getState();
  const marks = route.adoptIds ?? [];
  const profileId = route.profile === undefined ? null : (s.profileOrder.find((id) => engineProfile(id) === route.profile) ?? null);
  return {
    profileId,
    adoptIds: Array.from({ length: count }, (_, i) => (profileId !== null && typeof marks[i] === "string" ? marks[i]! : undefined)),
  };
}
