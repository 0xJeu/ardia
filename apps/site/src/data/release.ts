import release from "./release.json";

export const VERSION = release.version;
export const DMG_SIZE = `${Math.round(release.dmgBytes / 1e6)} MB`;
export const REPO = "https://github.com/mantrakp04/ardia";
export const DISCORD = "https://discord.gg/TdhuXrbcA6";
export const RELEASES = `${REPO}/releases/latest`;
export const DMG = `${REPO}/releases/download/v${VERSION}/Ardia-${VERSION}.dmg`;
export const NIGHTLY = "/nightly";
export const MIN_MACOS_MAJOR = 14;
export const MIN_MACOS = `macOS ${MIN_MACOS_MAJOR} Sonoma`;
export const SENT_REFS = ["mac", "share", "email"] as const;
export type SentRef = (typeof SENT_REFS)[number];
export const sentPath = (ref: SentRef) => `${import.meta.env.BASE_URL.replace(/\/$/, "")}/?ref=${ref}`;
export const sentLink = (ref: SentRef) => new URL(sentPath(ref), import.meta.env.SITE).href;
