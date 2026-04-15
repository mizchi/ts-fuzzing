import { createContext, useContext, type ReactNode } from "react";

const ThemeContext = createContext<string | null>(null);

export type ThemeProviderProps = {
  children?: ReactNode;
  theme: "dark" | "light";
};

export const ThemeProvider = ({ children, theme }: ThemeProviderProps) => {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
};

export type ThemeLabelProps = {
  label: string;
};

export const ThemeLabel = ({ label }: ThemeLabelProps) => {
  const theme = useContext(ThemeContext);
  if (theme === null) {
    throw new Error("theme context missing");
  }
  return (
    <span data-theme={theme}>
      {theme}:{label}
    </span>
  );
};

export type ThemeBombProps = {
  label: string;
};

export const ThemeBomb = ({ label }: ThemeBombProps) => {
  const theme = useContext(ThemeContext);
  if (theme === null) {
    throw new Error("theme context missing");
  }
  if (theme === "dark") {
    throw new Error(`dark theme rejected:${label}`);
  }
  return <span>{label}</span>;
};
