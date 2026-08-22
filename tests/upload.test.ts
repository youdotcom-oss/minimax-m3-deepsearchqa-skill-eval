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
    expect(plan.card_preview).toContain('viewer: false')
  })
})
