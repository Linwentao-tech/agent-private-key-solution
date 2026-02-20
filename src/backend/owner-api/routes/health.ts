import type {Router} from 'express'
import express from 'express'
import type {OwnerApiRuntime} from '../types.js'

export function createHealthRouter(runtime: OwnerApiRuntime): Router {
  const router = express.Router()

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'aba-owner-api',
      network: runtime.getState().network,
      chainId: runtime.getState().chainId,
      ownerAddress: runtime.ownerAddress,
    })
  })

  return router
}
