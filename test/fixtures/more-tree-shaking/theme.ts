import * as React from "react";

export type Theme = "light" | "dark";

export interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

// These are implementation details - should NOT appear in output
export const ThemeContext: React.Context<ThemeContextValue>;

export declare function useTheme(): ThemeContextValue;

export declare const ThemeProvider: React.FC<{ children: React.ReactNode }>;
