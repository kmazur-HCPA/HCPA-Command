import {describe,it,expect} from 'vitest'
import {fromLocalDateTime,today,displayDate} from '../../src/features/work/dates'
import {effectiveStatus} from '../../src/features/work/model'
describe('New York dates and reminder visibility',()=>{
 it('rejects the spring gap',()=>expect(()=>fromLocalDateTime('2026-03-08T02:30')).toThrow('does not exist'))
 it('resolves repeated fall times explicitly',()=>{expect(fromLocalDateTime('2026-11-01T01:30')).toBe('2026-11-01T05:30:00.000Z');expect(fromLocalDateTime('2026-11-01T01:30','later')).toBe('2026-11-01T06:30:00.000Z')})
 it('keeps date-only dates independent of UTC midnight',()=>{expect(displayDate('2026-09-21')).toBe('Sep 21, 2026');expect(today(new Date('2026-09-21T02:00:00Z'))).toBe('2026-09-20')})
 it('makes expired snoozes active without hiding overdue reminders',()=>{expect(effectiveStatus({status:'Snoozed',snoozed_until:'2020-01-01Z'})).toBe('Active');expect(effectiveStatus({status:'Active',snoozed_until:null})).toBe('Active')})
})
