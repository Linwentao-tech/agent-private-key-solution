import express from 'express'
import type {Server} from 'node:http'
import {parseCliError} from '../../lib/errors.js'
import {createRouter} from './routes/index.js'
import type {OwnerApiRuntime} from './types.js'

type StartOwnerApiServerOptions = {
  host: string
  port: number
}

type StartupInfo = {
  ok: true
  service: 'aba-owner-api'
  host: string
  port: number
  ownerAddress: string
  auth: 'bearer' | 'none'
  routes: readonly string[]
  listen: string
}

const OWNER_ROUTES = [
  'GET /health',
  'GET /owner/capabilities',
  'POST /owner/create-policy',
  'POST /owner/policy-update',
  'POST /owner/approve',
  'POST /owner/call',
] as const

function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}

function safeJsonResponse(data: unknown): string {
  return JSON.stringify(data, bigIntReplacer, 2)
}

export async function startOwnerApiServer(
  runtime: OwnerApiRuntime,
  options: StartOwnerApiServerOptions,
): Promise<{
  server: Server
  startup: StartupInfo
}> {
  const app = express()

  app.use(express.json({limit: '1mb'}))

  app.use((_req, res, next) => {
    res.json = (body: unknown) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      return res.send(safeJsonResponse(body))
    }
    next()
  })

  app.use((req, res, next) => {
    if (runtime.authToken) {
      const auth = req.headers.authorization || ''
      if (auth !== `Bearer ${runtime.authToken}`) {
        res.status(401).json({
          ok: false,
          error: 'UNAUTHORIZED',
          message: 'missing or invalid bearer token',
        })
        return
      }
    }
    next()
  })

  const router = createRouter(runtime)
  app.use(router)

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const parsed = parseCliError(err)
    res.status(400).json({
      ok: false,
      error: parsed.code,
      message: parsed.message,
      hint: parsed.hint ?? null,
      raw: parsed.raw ?? null,
    })
  })

  return new Promise((resolve, reject) => {
    const server = app.listen(options.port, options.host, () => {
      resolve({
        server,
        startup: {
          ok: true,
          service: 'aba-owner-api',
          host: options.host,
          port: options.port,
          listen: `${options.host}:${options.port}`,
          ownerAddress: runtime.ownerAddress,
          auth: runtime.authToken ? 'bearer' : 'none',
          routes: OWNER_ROUTES,
        },
      })
    })
    server.once('error', reject)
  })
}
