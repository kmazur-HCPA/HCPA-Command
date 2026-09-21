import assert from 'node:assert/strict'
import {randomUUID,createHash} from 'node:crypto'
import {PDFDocument} from 'pdf-lib'
import {zipSync,strToU8} from 'fflate'
export async function testLibrary({admin,owner,outsider,users,url,anonKey}){
 const token=(await owner.auth.getSession()).data.session.access_token
 const otherToken=(await outsider.auth.getSession()).data.session.access_token
 const endpoint=`${url}/functions/v1/library`
 const invoke=(body,accessToken=token)=>fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,apikey:anonKey,...(typeof body==='string'?{'Content-Type':'application/json'}:{})},body})
 const documentId=randomUUID(),projectId=randomUUID(),learningId=randomUUID()
 const create=await owner.from('work_items').insert([
  {id:projectId,user_id:users[0],kind:'project',title:'Synthetic restoration project',status:'Active',details:{}},
  {id:learningId,user_id:users[0],kind:'learning',title:'Synthetic course',status:'Complete',details:{progress:'100',takeaways:'Validate originals'}},
 ])
 assert.equal(create.error,null)
 const metadata=await owner.from('work_items').insert({id:documentId,user_id:users[0],kind:'library',title:'Synthetic reference',status:'Recorded',project_id:projectId,learning_id:learningId,details:{classification:'Internal',category:'Learning'}}).select('*').single()
 assert.equal(metadata.error,null)
 const plain=Buffer.from('Synthetic original\nPreserve every byte.\n')
 const upload=(id,name,bytes,accessToken=token,doc=documentId)=>{const body=new FormData();body.set('id',id);body.set('documentId',doc);body.set('file',new Blob([bytes]),name);return invoke(body,accessToken)}
 const id=randomUUID()
 let response=await upload(id,'reference.txt',plain);assert.equal(response.status,200,await response.clone().text())
 const original=await response.json();assert.equal(original.state,'ready')
 response=await upload(id,'reference.txt',plain);assert.equal(response.status,200);assert.equal((await response.json()).id,id)
 assert.equal((await owner.from('library_versions').select('id').eq('document_id',documentId)).data.length,1)
 const path=`${users[0]}/${documentId}/${id}`
 assert((await owner.storage.from('command-library').download(path)).error,'Direct storage download denied, including owner')
 assert((await owner.storage.from('command-library').upload(`${users[0]}/bypass.txt`,plain)).error,'Direct upload bypass denied')
 assert.deepEqual((await owner.storage.from('command-library').list(users[0])).data,[])
 assert((await owner.from('library_versions').insert({...original,id:randomUUID()})).error,'Client cannot forge ready versions')
 assert.equal((await upload(randomUUID(),'bad.pdf',plain)).status,422)
 assert.equal((await upload(randomUUID(),'bad.docm',plain)).status,422)
 assert.equal((await invoke(JSON.stringify({action:'download',id}),otherToken)).status,403)
 await admin.from('app_memberships').insert({user_id:users[1]})
 assert.equal((await invoke(JSON.stringify({action:'download',id}),otherToken)).status,404)
 assert.equal((await upload(randomUUID(),'reference.txt',plain,otherToken)).status,404)
 assert.deepEqual((await outsider.from('library_versions').select('*')).data,[])
 // Real parser/edge-runtime uploads, not browser mocks.
 const pdf=await PDFDocument.create();pdf.addPage().drawText('Synthetic PDF')
 assert.equal((await upload(randomUUID(),'reference.pdf',await pdf.save())).status,200)
 for(const [ext,path] of [['docx','word/document.xml'],['xlsx','xl/workbook.xml'],['pptx','ppt/presentation.xml']]){
  const roots={docx:'document',xlsx:'workbook',pptx:'presentation'},families={docx:'wordprocessingml.document',xlsx:'spreadsheetml.sheet',pptx:'presentationml.presentation'}
  const file=zipSync({'[Content_Types].xml':strToU8(`<Types><Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.${families[ext]}.main+xml"/></Types>`),[path]:strToU8(`<${roots[ext]}/>` )})
  response=await upload(randomUUID(),`reference.${ext}`,file);assert.equal(response.status,200,await response.clone().text())
 }
 // Simulate object-write success followed by metadata finalization failure.
 const pendingId=randomUUID(),pendingPath=`${users[0]}/${documentId}/${pendingId}`
 const pending={...original,id:pendingId,state:'pending'}
 assert.equal((await admin.from('library_versions').insert(pending)).error,null)
 assert.equal((await admin.storage.from('command-library').upload(pendingPath,plain,{contentType:'application/octet-stream'})).error,null)
 response=await upload(pendingId,'reference.txt',plain);assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).state,'ready')
 assert.equal((await upload(pendingId,'reference.txt',Buffer.from('different'))).status,409)
 assert((await admin.from('library_versions').update({sha256:'0'.repeat(64)}).eq('id',id)).error,'Ready original metadata is immutable')
 // Independent object + metadata backup/restore drill, only in this disposable local stack.
 const download=await invoke(JSON.stringify({action:'download',id}));assert.equal(download.status,200)
 const backup=Buffer.from(await download.arrayBuffer());assert.deepEqual(backup,plain)
 assert.equal((await admin.storage.from('command-library').remove([path])).error,null)
 assert.equal((await admin.from('library_versions').delete().eq('id',id)).error,null)
 assert.equal((await invoke(JSON.stringify({action:'download',id}))).status,404)
 assert.equal((await admin.storage.from('command-library').upload(path,backup,{contentType:'application/octet-stream'})).error,null)
 assert.equal((await admin.from('library_versions').insert(original)).error,null)
 const restored=await invoke(JSON.stringify({action:'download',id}));assert.equal(restored.status,200)
 assert.equal(createHash('sha256').update(Buffer.from(await restored.arrayBuffer())).digest('hex'),original.sha256)
 const links=(await owner.from('work_items').select('project_id,learning_id').eq('id',documentId).single()).data
 assert.deepEqual(links,{project_id:projectId,learning_id:learningId})
 await admin.from('app_memberships').update({active:false}).eq('user_id',users[0])
 assert.equal((await invoke(JSON.stringify({action:'download',id}))).status,403)
 await admin.from('app_memberships').update({active:true}).eq('user_id',users[0])
 console.log('PASS: Library Auth, owner isolation, Storage bypass denial, text/PDF/Office validation, retry reconciliation, immutable originals, revocation, and isolated byte-for-byte original restoration with links.')
}
