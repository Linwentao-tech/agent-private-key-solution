import type {Router} from 'express'
import express from 'express'
import {sepolia} from 'viem/chains'
import {getPublicClient, getWalletFromPrivateKey, parseAddress} from '../../../lib/chain.js'
import {ERC20_ABI} from '../../../lib/contracts.js'
import {DEFAULT_USDT_ADDRESS} from '../../../lib/constants.js'
import {requireBinding} from '../../../lib/require.js'
import {parseDecimalToUnits} from '../../../lib/units.js'
import type {ApproveBody, OwnerApiRuntime} from '../types.js'

const MAX_UINT256 = (1n << 256n) - 1n

export function createApproveRouter(runtime: OwnerApiRuntime): Router {
  const router = express.Router()

  router.post('/owner/approve', async (req, res) => {
    try {
      const body = req.body as ApproveBody
      const currentState = runtime.getState()
      const {tbaAddress} = requireBinding(currentState, {requirePolicyCreated: true})
      const {account, wallet} = getWalletFromPrivateKey(runtime.ownerPk)
      const publicClient = getPublicClient()

      const tokenAddress = body.token
        ? parseAddress(body.token, 'token')
        : DEFAULT_USDT_ADDRESS
      const spender = body.spender
        ? parseAddress(body.spender, 'spender')
        : tbaAddress

      let decimals = 6
      try {
        const decimalsRaw = await publicClient.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'decimals',
        })
        decimals = typeof decimalsRaw === 'bigint' ? Number(decimalsRaw) : Number(decimalsRaw)
      } catch {
        decimals = 6
      }

      const max = Boolean(body.max)
      const approveAmountUnits = (() => {
        if (max) return MAX_UINT256
        if (body.amountUnits !== undefined && body.amountUnits !== null && body.amountUnits !== '') {
          return BigInt(body.amountUnits)
        }
        if (body.amount !== undefined && body.amount !== null && String(body.amount).trim() !== '') {
          return parseDecimalToUnits(String(body.amount), decimals)
        }
        throw new Error('amount or amountUnits is required unless max=true')
      })()
      if (approveAmountUnits < 0n) throw new Error('approve amount cannot be negative')

    const requestedResetFirst = Boolean(body.resetFirst)
    const dryRun = Boolean(body.dryRun)
    const currentAllowance = (await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [runtime.ownerAddress, spender],
    })) as bigint
    const sameAsCurrent = approveAmountUnits === currentAllowance
    const needsSafeReset = currentAllowance > 0n && approveAmountUnits > 0n
    const effectiveResetFirst = requestedResetFirst || needsSafeReset
    const resetMode = requestedResetFirst ? 'requested' : needsSafeReset ? 'auto' : 'none'
    const willResetFirst = effectiveResetFirst && currentAllowance > 0n && approveAmountUnits > 0n

    if (sameAsCurrent) {
      res.json({
        ok: true,
        skipped: true,
        reason: 'allowance-already-matches',
        ownerAddress: runtime.ownerAddress,
        tbaAddress,
        tokenAddress,
        spender,
        decimals,
        approveAmountUnits,
        max,
        resetFirst: requestedResetFirst,
        effectiveResetFirst,
        resetMode,
        resetTxHash: null,
        txHash: null,
        allowanceBefore: currentAllowance,
        allowanceAfter: currentAllowance,
      })
      return
    }

    if (dryRun) {
      res.json({
        ok: true,
        dryRun: true,
        ownerAddress: runtime.ownerAddress,
        tbaAddress,
        tokenAddress,
        spender,
        decimals,
        currentAllowance,
        approveAmountUnits,
        max,
        resetFirst: requestedResetFirst,
        effectiveResetFirst,
        resetMode,
        willResetFirst,
      })
      return
    }

    let resetTxHash: `0x${string}` | null = null
    if (willResetFirst) {
      resetTxHash = await wallet.writeContract({
        account,
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [spender, 0n],
        chain: sepolia,
      })
      await publicClient.waitForTransactionReceipt({hash: resetTxHash})
    }

    const txHash = await wallet.writeContract({
      account,
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spender, approveAmountUnits],
      chain: sepolia,
    })
    await publicClient.waitForTransactionReceipt({hash: txHash})

    const nextAllowance = (await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [runtime.ownerAddress, spender],
    })) as bigint

    res.json({
      ok: true,
      ownerAddress: runtime.ownerAddress,
        tbaAddress,
        tokenAddress,
        spender,
        decimals,
        approveAmountUnits,
        max,
        resetFirst: requestedResetFirst,
        effectiveResetFirst,
        resetMode,
        resetTxHash,
        txHash,
        allowanceBefore: currentAllowance,
        allowanceAfter: nextAllowance,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      res.status(400).json({
        ok: false,
        error: 'APPROVE_ERROR',
        message,
      })
    }
  })

  return router
}
