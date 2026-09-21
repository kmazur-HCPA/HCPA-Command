// @vitest-environment node
import {describe,it,expect,vi} from 'vitest'
import {createWorkspaceExport,csvCell,validateSnapshot} from '../../src/services/export'
import type {ExportSnapshot} from '../../src/services/export'
import type {AppClient} from '../../src/platform/supabase'
import {newItem} from '../../src/features/work/model'
import {unzipSync,strFromU8} from 'fflate'
const uid='11111111-1111-4111-8111-111111111111'
function snapshot():ExportSnapshot{return {format:'command-workspace',format_version:1,exported_at:'2026-09-21T00:00:00Z',user_id:uid,work_items:[],journal_revisions:[],library_versions:[],activity_log:[],user_preferences:[],app_memberships:[],counts:{work_items:0,journal_revisions:0,library_versions:0,activity_log:0,user_preferences:0,app_memberships:0}}}
describe('portable verified exports',()=>{
 it('escapes CSV cells and prevents spreadsheet formulas without changing JSON',()=>{expect(csvCell('=HYPERLINK("bad")')).toBe('"\'=HYPERLINK(""bad"")"');expect(csvCell('a,b\nc')).toBe('"a,b\nc"')})
 it('rejects mismatched counts, cross-owner records and broken relationships',()=>{
  const s=snapshot();s.counts.work_items=1;expect(()=>validateSnapshot(s)).toThrow(/count mismatch/)
  s.work_items=[{...newItem('task',uid),original_body:'',version:1,created_at:'',updated_at:'',completed_at:null,project_id:crypto.randomUUID()}];expect(()=>validateSnapshot(s)).toThrow(/relationship/)
  s.work_items[0]!.project_id=null;s.work_items[0]!.user_id='other';expect(()=>validateSnapshot(s)).toThrow(/ownership/)
 })
 it('builds a readable archive whose entity counts reconcile',async()=>{
  const s=snapshot();const client={rpc:()=>({abortSignal:async()=>({data:s,error:null})})} as unknown as AppClient
  const result=await createWorkspaceExport(client,new AbortController().signal,vi.fn())
  const files=unzipSync(new Uint8Array(await result.blob.arrayBuffer()))
  expect(JSON.parse(strFromU8(files['workspace.json']!))).toEqual(s)
  expect(JSON.parse(strFromU8(files['originals-manifest.json']!))).toEqual([])
  expect(strFromU8(files['records.csv']!)).toContain('project_id')
 })
 it('never creates an archive after cancellation',async()=>{
  const controller=new AbortController();controller.abort()
  const client={rpc:()=>({abortSignal:async()=>({data:snapshot(),error:null})})} as unknown as AppClient
  await expect(createWorkspaceExport(client,controller.signal,vi.fn())).rejects.toThrow()
 })
})
