// Conservative source-graph check for this application's static imports.
// Runtime Worker exports, tests, build configs and CLI tools are explicit roots.
// Findings require review before deletion; this command never deletes code.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

const root = process.cwd()
const files = []
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) collect(path)
    else if (/\.(tsx?|mjs|css)$/.test(path)) files.push(path)
  }
}
for (const directory of ['src', 'dashboard/src', 'scripts']) collect(resolve(root, directory))
files.push(resolve(root, 'dashboard/vite.config.ts'), resolve(root, 'vitest.config.ts'))
const graph = new Map()
const packages = new Map([['package.json', new Set()], ['dashboard/package.json', new Set()]])
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const edges = new Set()
  graph.set(file, edges)
  // Includes type-only imports, re-exports, CSS imports and literal dynamic imports.
  const imports = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|@import\s*)["']([^"']+)["']/g)].map(match => match[1])
  const manifest = relative(root, file).replaceAll('\\', '/').startsWith('dashboard/') ? 'dashboard/package.json' : 'package.json'
  for (const specifier of imports) {
    if (specifier.startsWith('.')) {
      const path = resolve(dirname(file), specifier)
      const target = [path, `${path}.ts`, `${path}.tsx`, `${path}.mjs`, `${path}/index.ts`].find(candidate => existsSync(candidate) && files.includes(resolve(candidate)))
      if (target) edges.add(resolve(target))
    } else if (!specifier.startsWith('node:') && !specifier.startsWith('cloudflare:')) {
      packages.get(manifest).add(specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0])
    }
  }
}
const reachable = new Set()
function visit(file) {
  if (reachable.has(file)) return
  reachable.add(file)
  for (const edge of graph.get(file) ?? []) visit(edge)
}
for (const file of files) {
  const name = relative(root, file).replaceAll('\\', '/')
  if (name.endsWith('.test.ts') || name.endsWith('.d.ts') || name.startsWith('scripts/') || ['src/index.ts', 'dashboard/src/main.tsx', 'dashboard/vite.config.ts', 'vitest.config.ts'].includes(name)) visit(file)
}
const unusedModules = files.filter(file => !reachable.has(file)).map(file => relative(root, file).replaceAll('\\', '/'))
const tools = {
  'package.json': new Set(['typescript', 'vitest', 'wrangler', '@biomejs/biome', '@cloudflare/workers-types', '@types/node']),
  'dashboard/package.json': new Set(['typescript', '@types/react', '@types/react-dom']),
}
const unusedDependencies = []
for (const [manifest, imports] of packages) {
  const pkg = JSON.parse(readFileSync(resolve(root, manifest), 'utf8'))
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    if (!imports.has(name) && !tools[manifest].has(name)) unusedDependencies.push(`${manifest}:${name}`)
  }
}
console.log(JSON.stringify({ unusedModules, unusedDependencies }, null, 2))
if (unusedModules.length || unusedDependencies.length) process.exitCode = 1
