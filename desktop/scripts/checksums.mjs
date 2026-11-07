import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Runs on every CI runner, right after electron-builder. Keeping this in Node
// avoids depending on sha256sum vs. shasum vs. PowerShell between platforms.
const [dir = 'release', slug = 'all'] = process.argv.slice(2)
const installer = /\.(dmg|zip|exe|AppImage|deb)$/

const rows = readdirSync(dir)
  .filter((name) => installer.test(name) && statSync(join(dir, name)).isFile())
  .sort()
  .map((name) => `${createHash('sha256').update(readFileSync(join(dir, name))).digest('hex')}  ${name}`)

if (rows.length === 0) {
  console.error(`No installers found in ${dir}`)
  process.exit(1)
}

const target = join(dir, `SHA256SUMS-${slug}.txt`)
writeFileSync(target, `${rows.join('\n')}\n`)
console.log(rows.join('\n'))
