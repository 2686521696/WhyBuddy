import { createContext, type CSSProperties, type ReactNode } from "react";

/**
 * Context that indicates whether the current component tree is within
 * a MiroFish theme scope. Defaults to `false`.
 */
export const MirofishThemeContext = createContext<boolean>(false);

interface MirofishThemeProviderProps {
  children: ReactNode;
  enabled?: boolean;
  /** Optional className forwarded to the wrapper div when enabled */
  className?: string;
  /** Optional inline styles forwarded to the wrapper div when enabled */
  style?: CSSProperties;
}

/**
 * Provides MiroFish theme scope to descendant components.
 *
 * Defaults to `enabled=false`. AutopilotRoutePage explicitly passes `enabled`
 * to opt in. This prevents accidental theme activation in shared component
 * tests and future page reuse.
 *
 * When disabled, renders children directly without any wrapper element,
 * ensuring zero DOM changes in non-MiroFish contexts.
 *
 * When enabled, wraps children in a `<div data-theme="mirofish">` so that
 * CSS layer rules scoped to `[data-theme="mirofish"]` take effect.
 * Optional `className` and `style` props are forwarded to the wrapper div,
 * allowing the parent to apply grid-item constraints directly.
 */
export function MirofishThemeProvider({
  children,
  enabled = false,
  className,
  style,
}: MirofishThemeProviderProps) {
  if (!enabled) {
    return (
      <MirofishThemeContext.Provider value={false}>
        {children}
      </MirofishThemeContext.Provider>
    );
  }

  return (
    <MirofishThemeContext.Provider value={true}>
      <div data-theme="mirofish" className={className} style={style}>
        {children}
      </div>
    </MirofishThemeContext.Provider>
  );
}
