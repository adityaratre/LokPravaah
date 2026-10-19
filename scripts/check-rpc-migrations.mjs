import { readFileSync, readdirSync } from 'node:fs'
import { join, extname } from 'node:path'

const root = process.cwd()
const walk = (dir, accept) => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') return []
  const path = join(dir, entry.name)
  if (entry.isDirectory()) return walk(path, accept)
  return accept(path) ? [path] : []
})
const sourceFiles = walk(join(root, 'src'), path => ['.ts', '.tsx', '.js', '.jsx'].includes(extname(path)))
const sqlFiles = walk(join(root, 'supabase'), path => extname(path) === '.sql')
const sources = sourceFiles.map(path => ({ path, text: readFileSync(path, 'utf8') }))
const sqlText = sqlFiles.map(path => readFileSync(path, 'utf8')).join('\n')
const definitions = new Set()
const definitionPattern = /create\s+(?:or\s+replace\s+)?function\s+(?:public\s*\.\s*)?([a-z_][a-z0-9_]*)\s*\(/ig
for (const match of sqlText.matchAll(definitionPattern)) definitions.add(match[1].toLowerCase())
const calls = new Map()
const callPattern = /\.rpc\(\s*['"]([a-z_][a-z0-9_]*)['"]/ig
for (const source of sources) {
  for (const match of source.text.matchAll(callPattern)) {
    const name = match[1].toLowerCase()
    if (!calls.has(name)) calls.set(name, [])
    calls.get(name).push(source.path.replace(`${root}/`, ''))
  }
}
const missing = [...calls.entries()].filter(([name]) => !definitions.has(name))
if (missing.length) {
  console.error(`FAIL  ${missing.length} frontend RPC call(s) have no matching SQL function definition:`)
  for (const [name, paths] of missing) console.error(`  - ${name}: ${[...new Set(paths)].join(', ')}`)
  process.exit(1)
}
console.log(`PASS  ${calls.size} frontend RPC names match SQL function definitions across ${sqlFiles.length} migration files.`)
