import { createContext, useContext, useState, useEffect } from "react";

const ThemeCtx = createContext({ isDark: true, toggle: () => {} });

export function useTheme() {
  return useContext(ThemeCtx);
}

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(() => {
    return localStorage.getItem("theme") !== "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  }, [isDark]);

  // Set initial attribute on mount
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  }, []);

  function toggle() {
    setIsDark(d => {
      const next = !d;
      localStorage.setItem("theme", next ? "dark" : "light");
      return next;
    });
  }

  return (
    <ThemeCtx.Provider value={{ isDark, toggle }}>
      {children}
    </ThemeCtx.Provider>
  );
}
