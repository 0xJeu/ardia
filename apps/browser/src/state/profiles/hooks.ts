import { useBrowser } from "../browser/store";
import { profileFor } from "../browser/model";
import type { Profile } from "../browser/types";

export function useProfileRecords(): Record<string, Profile>;
export function useProfileRecords<T>(select: (profiles: Record<string, Profile>) => T): T;
export function useProfileRecords<T>(select?: (profiles: Record<string, Profile>) => T) {
  return useBrowser((s) => (select ? select(s.profiles) : s.profiles));
}

export function useProfileOrder(): string[];
export function useProfileOrder<T>(select: (order: string[]) => T): T;
export function useProfileOrder<T>(select?: (order: string[]) => T) {
  return useBrowser((s) => (select ? select(s.profileOrder) : s.profileOrder));
}

export const useProfileName = (profileId: string): string => useBrowser((s) => profileFor(s, profileId).name);

export const useWindowProfileValue = <T>(windowId: string, select: (profile: Profile | undefined) => T): T =>
  useBrowser((s) => select(s.profiles[s.windows[windowId]?.profileId ?? ""]));
