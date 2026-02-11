"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function WalletCard(props: {
  isConnected: boolean;
  wrongChain: boolean;
  chainName: string;
  walletLine: string;
  connectorLabel: string;
  connectErrorMessage: string | null;
  walletUsdtBal: bigint | null;
  walletUsdtBalLoading: boolean;
  refreshWalletUsdtBalance: () => void;
  formatUsdtUnits: (v: any) => string;
  fundUsdtAmount: string;
  setFundUsdtAmount: (v: string) => void;
  fundUsdtBusy: boolean;
  fundWalletUsdt: () => void;
  walletClientPresent: boolean;
  usdtMintableLoading: boolean;
  usdtMintable: boolean | null;
  usdtMintFn: "mint" | "_mint" | null;
  fundUsdtErr: string | null;
  fundUsdtTx: `0x${string}` | null;
}) {
  const {
    isConnected,
    wrongChain,
    chainName,
    walletLine,
    connectorLabel,
    connectErrorMessage,
    walletUsdtBal,
    walletUsdtBalLoading,
    refreshWalletUsdtBalance,
    formatUsdtUnits,
    fundUsdtAmount,
    setFundUsdtAmount,
    fundUsdtBusy,
    fundWalletUsdt,
    walletClientPresent,
    usdtMintableLoading,
    usdtMintable,
    usdtMintFn,
    fundUsdtErr,
    fundUsdtTx,
  } = props;

  return (
    <section className="mx-auto w-full max-w-4xl rounded-3xl border border-zinc-200/70 bg-gradient-to-br from-white via-zinc-50/70 to-white p-5 shadow-sm backdrop-blur">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-zinc-200 bg-white/80 px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Wallet</div>
          <div className="mt-1 min-h-[20px] font-mono text-sm text-zinc-900" suppressHydrationWarning>
            {walletLine}
          </div>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white/80 px-4 py-3 md:text-right">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Connector</div>
          <div className="mt-1 font-mono text-sm text-zinc-900" suppressHydrationWarning>
            {connectorLabel}
          </div>
        </div>
      </div>

      {connectErrorMessage ? <div className="mt-3 text-sm text-red-600">{connectErrorMessage}</div> : null}

      {isConnected ? (
        <div className="mt-4 grid gap-3 text-sm text-zinc-700 md:grid-cols-3">
          <div className="rounded-2xl border border-zinc-200 bg-white/85 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Chain</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="font-mono text-zinc-900" suppressHydrationWarning>
                {chainName}
              </span>
              {wrongChain ? (
                <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Please switch to Sepolia</Badge>
              ) : (
                <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">OK</Badge>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white/85 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">USDT (wallet)</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="font-mono text-zinc-900" suppressHydrationWarning>
                {wrongChain ? "—" : walletUsdtBal !== null ? `${formatUsdtUnits(walletUsdtBal)} USDT` : "—"}
              </span>
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="h-7 w-auto whitespace-nowrap rounded-lg px-3 text-[11px] hover:bg-zinc-50 disabled:opacity-60"
                onClick={refreshWalletUsdtBalance}
                disabled={wrongChain || walletUsdtBalLoading}
                title="Refresh wallet USDT balance"
              >
                {walletUsdtBalLoading ? "Refreshing…" : "Refresh"}
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white/85 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Fund</div>
            <div className="mt-2 grid gap-2">
              <div className="relative">
                <Input
                  className="h-8 w-full rounded-lg border border-zinc-300 bg-white px-3 py-1 pr-11 font-mono text-[12px] outline-none focus:border-zinc-900 disabled:opacity-60"
                  value={fundUsdtAmount}
                  onChange={(e) => setFundUsdtAmount(e.target.value)}
                  placeholder="100"
                  disabled={wrongChain || fundUsdtBusy}
                  title="Amount in USDT"
                />
                <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                  USDT
                </div>
              </div>
              <Button
                type="button"
                size="xs"
                className="h-8 w-full whitespace-nowrap rounded-lg bg-zinc-900 px-3 text-[11px] text-white hover:bg-zinc-800 disabled:opacity-60"
                onClick={fundWalletUsdt}
                disabled={wrongChain || fundUsdtBusy || !walletClientPresent || usdtMintableLoading || usdtMintable === false}
                title={
                  usdtMintable === false
                    ? "This USDT contract is not mintable here. Use a faucet or transfer tokens instead."
                    : usdtMintFn === "_mint"
                      ? "Mint demo USDT to your wallet (MockERC20._mint)"
                      : "Mint demo USDT to your wallet (MockERC20.mint)"
                }
              >
                {fundUsdtBusy ? "Funding…" : "Fund USDT with Sepolia ETH"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {isConnected ? (
        <div className="mt-3 grid gap-1">
          {fundUsdtErr ? <div className="text-xs text-red-600">{fundUsdtErr}</div> : null}
          {fundUsdtTx ? (
            <div className="max-w-full break-all font-mono text-[11px] text-zinc-600">fund tx: {fundUsdtTx}</div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
