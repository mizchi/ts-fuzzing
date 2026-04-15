import { createContext, useContext, type ReactNode } from "react";

const ThemeContext = createContext<"light" | "dark" | null>(null);

export type ThemeProviderProps = {
  children?: ReactNode;
  locale?: "ja-JP" | "en-US";
  theme: "light" | "dark";
};

export const ThemeProvider = ({ children, theme }: ThemeProviderProps) => {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
};

export type ThemePanelProps = {
  /**
   * @fuzz.minLength 1
   * @fuzz.maxLength 8
   */
  label: string;
  mode: "safe" | "explode";
};

export const ThemePanel = ({ label, mode }: ThemePanelProps) => {
  const theme = useContext(ThemeContext);
  if (theme === null) {
    throw new Error("theme context missing");
  }
  if (theme === "dark" && mode === "explode") {
    throw new Error(`dark theme rejected:${label}`);
  }

  return (
    <section data-theme={theme}>
      {theme}:{label}
    </section>
  );
};
