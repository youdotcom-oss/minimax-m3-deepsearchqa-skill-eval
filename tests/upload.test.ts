import { describe, expect, test } from 'bun:test'

describe('HF artifact upload CLI', () => {
  test('dry-run plans an upload-only dataset card with generated metadata', async () => {
    const proc = Bun.spawn(['python3', 'scripts/upload.py', '--card-only', '--dry-run'], {
      cwd: `${import.meta.dir}/..`,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, HF_DATASET_REPO: '', HF_REVISION: '' },
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    const plan = JSON.parse(stdout)
    expect(plan.files).toHaveLength(1)
    expect(plan.files[0]).toMatchObject({
      local: 'README.md',
      remote: 'README.md',
      generated: 'hf_dataset_card',
    })
    expect(plan.card_preview).toStartWith('---\npretty_name: MiniMax M3 DeepSearchQA Skill Eval')
    expect(plan.card_preview).toContain('license: mit')
    expect(plan.card_preview).toContain('config_name: results')
    expect(plan.card_preview).toContain('path: results.jsonl')
  })

  test('rejects abbreviated card-only option names', async () => {
    const proc = Bun.spawn(['python3', 'scripts/upload.py', '--card-on', '--dry-run'], {
      cwd: `${import.meta.dir}/..`,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited])

    expect(exitCode).toBe(2)
    expect(stderr).toContain('unrecognized arguments: --card-on')
  })

  test('dry-run plans a filtered file subset', async () => {
    const proc = Bun.spawn(
      ['python3', 'scripts/upload.py', '--files', 'results.jsonl,summary.json,README.md', '--dry-run'],
      {
        cwd: `${import.meta.dir}/..`,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, HF_DATASET_REPO: '', HF_REVISION: '' },
      },
    )
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    const plan = JSON.parse(stdout)
    expect(plan.files.map((file: { remote: string }) => file.remote)).toEqual([
      'README.md',
      'results.jsonl',
      'summary.json',
    ])
    expect(plan.files[0].generated).toBe('hf_dataset_card')
  })

  test('rejects unknown --files names', async () => {
    const proc = Bun.spawn(['python3', 'scripts/upload.py', '--files', 'nope.jsonl', '--dry-run'], {
      cwd: `${import.meta.dir}/..`,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exitCode).toBe(1)
    expect(stderr).toContain('Unknown file(s): nope.jsonl')
    expect(stdout).toBe('')
  })
})
