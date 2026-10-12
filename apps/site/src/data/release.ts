export const VERSION = "0.2.33";
export const DMG_SIZE = "197 MB";
export const REPO = "https://github.com/mantrakp04/ardia";
export const RELEASES = `${REPO}/releases/latest`;
// Releases up to 0.2.32 shipped as Netnyahoo-<version>.dmg; Ardia-<version>.dmg from 0.2.33.
const DMG_NAME = VERSION.localeCompare("0.2.33", "en", { numeric: true }) < 0 ? "Netnyahoo" : "Ardia";
export const DMG = `${REPO}/releases/latest/download/${DMG_NAME}-${VERSION}.dmg`;
export const MIN_MACOS = "macOS 14 Sonoma";
