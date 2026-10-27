const units = (n: number, unit: string) => (n === 1 ? `1 ${unit} ago` : `${n} ${unit}s ago`);

export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return units(m, "minute");
  const h = Math.floor(m / 60);
  if (h < 24) return units(h, "hour");
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  if (d < 30) return units(Math.floor(d / 7), "week");
  if (d < 365) return units(Math.floor(d / 30), "month");
  return units(Math.floor(d / 365), "year");
}

export type DurationUnit = "minutes" | "hours" | "days";

export function hoursFrom(amount: number, unit: DurationUnit): number {
  return unit === "minutes" ? amount / 60 : unit === "days" ? amount * 24 : amount;
}

export function durationFromHours(hours: number): { amount: number; unit: DurationUnit } {
  const minutes = Math.round(hours * 60);
  if (minutes % 1440 === 0) return { amount: minutes / 1440, unit: "days" };
  if (minutes % 60 === 0) return { amount: minutes / 60, unit: "hours" };
  return { amount: minutes, unit: "minutes" };
}

export function durationTitle(hours: number): string {
  const { amount, unit } = durationFromHours(hours);
  return `${amount} ${amount === 1 ? unit.slice(0, -1) : unit}`;
}
