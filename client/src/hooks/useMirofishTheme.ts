import { useContext } from "react";
import { MirofishThemeContext } from "@/contexts/MirofishThemeContext";

/**
 * Returns whether the current component is within a MiroFish theme scope.
 *
 * Context-based only — no DOM fallback.
 * Must be used inside a MirofishThemeProvider; returns `false` by default.
 */
export function useMirofishTheme(): boolean {
  return useContext(MirofishThemeContext);
}
