import {describe,it,expect} from 'vitest'
import {matchesWorkFields} from '../../src/services/work'

describe('lost acknowledgement reconciliation',()=>{
 it('recognizes database-normalized timestamps for saves and snoozes',()=>{
  expect(matchesWorkFields({remind_at:'2026-09-21T13:00:00+00:00',snoozed_until:'2026-09-21T10:00:00-04:00'}, {remind_at:'2026-09-21T13:00:00.000Z',snoozed_until:'2026-09-21T14:00:00.000Z'})).toBe(true)
 })
 it('ignores database JSON object key ordering without ignoring changed fields',()=>{
  expect(matchesWorkFields({details:{progress:'50',topic:'AI'}},{details:{topic:'AI',progress:'50'}})).toBe(true)
  expect(matchesWorkFields({details:{progress:'51',topic:'AI'}},{details:{topic:'AI',progress:'50'}})).toBe(false)
 })
 it('does not reconcile different times or concurrent text edits',()=>{
  expect(matchesWorkFields({remind_at:'2026-09-21T13:00:00Z'},{remind_at:'2026-09-21T14:00:00Z'})).toBe(false)
  expect(matchesWorkFields({title:'Changed elsewhere'},{title:'My draft'})).toBe(false)
  expect(matchesWorkFields({snoozed_until:null},{snoozed_until:'2026-09-21T14:00:00Z'})).toBe(false)
 })
})
