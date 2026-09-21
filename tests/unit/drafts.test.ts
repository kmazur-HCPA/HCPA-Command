import { describe, expect, it } from 'vitest'
import { draftStore } from '../../src/platform/drafts'
function memory() {
  const data = new Map<string,string>()
  return { getItem: (key:string) => data.get(key) ?? null, setItem: (key:string,value:string) => { data.set(key,value) }, removeItem: (key:string) => { data.delete(key) } } as Storage
}
describe('user-scoped draft recovery', () => {
  it('survives a new store instance and cannot cross owners', () => {
    const storage=memory(); draftStore(storage,'owner').save('capture','Unsent thought')
    expect(draftStore(storage,'owner').read('capture')?.text).toBe('Unsent thought')
    expect(draftStore(storage,'other').read('capture')).toBeNull()
  })
  it('preserves a newer edit when an older save is acknowledged', () => {
    const store=draftStore(memory(),'owner'); store.save('a','new text'); store.acknowledge('a','old text')
    expect(store.read('a')?.text).toBe('new text'); store.acknowledge('a','new text'); expect(store.read('a')).toBeNull()
  })
  it('reports unavailable storage instead of claiming success', () => {
    const storage=memory(); storage.setItem=()=>{throw new Error('Quota exceeded')}
    expect(()=>draftStore(storage,'owner').save('a','text')).toThrow('Quota exceeded')
  })
  it('preserves corrupt drafts and allows deliberate discard only', () => {
    const storage=memory(); storage.setItem('command:draft:v1:owner:a','invalid')
    const store=draftStore(storage,'owner'); expect(()=>store.read('a')).toThrow(); expect(storage.getItem('command:draft:v1:owner:a')).toBe('invalid')
    store.discard('a'); expect(store.read('a')).toBeNull()
  })
})
