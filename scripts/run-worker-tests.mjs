import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const candidates = process.platform === 'win32'
  ? [path.join(root, 'workers', 'video-annotation', '.venv', 'Scripts', 'python.exe')]
  : [path.join(root, 'workers', 'video-annotation', '.venv', 'bin', 'python')]
const python = candidates.find(existsSync)

if (!python) {
  console.error('Nuwa Worker environment is missing. Run the video-worker setup script first.')
  process.exit(1)
}

const result = spawnSync(
  python,
  [
    '-m',
    'unittest',
    'discover',
    '-s',
    'workers/video-annotation/tests',
    '-p',
    'test_*.py',
    '-v',
  ],
  {
    cwd: root,
    stdio: 'inherit',
  },
)

if (result.error) {
  console.error(result.error)
  process.exit(1)
}
process.exit(result.status ?? 1)
