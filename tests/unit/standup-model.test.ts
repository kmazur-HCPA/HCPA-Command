import { describe, expect, it } from "vitest";
import { mondayLabel, standupMonday, weekRangeLabel, weekStart } from "../../src/features/standup/model";

describe("stand-up weeks", () => {
  it("starts a new week on Tuesday, so Tuesday morning is blank", () => {
    expect(weekStart("2026-10-05")).toBe("2026-09-29"); // Monday: still last Tuesday's week
    expect(weekStart("2026-10-06")).toBe("2026-10-06"); // Tuesday: new, empty week
    expect(weekStart("2026-10-07")).toBe("2026-10-06");
    expect(weekStart("2026-10-11")).toBe("2026-10-06"); // Sunday
    expect(weekStart("2026-10-02")).toBe("2026-09-29"); // Friday
  });
  it("ends on the Monday of the meeting", () => {
    expect(standupMonday("2026-09-29")).toBe("2026-10-05");
    expect(mondayLabel("2026-09-29")).toBe("Mon, Oct 5");
    expect(weekRangeLabel("2026-09-29")).toBe("Sep 29 – Oct 5");
  });
  it("handles month and year boundaries", () => {
    expect(weekStart("2027-01-01")).toBe("2026-12-29");
    expect(standupMonday("2026-12-29")).toBe("2027-01-04");
  });
});
