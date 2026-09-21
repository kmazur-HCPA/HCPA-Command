import {useEffect} from 'react'
export function useDraftGuard(active:boolean) {
 useEffect(()=>{
  if(!active)return
  const unload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''}
  window.addEventListener('beforeunload',unload)
  return()=>{window.removeEventListener('beforeunload',unload)}
 },[active])
}
