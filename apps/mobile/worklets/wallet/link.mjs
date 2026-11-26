// Links the native addons the packed wallet bundle names, and only those, for Android (SL-17).
// Runs under the Bare runtime, not Node: on the build Mac, Node segfaults inside bare-module-lexer's Node addon
// (1.7.0), which bare-pack and bare-link both load; Bare loads the .bare build of the same lexer and works.
//   bare link.mjs <bundle> <out dir>
// react-native-bare-kit 0.16 links nothing by itself. bare-link from the source entry would also walk `ws`'s
// optional `bufferutil` and `utf-8-validate` and stop, so this reads the bundle header's `addons` list instead,
// writes an entry that requires exactly those packages, and links that. Files are added to <out>; nothing is removed.
/* global Bare */
import fs from 'bare-fs'
import path from 'bare-path'
import link from 'bare-link'
import Buffer from 'bare-buffer'

const [bundlePath, out] = Bare.argv.slice(2)
if (!bundlePath || !out) throw new Error('usage: bare link.mjs <bundle> <out dir>')

const bytes = fs.readFileSync(bundlePath)
const text = bytes.subarray(0, 64).toString()
// A packed JS module starts with `module.exports = "`; read the string back first.
const raw = text.startsWith('module.exports = ') ? Buffer.from(JSON.parse(bytes.toString().slice('module.exports = '.length).replace(/;?\s*$/, ''))) : bytes
const nl = raw.indexOf(0x0a)
const headerLength = Number(raw.subarray(0, nl).toString())
const header = JSON.parse(raw.subarray(nl + 1, nl + headerLength).toString())

const here = path.dirname(new URL(import.meta.url).pathname)
const packages = []
for (const addon of header.addons) {
  const m = /^linked:lib(.+)\.(\d+\.\d+\.\d+)\.so$/.exec(addon)
  if (!m) throw new Error('Unexpected addon reference ' + addon)
  const pkg = JSON.parse(fs.readFileSync(path.join(here, 'node_modules', m[1], 'package.json')))
  if (pkg.version !== m[2]) throw new Error(`${m[1]} is ${pkg.version} in node_modules but the bundle wants ${m[2]}`)
  packages.push(m[1])
}

const entry = path.join(here, 'addons-entry.cjs')
fs.writeFileSync(entry, packages.map((p) => `require('${p}')`).join('\n') + '\n')
const hosts = ['android-arm64', 'android-x64']
let n = 0
for await (const file of link(entry, { hosts, out })) {
  console.log('linked', path.relative(out, file))
  n++
}
console.log(`linked ${n} files for ${header.addons.length} addons (${hosts.join(', ')})`)
