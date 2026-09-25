import { expect, it } from "vitest";
import {
  agendaRange,
  upcomingEvents,
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

it('shows today through Friday, and the coming work week on weekends and across years',()=>{
 expect(workWeekRange('2026-09-21')).toEqual({start:'2026-09-21T04:00:00.000Z',end:'2026-09-26T04:00:00.000Z'});
 expect(workWeekRange('2026-09-25')).toEqual({start:'2026-09-25T04:00:00.000Z',end:'2026-09-26T04:00:00.000Z'});
 for(const day of ['2026-09-26','2026-09-27'])expect(workWeekRange(day)).toEqual({start:'2026-09-28T04:00:00.000Z',end:'2026-10-03T04:00:00.000Z'});
 expect(workWeekRange('2026-12-31')).toEqual({start:'2026-12-31T05:00:00.000Z',end:'2027-01-02T05:00:00.000Z'});
});

it('hides ended events while preserving ongoing, all-day and future events',()=>{
 const now=Date.parse('2026-09-23T15:00:00Z');
 const event=(id:string,start:string,end:string,allDay=false)=>({id,subject:id,start,end,allDay,durationMinutes:60});
 const events=[
  event('Monday','2026-09-21T13:00:00Z','2026-09-21T14:00:00Z'),
  event('ended just now','2026-09-23T14:00:00Z','2026-09-23T15:00:00Z'),
  event('in progress','2026-09-23T14:30:00Z','2026-09-23T15:30:00Z'),
  event('today all day','2026-09-23T04:00:00Z','2026-09-24T04:00:00Z',true),
  event('tomorrow','2026-09-24T13:00:00Z','2026-09-24T14:00:00Z'),
 ];
 expect(upcomingEvents(events,now).map(event=>event.id)).toEqual(['in progress','today all day','tomorrow']);
 expect(upcomingEvents(events,Date.parse('2026-09-25T00:00:00Z'))).toEqual([]);
});
