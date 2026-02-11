"use client";

import * as React from "react";
import type { Address } from "viem";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function TbaCard(props: {
  registryAddr: string | null;
  implementationAddr: string | null;

  isConnected: boolean;
  wrongChain: boolean;
  walletClientPresent: boolean;

  selectedTokenId: bigint | null;
  tbaIsCurrent: boolean;
  tbaAddress: Address | null;
  tbaDeployed: boolean | null;
  tbaBusy: boolean;
  tbaRefreshing: boolean;
  tbaErr: string | null;
  showSkeleton?: boolean;

  createTba: () => void;
  refreshTba: () => void;

  isNftOwner: boolean | null;

  allowanceLoading: boolean;
  usdtAllowance: bigint | null;
  formatAllowance: (v: bigint) => string;
  approveAmountUsdt: string;
  setApproveAmountUsdt: (v: string) => void;
  approveBusy: boolean;
  resetBusy: boolean;
  approveTx: `0x${string}` | null;
  allowanceErr: string | null;
  refreshAllowance: () => void;
  approveExactAmountFromString: () => void;
  resetAllowanceToZero: () => void;
}) {
  const {
    registryAddr,
    implementationAddr,
    isConnected,
    wrongChain,
    walletClientPresent,
    selectedTokenId,
    tbaIsCurrent,
    tbaAddress,
    tbaDeployed,
    tbaBusy,
    tbaRefreshing,
    tbaErr,
    showSkeleton = false,
    createTba,
    refreshTba,
    isNftOwner,
    allowanceLoading,
    usdtAllowance,
    formatAllowance,
    approveAmountUsdt,
    setApproveAmountUsdt,
    approveBusy,
    resetBusy,
    approveTx,
    allowanceErr,
    refreshAllowance,
    approveExactAmountFromString,
    resetAllowanceToZero,
  } = props;
  const allowanceActionBusy = approveBusy || resetBusy;

  return (
    <section className="relative rounded-2xl border border-zinc-200 bg-white/70 p-5 shadow-sm backdrop-blur">
      <div className={showSkeleton ? "pointer-events-none opacity-0" : ""}>
      

        <div className="mt-5 rounded-2xl border border-zinc-200 bg-white/90 p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-start">
            <div className="grid min-w-0 gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Your Agent Wallet</div>
              <div
                className="truncate rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-sm text-zinc-900"
                title={selectedTokenId === null ? "" : tbaIsCurrent && tbaAddress ? tbaAddress : ""}
              >
                {selectedTokenId === null
                  ? "Select an NFT tokenId"
                  : tbaIsCurrent && tbaAddress
                    ? tbaAddress
                    : "Computing…"}
              </div>
            </div>

            <div className="grid justify-items-start gap-2 md:justify-items-end">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Status</span>
                {selectedTokenId === null ? (
                  <Badge className="bg-zinc-100 text-zinc-700 hover:bg-zinc-100">idle</Badge>
                ) : !tbaIsCurrent || tbaRefreshing || tbaDeployed === null ? (
                  <Badge className="bg-zinc-100 text-zinc-700 hover:bg-zinc-100">checking</Badge>
                ) : tbaDeployed ? (
                  <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">deployed</Badge>
                ) : (
                  <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">not deployed</Badge>
                )}
              </div>
              {selectedTokenId !== null && tbaDeployed !== true ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-8 w-auto whitespace-nowrap rounded-lg bg-zinc-900 px-3 text-xs text-white hover:bg-zinc-800 disabled:opacity-60"
                  onClick={createTba}
                  disabled={!isConnected || wrongChain || !walletClientPresent || !tbaIsCurrent || tbaDeployed !== false}
                  title={!walletClientPresent ? "No wallet client" : "Deploy TBA via registry"}
                >
                  Create
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-auto whitespace-nowrap rounded-lg border border-zinc-300 bg-white px-3 text-xs hover:bg-zinc-50 disabled:opacity-60"
                  onClick={refreshTba}
                  disabled={selectedTokenId === null || tbaRefreshing}
                >
                  Refresh
                </Button>
              )}
            </div>
          </div>
        </div>

        {isConnected && !wrongChain ? (
          <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3.5">
            {selectedTokenId === null ? (
              <div className="text-sm text-zinc-600">
                Select an NFT to compute its agent wallet, then approve spend for this TBA.
              </div>
            ) : !tbaIsCurrent || !tbaAddress ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="grid min-w-0 gap-1">
                    <div className="text-xs text-zinc-500">agent wallet amount</div>
                    <div className="max-w-full truncate font-mono text-sm tabular-nums" suppressHydrationWarning>
                      —
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="grid gap-1">
                      <div className="text-[11px] font-medium text-zinc-600">Approve Amount</div>
                      <div className="relative">
                        <Input
                          className="w-[180px] rounded-xl border border-zinc-300 bg-white px-3 py-2 pr-12 font-mono text-xs outline-none focus:border-zinc-900"
                          value={approveAmountUsdt}
                          onChange={(e) => setApproveAmountUsdt(e.target.value)}
                          placeholder="e.g. 25"
                          inputMode="decimal"
                          disabled
                        />
                        <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-medium text-zinc-500">
                          USDT
                        </div>
                      </div>
                      <div className="text-[11px] leading-4 text-zinc-500">
                        Switching NFTs… computing the new agent wallet.
                      </div>
                    </div>
                    <Button
                      type="button"
                      className="inline-flex w-auto whitespace-nowrap items-center justify-center rounded-xl bg-zinc-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
                      disabled
                    >
                      Approve
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-auto whitespace-nowrap rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-medium disabled:opacity-60"
                      disabled
                    >
                      Reset 0
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="inline-flex w-auto whitespace-nowrap items-center justify-center rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-medium disabled:opacity-60"
                      disabled
                    >
                      Refresh
                    </Button>
                  </div>
                </div>

                {/* Reserve two lines so refresh/tx/errors don't change this card's height. */}
                <div className="mt-2 grid gap-1">
                  <div className="max-w-full truncate font-mono text-xs text-zinc-600 invisible">tx: 0x</div>
                  <div className="max-w-full truncate text-sm text-red-600 invisible">error</div>
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="grid min-w-0 gap-1">
                    <div className="text-xs text-zinc-500">agent wallet amount</div>
                    <div className="max-w-full truncate font-mono text-sm tabular-nums" suppressHydrationWarning>
                      {allowanceLoading
                        ? "loading…"
                        : usdtAllowance !== null
                          ? `${formatAllowance(usdtAllowance)} USDT`
                          : "—"}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="grid gap-1">
                      <div className="text-[11px] font-medium text-zinc-600">Approve Amount</div>
                      <div className="relative">
                        <Input
                          className="w-[180px] rounded-xl border border-zinc-300 bg-white px-3 py-2 pr-12 font-mono text-xs outline-none focus:border-zinc-900"
                          value={approveAmountUsdt}
                          onChange={(e) => setApproveAmountUsdt(e.target.value)}
                          placeholder="e.g. 25"
                          inputMode="decimal"
                        />
                        <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-medium text-zinc-500">
                          USDT
                        </div>
                      </div>
                    </div>

                    <Button
                      type="button"
                      className="inline-flex w-auto whitespace-nowrap items-center justify-center rounded-xl bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
                      onClick={approveExactAmountFromString}
                      disabled={!walletClientPresent || allowanceActionBusy || isNftOwner !== true}
                      title={isNftOwner !== true ? "Only NFT owner should approve allowance" : "Approve USDT allowance to this TBA"}
                    >
                      {approveBusy ? "Approving…" : "Approve"}
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      className="w-auto whitespace-nowrap rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-medium hover:bg-zinc-50 disabled:opacity-60"
                      onClick={resetAllowanceToZero}
                      disabled={!walletClientPresent || allowanceActionBusy || isNftOwner !== true}
                      title="Some tokens require resetting allowance to 0 before setting a new value."
                    >
                      {resetBusy ? "Resetting…" : "Reset 0"}
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      className="inline-flex w-auto whitespace-nowrap items-center justify-center rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-medium hover:bg-zinc-50 disabled:opacity-60"
                      onClick={refreshAllowance}
                      disabled={allowanceLoading}
                    >
                      Refresh
                    </Button>
                  </div>
                </div>

                {/* Reserve two lines so refresh/tx/errors don't change this card's height. */}
                <div className="mt-2 grid gap-1">
                  <div
                    className={`max-w-full truncate font-mono text-xs text-zinc-600 ${approveTx ? "" : "invisible"}`}
                    title={approveTx ?? ""}
                    aria-hidden={!approveTx}
                  >
                    {approveTx ? `tx: ${approveTx}` : "tx: 0x"}
                  </div>
                  <div
                    className={`max-w-full truncate text-sm text-red-600 ${allowanceErr ? "" : "invisible"}`}
                    title={allowanceErr ?? ""}
                    aria-hidden={!allowanceErr}
                  >
                    {allowanceErr ?? "error"}
                  </div>
                </div>
              </>
            )}
          </div>
        ) : null}

        <div className="mt-2 min-h-[16px] max-w-full truncate text-sm text-red-600" title={tbaErr ?? ""}>
          {tbaErr ?? ""}
        </div>
      </div>
      {showSkeleton ? (
        <div className="absolute inset-0 z-10 p-5">
          <div className="h-full animate-pulse">
            <div className="grid gap-3">
              <div className="grid gap-1">
                <div className="h-3 w-28 rounded bg-zinc-200" />
                <div className="h-5 w-full rounded bg-zinc-200" />
              </div>
              <div className="grid gap-1">
                <div className="h-3 w-24 rounded bg-zinc-200" />
                <div className="h-5 w-full rounded bg-zinc-200" />
              </div>
            </div>
            <div className="mt-5 rounded-xl border border-zinc-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="grid min-w-0 gap-2">
                  <div className="h-3 w-24 rounded bg-zinc-200" />
                  <div className="h-5 w-56 rounded bg-zinc-200" />
                </div>
                <div className="h-9 w-32 rounded-xl bg-zinc-200" />
              </div>
              <div className="mt-4 h-3 w-20 rounded bg-zinc-200" />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
