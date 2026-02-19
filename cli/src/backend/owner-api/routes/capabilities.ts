import type {Router} from 'express'
import express from 'express'
import type {OwnerApiRuntime} from '../types.js'

export function createCapabilitiesRouter(runtime: OwnerApiRuntime): Router {
  const router = express.Router()

  router.get('/owner/capabilities', (_req, res) => {
    res.json({
      ok: true,
      ownerAddress: runtime.ownerAddress,
      routes: [
        'POST /owner/create-policy - Create new policy (bind Agent to TBA)',
        'POST /owner/adjust-policy - Adjust policy params or rotate Agent',
        'POST /owner/approve - Approve tokens for TBA',
      ],
    })
  })

  return router
}
