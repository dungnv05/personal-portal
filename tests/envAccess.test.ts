import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const DISALLOWED_ENV_ACCESS = /import\.meta\.env(?!\.(VITE_[A-Z0-9_]+|DEV|PROD|MODE|BASE_URL|SSR)\b)/

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath))
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      files.push(fullPath)
    }
  }

  return files
}

describe('env access and Vite envPrefix guard', () => {
  it('allows only named VITE_* or built-in Vite properties on import.meta.env in src/', () => {
    const srcDir = resolve(process.cwd(), 'src')
    const files = collectSourceFiles(srcDir)
    expect(files.length).toBeGreaterThan(0)

    const violations: string[] = []
    for (const filePath of files) {
      const content = readFileSync(filePath, 'utf8')
      if (DISALLOWED_ENV_ACCESS.test(content)) {
        violations.push(filePath)
      }
    }

    expect(violations).toEqual([])
  })

  it('restricts envPrefix to VITE_ only in vite.config.js and vitest.config.ts', () => {
    const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.js'), 'utf8')
    const vitestConfig = readFileSync(resolve(process.cwd(), 'vitest.config.ts'), 'utf8')

    expect(viteConfig).toMatch(/envPrefix:\s*\[\s*['"]VITE_['"]\s*\]/)
    expect(viteConfig).not.toContain('SUPABASE_')

    expect(vitestConfig).toMatch(/envPrefix:\s*\[\s*['"]VITE_['"]\s*\]/)
    expect(vitestConfig).not.toContain('SUPABASE_')
  })
})
