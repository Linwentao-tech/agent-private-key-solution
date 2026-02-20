import type {Router} from 'express'
import express from 'express'
import {sepolia} from 'viem/chains'
import {getPublicClient, getWalletFromPrivateKey, parseAddress, parsePrivateKey} from '../../../lib/chain.js'
import {addressFromPrivateKey} from '../../../lib/context.js'
import {AGENT6551_ABI, ERC20_ABI} from '../../../lib/contracts.js'
import {DEFAULT_POLICY_MAX_TOTAL_USDT, DEFAULT_POLICY_VALID_SECONDS, DEFAULT_USDT_ADDRESS} from '../../../lib/constants.js'
import {requireBinding} from '../../../lib/require.js'
import {parseDecimalToUnits} from '../../../lib/units.js'
import {isPolicyConfigured, parseTargetsInput} from '../common.js'
import type {CreatePolicyBody, OwnerApiRuntime} from '../types.js'

export function createCreatePolicyRouter(runtime: OwnerApiRuntime): Router {
  const router = express.Router()

  router.post('/owner/create-policy', async (req, res) => {
    try {
      const body = req.body as CreatePolicyBody
      const currentState = runtime.getState()
      const {tbaAddress} = requireBinding(currentState)
      const publicClient = getPublicClient()
      const {account, wallet} = getWalletFromPrivateKey(runtime.ownerPk)

      const existingPolicy = (await publicClient.readContract({
        address: tbaAddress,
        abi: AGENT6551_ABI,
        functionName: 'policy',
      })) as readonly [`0x${string}`, bigint, bigint, bigint, `0x${string}`, boolean]

      const dryRun = Boolean(body.dryRun)
      if (isPolicyConfigured(existingPolicy)) {
        const nowIso = new Date().toISOString()
        if (currentState.binding && !currentState.binding.policyCreatedAt) {
          runtime.setState({
            ...currentState,
            binding: {
              ...currentState.binding,
              policyCreatedAt: nowIso,
              updatedAt: nowIso,
            },
          })
        }
        res.json({
          ok: true,
          alreadyConfigured: true,
          tbaAddress,
          policyCreated: true,
          policy: existingPolicy,
          hint: 'Policy already configured. Use POST /owner/adjust-policy to update.',
        })
        return
      }

    const budgetToken = body.budgetToken
      ? parseAddress(body.budgetToken, 'budgetToken')
      : DEFAULT_USDT_ADDRESS
    const policySigner = body.policySigner
      ? parseAddress(body.policySigner, 'policySigner')
      : currentState.agentSignerPrivateKey
        ? addressFromPrivateKey(parsePrivateKey(currentState.agentSignerPrivateKey))
        : runtime.ownerAddress

    let decimals = 6
    try {
      const decimalsRaw = await publicClient.readContract({
        address: budgetToken,
        abi: ERC20_ABI,
        functionName: 'decimals',
      })
      decimals = typeof decimalsRaw === 'bigint' ? Number(decimalsRaw) : Number(decimalsRaw)
    } catch {
      decimals = 6
    }

    const maxTotalRaw = body.maxTotal ? String(body.maxTotal) : DEFAULT_POLICY_MAX_TOTAL_USDT
    const maxTotalUnits = parseDecimalToUnits(maxTotalRaw, decimals)
    const validUntil = body.validUntil
      ? BigInt(body.validUntil)
      : BigInt(Math.floor(Date.now() / 1000) + DEFAULT_POLICY_VALID_SECONDS)
    const targets = parseTargetsInput(body.targets, budgetToken)
    const active = typeof body.active === 'boolean' ? body.active : true

    if (dryRun) {
      res.json({
        ok: true,
        dryRun: true,
        tbaAddress,
        payload: {
          policySigner,
          budgetToken,
          maxTotalUnits,
          validUntil,
          targets,
          active,
        },
      })
      return
    }

    const txHash = await wallet.writeContract({
      account,
      address: tbaAddress,
      abi: AGENT6551_ABI,
      functionName: 'configurePolicy',
      args: [policySigner, validUntil, budgetToken, maxTotalUnits, targets, active],
      chain: sepolia,
    })
    await publicClient.waitForTransactionReceipt({hash: txHash})

    const nowIso = new Date().toISOString()
    runtime.setState({
      ...currentState,
      binding: currentState.binding
        ? {
            ...currentState.binding,
            policyCreatedAt: nowIso,
            updatedAt: nowIso,
          }
        : currentState.binding,
    })

    res.json({
      ok: true,
      tbaAddress,
      txHash,
      policyCreated: true,
    })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      res.status(400).json({
        ok: false,
        error: 'CREATE_POLICY_ERROR',
        message,
      })
    }
  })

  return router
}
