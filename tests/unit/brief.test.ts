import { expect, it } from 'vitest';
import { latestBrief, isCompactBrief, briefIsOld, briefSections, type Review } from '../../src/features/reviews/brief';
const review=(id:string,status:Review['status'],started_at:string,summary='Saved brief'):Review=>({id,status,started_at,summary,user_id:'owner',finished_at:status==='running'?null:started_at});
it('retains the last usable brief through failed or running reviews',()=>{
 const rows=[review('running','running','2026-09-23T17:00:00Z',''),review('failed','failed','2026-09-23T16:00:00Z'),review('partial','partial','2026-09-23T15:00:00Z'),review('complete','complete','2026-09-23T13:00:00Z')];
 expect(latestBrief(rows)?.id).toBe('partial');
 expect(latestBrief([rows[0]!,rows[1]!])).toBeUndefined();
});
it('uses Eastern dates for old briefs and reads structured and legacy summaries',()=>{
 const r=review('one','complete','2026-09-24T01:00:00Z');
 expect(briefIsOld(r,Date.parse('2026-09-24T03:00:00Z'))).toBe(false);
 expect(briefIsOld(r,Date.parse('2026-09-24T05:00:00Z'))).toBe(true);
 expect(briefSections('At a glance\nFocus on GIS.\n\nTop three priorities\n1. Validate parcels.')).toEqual([{title:'At a glance',lines:['Focus on GIS.']},{title:'Top three priorities',lines:['1. Validate parcels.']}]);
 expect(briefSections('Previous plain-text summary')).toEqual([{title:'',lines:['Previous plain-text summary']}]);
});

it('accepts short current-state check-ins and rejects reports and exposed URLs',()=>{
 expect(isCompactBrief('No material changes. Keep the parcel validation as your next focus.')).toBe(true);
 expect(isCompactBrief('Next: Review [parcel output](/?record=11111111-1111-4111-8111-111111111111) before rollout.')).toBe(true);
 expect(isCompactBrief('word '.repeat(121))).toBe(false);
 expect(isCompactBrief('x'.repeat(1001))).toBe(false);
 expect(isCompactBrief('Now\nOne\nTwo\nThree\nFour')).toBe(false);
 expect(isCompactBrief('Checked: 14 tasks and 45 emails.')).toBe(false);
 expect(isCompactBrief('Review https://outlook.office.com/long-link')).toBe(false);
});
