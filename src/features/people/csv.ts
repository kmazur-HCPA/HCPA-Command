import {
  validEmail,
  validPhone,
  type ContactInput,
  type ImportRow,
} from "./model";
const aliases: Record<string, keyof ContactInput | "first" | "last"> = {
  name: "name",
  fullname: "name",
  displayname: "name",
  firstname: "first",
  givenname: "first",
  lastname: "last",
  surname: "last",
  email: "email",
  emailaddress: "email",
  primaryemail: "email",
  jobtitle: "job_title",
  title: "job_title",
  role: "job_title",
  organization: "organization",
  company: "organization",
  companyname: "organization",
  phone: "phone",
  businessphone: "phone",
  workphone: "phone",
  mobile: "mobile",
  mobilephone: "mobile",
  cellphone: "mobile",
  department: "department",
  location: "location",
  officelocation: "location",
  notes: "notes",
  note: "notes",
  comments: "notes",
};
export const csvTemplate =
  "Name,Email,Job Title,Organization,Phone,Mobile,Department,Location,Notes\r\n";
export function parseContacts(text: string): {
  rows: ImportRow[];
  ignored: string[];
} {
  if (text.length > 2 * 1024 * 1024)
    throw new Error("Use a CSV smaller than 2 MB.");
  text = text.replace(/^\uFEFF/, "");
  if (text.includes("\0")) throw new Error("Save the file as UTF-8 CSV.");
  const records: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  const pushField = () => {
    row.push(field);
    field = "";
    closed = false;
    if (row.length > 200) throw new Error("CSV has too many columns.");
  };
  const pushRow = () => {
    pushField();
    if (row.some((v) => v.trim())) records.push(row);
    row = [];
    if (records.length > 501)
      throw new Error("Import up to 500 contacts per file.");
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
      continue;
    }
    if (c === ",") {
      pushField();
      continue;
    }
    if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      pushRow();
      continue;
    }
    if (closed) {
      if (c === " " || c === "\t") continue;
      throw new Error("Unexpected text after a quoted CSV field.");
    }
    if (c === '"') {
      if (field)
        throw new Error("Unexpected quote in CSV. Quote the whole field.");
      quoted = true;
      continue;
    }
    field += c;
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field.");
  if (field || row.length || closed) pushRow();
  const headers = records.shift();
  if (!headers?.length) throw new Error("Add a header row and contacts.");
  const normalized = headers.map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ""),
  );
  const mapped = normalized.map((h) =>
    h === "title" && normalized.includes("jobtitle") ? undefined : aliases[h],
  );
  if (
    !mapped.includes("name") &&
    !mapped.includes("first") &&
    !mapped.includes("last")
  )
    throw new Error(
      "Include Name, Full Name, or First Name / Last Name columns.",
    );
  const used = mapped.filter(Boolean);
  if (new Set(used).size !== used.length)
    throw new Error(
      "Multiple columns map to the same contact field. Keep one column per field.",
    );
  const ignored = headers.filter((_, i) => !mapped[i]);
  const rows = records.map((values, index) => {
    const contact: ContactInput = {
      id: crypto.randomUUID(),
      name: "",
      email: "",
      job_title: "",
      organization: "",
      phone: "",
      mobile: "",
      department: "",
      location: "",
      notes: "",
    };
    let first = "",
      last = "",
      issue =
        values.length !== headers.length
          ? "Column count does not match the header"
          : "";
    mapped.forEach((key, i) => {
      const value = (values[i] ?? "").trim();
      if (key === "first") first = value;
      else if (key === "last") last = value;
      else if (key) contact[key] = value;
    });
    contact.name = contact.name || [first, last].filter(Boolean).join(" ");
    contact.email = contact.email.toLowerCase();
    if (!contact.name || contact.name.length > 240)
      issue = "Name is required (up to 240 characters)";
    else if (!validEmail(contact.email)) issue = "Invalid email address";
    else if (!validPhone(contact.phone) || !validPhone(contact.mobile))
      issue = "Invalid phone number (up to 80 characters)";
    else if (
      [
        contact.job_title,
        contact.organization,
        contact.department,
        contact.location,
      ].some((v) => v.length > 240)
    )
      issue = "Contact fields must be 240 characters or fewer";
    else if (contact.notes.length > 10000)
      issue = "Notes must be 10,000 characters or fewer";
    return { row: index + 2, contact, issue };
  });
  if (!rows.length) throw new Error("No contacts were found below the header.");
  return { rows, ignored };
}
