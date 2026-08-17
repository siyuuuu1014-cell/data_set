// Post-install: replace lzo with stub so parquetjs optional dep resolves
// The real lzo package has native bindings that may not compile.
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
const path = require('path')

const dir = path.join(__dirname, '..', 'node_modules', 'lzo')
const file = path.join(dir, 'index.js')

fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(file, `// Stub — replaces real lzo native module to avoid build/runtime errors.
// LZO compression is never used by this app; parquetjs loads it lazily.
module.exports = { compress: () => {}, decompress: () => {} }
`)
console.log('[postinstall] lzo → stub')
