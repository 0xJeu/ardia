const dark = {
  cardFill: "#FFFFFF17",
  cardBorder: "#FFFFFF0A",
  cardShadowOpacity: 0.3,
  title: "rgba(255,255,255,0.8)",
  body: "rgba(255,255,255,0.6)",
  arrow: "#FFFFFF99",
  badge: "#FFFFFF14",
  badgeGlyph: "#FFFFFFCC",
  askFill: "#FFFFFF17",
  askFillHover: "#FFFFFF24",
  askFillPressed: "#FFFFFF2E",
  askText: "rgba(255,255,255,0.85)",
};

export type NtpCardColors = typeof dark;

const light: NtpCardColors = {
  cardFill: "#FFFFFF80",
  cardBorder: "#00000014",
  cardShadowOpacity: 0.1,
  title: "rgba(0,0,0,0.8)",
  body: "rgba(0,0,0,0.53)",
  arrow: "#00000087",
  badge: "#0000000A",
  badgeGlyph: "#000000B3",
  askFill: "#0000000D",
  askFillHover: "#00000017",
  askFillPressed: "#0000001F",
  askText: "rgba(0,0,0,0.8)",
};

export const ntpCardColors = { dark, light } as const;

export const NTP_CARD_SHADOW = { color: "#000000", radius: 24, offset: [0, 8] as [number, number] };
