import { describe, it, expect } from "vitest";
import { parseContacts } from "../../src/features/people/csv";
import { flagDuplicates, telephoneLink } from "../../src/features/people/model";
import { validateFields } from "../../netlify/functions/_shared/cora/actions";
describe("Directory imports", () => {
  it("parses BOM, CRLF, quoted commas, escaped quotes, multiline notes and Outlook headers", () => {
    const result = parseContacts(
      '\uFEFFFirst Name,Last Name,E-mail Address,Job Title,Company,Business Phone,Notes\r\nAlex,Chen,ALEX@example.org,Manager,HCPA,813-555-0100,"First, line\nSaid ""hello""."\r\n',
    );
    expect(result.rows[0]).toMatchObject({
      issue: "",
      contact: {
        name: "Alex Chen",
        email: "alex@example.org",
        job_title: "Manager",
        notes: 'First, line\nSaid "hello".',
      },
    });
  });
  it("reports malformed structure and bounded validation errors", () => {
    for (const value of [
      'Name,Notes\nAlex,"unfinished',
      "Email\na@example.org",
      "Name,Full Name\nA,A",
      "Name\n" + Array(501).fill("A").join("\n"),
    ])
      expect(() => parseContacts(value)).toThrow();
    expect(parseContacts("Name,Email\nAlex,invalid").rows[0]!.issue).toBe(
      "Invalid email address",
    );
    expect(
      parseContacts("Name,Email\nAlex,a@example.org,extra").rows[0]!.issue,
    ).toContain("Column count");
    expect(
      parseContacts("Name,Notes\nAlex,=SUM(A1:A2)").rows[0]!.contact.notes,
    ).toBe("=SUM(A1:A2)");
  });
  it("flags file, email and archived-name matches without modifying existing contacts", () => {
    const rows = parseContacts(
      "Name,Email,Organization\nAlex,alex@example.org,HCPA\nOther,ALEX@example.org,Other\nKnown,,HCPA",
    ).rows;
    const checked = flagDuplicates(rows, [
      {
        id: "existing",
        title: "Known",
        organization: "HCPA",
        details: {},
        archived: true,
      },
    ]);
    expect(checked.map((row) => row.issue)).toEqual([
      "",
      "Duplicate in this file",
      "Matches an archived contact",
    ]);
  });
  it("validates Cora contact fields and restricts phone links to dialable characters", () => {
    expect(
      validateFields("person", {
        details: { email: "a@example.org", phone: "+1 (813) 555-0100 ext 22" },
      }),
    ).toHaveProperty("details");
    expect(() =>
      validateFields("person", { details: { email: "invalid" } }),
    ).toThrow();
    expect(() =>
      validateFields("person", { details: { phone: "x".repeat(81) } }),
    ).toThrow();
    expect(telephoneLink("+1 (813) 555-0100 ext 22")).toBe(
      "tel:+18135550100;ext=22",
    );
    expect(telephoneLink("javascript:alert()")).toBeUndefined();
  });
});
