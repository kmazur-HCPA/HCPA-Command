type Operation = 'work.read' | 'work.write' | 'work.convert' | 'auth.sign_in' | 'auth.sign_out' | 'auth.recovery' | 'auth.password_update' | 'access.check' | 'preferences.read' | 'preferences.write'
type Result = 'ok' | 'error'
// Deliberately no arbitrary metadata: emails, tokens, URLs and record content never enter this logger.
export function recordTiming(operation: Operation, startedAt: number, result: Result) {
  const durationMs = Math.round(performance.now() - startedAt)
  console.info(JSON.stringify({ event: 'operation', operation, result, durationMs }))
  return durationMs
}
export async function measured<T>(operation: Operation, work: () => Promise<T>): Promise<T> {
  const start = performance.now()
  try {
    const value = await work()
    recordTiming(operation, start, 'ok')
    return value
  } catch (error) {
    recordTiming(operation, start, 'error')
    throw error
  }
}
