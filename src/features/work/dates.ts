const zone='America/New_York'
export function localDateTime(iso:string) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso))
  const get=(type:string)=>parts.find(p=>p.type===type)?.value
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}
export function today(now=new Date()) {return localDateTime(now.toISOString()).slice(0,10)}
export function fromLocalDateTime(value:string, occurrence:'earlier'|'later'='earlier') {
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Enter a valid date and time.')
  const wall=Date.parse(`${value}:00Z`)
  const candidates=[4,5].map(offset=>new Date(wall+offset*3600000).toISOString()).filter(iso=>localDateTime(iso)===value)
  if(!candidates.length) throw new Error('That time does not exist in New York because the clocks move forward. Choose another time.')
  return candidates[occurrence==='later'?candidates.length-1:0]!
}
export function displayDate(date:string|null,instant:string|null=null) {
  if(instant) return new Intl.DateTimeFormat('en-US',{timeZone:zone,dateStyle:'medium',timeStyle:'short'}).format(new Date(instant))+' ET'
  if(date) return new Intl.DateTimeFormat('en-US',{timeZone:'UTC',dateStyle:'medium'}).format(new Date(`${date}T12:00:00Z`))
  return 'No date'
}
