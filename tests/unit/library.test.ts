import {describe,it,expect} from 'vitest'
import {zipSync,strToU8} from 'fflate'
import {PDFDocument,PDFName,PDFString} from 'pdf-lib'
import {validateFile,MAX_FILE_BYTES} from '../../supabase/functions/_shared/validate-file'
import {handleLibrary} from '../../supabase/functions/library/handler'
import {createClient} from '@supabase/supabase-js'
const bytes=(value:string)=>new TextEncoder().encode(value)
describe('Library file validation',()=>{
 it('preserves byte hashes and validates text without rendering it',async()=>{
  const file=bytes('<script>not executed</script>\nOriginal words')
  const result=await validateFile('notes.txt',file);expect(result.size).toBe(file.length);expect(result.hash).toHaveLength(64)
  expect((await validateFile('notes.txt',file)).hash).toBe(result.hash)
 })
 it('rejects malformed, unsupported, oversized and misleading files',async()=>{
  for(const [name,data] of [['macro.docm',bytes('x')],['broken.pdf',bytes('not PDF')],['data.json',bytes('{bad')],['../notes.txt',bytes('x')],['binary.txt',new Uint8Array([0,255])],['large.txt',new Uint8Array(MAX_FILE_BYTES+1)]] as const)await expect(validateFile(name,data)).rejects.toThrow()
 })
 it('accepts a plain PDF and rejects PDF actions',async()=>{
  const pdf=await PDFDocument.create();pdf.addPage().drawText('Synthetic original')
  expect((await validateFile('original.pdf',await pdf.save())).mediaType).toBe('application/pdf')
  pdf.catalog.set(PDFName.of('OpenAction'),pdf.context.obj({S:PDFName.of('JavaScript'),JS:PDFString.of('app.alert(1)')}))
  await expect(validateFile('active.pdf',await pdf.save())).rejects.toThrow(/actions/)
 })
 it('validates macro-free Office structures and rejects external relationships or embedded binaries',async()=>{
  for(const [ext,path] of [['docx','word/document.xml'],['xlsx','xl/workbook.xml'],['pptx','ppt/presentation.xml']]){
   const roots:Record<string,string>={docx:'document',xlsx:'workbook',pptx:'presentation'};const families:Record<string,string>={docx:'wordprocessingml.document',xlsx:'spreadsheetml.sheet',pptx:'presentationml.presentation'}
   const files={'[Content_Types].xml':strToU8(`<Types><Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.${families[ext!]}.main+xml"/></Types>`),[path!]:strToU8(`<${roots[ext!]}/>`)}
   expect((await validateFile(`original.${ext}`,zipSync(files))).hash).toHaveLength(64)
   await expect(validateFile(`active.${ext}`,zipSync({...files,'_rels/.rels':strToU8('<Relationships><Relationship TargetMode="External"/></Relationships>')}))).rejects.toThrow(/external/)
   await expect(validateFile(`macro.${ext}`,zipSync({...files,'word/vbaProject.bin':bytes('macro')}))).rejects.toThrow(/macros/)
  }
 })
 it('rejects archive expansion and malformed XML',async()=>{
  await expect(validateFile('bomb.docx',zipSync({'[Content_Types].xml':bytes('<Types/>'),'word/document.xml':new Uint8Array(13*1024*1024)}))).rejects.toThrow(/large/)
  await expect(validateFile('broken.docx',zipSync({'[Content_Types].xml':bytes('<Types/>'),'word/document.xml':bytes('<broken>')}))).rejects.toThrow(/malformed/)
 })
 it('requires authentication before reading request bytes',async()=>{
  const client=createClient('http://127.0.0.1:54321','test',{auth:{persistSession:false}})
  const response=await handleLibrary(new Request('https://example.test/library',{method:'POST',body:'private'}),client,client)
  expect(response.status).toBe(401)
  expect((await handleLibrary(new Request('https://example.test/library',{method:'POST',headers:{Origin:'https://untrusted.example'},body:'data'}),client,client)).status).toBe(403)
 })
})
