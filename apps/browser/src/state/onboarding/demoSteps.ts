import { isWebDemo } from "../../platform/webDemo";

const MAC_ONLY_STEPS: readonly string[] = ["searchPrivacy", "home"];

export const stepsForThisSurface = <T extends string>(steps: T[]): T[] => (isWebDemo ? steps.filter((s) => !MAC_ONLY_STEPS.includes(s)) : steps);
