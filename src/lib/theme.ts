/**
 * Per-viewer appearance preference, stored in cookies so the server renders the right theme
 * without a flash. Shared by server (root layout) and client (theme menu).
 */
export const PALETTES = [
  { id: "calm", label: "Calm", description: "Neutral green-gray (default)" },
  { id: "sky", label: "Sky", description: "Bright, airy blue and white" },
] as const;
export type Palette = (typeof PALETTES)[number]["id"];

export const MODES = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const;
export type Mode = (typeof MODES)[number]["id"];

export const PALETTE_COOKIE = "rhi_palette";
export const MODE_COOKIE = "rhi_mode";
export const DEFAULT_PALETTE: Palette = "calm";
export const DEFAULT_MODE: Mode = "system";

export function parsePalette(value: string | undefined | null): Palette {
  return PALETTES.some((p) => p.id === value) ? (value as Palette) : DEFAULT_PALETTE;
}

export function parseMode(value: string | undefined | null): Mode {
  return MODES.some((m) => m.id === value) ? (value as Mode) : DEFAULT_MODE;
}
