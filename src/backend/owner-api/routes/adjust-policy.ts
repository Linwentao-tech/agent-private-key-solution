import type {Router} from 'express'
import express from 'express'
import {sepolia} from 'viem/chains'
import {getPublicClient, getWalletFromPrivateKey, parseAddress} from '../../../lib/chain.js'
import {AGENT6551_ABI, ERC20_ABI} from '../../../lib/contracts.js'
import {requireBinding} from '../../../lib/require.js'
import {parseDecimalToUnits} from '../../../lib/units.js'
import {parseTargetsWithoutAuto} from '../common.js'
import type {AdjustPolicyBody, OwnerApiRuntime} from '../types.js'

export function createAdjustPolicyRouter(runtime: OwnerApiRuntime): Router {
  const router = express.Router()

  router.post('/owner/adjust-policy', async (req, res) => {
    try {
      const body = req.body as AdjustPolicyBody
      const currentState = runtime.getState()
      const {tbaAddress} = requireBinding(currentState, {requirePolicyCreated: true})
      const publicClient = getPublicClient()
      const {account, wallet} = getWalletFromPrivateKey(runtime.ownerPk)

      const policyTuple = (await publicClient.readContract({
        address: tbaAddress,
        abi: AGENT6551_ABI,
        functionName: 'policy',
      })) as readonly [`0x${string}`, bigint, bigint, bigint, `0x${string}`, boolean]
      const currentTargets = (await publicClient.readContract({
        address: tbaAddress,
        abi: AGENT6551_ABI,
        functionName: 'getPolicyTargets',
      })) as `0x${string}`[]

      let decimals = 6
      try {
        const decimalsRaw = await publicClient.readContract({
          address: policyTuple[4],
          abi: ERC20_ABI,
          functionName: 'decimals',
        })
        decimals = typeof decimalsRaw === 'bigint' ? Number(decimalsRaw) : Number(decimalsRaw)
      } catch {
        decimals = 6
      }

      const dryRun = Boolean(body.dryRun)
      const newSigner = body.signer ? parseAddress(body.signer, 'signer') : null
      const hasSignerUpdate = newSigner !== null

      const maxTotalUnits = body.maxTotal ? parseDecimalToUnits(String(body.maxTotal), decimals) : policyTuple[2]
      const validUntil = body.validUntil ? BigInt(body.validUntil) : policyTuple[1]
      const targets = parseTargetsWithoutAuto(body.targets, currentTargets)
      const active = typeof body.active === 'boolean' ? body.active : policyTuple[5]

      const hasParamUpdate = body.maxTotal !== undefined || body.validUntil !== undefined || body.targets !== undefined || body.active !== undefined

      if (dryRun) {
        res.json({
          ok: true,
          dryRun: true,
          tbaAddress,
          changes: {
            signer: hasSignerUpdate ? {from: policyTuple[0], to: newSigner} : null,
            validUntil: body.validUntil !== undefined ? {from: policyTuple[1], to: validUntil} : null,
            maxTotal: body.maxTotal !== undefined ? {from: policyTuple[2], to: maxTotalUnits} : null,
            active: body.active !== undefined ? {from: policyTuple[5], to: active} : null,
          },
        })
        return
      }

      const txHashes: `0x${string}`[] = []

      if (hasSignerUpdate) {
        const rotateTxHash = await wallet.writeContract({
          account,
          address: tbaAddress,
          abi: AGENT6551_ABI,
          functionName: 'rotatePolicySigner',
          args: [newSigner],
          chain: sepolia,
        })
        await publicClient.waitForTransactionReceipt({hash: rotateTxHash})
        txHashes.push(rotateTxHash)
      }

      if (hasParamUpdate) {
        const updateTxHash = await wallet.writeContract({
          account,
          address: tbaAddress,
          abi: AGENT6551_ABI,
          functionName: 'updatePolicy',
          args: [validUntil, maxTotalUnits, targets, active],
          chain: sepolia,
        })
        await publicClient.waitForTransactionReceipt({hash: updateTxHash})
        txHashes.push(updateTxHash)
      }

      res.json({
        ok: true,
        tbaAddress,
        signerRotated: hasSignerUpdate,
        paramsUpdated: hasParamUpdate,
        txHashes,
        txHash: txHashes.length === 1 ? txHashes[0] : null,
        update: {
          signer: hasSignerUpdate ? newSigner : policyTuple[0],
          validUntil,
          maxTotalUnits,
          targets,
          active,
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      res.status(400).json({
        ok: false,
        error: 'ADJUST_POLICY_ERROR',
        message,
      })
    }
  })

  return router
}
