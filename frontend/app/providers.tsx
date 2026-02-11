"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import type { State } from "wagmi";
import { wagmiConfig } from "../lib/wagmiConfig";

// React 19 dev instrumentation (and various tools) may JSON.stringify props/state for logs.
// JSON.stringify throws on `bigint` by default; adding BigInt#toJSON makes it serialize as a string.
if (typeof BigInt !== "undefined" && !(BigInt.prototype as any).toJSON) {
  (BigInt.prototype as any).toJSON = function toJSON() {
    return this.toString();
  };
}

const queryClient = new QueryClient();

export function Providers({
  children,
  initialState,
}: {
  children: React.ReactNode;
  initialState?: State;
}) {
  return (
    <WagmiProvider config={wagmiConfig} initialState={initialState}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
