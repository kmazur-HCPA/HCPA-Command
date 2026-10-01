import type { Theme } from "../services/account";

export type ThemeMode = "auto" | "day" | "evening";
type Switcher = {
  getMode: () => ThemeMode;
  setMode: (mode: ThemeMode) => void;
};
const switcher = () => (window as unknown as { CommandTheme?: Switcher }).CommandTheme;

export const themeModes: { mode: ThemeMode; label: string }[] = [
  { mode: "auto", label: "Auto" },
  { mode: "day", label: "Day" },
  { mode: "evening", label: "Evening" },
];

// The saved preference stores the mode directly. Accounts saved before the Stone redesign hold
// system / dark / light: Day carries over; system and dark (the old default) mean Auto.
export const toStoredTheme = (mode: ThemeMode): Theme => mode;
export const fromStoredTheme = (theme: Theme): ThemeMode =>
  theme === "day" || theme === "light" ? "day" : theme === "evening" ? "evening" : "auto";

export const currentMode = (): ThemeMode => switcher()?.getMode() ?? "auto";
export const hasLocalMode = () => {
  try {
    return localStorage.getItem("cmd-theme-mode") !== null;
  } catch {
    return false;
  }
};
export const setMode = (mode: ThemeMode) => {
  switcher()?.setMode(mode);
  window.dispatchEvent(new Event("cmd-modechange"));
};
