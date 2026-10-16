// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ThemeMenu } from "@/components/ThemeMenu";
import { parseMode, parsePalette } from "@/lib/theme";

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.palette;
  delete document.documentElement.dataset.mode;
  document.cookie = "rhi_palette=; max-age=0; path=/";
  document.cookie = "rhi_mode=; max-age=0; path=/";
});

describe("theme preferences", () => {
  it("falls back to defaults for missing or unknown values", () => {
    expect(parsePalette(undefined)).toBe("calm");
    expect(parsePalette("neon")).toBe("calm");
    expect(parsePalette("sky")).toBe("sky");
    expect(parseMode("sepia")).toBe("system");
    expect(parseMode("dark")).toBe("dark");
  });

  it("switches palette and mode, applies them to <html> and remembers them in cookies", () => {
    document.documentElement.dataset.palette = "calm";
    document.documentElement.dataset.mode = "system";
    render(<ThemeMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    expect(screen.getByRole("radio", { name: /Calm/ })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: /Sky/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));

    expect(document.documentElement.dataset.palette).toBe("sky");
    expect(document.documentElement.dataset.mode).toBe("dark");
    expect(document.cookie).toContain("rhi_palette=sky");
    expect(document.cookie).toContain("rhi_mode=dark");
    expect(screen.getByRole("radio", { name: /Sky/ })).toBeChecked();
  });
});
