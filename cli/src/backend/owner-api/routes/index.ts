import type {Router} from 'express'
import express from 'express'
import type {OwnerApiRuntime} from '../types.js'
import {createAdjustPolicyRouter} from './adjust-policy.js'
import {createApproveRouter} from './approve.js'
import {createCapabilitiesRouter} from './capabilities.js'
import {createCreatePolicyRouter} from './create-policy.js'
import {createHealthRouter} from './health.js'

export function createRouter(runtime: OwnerApiRuntime): Router {
  const router = express.Router()

  router.use(createHealthRouter(runtime))
  router.use(createCapabilitiesRouter(runtime))
  router.use(createCreatePolicyRouter(runtime))
  router.use(createAdjustPolicyRouter(runtime))
  router.use(createApproveRouter(runtime))

  router.use((_req, res) => {
    res.status(404).json({
      ok: false,
      error: 'NOT_FOUND',
      message: 'route not found',
    })
  })

  return router
}
