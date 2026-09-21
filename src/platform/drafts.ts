// Foundation for future editors. Call only after fresh authorization; never enumerate
// or render drafts before that check. Nothing is silently removed on session expiry.
export type Draft = { version: 1; owner: string; id: string; text: string; updatedAt: string }
export function draftStore(storage: Storage, owner: string) {
  if (!owner) throw new Error('An authenticated owner is required.')
  const prefix = `command:draft:v1:${encodeURIComponent(owner)}:`
  const key = (id: string) => {
    if (!id) throw new Error('A draft ID is required.')
    return prefix + encodeURIComponent(id)
  }
  return {
    read(id: string): Draft | null {
      const value = storage.getItem(key(id))
      if (!value) return null
      const draft: unknown = JSON.parse(value)
      if (!draft || typeof draft !== 'object' || !('version' in draft) || draft.version !== 1 || !('owner' in draft) || draft.owner !== owner || !('id' in draft) || draft.id !== id || !('text' in draft) || typeof draft.text !== 'string' || !('updatedAt' in draft) || typeof draft.updatedAt !== 'string') throw new Error('The saved draft cannot be read. Preserve it for recovery.')
      return draft as Draft
    },
    save(id: string, text: string): Draft {
      const draft: Draft = { version: 1, owner, id, text, updatedAt: new Date().toISOString() }
      // Quota/security exceptions deliberately reach the editor: never show "saved" on failure.
      storage.setItem(key(id), JSON.stringify(draft))
      return draft
    },
    discard(id: string) { storage.removeItem(key(id)) },
    acknowledge(id: string, savedText: string) {
      // Do not delete a newer local edit when an older network write finishes.
      const draft = this.read(id)
      if (draft?.text === savedText) storage.removeItem(key(id))
    },
  }
}

export function listDrafts(storage:Storage,owner:string) {
 const prefix=`command:draft:v1:${encodeURIComponent(owner)}:`
 const result:{key:string;text:string}[]=[]
 for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key?.startsWith(prefix))result.push({key,text:storage.getItem(key)??''})}
 return result
}
