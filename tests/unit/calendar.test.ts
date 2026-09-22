import { expect, it } from "vitest";
import {
  agendaRange,
  workWeekRange,
  calendarInstant,
  eventDuration,
} from "../../src/features/microsoft/calendar";
it("uses Eastern calendar boundaries across spring and fall clock changes", () => {
  const spring = agendaRange("2026-03-08"),
    fall = agendaRange("2026-11-01");
  expect(Date.parse(spring.end) - Date.parse(spring.start)).toBe(23 * 3600000);
  expect(Date.parse(fall.end) - Date.parse(fall.start)).toBe(25 * 3600000);
  expect(agendaRange("2026-12-29", 7).end).toBe("2027-01-05T05:00:00.000Z");
  expect(() =>
    calendarInstant({
      dateTime: "2026-09-22T09:00:00",
      timeZone: "Eastern Standard Time",
    }),
  ).toThrow();
  expect(eventDuration(90)).toBe("1h 30m");
});

it('shows the whole Monday to Friday week including on weekends and across years',()=>{
 for(const day of ['2026-09-21','2026-09-23','2026-09-26','2026-09-27'])expect(workWeekRange(day)).toEqual({start:'2026-09-21T04:00:00.000Z',end:'2026-09-26T04:00:00.000Z'});
 expect(workWeekRange('2027-01-01')).toEqual({start:'2026-12-28T05:00:00.000Z',end:'2027-01-02T05:00:00.000Z'});
});
