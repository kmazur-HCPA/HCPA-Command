import type { Kind } from "../features/work/model";
export type PageName = "workspace" | "settings" | "lab" | Kind;
export const navigation: {
  page: PageName;
  label: string;
  icon: string;
  group: string;
}[] = [
  { page: "workspace", label: "Work Day", icon: "home", group: "Work" },
  { page: "task", label: "Tasks", icon: "task", group: "Work" },
  { page: "project", label: "Projects", icon: "project", group: "Work" },
  { page: "journal", label: "Journal", icon: "journal", group: "Work" },
  { page: "learning", label: "Learning", icon: "learning", group: "Explore" },
  { page: "library", label: "Library", icon: "library", group: "Explore" },
  { page: "lab", label: "AI Lab", icon: "lab", group: "Explore" },
  { page: "person", label: "People", icon: "person", group: "Context" },
  {
    page: "initiative",
    label: "Initiatives",
    icon: "initiative",
    group: "Context",
  },
  { page: "settings", label: "Settings", icon: "settings", group: "Context" },
];
