import {addressFromPrivateKey} from '../../lib/context.js'
import {loadState, saveState} from '../../lib/state.js'
import {parseOwnerPrivateKey} from './common.js'
import {startOwnerApiServer} from './server.js'
import type {OwnerApiRuntime} from './types.js'

type MainArgs = {
  listen: string
  token?: string
  ownerPrivatekey?: string
  json: boolean
  help: boolean
}

function parseArgValue(current: string, next: string | undefined): {value?: string; consumedNext: boolean} {
  const eq = current.indexOf('=')
  if (eq >= 0) return {value: current.slice(eq + 1), consumedNext: false}
  return {value: next, consumedNext: true}
}

function parseListen(value: string): {host: string; port: number} {
  const parts = value.split(':')
  if (parts.length === 1) {
    const port = Number(parts[0])
    if (!Number.isInteger(port) || port <= 0) throw new Error('invalid port')
    return {host: 'localhost', port}
  }
  if (parts.length === 2) {
    const port = Number(parts[1])
    if (!Number.isInteger(port) || port <= 0) throw new Error('invalid port')
    const host = parts[0] || 'localhost'
    return {host, port}
  }
  throw new Error('invalid listen format, use: localhost:3000 or :3000')
}

function parseArgs(argv: string[]): MainArgs {
  const out: MainArgs = {
    listen: 'localhost:8787',
    json: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') {
      out.json = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      out.help = true
      continue
    }
    if (arg.startsWith('--listen')) {
      const {value, consumedNext} = parseArgValue(arg, argv[i + 1])
      if (!value) throw new Error('--listen requires a value')
      out.listen = value
      if (consumedNext) i += 1
      continue
    }
    if (arg.startsWith('--token')) {
      const {value, consumedNext} = parseArgValue(arg, argv[i + 1])
      if (!value) throw new Error('--token requires a value')
      out.token = value
      if (consumedNext) i += 1
      continue
    }
    if (arg.startsWith('--owner-privatekey')) {
      const {value, consumedNext} = parseArgValue(arg, argv[i + 1])
      if (!value) throw new Error('--owner-privatekey requires a value')
      out.ownerPrivatekey = value
      if (consumedNext) i += 1
      continue
    }
    throw new Error(`unknown argument: ${arg}`)
  }
  return out
}

function printHelp(): void {
  console.log(
    [
      'Owner API backend (separate from aba commands)',
      '',
      'USAGE',
      '  node ./dist/backend/owner-api/main.js --listen localhost:3000 [--token <token>]',
      '    [--owner-privatekey <0x...>] [--json]',
      '',
      'FLAGS',
      '  --listen             listen address (default: localhost:8787)',
      '  --token              bearer token',
      '  --owner-privatekey   owner key',
      '  --json               print startup info as json',
    ].join('\n'),
  )
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  const authToken = args.token || null
  const ownerPk = parseOwnerPrivateKey(args.ownerPrivatekey)
  const ownerAddress = addressFromPrivateKey(ownerPk)
  const {host, port} = parseListen(args.listen)

  const runtime: OwnerApiRuntime = {
    ownerPk,
    ownerAddress,
    authToken,
    getState: () => loadState(),
    setState: (next) => saveState(next),
  }

  const {server, startup} = await startOwnerApiServer(runtime, {host, port})

  if (args.json) {
    console.log(JSON.stringify(startup, null, 2))
  } else {
    console.log(
      [
        'Owner API started.',
        `listen: http://${startup.host}:${startup.port}`,
        `owner: ${startup.ownerAddress}`,
        `auth: ${startup.auth === 'bearer' ? 'bearer token required' : 'none'}`,
      ].join('\n'),
    )
  }

  const shutdown = () => {
    server.close(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  await new Promise<void>(() => {})
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
