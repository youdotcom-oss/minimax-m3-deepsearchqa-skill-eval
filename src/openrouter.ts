import { readStringEnv } from './env.ts'

export async function judgeJson<T>(params: {
  model: string
  system: string
  user: string
  timeoutMs: number
}): Promise<T> {
  const apiKey = readStringEnv('OPENROUTER_API_KEY')
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(params.timeoutMs),
    body: JSON.stringify({
      model: params.model,
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    }),
  })

  if (!res.ok) {
    throw new Error(`OpenRouter error ${res.status}: ${await res.text()}`)
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('OpenRouter returned no message content')
  return JSON.parse(stripJsonFences(content)) as T
}

function stripJsonFences(content: string): string {
  const trimmed = content.trim()
  if (!trimmed.startsWith('```')) return trimmed
  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
}
