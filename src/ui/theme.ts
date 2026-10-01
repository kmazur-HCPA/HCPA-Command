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

// The saved preference keeps its existing three values so the database is unchanged.
export const toStoredTheme = (mode: ThemeMode): Theme =>
  mode === "day" ? "light" : mode === "evening" ? "dark" : "system";
// "dark" was the old default for every account, so it cannot be read as a deliberate Evening
// choice on a device with no local setting. Only an explicit Day or Auto carries across devices.
export const fromStoredTheme = (theme: Theme): ThemeMode => (theme === "light" ? "day" : "auto");

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
