import type { Kind } from "../features/work/model";
export type PageName = "workspace" | "settings" | "close" | Kind;
export const navigation: {
  page: PageName;
  label: string;
  icon: string;
  group: string;
}[] = [
  { page: "workspace", label: "Work Day", icon: "home", group: "Work" },
  { page: "task", label: "Tasks", icon: "task", group: "Work" },
  { page: "project", label: "Projects", icon: "project", group: "Work" },
  { page: "close", label: "Close the Day", icon: "check", group: "Work" },
  { page: "person", label: "People", icon: "person", group: "Context" },
  { page: "settings", label: "Settings", icon: "settings", group: "Context" },
];
// Address bar path for a page: Close the Day has its own /close route.
export const pageUrl = (page: PageName) =>
  page === "workspace" ? "/" : page === "close" ? "/close" : `/?page=${page}`;
