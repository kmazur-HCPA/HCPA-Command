export const contactFields = [
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "mobile", label: "Mobile phone", type: "tel" },
  { key: "department", label: "Department", type: "text" },
  { key: "location", label: "Location", type: "text" },
] as const;
export const validEmail = (value: string) =>
  !value ||
  (value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value));
export const validPhone = (value: string) =>
  value.length <= 80 &&
  !Array.from(value).some((character) => character.charCodeAt(0) < 32);
export function telephoneLink(value: string) {
  // Do not put arbitrary imported text into a URL scheme.
  const number = value
    .replace(/(?:ext\.?|x|#)\s*(\d+)\s*$/i, ";ext=$1")
    .replace(/[^\d+;=ext]/g, "");
  return /\d/.test(number) ? `tel:${number}` : undefined;
}
export type DirectoryPerson = {
  id: string;
  title: string;
  organization: string;
  person_role: string;
  details: Record<string, string>;
  archived: boolean;
  version: number;
  notes_excerpt: string;
};
export type ContactInput = {
  id: string;
  name: string;
  email: string;
  job_title: string;
  organization: string;
  phone: string;
  mobile: string;
  department: string;
  location: string;
  notes: string;
};
export type ImportRow = { row: number; contact: ContactInput; issue: string };
export type ContactMatch = Pick<
  DirectoryPerson,
  "id" | "title" | "organization" | "details" | "archived"
>;
const normal = (value: string) => value.trim().toLowerCase();
export function duplicateKeys(person: {
  name: string;
  email: string;
  organization: string;
}) {
  return [
    ...(person.email ? [`email:${normal(person.email)}`] : []),
    `name:${JSON.stringify([normal(person.name), normal(person.organization)])}`,
  ];
}
export function flagDuplicates(rows: ImportRow[], existing: ContactMatch[]) {
  const seen = new Map<string, string>();
  for (const person of existing)
    for (const key of duplicateKeys({
      name: person.title,
      email: person.details.email ?? "",
      organization: person.organization,
    }))
      seen.set(
        key,
        person.archived
          ? "Matches an archived contact"
          : "Matches an existing contact",
      );
  return rows.map((row) => {
    if (row.issue) return row;
    const keys = duplicateKeys(row.contact),
      match = keys.map((key) => seen.get(key)).find(Boolean);
    if (match) return { ...row, issue: match };
    for (const key of keys) seen.set(key, "Duplicate in this file");
    return row;
  });
}
