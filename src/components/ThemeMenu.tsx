"use client";

import { Check, Monitor, Moon, Palette as PaletteIcon, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Mode, MODE_COOKIE, MODES, Palette, PALETTE_COOKIE, PALETTES, parseMode, parsePalette } from "@/lib/theme";

const MODE_ICONS = { system: Monitor, light: Sun, dark: Moon } as const;
const ONE_YEAR = 60 * 60 * 24 * 365;

/** Swatches preview each palette's canvas, surface and accent. */
const SWATCH: Record<Palette, [string, string, string]> = {
  calm: ["#f6f7f5", "#ffffff", "#1c6e62"],
  sky: ["#f4f6f8", "#ffffff", "#3c86cf"],
};

/** Applies a preference to <html> immediately and remembers it for server rendering. */
function applyPreference(attr: "palette" | "mode", cookie: string, value: string) {
  document.documentElement.dataset[attr] = value;
  document.cookie = `${cookie}=${value}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
}

export function ThemeMenu() {
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState<Palette>("calm");
  const [mode, setMode] = useState<Mode>("system");
  const ref = useRef<HTMLDivElement>(null);

  function sync() {
    const root = document.documentElement;
    setPalette(parsePalette(root.dataset.palette));
    setMode(parseMode(root.dataset.mode));
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  function choosePalette(p: Palette) {
    applyPreference("palette", PALETTE_COOKIE, p);
    setPalette(p);
  }

  function chooseMode(m: Mode) {
    applyPreference("mode", MODE_COOKIE, m);
    setMode(m);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="btn-ghost"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Appearance"
        onClick={() => {
          if (!open) sync();
          setOpen((o) => !o);
        }}
      >
        <PaletteIcon aria-hidden className="h-5 w-5" />
      </button>
      {open && (
        <div role="dialog" aria-label="Appearance" className="card absolute right-0 z-40 mt-2 w-72 p-3 shadow-xl">
          <fieldset>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Theme</legend>
            <div className="space-y-1.5">
              {PALETTES.map((p) => {
                const [canvas, surface, accent] = SWATCH[p.id];
                const active = palette === p.id;
                return (
                  <label
                    key={p.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${active ? "border-accent bg-accent/5" : "border-line hover:bg-sunken"}`}
                  >
                    <input type="radio" name="palette" value={p.id} checked={active} onChange={() => choosePalette(p.id)} className="sr-only" />
                    <span aria-hidden className="flex h-8 w-12 overflow-hidden rounded-md border border-line" style={{ background: canvas }}>
                      <span className="m-1 flex-1 rounded-sm" style={{ background: surface }} />
                      <span className="my-2 mr-1 w-2 rounded-sm" style={{ background: accent }} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{p.label}</span>
                      <span className="block text-xs text-muted">{p.description}</span>
                    </span>
                    {active && <Check aria-hidden className="h-4 w-4 text-accent" />}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <fieldset className="mt-3">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Mode</legend>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-sunken p-1">
              {MODES.map((m) => {
                const Icon = MODE_ICONS[m.id];
                const active = mode === m.id;
                return (
                  <label
                    key={m.id}
                    className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${active ? "bg-surface text-ink elevated" : "text-muted hover:text-ink"}`}
                  >
                    <input type="radio" name="mode" value={m.id} checked={active} onChange={() => chooseMode(m.id)} className="sr-only" />
                    <Icon aria-hidden className="h-3.5 w-3.5" />
                    {m.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <p className="mt-3 text-xs text-muted">Saved in this browser only.</p>
        </div>
      )}
    </div>
  );
}
