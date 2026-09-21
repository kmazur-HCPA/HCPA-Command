import {useEffect} from 'react'
export function useDraftGuard(active:boolean) {
 useEffect(()=>{
  if(!active)return
  const block=(event:Event)=>{event.preventDefault()}
  const unload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''}
  window.addEventListener('beforeunload',unload);window.addEventListener('command:before-update',block)
  return()=>{window.removeEventListener('beforeunload',unload);window.removeEventListener('command:before-update',block)}
 },[active])
}
