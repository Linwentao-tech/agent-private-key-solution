"use client";

import * as React from "react";
import type { Address } from "viem";
import type { OwnedCollection } from "../../lib/nft";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

function shortAddr(a: string) {
  const s = a ?? "";
  if (!s) return "";
  if (!s.startsWith("0x") || s.length < 10) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

export function NftCard(props: {
  isConnected: boolean;
  wrongChain: boolean;
  collections: OwnedCollection[];
  loadingNfts: boolean;
  nftError: string | null;
  refreshNfts: () => void;

  selectedNftContract: Address | null;
  setSelectedNftContract: (a: Address | null) => void;
  selectedTokenId: bigint | null;
  setSelectedTokenId: (v: bigint | null) => void;

  selectedCollection: OwnedCollection | null;
  selectedNftMedia: { imageUrl?: string; title?: string } | null;
}) {
  const {
    isConnected,
    wrongChain,
    collections,
    loadingNfts,
    nftError,
    refreshNfts,
    selectedNftContract,
    setSelectedNftContract,
    selectedTokenId,
    setSelectedTokenId,
    selectedCollection,
    selectedNftMedia,
  } = props;

  const collectionSelectId = React.useId();
  const tokenIdSelectId = React.useId();
  const collectionLabel =
    selectedCollection?.name?.trim() ||
    (selectedNftContract ? shortAddr(selectedNftContract) : collections.length ? "Choose…" : "No collections found");
  const tokenLabel =
    selectedTokenId !== null ? `#${selectedTokenId.toString()}` : selectedCollection?.tokenIds?.length ? "Choose…" : "No tokenIds";

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white/70 p-5 shadow-sm backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="text-xs text-zinc-500">NFTs</div>
          <div className="text-sm text-zinc-700">
            {collections.length > 0 ? `${collections.length} collections found` : "No collections loaded"}
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="inline-flex w-auto whitespace-nowrap items-center justify-center rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60"
          onClick={refreshNfts}
          disabled={!isConnected || wrongChain || loadingNfts}
        >
          {loadingNfts ? "Refreshing…" : "Refresh NFTs"}
        </Button>
      </div>

      {!isConnected ? (
        <div className="mt-4 text-sm text-zinc-600">Connect your wallet to load NFTs.</div>
      ) : wrongChain ? (
        <div className="mt-4 text-sm text-zinc-600">Switch your wallet network to Sepolia to load NFTs.</div>
      ) : nftError ? (
        <div className="mt-4 text-sm text-red-600">NFT load failed: {nftError}</div>
      ) : (
        <div className="mt-4 grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid min-w-0 gap-1">
              <label className="text-sm text-zinc-600" htmlFor={collectionSelectId}>
                Collection
              </label>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild disabled={loadingNfts || collections.length === 0}>
                  <button
                    id={collectionSelectId}
                    type="button"
                    className="h-10 w-full min-w-0 cursor-pointer rounded-xl border border-zinc-300/90 bg-gradient-to-b from-white to-zinc-50 px-3 font-mono text-left text-sm text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(24,24,27,0.06)] outline-none transition-all duration-200 hover:border-zinc-400 hover:from-white hover:to-white focus-visible:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">{collectionLabel}</span>
                      <span className="shrink-0 text-sm text-zinc-500">▾</span>
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-72 min-w-[240px] overflow-auto">
                  {collections.map((c) => (
                    <DropdownMenuItem
                      key={c.contractAddress}
                      className="font-mono text-sm"
                      onSelect={() => {
                        const addr = c.contractAddress as Address;
                        setSelectedNftContract(addr);
                        setSelectedTokenId(c.tokenIds?.[0] ?? null);
                      }}
                    >
                      <span className="inline-flex w-4 items-center justify-center">
                        {selectedNftContract?.toLowerCase() === c.contractAddress.toLowerCase() ? "✓" : ""}
                      </span>
                      <span>{c.name?.trim() ? c.name : shortAddr(c.contractAddress)}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="grid min-w-0 gap-1">
              <label className="text-sm text-zinc-600" htmlFor={tokenIdSelectId}>
                tokenId
              </label>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger
                  asChild
                  disabled={loadingNfts || !selectedCollection || !(selectedCollection?.tokenIds?.length ?? 0)}
                >
                  <button
                    id={tokenIdSelectId}
                    type="button"
                    className="h-10 w-full min-w-0 cursor-pointer rounded-xl border border-zinc-300/90 bg-gradient-to-b from-white to-zinc-50 px-3 font-mono text-left text-sm text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(24,24,27,0.06)] outline-none transition-all duration-200 hover:border-zinc-400 hover:from-white hover:to-white focus-visible:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">{tokenLabel}</span>
                      <span className="shrink-0 text-sm text-zinc-500">▾</span>
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-72 min-w-[200px] overflow-auto">
                  {(selectedCollection?.tokenIds ?? []).map((id) => (
                    <DropdownMenuItem
                      key={id.toString()}
                      className="font-mono text-sm"
                      onSelect={() => setSelectedTokenId(id)}
                    >
                      <span className="inline-flex w-4 items-center justify-center">
                        {selectedTokenId !== null && id === selectedTokenId ? "✓" : ""}
                      </span>
                      <span>#{id.toString()}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-[140px_1fr] sm:items-start">
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
              {selectedNftMedia?.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selectedNftMedia.imageUrl}
                  alt={selectedNftMedia.title ?? "NFT image"}
                  className="h-[140px] w-full object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="grid h-[140px] place-items-center bg-[radial-gradient(circle_at_30%_20%,#eef2ff_0%,transparent_55%),radial-gradient(circle_at_80%_30%,#ecfeff_0%,transparent_55%),linear-gradient(180deg,#ffffff_0%,#fafafa_100%)]">
                  <div className="text-center text-xs text-zinc-500">
                    <div className="font-medium text-zinc-700">No image</div>
                    <div className="mt-1 font-mono">{selectedTokenId !== null ? `#${selectedTokenId}` : "—"}</div>
                  </div>
                </div>
              )}
            </div>

            <div className="min-w-0">
              <div className="text-xs text-zinc-500">Selected NFT</div>
              <div className="mt-1 truncate font-mono text-sm text-zinc-800" title={selectedNftContract ?? ""}>
                {selectedNftContract ?? "—"}
              </div>
              <div className="mt-1 text-sm text-zinc-700">
                {selectedNftMedia?.title ? (
                  <span className="font-medium">{selectedNftMedia.title}</span>
                ) : selectedTokenId !== null ? (
                  <span className="font-medium">tokenId #{selectedTokenId.toString()}</span>
                ) : (
                  "—"
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
