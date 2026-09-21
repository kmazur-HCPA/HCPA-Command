import {test,expect} from '@playwright/test'
import type {Page} from '@playwright/test'
import {newItem} from '../../src/features/work/model'
import type {WorkItem} from '../../src/features/work/model'
const uid='11111111-1111-4111-8111-111111111111'
const user={id:uid,email:'owner@example.test',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-01-01Z'}
const jwt=`${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({sub:uid,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.test`
async function setup(page:Page){
 const rows:WorkItem[]=[],history:{id:string;item_id:string;version:number;snapshot:WorkItem;created_at:string}[]=[]
 const control={failWrites:false,loseAck:false}
 await page.route('https://command-test.supabase.co/**',async route=>{
  const request=route.request(),url=new URL(request.url()),p=url.searchParams,method=request.method()
  if(url.pathname==='/auth/v1/token')return route.fulfill({json:{access_token:jwt,refresh_token:'test',expires_in:3600,token_type:'bearer',user}})
  if(url.pathname==='/auth/v1/user')return route.fulfill({json:user})
  if(url.pathname==='/auth/v1/logout')return route.fulfill({json:{}})
  if(url.pathname.endsWith('/app_memberships'))return route.fulfill({json:{user_id:uid,active:true}})
  if(url.pathname.endsWith('/user_preferences'))return route.fulfill({json:{user_id:uid,theme:'dark',timezone:'America/New_York',version:1}})
  if(url.pathname.endsWith('/journal_revisions'))return route.fulfill({json:history.filter(h=>h.item_id===p.get('item_id')?.slice(3)).reverse()})
  if(url.pathname.endsWith('/rpc/convert_reminder')){
   const input=request.postDataJSON(),r=rows.find(r=>r.id===input.reminder_id)!
   if(!r.converted_task_id){const task={...r,id:crypto.randomUUID(),kind:'task' as const,status:'Inbox',version:1};rows.push(task);r.converted_task_id=task.id;r.status='Complete';r.version++}
   return route.fulfill({json:r.converted_task_id})
  }
  if(!url.pathname.endsWith('/work_items'))return route.fulfill({status:404,json:{message:'Unexpected request'}})
  if(method!=='GET'&&control.failWrites)return route.fulfill({status:503,json:{message:'Synthetic network failure'}})
  let selected=rows.filter(row=>{
   for(const [key,value] of p){
    if(['select','order','offset','limit','or'].includes(key))continue
    const v=row[key as keyof WorkItem]
    if(value.startsWith('eq.')&&String(v)!==value.slice(3))return false
    if(value==='not.is.null'&&v===null)return false
    if(value.startsWith('lte.')&&(v===null||String(v)>value.slice(4)))return false
    if(value.startsWith('in.')&&!value.slice(4,-1).split(',').includes(String(v)))return false
    if(value.startsWith('not.in.')&&value.slice(8,-1).split(',').includes(String(v)))return false
   }return true
  })
  if(method==='POST'){
   const input=request.postDataJSON()
   if(rows.some(r=>r.id===input.id))selected=[]
   else{const row={...newItem(input.kind,uid),...input,original_body:input.body,version:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),completed_at:null} as WorkItem;rows.push(row);selected=[row]}
  }
  if(method==='PATCH'){const patch=request.postDataJSON();selected.forEach(row=>Object.assign(row,patch,{version:row.version+1,updated_at:new Date().toISOString()}))}
  if(method!=='GET'){
   selected.filter(r=>r.kind==='journal').forEach(row=>history.push({id:crypto.randomUUID(),item_id:row.id,version:row.version,snapshot:{...row},created_at:row.updated_at}))
   if(control.loseAck){control.loseAck=false;return route.abort('failed')}
  }
  if(method==='GET')selected=selected.slice(Number(p.get('offset')??0),Number(p.get('offset')??0)+Number(p.get('limit')??1000))
  const single=request.headers().accept?.includes('vnd.pgrst.object')
  if(single&&!selected.length)return route.fulfill({status:406,json:{message:'No row'}})
  return route.fulfill({json:single?selected[0]:selected})
 })
 await page.goto('/');await page.getByLabel('Email',{exact:true}).fill('owner@example.test');await page.getByLabel('Password',{exact:true}).fill('Test-password-123');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Work Day',exact:true})).toBeVisible()
 return {rows,control,history}
}
test('create a task, choose a priority, edit, and complete it',async({page})=>{
 const {rows}=await setup(page)
 await page.getByRole('button',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'New task',exact:true}).click()
 await page.getByLabel('Title',{exact:true}).fill('Review architecture');await page.getByRole('textbox',{name:'Notes',exact:true}).fill('Check the recovery path.');await page.getByLabel('Due date',{exact:true}).fill('2026-09-21');await page.getByLabel('Work Day priority slot').selectOption('1');await page.getByRole('button',{name:'Save',exact:true}).click()
 await expect(page.getByRole('button',{name:'Review architecture',exact:true})).toBeVisible();expect(rows[0]?.due_date).toBe('2026-09-21')
 await page.getByRole('button',{name:'Work Day',exact:true}).click();await expect(page.locator('.focus-panel').getByRole('button',{name:'Review architecture'})).toBeVisible()
 await page.getByRole('button',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'Complete',exact:true}).click();await expect(page.locator('.record-meta')).toContainText('Complete')
})
test('capture survives failed save and reload, then a lost acknowledgement produces one entry',async({page})=>{
 const {rows,control}=await setup(page)
 await page.getByRole('button',{name:'Quick Capture',exact:true}).click();await page.getByLabel('What’s on your mind?').fill('  Keep the original words.\nSecond line.  ')
 control.failWrites=true;await page.getByRole('button',{name:'Save capture',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Not saved')
 await page.getByRole('button',{name:'Close · keep draft',exact:true}).click();await page.reload();await page.getByRole('button',{name:'Quick Capture',exact:true}).click();await expect(page.getByLabel('What’s on your mind?')).toHaveValue('  Keep the original words.\nSecond line.  ')
 control.failWrites=false;control.loseAck=true;await page.getByRole('button',{name:'Save capture',exact:true}).click();await expect(page.getByRole('heading',{name:'Journal',exact:true})).toBeVisible()
 expect(rows.filter(r=>r.kind==='journal')).toHaveLength(1);expect(rows[0]?.original_body).toBe('  Keep the original words.\nSecond line.  ')
})
test('journal revisions preserve original text and drafts block logout until deliberately discarded',async({page})=>{
 const {history}=await setup(page)
 await page.getByRole('button',{name:'Quick Capture',exact:true}).click();await page.getByLabel('What’s on your mind?').fill('Original decision');await page.getByRole('button',{name:'Save capture',exact:true}).click()
 await page.getByRole('button',{name:'Original decision',exact:true}).click();await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByRole('textbox',{name:'Notes',exact:true}).fill('Revised decision');await page.getByLabel('Entry type').selectOption('Decision');await page.getByRole('button',{name:'Save',exact:true}).click()
 await page.getByText('Original entry',{exact:true}).click();await expect(page.locator('details').filter({hasText:'Original entry'})).toContainText('Original decision');expect(history).toHaveLength(2)
 await page.getByRole('button',{name:'Quick Capture',exact:true}).click();await page.getByLabel('What’s on your mind?').fill('Unsent note');await page.getByRole('button',{name:'Close · keep draft',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();await expect(page.getByRole('alert')).toContainText('unsaved local drafts')
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Discard draft',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('heading',{name:'Welcome to Command.'})).toBeVisible()
})
test('reminder remains visible after its due time and converts explicitly',async({page})=>{
 const {rows}=await setup(page)
 await page.getByRole('button',{name:'All reminders',exact:true}).click();await page.getByRole('button',{name:'New reminder',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('Call vendor');await page.getByLabel('Reminder date (no time)').fill('2020-01-01');await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByRole('button',{name:'Call vendor',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Convert to task',exact:true}).click();await expect(page.locator('.record-meta')).toContainText('Complete');expect(rows.filter(r=>r.kind==='task')).toHaveLength(1)
})
test('conflicting edits preserve the draft until the saved version is reviewed',async({page})=>{
 const {rows}=await setup(page)
 await page.getByRole('button',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'New task',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('Concurrent task');await page.getByRole('button',{name:'Save',exact:true}).click()
 await page.getByRole('button',{name:'Concurrent task',exact:true}).click();await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByRole('textbox',{name:'Notes',exact:true}).fill('My unsent edit')
 rows[0]!.body='Remote edit';rows[0]!.version++
 await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByRole('alert')).toContainText('changed elsewhere');await expect(page.getByRole('textbox',{name:'Notes',exact:true})).toHaveValue('My unsent edit')
 await page.getByRole('button',{name:'Compare latest saved version'}).click();await expect(page.locator('.conflict-panel')).toContainText('Remote edit')
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Keep my draft against this version'}).click();await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.locator('.full-text').first()).toHaveText('My unsent edit')
})
test('a decision links to a project and generates a traceable task',async({page})=>{
 const {rows}=await setup(page)
 await page.getByRole('button',{name:'Projects',exact:true}).click();await page.getByRole('button',{name:'New project',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('Service improvement');await page.getByRole('textbox',{name:'Goals',exact:true}).fill('Reduce interruptions');await page.getByRole('button',{name:'Save',exact:true}).click()
 await page.getByRole('button',{name:'Journal',exact:true}).click();await page.getByRole('button',{name:'New journal',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('Adopt the new process');await page.getByRole('textbox',{name:'Notes',exact:true}).fill('Evidence and reasoning');await page.getByRole('combobox',{name:'Entry type',exact:true}).selectOption('Decision');await page.getByText('Links and context',{exact:true}).click();await page.getByRole('combobox',{name:'Project',exact:true}).selectOption(rows[0]!.id);await page.getByRole('button',{name:'Save',exact:true}).click()
 await page.getByRole('button',{name:'Adopt the new process',exact:true}).click();await expect(page.getByRole('link',{name:'Service improvement',exact:true})).toBeVisible();await page.getByRole('button',{name:'Create resulting task'}).click();await page.getByRole('button',{name:'Save',exact:true}).click()
 const task=rows.find(r=>r.kind==='task')!;expect(task.source_entry_id).toBe(rows.find(r=>r.kind==='journal')!.id);expect(task.project_id).toBe(rows[0]!.id)
 await expect(page.getByRole('link',{name:'Adopt the new process',exact:true})).toBeVisible()
})

test('learning connects to an experiment and a recorded decision',async({page})=>{
 const {rows}=await setup(page)
 await page.getByRole('button',{name:'Learning',exact:true}).click();await page.getByRole('button',{name:'New learning',exact:true}).click()
 await page.getByLabel('Title',{exact:true}).fill('Evaluation course');await page.getByLabel('Progress (%)',{exact:true}).fill('100');await page.getByLabel('Key takeaways',{exact:true}).fill('Use representative synthetic examples');await page.getByRole('button',{name:'Save',exact:true}).click()
 await page.getByRole('button',{name:'AI Lab',exact:true}).click();await page.getByRole('button',{name:'Experiments',exact:true}).click();await page.getByRole('button',{name:'New experiment',exact:true}).click()
 await page.getByLabel('Title',{exact:true}).fill('Compare evaluation methods');await page.getByLabel('Hypothesis',{exact:true}).fill('A rubric improves agreement');await page.getByLabel('Conclusion',{exact:true}).fill('Adopt rubric');await page.getByText('Links and context',{exact:true}).click();await page.getByRole('combobox',{name:'Learning source',exact:true}).selectOption(rows[0]!.id);await page.getByRole('button',{name:'Save',exact:true}).click()
 await page.getByRole('button',{name:'Journal',exact:true}).click();await page.getByRole('button',{name:'New journal',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('Use the rubric');await page.getByRole('combobox',{name:'Entry type',exact:true}).selectOption('Decision');await page.getByText('Links and context',{exact:true}).click();await page.getByRole('combobox',{name:'Experiment',exact:true}).selectOption(rows.find(r=>r.kind==='experiment')!.id);await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('button',{name:'Use the rubric',exact:true}).click();await expect(page.getByRole('link',{name:'Compare evaluation methods',exact:true})).toBeVisible()
 expect(rows.find(r=>r.kind==='experiment')!.learning_id).toBe(rows[0]!.id)
})
test('Library preserves metadata links and recovers an interrupted original upload',async({page})=>{
 const {rows}=await setup(page)
 const versions:Record<string,unknown>[]=[];let fail=true
 await page.route('https://command-test.supabase.co/rest/v1/library_versions*',route=>route.fulfill({json:versions}))
 await page.route('https://command-test.supabase.co/functions/v1/library',async route=>{
  if(route.request().headers()['content-type']?.includes('application/json'))return route.fulfill({contentType:'application/octet-stream',body:'Synthetic original'})
  const raw=route.request().postDataBuffer()!.toString(),id=raw.match(/name="id"\r\n\r\n([^\r]+)/)![1]!
  if(!versions.length)versions.push({id,user_id:uid,document_id:rows.find(r=>r.kind==='library')!.id,filename:'reference.txt',media_type:'text/plain',size_bytes:18,sha256:'a'.repeat(64),state:'pending',created_at:new Date().toISOString()})
  if(fail){fail=false;return route.fulfill({status:503,json:{error:'Original uploaded; finalization is pending. Retry the same version and file.'}})}
  expect(id).toBe(versions[0]!.id);versions[0]!.state='ready';return route.fulfill({json:versions[0]})
 })
 await page.getByRole('button',{name:'Library',exact:true}).click();await page.getByRole('button',{name:'New library',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('Reference document');await page.getByRole('combobox',{name:'Classification',exact:true}).selectOption('Internal');await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('button',{name:'Reference document',exact:true}).click()
 const fixture={name:'reference.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic original')}
 await page.getByLabel('Choose original file').setInputFiles(fixture);await page.getByRole('button',{name:'Upload new version',exact:true}).click();await expect(page.getByRole('alert')).toContainText('finalization is pending')
 await page.reload();await expect(page.getByText('Pending attempt:',{exact:false})).toBeVisible();await page.getByLabel('Choose original file').setInputFiles(fixture);await page.getByRole('button',{name:'Retry upload',exact:true}).click();await expect(page.getByRole('status')).toContainText('Original verified and saved')
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Download original',exact:true}).click();expect((await downloaded).suggestedFilename()).toBe('reference.txt');expect(versions).toHaveLength(1)
})
