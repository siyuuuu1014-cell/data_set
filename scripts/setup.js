#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const DIRS = ['data', 'configs']

for (const dir of DIRS) {
  const dirPath = path.join(ROOT, dir)
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
    fs.writeFileSync(path.join(dirPath, '.gitkeep'), '')
    console.log(`✓ Created ${dir}/`)
  }
}
