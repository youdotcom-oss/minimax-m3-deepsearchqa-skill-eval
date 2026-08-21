export function readStringEnv(name: string, fallback?: string): string {
  const value = process.env[name]
  if (value !== undefined && value !== '') return value
  if (fallback !== undefined) return fallback
  throw new Error(`${name} is required`)
}

export function readIntegerEnv(name: string, fallback: number, min = 0): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min}`)
  }
  return value
}

export function isForce(): boolean {
  return process.env.FORCE === '1' || process.env.FORCE === 'true'
}
