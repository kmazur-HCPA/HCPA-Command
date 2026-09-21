/* eslint-disable no-control-regex -- reject binary/control characters in uploaded files and names */
import {XMLParser,XMLValidator} from 'fast-xml-parser'
import {unzipSync} from 'fflate'
import {PDFDocument,PDFDict,PDFName} from 'pdf-lib'
export const MAX_FILE_BYTES=5*1024*1024
const officeTypes:Record<string,string>={docx:'word/document.xml',xlsx:'xl/workbook.xml',pptx:'ppt/presentation.xml'}
const types:Record<string,string>={pdf:'application/pdf',txt:'text/plain',md:'text/markdown',csv:'text/csv',json:'application/json',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'}
function text(bytes:Uint8Array){try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{throw new Error('Text and XML must use valid UTF-8.')}}
export async function validateFile(filename:string,bytes:Uint8Array) {
 if(!filename||filename.length>180||/[\x00-\x1f\x7f/\\]/.test(filename))throw new Error('Use a plain filename of at most 180 characters.')
 if(!bytes.length||bytes.length>MAX_FILE_BYTES)throw new Error('Files must be nonempty and at most 5 MiB.')
 const ext=filename.split('.').pop()?.toLowerCase()??'',mediaType=types[ext]
 if(!mediaType)throw new Error('Supported files: PDF, TXT, MD, CSV, JSON, DOCX, XLSX and PPTX. Macro-enabled and legacy Office formats are not supported.')
 if(ext==='pdf'){
  if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw new Error('The file is not a PDF.')
  let pdf:PDFDocument
  try{pdf=await PDFDocument.load(bytes,{ignoreEncryption:false,throwOnInvalidObject:true,updateMetadata:false})}catch{throw new Error('The PDF is malformed or encrypted. Export an unencrypted PDF and retry.')}
  if(pdf.getPageCount()>2000||pdf.context.enumerateIndirectObjects().length>20000)throw new Error('The PDF is too complex for this release.')
  const forbidden=new Set(['JS','JavaScript','AA','OpenAction','Launch','EmbeddedFile','EmbeddedFiles','XFA','RichMedia','RichMediaContent','Rendition','GoToR','SubmitForm','ImportData'])
  const seen=new Set<unknown>()
  const inspect=(object:unknown,depth=0)=>{
   if(!object||seen.has(object))return
   if(depth>100)throw new Error('The PDF object graph is too deep.')
   seen.add(object)
   if(object instanceof PDFName&&forbidden.has(object.decodeText()))throw new Error('PDF scripts, automatic actions and embedded content are not supported.')
   if(object instanceof PDFDict)for(const [key,value] of object.entries()){inspect(key,depth+1);inspect(value,depth+1)}
   else if(typeof object==='object'&&'asArray' in object&&typeof object.asArray==='function')for(const value of object.asArray())inspect(value,depth+1)
   else if(typeof object==='object'&&'dict' in object)inspect(object.dict,depth+1)
  }
  for(const [,object] of pdf.context.enumerateIndirectObjects())inspect(object)
 }else if(officeTypes[ext]){
  let total=0,count=0
  let files:ReturnType<typeof unzipSync>
  try{files=unzipSync(bytes,{filter:entry=>{
   total+=entry.originalSize;count++
   if(total>25*1024*1024||count>2000||entry.originalSize>12*1024*1024)throw new Error('Archive exceeds validation limits')
   if(/(^|\/)\.\.(\/|$)|\\|[\x00-\x1f]/.test(entry.name)||/vbaproject|activex|embeddings|externallinks|customui/i.test(entry.name))throw new Error('Active or embedded content')
   return true
  }})}catch{throw new Error('Office archive is malformed, too large, or contains macros/embedded objects.')}
  if(!files['[Content_Types].xml']||!files[officeTypes[ext]!])throw new Error('Office content does not match its extension.')
  for(const [name,data] of Object.entries(files)){
   if(/\.(xml|rels)$/i.test(name)){
    const xml=text(data)
    if(XMLValidator.validate(xml)!==true)throw new Error('Office XML is malformed.')
    if(/<!DOCTYPE|<!ENTITY|macroEnabled|vbaProject|TargetMode\s*=\s*["']External["']/i.test(xml))throw new Error('Office macros, external relationships and XML entities are not supported. Remove them or export a PDF.')
   }else if(!/\.(png|jpe?g|gif|emf|wmf|bin)$/i.test(name)&&!name.endsWith('/'))throw new Error('Office archive contains an unsupported embedded file.')
   // Binary printer settings are normal; other opaque binary parts may carry active content.
   if(/\.bin$/i.test(name)&&!/^\w+\/printerSettings\/printerSettings\d+\.bin$/.test(name))throw new Error('Office archive contains an unsupported binary component.')
  }
  const parser=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,processEntities:false})
  const contentTypes=parser.parse(text(files['[Content_Types].xml']!))
  const overrides=contentTypes.Types?.Override
  const declared=(Array.isArray(overrides)?overrides:[overrides]).filter(Boolean)
  const expectedPartType:Record<string,string>={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'}
  const root:Record<string,string>={docx:'document',xlsx:'workbook',pptx:'presentation'}
  const document=parser.parse(text(files[officeTypes[ext]!]!))
  if(!(root[ext]! in document)||!declared.some((part:Record<string,string>)=>part['@_PartName']==='/'+officeTypes[ext]&&part['@_ContentType']===expectedPartType[ext]))throw new Error('Office package type or main document is invalid.')
 }else{
  const content=text(bytes)
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(content))throw new Error('Text file contains binary control characters.')
  if(ext==='json'){try{JSON.parse(content)}catch{throw new Error('The JSON document is not valid.')}}
 }
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>))).map(v=>v.toString(16).padStart(2,'0')).join('')
 return {mediaType,hash,size:bytes.length}
}
