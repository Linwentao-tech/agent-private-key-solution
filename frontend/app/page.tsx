"use client";

import * as React from "react";
import type { Address } from "viem";
import {
  bytesToHex,
  decodeFunctionData,
  encodePacked,
  formatUnits,
  keccak256,
  parseAbi,
  parseAbiItem,
} from "viem";
import { sepolia } from "viem/chains";
import { useAccount, useConnect, useDisconnect, usePublicClient, useWalletClient } from "wagmi";
import { fetchOwnedCollectionsAlchemy, type OwnedCollection } from "../lib/nft";
import { AGENT6551_ABI, ERC20_ABI, ERC6551_REGISTRY_ABI, ERC721_ABI, MOCK_ERC20_ABI } from "../lib/contracts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { NftCard } from "./_components/NftCard";
import { SessionBuilderForm } from "./_components/SessionBuilderForm";
import { SkillInviteCard } from "./_components/SkillInviteCard";
import { TbaCard } from "./_components/TbaCard";
import { WalletCard } from "./_components/WalletCard";

const REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS as `0x${string}` | undefined;
const IMPLEMENTATION_ADDRESS = process.env
  .NEXT_PUBLIC_IMPLEMENTATION_ADDRESS as `0x${string}` | undefined;

function asAddressOrNull(v?: string): `0x${string}` | null {
  if (!v) return null;
  if (!v.startsWith("0x")) return null;
  return v as `0x${string}`;
}

const REGISTRY_ADDR = asAddressOrNull(REGISTRY_ADDRESS);
const IMPLEMENTATION_ADDR = asAddressOrNull(IMPLEMENTATION_ADDRESS);
const DEFAULT_SESSION_TARGET = "0x0829c21655B4E6332cb562CfD0667008023A2F2A";

const SALT_ZERO =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

function shortAddr(a?: string) {
  if (!a) return "";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function formatUnixSecLocal(mounted: boolean, v: any): string {
  if (!mounted) return "—";
  if (v === null || v === undefined) return "—";
  try {
    // viem often returns bigint for uint64/uint256.
    const asBig = typeof v === "bigint" ? v : BigInt(v?.toString?.() ?? String(v));
    // Seconds since epoch are safely representable as Number for any realistic expiry.
    const ms = Number(asBig) * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function formatUsdtUnits(v: any): string {
  if (v === null || v === undefined) return "—";
  try {
    const asBig = typeof v === "bigint" ? v : BigInt(v?.toString?.() ?? String(v));
    return formatUnits(asBig, 6);
  } catch {
    return "—";
  }
}

function selector4(data: `0x${string}`): `0x${string}` {
  if (!data || data.length < 10) return "0x" as `0x${string}`;
  return data.slice(0, 10) as `0x${string}`;
}

// JSON.stringify throws on bigint; this keeps localStorage snapshots robust even if a bigint slips in.
function stringifyJsonWithBigInt(v: any): string {
  return JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val));
}

function sanitizeConnectErrorMessage(err: unknown): string | null {
  const msg = (err as any)?.message ? String((err as any).message) : "";
  if (!msg) return null;
  const m = msg.toLowerCase();
  if (m.includes("user rejected") || m.includes("rejected the request") || m.includes("user denied")) {
    return null;
  }
  return msg;
}

const EVT_SESSION_CREATED = parseAbiItem(
  "event SessionCreated(bytes32 indexed sessionId, address indexed signer, uint64 validUntil, address budgetToken, uint256 maxTotal)",
);
const EVT_SESSION_ACTIVATED = parseAbiItem(
  "event SessionActivated(bytes32 indexed sessionId, address indexed signer)",
);
const EVT_SESSION_REVOKED = parseAbiItem("event SessionRevoked(bytes32 indexed sessionId)");
const EVT_SESSION_EXECUTED = parseAbiItem(
  "event SessionExecuted(bytes32 indexed sessionId, uint256 indexed nonce, uint256 spend, uint256 totalSpent)",
);

const ENTRYPOINT_V07_ABI = parseAbi([
  "function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops,address beneficiary)",
]);

const ENTRYPOINT_V06_ABI = parseAbi([
  "function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,uint256 callGasLimit,uint256 verificationGasLimit,uint256 preVerificationGas,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,bytes paymasterAndData,bytes signature)[] ops,address beneficiary)",
]);

const SIMPLE_ACCOUNT_ABI = parseAbi([
  "function execute(address dest,uint256 value,bytes func)",
  "function executeBatch(address[] dest,bytes[] func)",
]);

// Universal selectors we can name without knowing the target's ABI.
// This is not target-specific hardcoding; these are standard ERC20-style signatures.
const COMMON_SELECTOR_SIG: Record<string, string> = {
  "0x095ea7b3": "approve(address,uint256)",
  "0xa9059cbb": "transfer(address,uint256)",
  "0x23b872dd": "transferFrom(address,address,uint256)",
  "0x70a08231": "balanceOf(address)",
  "0xdd62ed3e": "allowance(address,address)",
};

export default function Page() {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const lastPersistRef = React.useRef<string>("");
  const [copiedSkill, setCopiedSkill] = React.useState(false);
  const [copiedSessionId, setCopiedSessionId] = React.useState<string | null>(null);
  const [skillUrl, setSkillUrl] = React.useState<string>("/skill.md");

  const { address, chain, isConnected, connector: activeConnector } = useAccount();
  const { connect, connectors, isPending: isConnecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const publicClient = usePublicClient({ chainId: sepolia.id });
  const { data: walletClient } = useWalletClient({ chainId: sepolia.id });
  const [showConnectorPicker, setShowConnectorPicker] = React.useState(false);
  const availableConnectors = React.useMemo(() => {
    const seen = new Set<string>();
    return connectors.filter((c) => {
      const key = `${c.id}:${c.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [connectors]);
  const connectorLabel = activeConnector?.name ?? "Not connected";
  const wrongChain = isConnected && chain?.id !== sepolia.id;

  React.useEffect(() => {
    if (isConnected) setShowConnectorPicker(false);
  }, [isConnected]);

  const [collections, setCollections] = React.useState<OwnedCollection[]>([]);
  const [loadingNfts, setLoadingNfts] = React.useState(false);
  const [nftError, setNftError] = React.useState<string | null>(null);

  const [selectedNftContract, setSelectedNftContract] = React.useState<Address | null>(null);
  const [selectedTokenId, setSelectedTokenId] = React.useState<bigint | null>(null);
  const selectedNftContractRef = React.useRef<Address | null>(null);
  const selectedTokenIdRef = React.useRef<bigint | null>(null);
  const [tbaAddress, setTbaAddress] = React.useState<Address | null>(null);
  const [tbaDeployed, setTbaDeployed] = React.useState<boolean | null>(null);
  const [tbaBusy, setTbaBusy] = React.useState(false);
  const [tbaCreateKey, setTbaCreateKey] = React.useState<string | null>(null);
  const [tbaRefreshing, setTbaRefreshing] = React.useState(false);
  const [tbaErr, setTbaErr] = React.useState<string | null>(null);

  const tbaReqIdRef = React.useRef(0);
  const [tbaResolvedKey, setTbaResolvedKey] = React.useState<string | null>(null);
  const [tbaPendingKey, setTbaPendingKey] = React.useState<string | null>(null);

  const selectedNftKey = React.useMemo(() => {
    if (!selectedNftContract || selectedTokenId === null) return null;
    return `${selectedNftContract.toLowerCase()}:${selectedTokenId.toString()}`;
  }, [selectedNftContract, selectedTokenId]);

  const tbaMatchesSelection = Boolean(selectedNftKey && tbaResolvedKey === selectedNftKey);
  const tbaIsCurrent = tbaMatchesSelection && !!tbaAddress;
  const sessionPanelReady = isConnected && !wrongChain && tbaMatchesSelection && !!tbaAddress && tbaDeployed === true;

  React.useEffect(() => {
    selectedNftContractRef.current = selectedNftContract;
    selectedTokenIdRef.current = selectedTokenId;
  }, [selectedNftContract, selectedTokenId]);

  const [nftOwner, setNftOwner] = React.useState<Address | null>(null);
  const [isNftOwner, setIsNftOwner] = React.useState<boolean | null>(null);

  const [sessionLabel, setSessionLabel] = React.useState<string>("session-1");
  const [sessionValidForMin, setSessionValidForMin] = React.useState<string>("15");
  // Fixed "USDT-like" demo token address on Sepolia (6 decimals).
  const USDT_ADDRESS = "0x7169D38820dfd117C3FA1f22a697dBA58d90BA06" as const;
  const [sessionMaxTotalUsdt, setSessionMaxTotalUsdt] = React.useState<string>("1");
  const [sessionTargets, setSessionTargets] = React.useState<string>(DEFAULT_SESSION_TARGET);
  const [sessionIdHex, setSessionIdHex] = React.useState<`0x${string}` | null>(null);
  const [sessionIdSalt, setSessionIdSalt] = React.useState<`0x${string}` | null>(null); // bytes32
  const [sessionIdTsSec, setSessionIdTsSec] = React.useState<bigint | null>(null);
  const [sessionTxHash, setSessionTxHash] = React.useState<`0x${string}` | null>(null);
  const [sessionReadback, setSessionReadback] = React.useState<any>(null);
  const [sessionErr, setSessionErr] = React.useState<string | null>(null);
  const [sessionBusy, setSessionBusy] = React.useState(false);
  const [sessionPrompt, setSessionPrompt] = React.useState<string | null>(null);
  const [copiedSessionPrompt, setCopiedSessionPrompt] = React.useState(false);

  const [sessionIds, setSessionIds] = React.useState<`0x${string}`[]>([]);
  const [sessionsLoading, setSessionsLoading] = React.useState(false);
  const [sessionsErr, setSessionsErr] = React.useState<string | null>(null);
  const [sessionsById, setSessionsById] = React.useState<Record<string, any>>({});

  type SessionLogEntry = {
    blockNumber: bigint;
    logIndex: number;
    txHash: `0x${string}`;
    event: "SessionCreated" | "SessionActivated" | "SessionExecuted" | "SessionRevoked";
    args: any;
  };
  const [logSessionId, setLogSessionId] = React.useState<`0x${string}` | null>(null);
  const [sessionLogs, setSessionLogs] = React.useState<SessionLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = React.useState(false);
  const [, setLogsErr] = React.useState<string | null>(null);
  const lastLogsToBlockRef = React.useRef<bigint | null>(null);
  const [txMethodByHash, setTxMethodByHash] = React.useState<Record<string, string>>({});
  const txMethodPendingRef = React.useRef<Set<string>>(new Set());
  const [txTargetByHash, setTxTargetByHash] = React.useState<Record<string, `0x${string}`>>({});
  const [txSelectorByHash, setTxSelectorByHash] = React.useState<Record<string, `0x${string}`>>({});
  const [txOuterToByHash, setTxOuterToByHash] = React.useState<Record<string, `0x${string}`>>({});
  const [txOuterSelectorByHash, setTxOuterSelectorByHash] = React.useState<Record<string, `0x${string}`>>({});
  const [selectorSigByHex, setSelectorSigByHex] = React.useState<Record<string, string>>({});
  const selectorPendingRef = React.useRef<Set<string>>(new Set());
  const selectedLogSessionLabel = logSessionId
    ? `${logSessionId.slice(0, 10)}…${logSessionId.slice(-8)}`
    : sessionIds.length
      ? "Choose…"
      : "No sessions";

  const [usdtAllowance, setUsdtAllowance] = React.useState<bigint | null>(null);
  const [allowanceLoading, setAllowanceLoading] = React.useState(false);
  const [allowanceErr, setAllowanceErr] = React.useState<string | null>(null);
  const [approveBusy, setApproveBusy] = React.useState(false);
  const [resetBusy, setResetBusy] = React.useState(false);
  const [approveTx, setApproveTx] = React.useState<`0x${string}` | null>(null);
  const [approveAmountUsdt, setApproveAmountUsdt] = React.useState<string>("");
  const [walletUsdtBal, setWalletUsdtBal] = React.useState<bigint | null>(null);
  const [walletUsdtBalLoading, setWalletUsdtBalLoading] = React.useState(false);
  const [fundUsdtAmount, setFundUsdtAmount] = React.useState<string>("100");
  const [fundUsdtBusy, setFundUsdtBusy] = React.useState(false);
  const [fundUsdtTx, setFundUsdtTx] = React.useState<`0x${string}` | null>(null);
  const [fundUsdtErr, setFundUsdtErr] = React.useState<string | null>(null);
  const [usdtMintable, setUsdtMintable] = React.useState<boolean | null>(null);
  const [usdtMintableLoading, setUsdtMintableLoading] = React.useState(false);
  const [usdtMintFn, setUsdtMintFn] = React.useState<"mint" | "_mint" | null>(null);

  const sessionMaxTotalUnits = React.useMemo(() => {
    try {
      return parseUsdtToUnits(sessionMaxTotalUsdt);
    } catch {
      return null;
    }
  }, [sessionMaxTotalUsdt]);
  const maxTotalExceedsAllowance = Boolean(
    sessionMaxTotalUnits !== null && usdtAllowance !== null && sessionMaxTotalUnits > usdtAllowance,
  );
  const maxTotalAllowanceHint =
    usdtAllowance !== null ? `agent wallet amount: ${formatUsdtUnits(usdtAllowance)} USDT` : null;

  const promptSessionId = React.useMemo(
    () => (sessionIds.length ? (sessionIds[0] as `0x${string}`) : null),
    [sessionIds],
  );

  const derivedSessionPrompt = React.useMemo(() => {
    if (!tbaAddress || !promptSessionId) return null;
    return [
      `tba=${tbaAddress}`,
      `sessionId=${promptSessionId}`,
      `Call the buy function on contract 0x0829c21655B4E6332cb562CfD0667008023A2F2A to purchase item1, spending 20 USDT..`,
    ].join("\n");
  }, [tbaAddress, promptSessionId]);

  const missingEnv =
    !REGISTRY_ADDR || !IMPLEMENTATION_ADDR ? "Missing NEXT_PUBLIC_* env" : null;

  const MAX_TX_GAS = 5_000_000n;

  function gasWithBufferAndClamp(est: bigint, bufferBps: bigint = 2_000n, max: bigint = MAX_TX_GAS): bigint {
    // Add a safety buffer to avoid under-estimation; clamp so wallets don't auto-attach huge limits.
    let gas = est + (est * bufferBps) / 10_000n;
    if (gas < 21_000n) gas = 21_000n;
    if (gas > max) gas = max;
    return gas;
  }

  async function estimateContractGasClamped(params: {
    pc: any;
    address: Address;
    abi: any;
    functionName: string;
    args: any[];
    account: Address;
  }): Promise<bigint> {
    const { pc, address, abi, functionName, args, account } = params;
    // Prefer simulateContract: it tends to produce better estimates and clearer errors.
    try {
      const sim = await pc.simulateContract({
        address,
        abi,
        functionName,
        args,
        account,
        chain: sepolia,
      });
      const est = (sim as any)?.request?.gas;
      if (typeof est === "bigint" && est > 0n) return gasWithBufferAndClamp(est);
    } catch (e: any) {
      // If it looks like a real revert, surface it; otherwise fall back to estimateContractGas.
      const msg = (e?.shortMessage ?? e?.message ?? "").toLowerCase();
      if (msg.includes("revert")) throw e;
    }
    const est = (await pc.estimateContractGas({
      address,
      abi,
      functionName,
      args,
      account,
    })) as bigint;
    return gasWithBufferAndClamp(est);
  }

  React.useEffect(() => {
    if (!mounted) return;
    try {
      setSkillUrl(`${window.location.origin}/skill.md`);
    } catch {
      setSkillUrl("/skill.md");
    }
  }, [mounted]);

  const skillInviteText = `Read ${skillUrl} and follow the instructions to run inside this AA session.`;

  // Probe whether the configured "USDT" supports an open mint() (MockERC20).
  // If it isn't mintable, we disable the button to avoid users sending failing transactions.
  React.useEffect(() => {
    if (!mounted) return;
    if (!publicClient) return;
    if (!address) return;
    if (!isConnected || wrongChain) return;
    const pc = publicClient;
    const acct = address as Address;
    let cancelled = false;

    async function probeMintable() {
      setUsdtMintableLoading(true);
      try {
        // simulateContract gives clearer failures than sending a tx, and costs nothing.
        // Some mock tokens expose _mint() instead of mint(); try both.
        try {
          await pc.simulateContract({
            address: USDT_ADDRESS,
            abi: MOCK_ERC20_ABI,
            functionName: "_mint",
            args: [acct, 1n],
            account: acct,
            chain: sepolia,
          });
          if (!cancelled) {
            setUsdtMintable(true);
            setUsdtMintFn("_mint");
          }
          return;
        } catch {
          // fall through
        }

        await pc.simulateContract({
          address: USDT_ADDRESS,
          abi: MOCK_ERC20_ABI,
          functionName: "mint",
          args: [acct, 1n],
          account: acct,
          chain: sepolia,
        });
        if (!cancelled) {
          setUsdtMintable(true);
          setUsdtMintFn("mint");
        }
      } catch (e: any) {
        const msg = (e?.shortMessage ?? e?.message ?? String(e) ?? "").toLowerCase();
        // Only mark as "not mintable" when it looks like the function does not exist / selector mismatch.
        // A plain revert can also happen on mintable tokens (e.g. access control), so we treat that as "unknown".
        const looksUnsupported =
          msg.includes("does not exist") ||
          msg.includes("not found") ||
          msg.includes("unknown function") ||
          msg.includes("function selector") ||
          msg.includes("method not found") ||
          msg.includes("unsupported function") ||
          msg.includes("function selector");
        if (!cancelled) {
          setUsdtMintable(looksUnsupported ? false : null);
          if (looksUnsupported) setUsdtMintFn(null);
        }
      } finally {
        if (!cancelled) setUsdtMintableLoading(false);
      }
    }

    void probeMintable();
    return () => {
      cancelled = true;
    };
  }, [mounted, publicClient, address, isConnected, wrongChain, USDT_ADDRESS]);

  // Persist dashboard state so refresh keeps the last selections/content.
  React.useEffect(() => {
    if (!mounted) return;
    try {
      const raw = localStorage.getItem("aba.dashboard.v1");
      if (!raw) return;
      const parsed = JSON.parse(raw) as any;
      if (Array.isArray(parsed?.collections)) {
        const cols: OwnedCollection[] = parsed.collections
          .map((c: any) => ({
            contractAddress: c.contractAddress,
            name: c.name,
            tokenIds: Array.isArray(c.tokenIds) ? c.tokenIds.map((x: string) => BigInt(x)) : [],
          }))
          .filter((c: any) => typeof c.contractAddress === "string" && c.contractAddress.startsWith("0x"));
        setCollections(cols);
      }
      if (typeof parsed?.selectedNftContract === "string" && parsed.selectedNftContract.startsWith("0x")) {
        setSelectedNftContract(parsed.selectedNftContract);
      }
      if (typeof parsed?.selectedTokenId === "string") {
        setSelectedTokenId(parsed.selectedTokenId ? BigInt(parsed.selectedTokenId) : null);
      }

      // Session builder defaults (optional).
      if (typeof parsed?.sessionLabel === "string" && parsed.sessionLabel.trim()) {
        setSessionLabel(parsed.sessionLabel);
      }
      if (typeof parsed?.sessionValidForMin === "string" && /^\d+$/.test(parsed.sessionValidForMin)) {
        // If value isn't in our dropdown list, keep the current default.
        const allowed = new Set(["5", "15", "30", "60", "240", "1440", "10080"]);
        if (allowed.has(parsed.sessionValidForMin)) setSessionValidForMin(parsed.sessionValidForMin);
      }
      if (typeof parsed?.sessionMaxTotalUsdt === "string" && parsed.sessionMaxTotalUsdt.trim()) {
        setSessionMaxTotalUsdt(parsed.sessionMaxTotalUsdt);
      }
      if (typeof parsed?.sessionTargets === "string") {
        setSessionTargets(parsed.sessionTargets);
      }
    } catch {
      // ignore cache errors
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  React.useEffect(() => {
    if (!mounted) return;
    // Persist after render without depending on a fragile deps array (Fast Refresh friendly).
    // Use a stable snapshot string to avoid unnecessary writes.
    if (!lastPersistRef.current) lastPersistRef.current = "";
    try {
      const snapshot = stringifyJsonWithBigInt({
        collections: collections.map((c) => ({
          contractAddress: c.contractAddress,
          name: c.name,
          tokenIds: c.tokenIds.map((x) => x.toString()),
        })),
        selectedNftContract,
        selectedTokenId: selectedTokenId?.toString() ?? "",
        sessionLabel,
        sessionValidForMin,
        sessionMaxTotalUsdt,
        sessionTargets,
      });
      if (snapshot !== lastPersistRef.current) {
        lastPersistRef.current = snapshot;
        localStorage.setItem("aba.dashboard.v1", snapshot);
      }
    } catch {
      // ignore
    }
  });

  const walletLine = isConnected ? (address as string) : "Not connected";

  async function refreshNfts(opts?: { silent?: boolean }) {
    if (!address) return;
    const silent = !!opts?.silent;
    if (!silent) setLoadingNfts(true);
    if (!silent) setNftError(null);
    try {
      const cols = await fetchOwnedCollectionsAlchemy({
        owner: address as Address,
        withMetadata: true,
        pageSize: 100,
      });
      setCollections(cols);
      // Keep the user's current selection if it still exists after refresh.
      const curContract = selectedNftContractRef.current;
      const curTokenId = selectedTokenIdRef.current;

      let nextContract: Address | null =
        curContract &&
        cols.some((c) => c.contractAddress.toLowerCase() === curContract.toLowerCase())
          ? curContract
          : cols[0]?.contractAddress ?? null;

      const col = nextContract
        ? cols.find((c) => c.contractAddress.toLowerCase() === nextContract.toLowerCase()) ?? null
        : null;

      let nextTokenId: bigint | null =
        curTokenId !== null && col?.tokenIds?.some((id) => id === curTokenId)
          ? curTokenId
          : col?.tokenIds?.[0] ?? null;

      setSelectedNftContract(nextContract);
      setSelectedTokenId(nextTokenId);
    } catch (e: any) {
      setNftError(e?.message ?? String(e));
    } finally {
      if (!silent) setLoadingNfts(false);
    }
  }

  async function refreshTba(tokenId: bigint | null, opts?: { clear?: boolean }) {
    if (!publicClient) return;
    const clear = opts?.clear ?? false;
    setTbaErr(null);
    if (tokenId === null || !selectedNftContract) {
      // No selection: reset TBA state.
      setTbaPendingKey(null);
      setTbaResolvedKey(null);
      setTbaAddress(null);
      setTbaDeployed(null);
      return;
    }
    if (!REGISTRY_ADDR || !IMPLEMENTATION_ADDR) return;
    const key = `${selectedNftContract.toLowerCase()}:${tokenId.toString()}`;
    const reqId = (tbaReqIdRef.current += 1);
    setTbaRefreshing(true);
    setTbaPendingKey(key);
    if (clear) {
      // Keep the layout stable by not collapsing large dependent UI blocks.
      // Actions are gated by key-matching, so stale UI cannot be used accidentally.
      setTbaResolvedKey(null);
      setTbaDeployed(null);
    }
    try {
      const tba = (await publicClient.readContract({
        address: REGISTRY_ADDR,
        abi: ERC6551_REGISTRY_ABI,
        functionName: "account",
        args: [IMPLEMENTATION_ADDR, SALT_ZERO, BigInt(sepolia.id), selectedNftContract, tokenId],
      })) as Address;
      const code = await publicClient.getBytecode({ address: tba });
      const deployed = !!code && code !== "0x";
      if (reqId !== tbaReqIdRef.current) return;
      setTbaAddress(tba);
      setTbaDeployed(deployed);
      setTbaResolvedKey(key);
    } catch (e: any) {
      if (reqId !== tbaReqIdRef.current) return;
      setTbaErr(e?.message ?? String(e));
    } finally {
      if (reqId !== tbaReqIdRef.current) return;
      setTbaRefreshing(false);
      setTbaPendingKey(null);
    }
  }

  async function createTba() {
    if (!walletClient || !publicClient) return;
    if (!address) return;
    if (selectedTokenId === null) return;
    if (!selectedNftContract) return;
    if (!REGISTRY_ADDR || !IMPLEMENTATION_ADDR) return;
    const createKey = `${selectedNftContract.toLowerCase()}:${selectedTokenId.toString()}`;
    setTbaCreateKey(createKey);
    setTbaBusy(true);
    setTbaErr(null);
    try {
      const gas = await estimateContractGasClamped({
        pc: publicClient,
        address: REGISTRY_ADDR,
        abi: ERC6551_REGISTRY_ABI,
        functionName: "createAccount",
        args: [IMPLEMENTATION_ADDR, SALT_ZERO, BigInt(sepolia.id), selectedNftContract, selectedTokenId],
        account: address as Address,
      });
      const hash = await walletClient.writeContract({
        address: REGISTRY_ADDR,
        abi: ERC6551_REGISTRY_ABI,
        functionName: "createAccount",
        args: [IMPLEMENTATION_ADDR, SALT_ZERO, BigInt(sepolia.id), selectedNftContract, selectedTokenId],
        chain: sepolia,
        gas,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await refreshTba(selectedTokenId, { clear: false });
    } catch (e: any) {
      setTbaErr(e?.shortMessage ?? e?.message ?? String(e));
    } finally {
      setTbaBusy(false);
      setTbaCreateKey(null);
    }
  }

  React.useEffect(() => {
    if (!mounted) return;
    if (!isConnected || wrongChain) {
      setCollections([]);
      setSelectedNftContract(null);
      setSelectedTokenId(null);
      setTbaAddress(null);
      setTbaDeployed(null);
      setTbaResolvedKey(null);
      setTbaPendingKey(null);
      setTbaCreateKey(null);
      return;
    }
    // Silent auto-refresh so the "Refresh NFTs" button doesn't look like it was clicked.
    void refreshNfts({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, isConnected, wrongChain, address]);

  React.useEffect(() => {
    if (!mounted) return;
    if (!isConnected || wrongChain || !address) {
      setWalletUsdtBal(null);
      return;
    }
    // Silent initial fetch to avoid implying the manual Refresh button was clicked.
    void refreshWalletUsdtBalance({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, isConnected, wrongChain, address]);

  React.useEffect(() => {
    if (!mounted) return;
    // Recompute TBA on selection changes. Do not clear large dependent UI blocks; instead,
    // key-gate actions and swap in the new TBA once resolved.
    void refreshTba(selectedTokenId, { clear: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, selectedNftContract, selectedTokenId]);

  React.useEffect(() => {
    if (!mounted) return;
    // When switching NFTs, clear per-TBA derived UI so other panels don't momentarily show stale data.
    setUsdtAllowance(null);
    setApproveTx(null);
    setSessionTxHash(null);
    setSessionErr(null);
    setSessionPrompt(null);
    setSessionReadback(null);
    setCopiedSessionPrompt(false);
    setSessionIds([]);
    setSessionsById({});
    setSessionsErr(null);
    setLogSessionId(null);
    setSessionLogs([]);
    setLogsErr(null);
    lastLogsToBlockRef.current = null;
    setTxMethodByHash({});
    setTxTargetByHash({});
    setTxSelectorByHash({});
    setTxOuterToByHash({});
    setTxOuterSelectorByHash({});
    txMethodPendingRef.current = new Set();
    selectorPendingRef.current = new Set();
  }, [mounted, selectedNftKey]);

  const tbaBusyOnCurrentSelection = Boolean(
    tbaBusy && tbaCreateKey && selectedNftKey && tbaCreateKey === selectedNftKey,
  );
  const sessionShowSkeleton = Boolean(selectedTokenId !== null && !tbaIsCurrent);

  React.useEffect(() => {
    if (!mounted) return;
    if (!isConnected || wrongChain || !tbaIsCurrent || !tbaAddress) {
      setUsdtAllowance(null);
      setApproveTx(null);
      return;
    }
    // Silent auto-refresh so the "Refresh" button doesn't look like it was clicked.
    void refreshAllowance({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, isConnected, wrongChain, tbaIsCurrent, tbaAddress, address]);

  React.useEffect(() => {
    if (!mounted) return;
    if (!sessionPanelReady || isNftOwner !== true || !tbaAddress) {
      setLogSessionId(null);
      setSessionLogs([]);
      lastLogsToBlockRef.current = null;
      return;
    }
    // Keep Session Log selector in sync with "Your Sessions":
    // if selected session expired/removed, auto-switch to the first available one.
    if (!logSessionId) {
      if (sessionIds.length > 0) setLogSessionId(sessionIds[0]);
      return;
    }
    const stillExists = sessionIds.some((sid) => sid.toLowerCase() === logSessionId.toLowerCase());
    if (!stillExists) {
      setLogSessionId(sessionIds.length > 0 ? sessionIds[0] : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, sessionPanelReady, isNftOwner, tbaAddress, sessionIds, logSessionId]);

  React.useEffect(() => {
    if (!mounted) return;
    setSessionLogs([]);
    setLogsErr(null);
    lastLogsToBlockRef.current = null;
    // Reset decoded call cache so function names are recalculated per-session / per-refresh.
    setTxMethodByHash({});
    setTxTargetByHash({});
    setTxSelectorByHash({});
    setTxOuterToByHash({});
    setTxOuterSelectorByHash({});
    if (!logSessionId) return;
    if (!sessionPanelReady || !tbaIsCurrent || !tbaAddress) return;
    // Silent auto-load so the "Load recent" button doesn't look like it was clicked.
    void loadRecentSessionLogs({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, logSessionId, sessionPanelReady, tbaIsCurrent, tbaAddress]);

  React.useEffect(() => {
    if (!mounted) return;
    if (!publicClient) return;
    if (!sessionPanelReady || !tbaIsCurrent || !tbaAddress) return;
    if (!logSessionId) return;
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const latest = await publicClient.getBlockNumber();
        const last = lastLogsToBlockRef.current;
        const from = last === null ? (latest > 20n ? latest - 20n : 0n) : last + 1n;
        if (from > latest) return;
        const logs = await fetchSessionLogsRange(from, latest);
        if (cancelled) return;
        if (logs.length) setSessionLogs((prev) => mergeAndSortLogs(prev, logs));
        if (logs.some((l) => l.event === "SessionExecuted" || l.event === "SessionRevoked")) {
          void refreshSessionById(logSessionId);
        }
        lastLogsToBlockRef.current = latest;
      } catch (e: any) {
        if (cancelled) return;
        setLogsErr(e?.shortMessage ?? e?.message ?? String(e));
      }
    };
    const id = setInterval(() => void poll(), 6000);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
	  }, [mounted, logSessionId, sessionPanelReady, tbaIsCurrent, tbaAddress]);

  // Session logs are fetched via events, but the user usually wants the concrete function name.
  // We resolve it from the transaction input. For executeWithSession/execute, we also show the *target* call
  // as `target.fnSig` when possible (best-effort): if we can't resolve the selector, we show the 4-byte selector.
  React.useEffect(() => {
    if (!publicClient) return;
    if (!sessionLogs.length) return;

    const uniq: string[] = [];
    const seen = new Set<string>();
    for (const l of sessionLogs) {
      const h = l?.txHash;
      if (!h) continue;
      if (seen.has(h)) continue;
      seen.add(h);
      uniq.push(h);
    }

    const pending = txMethodPendingRef.current;
    const toResolve = uniq.filter((h) => !txMethodByHash[h] && !pending.has(h));
    if (!toResolve.length) return;

    let cancelled = false;
    void (async () => {
      // Bound work per render to keep the UI responsive.
      const BATCH = 12;
      for (const h of toResolve.slice(0, BATCH)) {
        pending.add(h);
        try {
          const tx = (await publicClient.getTransaction({ hash: h as `0x${string}` })) as any;
          const data = (tx?.input ?? tx?.data ?? "0x") as `0x${string}`;
          const toAddr = (tx?.to ?? null) as `0x${string}` | null;
          const outerSelector = selector4(data);

          const decodeTargetFromAgentCall = (agentCallData: `0x${string}`): boolean => {
            try {
              const d = decodeFunctionData({ abi: AGENT6551_ABI, data: agentCallData });
              if (d.functionName === "executeWithSession") {
                const argsAny = d.args as any;
                const req = (argsAny?.[0] ?? argsAny?.req) as any;
                const to = req?.to as `0x${string}` | undefined;
                const inner = (req?.data ?? "0x") as `0x${string}`;
                const sel = selector4(inner);
                if (to) setTxTargetByHash((prev) => (prev[h] ? prev : { ...prev, [h]: to }));
                if (sel && sel !== "0x") setTxSelectorByHash((prev) => (prev[h] ? prev : { ...prev, [h]: sel }));
                setTxMethodByHash((prev) => (prev[h] ? prev : { ...prev, [h]: "executeWithSession" }));
                return true;
              }
              if (d.functionName === "execute") {
                const argsAny = d.args as any;
                const to = argsAny?.[0] as `0x${string}` | undefined;
                const inner = (argsAny?.[2] ?? "0x") as `0x${string}`;
                const sel = selector4(inner);
                if (to) setTxTargetByHash((prev) => (prev[h] ? prev : { ...prev, [h]: to }));
                if (sel && sel !== "0x") setTxSelectorByHash((prev) => (prev[h] ? prev : { ...prev, [h]: sel }));
                setTxMethodByHash((prev) => (prev[h] ? prev : { ...prev, [h]: "execute" }));
                return true;
              }
              if (d.functionName === "activateSessionBySig") {
                setTxMethodByHash((prev) => (prev[h] ? prev : { ...prev, [h]: "activateSessionBySig" }));
                return true;
              }
              if (d.functionName === "activateSession") {
                setTxMethodByHash((prev) => (prev[h] ? prev : { ...prev, [h]: "activateSession" }));
                return true;
              }
              return false;
            } catch {
              return false;
            }
          };

          if (toAddr) {
            setTxOuterToByHash((prev) => (prev[h] ? prev : { ...prev, [h]: toAddr }));
          }
          if (outerSelector && outerSelector !== "0x") {
            setTxOuterSelectorByHash((prev) => (prev[h] ? prev : { ...prev, [h]: outerSelector }));
          }

          // Never surface "unknown" in UI. If ABI decode fails, fall back to the 4-byte selector.
          let fn: string = outerSelector && outerSelector !== "0x" ? outerSelector : "0x????????";
          try {
            const decoded = decodeFunctionData({ abi: AGENT6551_ABI, data });
            fn = decoded.functionName;

            // Direct calls: decode inner target from TBA call itself.
            if (decoded.functionName === "executeWithSession" || decoded.functionName === "execute") {
              decodeTargetFromAgentCall(data);
            }
          } catch {
            // Not a direct TBA tx. Try decode as EntryPoint.handleOps (4337) -> SimpleAccount.execute -> TBA call.
            try {
              const ep =
                (() => {
                  try {
                    return decodeFunctionData({ abi: ENTRYPOINT_V07_ABI, data });
                  } catch {
                    return decodeFunctionData({ abi: ENTRYPOINT_V06_ABI, data });
                  }
                })() as any;

              if (ep?.functionName === "handleOps") {
                fn = "handleOps";
                const ops = (ep.args?.[0] ?? []) as any[];
                // Prefer an op whose inner call ultimately targets the selected TBA.
                for (const op of ops) {
                  const opCallData = (op?.callData ?? "0x") as `0x${string}`;
                  try {
                    const sa = decodeFunctionData({ abi: SIMPLE_ACCOUNT_ABI, data: opCallData }) as any;
                    if (sa.functionName === "execute") {
                      const dest = sa.args?.[0] as `0x${string}` | undefined;
                      const inner = (sa.args?.[2] ?? "0x") as `0x${string}`;
                      if (dest && tbaAddress && dest.toLowerCase() === tbaAddress.toLowerCase()) {
                        // inner is the TBA calldata
                        const ok = decodeTargetFromAgentCall(inner);
                        if (ok) break;
                      }
                    } else if (sa.functionName === "executeBatch") {
                      const dests = (sa.args?.[0] ?? []) as `0x${string}`[];
                      const inners = (sa.args?.[1] ?? []) as `0x${string}`[];
                      for (let i = 0; i < Math.min(dests.length, inners.length); i++) {
                        const dest = dests[i];
                        if (dest && tbaAddress && dest.toLowerCase() === tbaAddress.toLowerCase()) {
                          const ok = decodeTargetFromAgentCall(inners[i]);
                          if (ok) break;
                        }
                      }
                    }
                  } catch {
                    // ignore op decode failures
                  }
                }
              }
            } catch {
              // ignore decode failures
            }
          }
          if (!cancelled) setTxMethodByHash((prev) => (prev[h] ? prev : { ...prev, [h]: fn }));
        } catch {
          // If we couldn't even load the transaction, still show something stable.
          if (!cancelled) setTxMethodByHash((prev) => (prev[h] ? prev : { ...prev, [h]: "0x????????" }));
        } finally {
          pending.delete(h);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publicClient, sessionLogs, txMethodByHash]);

  // Best-effort selector -> text signature resolution (for arbitrary target contracts).
  React.useEffect(() => {
    const pending = selectorPendingRef.current;
    const selectors = [...Object.values(txSelectorByHash), ...Object.values(txOuterSelectorByHash)];
    const uniq = [...new Set(selectors.map((s) => (s || "").toLowerCase()).filter(Boolean))] as `0x${string}`[];
    const toResolve = uniq.filter((s) => !selectorSigByHex[s] && !pending.has(s));
    if (!toResolve.length) return;

    let cancelled = false;
    void (async () => {
      const BATCH = 8;
      for (const sel of toResolve.slice(0, BATCH)) {
        pending.add(sel);
        try {
          const resp = await fetch(`/api/4byte?hex=${encodeURIComponent(sel)}`);
          const j = (await resp.json()) as any;
          const sig = typeof j?.textSignature === "string" && j.textSignature.length ? j.textSignature : null;
          if (!cancelled && sig) {
            setSelectorSigByHex((prev) => (prev[sel] ? prev : { ...prev, [sel]: sig }));
          }
        } catch {
          // ignore (fallback stays selector)
        } finally {
          pending.delete(sel);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [txSelectorByHash, txOuterSelectorByHash, selectorSigByHex]);

  React.useEffect(() => {
    if (!mounted) return;
    if (!tbaAddress) return;
    if (!sessionIdSalt || sessionIdTsSec === null) {
      // Seed is generated lazily; user can regenerate at any time.
      const tsSec = BigInt(Math.floor(Date.now() / 1000));
      let salt: `0x${string}` | null = null;
      try {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        salt = bytesToHex(bytes) as `0x${string}`;
      } catch {
        salt = keccak256(encodePacked(["string", "uint256"], ["fallback", tsSec])) as `0x${string}`;
      }
      setSessionIdTsSec(tsSec);
      setSessionIdSalt(salt);
      return;
    }

    const packed = encodePacked(
      ["address", "string", "uint256", "bytes32"],
      [tbaAddress, sessionLabel, sessionIdTsSec, sessionIdSalt],
    );
    setSessionIdHex(keccak256(packed));
  }, [mounted, tbaAddress, sessionLabel, sessionIdSalt, sessionIdTsSec]);

  function regenerateSessionId() {
    if (!tbaAddress) return;
    const tsSec = BigInt(Math.floor(Date.now() / 1000));
    let salt: `0x${string}` | null = null;
    try {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      salt = bytesToHex(bytes) as `0x${string}`;
    } catch {
      salt = keccak256(encodePacked(["string", "uint256"], ["fallback", tsSec])) as `0x${string}`;
    }
    setSessionIdTsSec(tsSec);
    setSessionIdSalt(salt);
    const packed = encodePacked(
      ["address", "string", "uint256", "bytes32"],
      [tbaAddress, sessionLabel, tsSec, salt],
    );
    setSessionIdHex(keccak256(packed));
  }

  React.useEffect(() => {
    if (!mounted) return;
    if (!publicClient) return;
    if (!selectedNftContract || selectedTokenId === null) {
      setNftOwner(null);
      setIsNftOwner(null);
      return;
    }
    (async () => {
      try {
        const o = (await publicClient.readContract({
          address: selectedNftContract,
          abi: ERC721_ABI,
          functionName: "ownerOf",
          args: [selectedTokenId],
        })) as Address;
        setNftOwner(o);
        setIsNftOwner(address ? o.toLowerCase() === address.toLowerCase() : false);
      } catch {
        setNftOwner(null);
        setIsNftOwner(null);
      }
    })();
  }, [mounted, publicClient, selectedNftContract, selectedTokenId, address]);

  const selectedCollection = React.useMemo(() => {
    if (!selectedNftContract) return null;
    return (
      collections.find((c) => c.contractAddress.toLowerCase() === selectedNftContract.toLowerCase()) ??
      null
    );
  }, [collections, selectedNftContract]);

  const selectedNftMedia = React.useMemo(() => {
    if (!selectedCollection) return null;
    if (selectedTokenId === null) return null;
    const key = selectedTokenId.toString();
    return selectedCollection.tokenMedia?.[key] ?? null;
  }, [selectedCollection, selectedTokenId]);

  function parseTargets(raw: string): Address[] {
    const items = raw
      .split(/[,\n]/g)
      .map((x) => x.trim())
      .filter(Boolean);
    const out: Address[] = [];
    for (const it of items) {
      if (!it.startsWith("0x") || it.length !== 42) continue;
      out.push(it as Address);
    }
    return out;
  }

  function parseUsdtToUnits(raw: string, fieldLabel = "Max USDT"): bigint {
    const s = raw.trim();
    if (!s) throw new Error(`${fieldLabel} is required`);
    if (s.startsWith("-")) throw new Error(`${fieldLabel} must be >= 0`);
    if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`${fieldLabel} must be a number`);
    const [whole, fracRaw = ""] = s.split(".");
    const frac = (fracRaw + "000000").slice(0, 6); // USDT 6 decimals
    return BigInt(whole) * 1_000_000n + BigInt(frac);
  }

  function mergeAndSortLogs(prev: SessionLogEntry[], next: SessionLogEntry[]) {
    const seen = new Set<string>();
    const out: SessionLogEntry[] = [];
    for (const e of [...prev, ...next]) {
      const k = `${e.txHash}:${e.logIndex}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(e);
    }
    out.sort((a, b) => {
      if (a.blockNumber === b.blockNumber) return a.logIndex - b.logIndex;
      return a.blockNumber < b.blockNumber ? -1 : 1;
    });
    return out;
  }

  async function refreshSessions(opts?: { silent?: boolean }) {
    if (!mounted) return;
    if (!publicClient) return;
    if (!tbaIsCurrent || !tbaAddress) return;
    if (!address) return;
    if (isNftOwner !== true) {
      setSessionIds([]);
      setSessionsById({});
      return;
    }
    const silent = !!opts?.silent;
    if (!silent) setSessionsLoading(true);
    if (!silent) setSessionsErr(null);
    try {
      // Pull session ids directly from chain (requires msg.sender == token owner).
      const ids: `0x${string}`[] = [];
      const PAGE = 50n;
      let offset = 0n;
      for (let i = 0; i < 10; i++) {
        const page = (await publicClient.readContract({
          address: tbaAddress,
          abi: AGENT6551_ABI,
          functionName: "getActiveSessionIds",
          args: [offset, PAGE],
          account: address as Address,
        })) as `0x${string}`[];
        for (const sid of page) ids.push(sid);
        if (page.length < Number(PAGE)) break;
        offset += PAGE;
      }

      setSessionIds(ids);
      if (ids.length === 0) {
        setSessionsById({});
        return;
      }
      const reads = await Promise.allSettled(
        ids.map(async (sid) => {
          const s = await publicClient.readContract({
            address: tbaAddress,
            abi: AGENT6551_ABI,
            functionName: "sessions",
            args: [sid],
            account: address as Address,
          });
          return [sid, s] as const;
        }),
      );
      const next: Record<string, any> = {};
      for (const r of reads) {
        if (r.status !== "fulfilled") continue;
        const [sid, s] = r.value;
        next[sid] = s;
      }
      setSessionsById(next);
    } catch (e: any) {
      const msg = e?.shortMessage ?? e?.message ?? String(e);
      // If the call returns no data, treat it as "no sessions" instead of an alarming UI error.
      // This commonly happens when the TBA has no sessions yet (or RPC can't decode),
      // and the best UX is to show an empty list state.
      if (
        typeof msg === "string" &&
        msg.toLowerCase().includes("getactivesessionids") &&
        msg.toLowerCase().includes("returned no data") &&
        msg.includes('"0x"')
      ) {
        setSessionIds([]);
        setSessionsById({});
        setSessionsErr(null);
      } else {
        setSessionsErr(msg);
      }
    } finally {
      if (!silent) setSessionsLoading(false);
    }
  }

  async function refreshSessionById(sid: `0x${string}`) {
    if (!mounted) return;
    if (!publicClient) return;
    if (!tbaIsCurrent || !tbaAddress) return;
    if (!address) return;
    try {
      const s = await publicClient.readContract({
        address: tbaAddress,
        abi: AGENT6551_ABI,
        functionName: "sessions",
        args: [sid],
        account: address as Address,
      });
      setSessionsById((prev) => ({ ...prev, [sid]: s }));
    } catch {
      // ignore (UI can still be refreshed manually)
    }
  }

  async function fetchSessionLogsRange(fromBlock: bigint, toBlock: bigint) {
    if (!publicClient) return [] as SessionLogEntry[];
    if (!tbaIsCurrent || !tbaAddress) return [] as SessionLogEntry[];
    if (!logSessionId) return [] as SessionLogEntry[];
    const pc = publicClient;
    const tba = tbaAddress;
    const sid = logSessionId;

    async function fetchWithChunk(chunk: bigint): Promise<SessionLogEntry[]> {
      const all: SessionLogEntry[] = [];
      for (let start = fromBlock; start <= toBlock; start += chunk) {
        const end = start + chunk - 1n <= toBlock ? start + chunk - 1n : toBlock;
        const [created, activated, executed, revoked] = await Promise.all([
          pc.getLogs({
            address: tba,
            event: EVT_SESSION_CREATED,
            args: { sessionId: sid },
            fromBlock: start,
            toBlock: end,
          }),
          pc.getLogs({
            address: tba,
            event: EVT_SESSION_ACTIVATED,
            args: { sessionId: sid },
            fromBlock: start,
            toBlock: end,
          }),
          pc.getLogs({
            address: tba,
            event: EVT_SESSION_EXECUTED,
            args: { sessionId: sid },
            fromBlock: start,
            toBlock: end,
          }),
          pc.getLogs({
            address: tba,
            event: EVT_SESSION_REVOKED,
            args: { sessionId: sid },
            fromBlock: start,
            toBlock: end,
          }),
        ]);

        for (const l of created as any[]) {
          all.push({
            blockNumber: l.blockNumber,
            logIndex: Number(l.logIndex),
            txHash: l.transactionHash,
            event: "SessionCreated",
            args: l.args,
          });
        }
        for (const l of activated as any[]) {
          all.push({
            blockNumber: l.blockNumber,
            logIndex: Number(l.logIndex),
            txHash: l.transactionHash,
            event: "SessionActivated",
            args: l.args,
          });
        }
        for (const l of executed as any[]) {
          all.push({
            blockNumber: l.blockNumber,
            logIndex: Number(l.logIndex),
            txHash: l.transactionHash,
            event: "SessionExecuted",
            args: l.args,
          });
        }
        for (const l of revoked as any[]) {
          all.push({
            blockNumber: l.blockNumber,
            logIndex: Number(l.logIndex),
            txHash: l.transactionHash,
            event: "SessionRevoked",
            args: l.args,
          });
        }
      }
      return all;
    }

    // Prefer larger ranges to reduce request count; fall back if RPC rejects range/size.
    const chunkAttempts = [100n, 25n, 10n] as const;
    let lastErr: any = null;
    for (let i = 0; i < chunkAttempts.length; i++) {
      const chunk = chunkAttempts[i];
      try {
        return await fetchWithChunk(chunk);
      } catch (e: any) {
        lastErr = e;
        // Be tolerant of provider-specific failures (e.g. "HTTP request failed")
        // by progressively retrying with smaller block chunks.
        if (i === chunkAttempts.length - 1) throw e;
      }
    }
    throw lastErr;
  }

  async function loadRecentSessionLogs(opts?: { silent?: boolean }) {
    if (!mounted) return;
    if (!publicClient) return;
    if (!tbaIsCurrent || !tbaAddress) return;
    if (!logSessionId) return;

    const silent = !!opts?.silent;
    if (!silent) setLogsLoading(true);
    if (!silent) setLogsErr(null);
    try {
      const latest = await publicClient.getBlockNumber();
      const from = latest > 100n ? latest - 100n : 0n;
      const logs = await fetchSessionLogsRange(from, latest);
      setSessionLogs((prev) => mergeAndSortLogs(prev.length ? prev : [], logs));
      if (logs.some((l) => l.event === "SessionExecuted" || l.event === "SessionRevoked")) {
        void refreshSessionById(logSessionId);
      }
      lastLogsToBlockRef.current = latest;
    } catch (e: any) {
      setLogsErr(e?.shortMessage ?? e?.message ?? String(e));
    } finally {
      if (!silent) setLogsLoading(false);
    }
  }

  async function refreshAllowance(opts?: { silent?: boolean }) {
    if (!mounted) return;
    if (!publicClient) return;
    if (!tbaIsCurrent || !tbaAddress) return;
    if (!address) return;
    const silent = !!opts?.silent;
    if (!silent) setAllowanceLoading(true);
    if (!silent) setAllowanceErr(null);
    try {
      const a = (await publicClient.readContract({
        address: USDT_ADDRESS,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address as Address, tbaAddress],
      })) as bigint;
      setUsdtAllowance(a);
    } catch (e: any) {
      setAllowanceErr(e?.shortMessage ?? e?.message ?? String(e));
      setUsdtAllowance(null);
    } finally {
      if (!silent) setAllowanceLoading(false);
    }
  }

  async function refreshWalletUsdtBalance(opts?: { silent?: boolean }) {
    if (!mounted) return;
    if (!publicClient) return;
    if (!address) return;
    if (!isConnected || wrongChain) return;
    const silent = !!opts?.silent;
    if (!silent) setWalletUsdtBalLoading(true);
    try {
      const b = (await publicClient.readContract({
        address: USDT_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address as Address],
      })) as bigint;
      setWalletUsdtBal(b);
    } catch {
      setWalletUsdtBal(null);
    } finally {
      if (!silent) setWalletUsdtBalLoading(false);
    }
  }

  async function fundWalletUsdt() {
    if (!walletClient || !publicClient) return;
    if (!mounted) return;
    if (!address) return;
    if (!isConnected || wrongChain) return;
    if (usdtMintable === false) {
      setFundUsdtErr(
        `This "USDT" contract does not support mint()/_mint() from your wallet.\n` +
          `Use a faucet or transfer tokens to ${address} instead.\n` +
          `token: ${USDT_ADDRESS}`,
      );
      return;
    }
    setFundUsdtBusy(true);
    setFundUsdtErr(null);
    setFundUsdtTx(null);
    try {
      const amount = parseUsdtToUnits(fundUsdtAmount);
      if (amount <= 0n) throw new Error("Amount must be > 0");
      const mintFn: "mint" | "_mint" = usdtMintFn ?? "_mint";
      // Estimate gas explicitly; some RPCs/wallets otherwise attach an oversized gas limit (e.g. 21,000,000)
      // which can exceed node caps.
      const gasEst = await publicClient.estimateContractGas({
        address: USDT_ADDRESS,
        abi: MOCK_ERC20_ABI,
        functionName: mintFn,
        args: [address as Address, amount],
        account: address as Address,
      });
      // Add a small buffer, and clamp to avoid "gas limit too high" caps on some nodes.
      const gasWithBuffer = (gasEst * 12n) / 10n;
      const gasClamped = gasWithBuffer > 5_000_000n ? 5_000_000n : gasWithBuffer;
      const hash = await walletClient.writeContract({
        address: USDT_ADDRESS,
        abi: MOCK_ERC20_ABI,
        functionName: mintFn,
        args: [address as Address, amount],
        chain: sepolia,
        gas: gasClamped,
      });
      setFundUsdtTx(hash);
      await publicClient.waitForTransactionReceipt({ hash });
      // Silent refresh: avoid showing the manual Refresh button as if it was clicked.
      await refreshWalletUsdtBalance({ silent: true });
    } catch (e: any) {
      const msg = e?.shortMessage ?? e?.message ?? String(e);
      if (typeof msg === "string" && msg.toLowerCase().includes("revert")) {
        // Don't flip usdtMintable to false on revert; mint() might exist but be access-controlled.
        setFundUsdtErr(
          `${msg}\nIf mint() is access-controlled, you may need to use a faucet or transfer tokens to this wallet instead.`,
        );
      } else setFundUsdtErr(msg);
    } finally {
      setFundUsdtBusy(false);
    }
  }

  async function approveUsdtAmount(amountUnits: bigint) {
    if (!walletClient || !publicClient) return;
    if (!tbaIsCurrent || !tbaAddress) return;
    if (!address) return;
    const pc = publicClient;
    const wc = walletClient;
    const acct = address as Address;
    const spender = tbaAddress;
    setApproveBusy(true);
    setApproveTx(null);
    setAllowanceErr(null);
    try {
      async function readAllowanceOnDemand(): Promise<bigint> {
        // Don't rely solely on UI state; always have a chain-sourced value here.
        const a = (await pc.readContract({
          address: USDT_ADDRESS,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [acct, spender],
        })) as bigint;
        setUsdtAllowance(a);
        return a;
      }

      async function sendApprove(spender: Address, amount: bigint): Promise<`0x${string}`> {
        // Some wallets display "gas limit too low" when a transaction would revert or can't be simulated.
        // We simulate first to get a reliable revert reason and a reasonable gas estimate.
        let gas: bigint | undefined = undefined;
        try {
          const sim = await pc.simulateContract({
            address: USDT_ADDRESS,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [spender, amount],
            account: acct,
            chain: sepolia,
          });
          const est = sim.request.gas ?? 0n;
          if (est > 0n) {
            // A bit more padding than 20%: some RPCs under-estimate for tokens with extra checks.
            gas = (est * 15n) / 10n + 10_000n;
          }
        } catch (e: any) {
          // If simulation fails (rate limits / RPC quirks), fall back to estimateGas.
          try {
            const est = await pc.estimateContractGas({
              address: USDT_ADDRESS,
              abi: ERC20_ABI,
              functionName: "approve",
              args: [spender, amount],
              account: acct,
            });
            gas = (est * 15n) / 10n + 10_000n;
          } catch {
            gas = 250_000n; // conservative fallback for approve()
          }
          // Preserve the original error message if it looks like a real revert.
          const msg = e?.shortMessage ?? e?.message ?? "";
          if (typeof msg === "string" && msg.toLowerCase().includes("revert")) throw e;
        }

        return await wc.writeContract({
          address: USDT_ADDRESS,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [spender, amount],
          gas: gas ? gasWithBufferAndClamp(gas, 0n) : gas,
          chain: sepolia,
        });
      }

      const currentAllowance = await readAllowanceOnDemand();

      // USDT-style tokens often require: approve(spender, 0) before approve(spender, newAmount) when current != 0.
      // When this happens, wallets often show a misleading "gas limit" style error.
      if (currentAllowance > 0n && amountUnits > 0n) {
        const ok = window.confirm(
          "Current allowance is non-zero. Some tokens (like USDT) require resetting allowance to 0 before setting a new non-zero value. This will send 2 transactions. Continue?",
        );
        if (!ok) return;
        const hash0 = await sendApprove(spender, 0n);
        setApproveTx(hash0);
        await pc.waitForTransactionReceipt({ hash: hash0 });
      }

      const hash = await sendApprove(spender, amountUnits);
      setApproveTx(hash);
      await pc.waitForTransactionReceipt({ hash });
      await refreshAllowance({ silent: true });
    } catch (e: any) {
      setAllowanceErr(e?.shortMessage ?? e?.message ?? String(e));
    } finally {
      setApproveBusy(false);
    }
  }

  async function resetUsdtAllowanceToZero() {
    if (!walletClient || !publicClient) return;
    if (!tbaIsCurrent || !tbaAddress) return;
    if (!address) return;
    const pc = publicClient;
    const wc = walletClient;
    const acct = address as Address;
    setResetBusy(true);
    setApproveTx(null);
    setAllowanceErr(null);
    try {
      let gas: bigint | undefined = undefined;
      try {
        const sim = await pc.simulateContract({
          address: USDT_ADDRESS,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [tbaAddress, 0n],
          account: acct,
          chain: sepolia,
        });
        const est = sim.request.gas ?? 0n;
        if (est > 0n) gas = (est * 15n) / 10n + 10_000n;
      } catch {
        try {
          const est = await pc.estimateContractGas({
            address: USDT_ADDRESS,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [tbaAddress, 0n],
            account: acct,
          });
          gas = (est * 15n) / 10n + 10_000n;
        } catch {
          gas = 250_000n;
        }
      }
      const hash = await wc.writeContract({
        address: USDT_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [tbaAddress, 0n],
        gas: gas ? gasWithBufferAndClamp(gas, 0n) : gas,
        chain: sepolia,
      });
      setApproveTx(hash);
      await publicClient.waitForTransactionReceipt({ hash });
      await refreshAllowance({ silent: true });
    } catch (e: any) {
      setAllowanceErr(e?.shortMessage ?? e?.message ?? String(e));
    } finally {
      setResetBusy(false);
    }
  }

  React.useEffect(() => {
    if (!mounted) return;
    if (!sessionPanelReady || isNftOwner !== true || !tbaAddress) {
      setSessionIds([]);
      setSessionsById({});
      return;
    }
    // Auto-load sessions when the selected TBA changes.
    void refreshSessions({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, sessionPanelReady, isNftOwner, tbaAddress]);

  async function createSession() {
    if (!walletClient || !publicClient) return;
    if (!sessionPanelReady) return;
    if (!tbaAddress) return;
    if (!address) return;
    if (isNftOwner !== true) {
      setSessionErr("Only the NFT owner can create a session on this TBA.");
      return;
    }
    const trimmedLabel = sessionLabel.trim();
    if (!trimmedLabel) {
      setSessionErr("Session Label is required.");
      return;
    }
    if (!sessionMaxTotalUsdt.trim()) {
      setSessionErr("Max Total (USDT) is required.");
      return;
    }
    const targetsRaw = parseTargets(sessionTargets);
    if (targetsRaw.length === 0) {
      setSessionErr("At least one Whitelist Target is required.");
      return;
    }

    setSessionBusy(true);
    setSessionErr(null);
    setSessionTxHash(null);
    setSessionReadback(null);
    setSessionPrompt(null);
    setCopiedSessionPrompt(false);
    try {
      // Always generate a fresh sessionId for each creation to avoid nonce/history collisions.
      const tsSec = BigInt(Math.floor(Date.now() / 1000));
      let salt: `0x${string}` | null = null;
      try {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        salt = bytesToHex(bytes) as `0x${string}`;
      } catch {
        salt = keccak256(encodePacked(["string", "uint256"], ["fallback", tsSec])) as `0x${string}`;
      }
      const packed = encodePacked(
        ["address", "string", "uint256", "bytes32"],
        [tbaAddress, trimmedLabel, tsSec, salt],
      );
      const sid = keccak256(packed);
      setSessionIdTsSec(tsSec);
      setSessionIdSalt(salt);
      setSessionIdHex(sid);

      const validForMin = Number(sessionValidForMin || "0");
      if (!Number.isFinite(validForMin) || validForMin <= 0) throw new Error("Valid For must be > 0");
      const validFor = validForMin * 60;
      const now = Math.floor(Date.now() / 1000);
      const validUntil = BigInt(now + validFor);

      const budgetToken = USDT_ADDRESS;

      const maxTotal = parseUsdtToUnits(sessionMaxTotalUsdt);
      if (usdtAllowance !== null && maxTotal > usdtAllowance) {
        throw new Error(`Max Total exceeds agent wallet amount (${formatUsdtUnits(usdtAllowance)} USDT).`);
      }
      const merged = new Map<string, Address>();
      for (const t of targetsRaw) merged.set(t.toLowerCase(), t);
      merged.set(budgetToken.toLowerCase(), budgetToken);
      const targets = [...merged.values()];
      if (targets.length === 0) throw new Error("targets must contain at least 1 address");

      const gas = await estimateContractGasClamped({
        pc: publicClient,
        address: tbaAddress,
        abi: AGENT6551_ABI,
        functionName: "createSession",
        args: [sid, validUntil, budgetToken, maxTotal, targets],
        account: address as Address,
      });
      const hash = await walletClient.writeContract({
        address: tbaAddress,
        abi: AGENT6551_ABI,
        functionName: "createSession",
        args: [sid, validUntil, budgetToken, maxTotal, targets],
        chain: sepolia,
        gas,
      });
      setSessionTxHash(hash);
      await publicClient.waitForTransactionReceipt({ hash });

      const s = await publicClient.readContract({
        address: tbaAddress,
        abi: AGENT6551_ABI,
        functionName: "sessions",
        args: [sid],
      });
      setSessionReadback(s);
      setSessionsById((prev) => ({ ...prev, [sid]: s }));
      await refreshSessions({ silent: true });

      // Generate a copyable prompt that satisfies public/skill.md requirements.
      // Keep it short and strictly include the required fields.
      setSessionPrompt(
        [
          `tba=${tbaAddress}`,
          `sessionId=${sid}`,
          `Call the buy function on contract 0x0829c21655B4E6332cb562CfD0667008023A2F2A to purchase item1, spending 20 USDT..`,
        ].join("\n"),
      );
    } catch (e: any) {
      setSessionErr(e?.shortMessage ?? e?.message ?? String(e));
    } finally {
      setSessionBusy(false);
    }
  }

  async function revokeSession(sid: `0x${string}`) {
    if (!walletClient || !publicClient) return;
    if (!sessionPanelReady) return;
    if (!tbaAddress) return;
    if (!address) return;
    if (isNftOwner !== true) return;
    setSessionsErr(null);
    try {
      const gas = await estimateContractGasClamped({
        pc: publicClient,
        address: tbaAddress,
        abi: AGENT6551_ABI,
        functionName: "revokeSession",
        args: [sid],
        account: address as Address,
      });
      const hash = await walletClient.writeContract({
        address: tbaAddress,
        abi: AGENT6551_ABI,
        functionName: "revokeSession",
        args: [sid],
        chain: sepolia,
        gas,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      // Optimistic UI: mark revoked immediately, then refresh in background.
      setSessionsById((prev) => {
        const cur = prev[sid];
        if (!cur) return prev;
        // cur is a tuple-like array: [signer, validUntil, maxTotal, spent, budgetToken, revoked]
        const next = [...cur];
        next[5] = true;
        return { ...prev, [sid]: next };
      });
      void refreshSessions({ silent: true });
    } catch (e: any) {
      setSessionsErr(e?.shortMessage ?? e?.message ?? String(e));
    }
  }

  return (
    <div className="min-h-[100svh] bg-[radial-gradient(circle_at_20%_10%,#f5f0ff_0%,transparent_50%),radial-gradient(circle_at_80%_0%,#e8fff7_0%,transparent_45%),linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] px-5 pb-10 pt-0 text-zinc-900">
      <div className="sticky top-0 z-20 -mx-5 border-b border-zinc-200 bg-white/70 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1800px] items-center justify-between px-5 py-3">
          <div className="flex items-baseline gap-3">
            
            
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="bg-white text-zinc-700">
              {chain?.name ?? "Unknown"}
            </Badge>
            <Badge
              className={
                wrongChain
                  ? "bg-amber-100 text-amber-800 hover:bg-amber-100"
                  : "bg-emerald-100 text-emerald-800 hover:bg-emerald-100"
              }
              title={wrongChain ? "Switch network to Sepolia" : "Ready"}
            >
              {wrongChain ? "Wrong Network" : "Ready"}
            </Badge>

            {isConnected && address ? (
              <Badge variant="outline" className="bg-white font-mono text-zinc-700" suppressHydrationWarning>
                {shortAddr(address)}
              </Badge>
            ) : null}

            {!isConnected ? (
              <div className="relative">
                <Button
                  type="button"
                  size="sm"
                  className="w-auto whitespace-nowrap px-3 rounded-xl bg-zinc-900 text-xs text-white hover:bg-zinc-800 disabled:opacity-60"
                  onClick={() => setShowConnectorPicker((v) => !v)}
                  disabled={isConnecting || availableConnectors.length === 0}
                  title={availableConnectors.length === 0 ? "No wallet detected" : "Choose a wallet"}
                >
                  {isConnecting ? "Connecting…" : "Connect"}
                </Button>

                {showConnectorPicker ? (
                  <div className="absolute right-0 top-[calc(100%+8px)] z-30 min-w-[220px] rounded-xl border border-zinc-200 bg-white p-2 shadow-lg">
                    <div className="px-2 py-1 text-xs font-medium text-zinc-500">Choose wallet</div>
                    <div className="mt-1 grid gap-1">
                      {availableConnectors.map((c) => (
                        <button
                          key={`${c.id}:${c.name}`}
                          type="button"
                          className="w-full cursor-pointer whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-sm text-zinc-800 transition-all duration-200 ease-out transform-gpu hover:-translate-y-0.5 hover:bg-zinc-50 hover:shadow-sm active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => {
                            setShowConnectorPicker(false);
                            connect({ connector: c });
                          }}
                          disabled={isConnecting}
                          title={`Connect with ${c.name}`}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-auto whitespace-nowrap px-3 rounded-xl border border-zinc-300 bg-white text-xs hover:bg-zinc-50"
                onClick={() => {
                  setShowConnectorPicker(false);
                  disconnect();
                }}
                title="Disconnect wallet"
              >
                Disconnect
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[2100px]">
        <header className="pt-8">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
            Bind an Agent to Your NFT
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
            Create a token-bound agent identity and grant spend-limited sessions for safe onchain actions.
            
          </p>
        </header>

        <div className="mt-8 grid gap-6 lg:grid-cols-12 lg:items-start">
          <SkillInviteCard
            skillUrl={skillUrl}
            mounted={mounted}
            copiedSkill={copiedSkill}
            setCopiedSkill={setCopiedSkill}
            skillInviteText={skillInviteText}
          />

          {isConnected ? (
            <>
	          {missingEnv ? (
	            <Alert className="lg:col-span-12" variant="destructive">
	              <AlertTitle>Missing frontend env</AlertTitle>
	              <AlertDescription>
	                Set <span className="font-mono">NEXT_PUBLIC_REGISTRY_ADDRESS</span>,{" "}
	                <span className="font-mono">NEXT_PUBLIC_IMPLEMENTATION_ADDRESS</span> (and optionally{" "}
	                <span className="font-mono">NEXT_PUBLIC_RPC_URL</span> /{" "}
	                <span className="font-mono">NEXT_PUBLIC_ALCHEMY_API_KEY</span>). See{" "}
	                <span className="font-mono">frontend/.env.local.example</span>.
	              </AlertDescription>
	            </Alert>
	          ) : null}

          <div className="grid gap-2 lg:col-span-8 lg:col-start-3">
            <div className="flex items-center justify-center gap-2">
              <Badge className="bg-zinc-900 text-white hover:bg-zinc-900">Step 1</Badge>
              <div className="text-sm text-zinc-700">Connect wallet and prepare balance</div>
            </div>
            <WalletCard
              isConnected={isConnected}
              wrongChain={wrongChain}
              chainName={chain?.name ?? "Unknown"}
              walletLine={walletLine}
              connectorLabel={connectorLabel}
              connectErrorMessage={sanitizeConnectErrorMessage(connectError)}
              walletUsdtBal={walletUsdtBal}
              walletUsdtBalLoading={walletUsdtBalLoading}
              refreshWalletUsdtBalance={() => void refreshWalletUsdtBalance()}
              formatUsdtUnits={formatUsdtUnits}
              fundUsdtAmount={fundUsdtAmount}
              setFundUsdtAmount={setFundUsdtAmount}
              fundUsdtBusy={fundUsdtBusy}
              fundWalletUsdt={() => void fundWalletUsdt()}
              walletClientPresent={!!walletClient}
              usdtMintableLoading={usdtMintableLoading}
              usdtMintable={usdtMintable}
              usdtMintFn={usdtMintFn}
              fundUsdtErr={fundUsdtErr}
              fundUsdtTx={fundUsdtTx}
            />
          </div>

          <div className="mx-auto grid w-full max-w-5xl gap-2 lg:col-span-12 lg:col-start-1">
            <div className="flex items-center justify-center gap-2">
              <Badge className="bg-zinc-900 text-white hover:bg-zinc-900">Step 2</Badge>
              <div className="text-sm text-zinc-700">Choose NFT collection and token</div>
            </div>
            <NftCard
              isConnected={isConnected}
              wrongChain={wrongChain}
              collections={collections}
              loadingNfts={loadingNfts}
              nftError={nftError}
              refreshNfts={() => void refreshNfts()}
              selectedNftContract={selectedNftContract}
              setSelectedNftContract={setSelectedNftContract}
              selectedTokenId={selectedTokenId}
              setSelectedTokenId={setSelectedTokenId}
              selectedCollection={selectedCollection}
              selectedNftMedia={selectedNftMedia}
            />
          </div>

          <div className="mx-auto grid w-full max-w-5xl gap-2 lg:col-span-12 lg:col-start-1">
            <div className="flex items-center justify-center gap-2">
              <Badge className="bg-zinc-900 text-white hover:bg-zinc-900">Step 3</Badge>
              <div className="text-sm text-zinc-700">Create agent wallet and set allowance</div>
            </div>
            <TbaCard
              registryAddr={REGISTRY_ADDR}
              implementationAddr={IMPLEMENTATION_ADDR}
              isConnected={isConnected}
              wrongChain={wrongChain}
              walletClientPresent={!!walletClient}
              selectedTokenId={selectedTokenId}
              tbaIsCurrent={tbaIsCurrent}
              tbaAddress={tbaAddress}
              tbaDeployed={tbaDeployed}
              tbaBusy={tbaBusyOnCurrentSelection}
              tbaRefreshing={tbaRefreshing}
              tbaErr={tbaErr}
              showSkeleton={selectedTokenId !== null && !tbaIsCurrent}
              createTba={() => void createTba()}
              refreshTba={() => void refreshTba(selectedTokenId, { clear: false })}
              isNftOwner={isNftOwner}
              allowanceLoading={allowanceLoading}
              usdtAllowance={usdtAllowance}
              formatAllowance={(v) => formatUnits(v, 6)}
              approveAmountUsdt={approveAmountUsdt}
              setApproveAmountUsdt={setApproveAmountUsdt}
              approveBusy={approveBusy}
              resetBusy={resetBusy}
              approveTx={approveTx}
              allowanceErr={allowanceErr}
              refreshAllowance={() => void refreshAllowance()}
              approveExactAmountFromString={() => {
                try {
                  const units = parseUsdtToUnits(approveAmountUsdt, "Approve Amount");
                  void approveUsdtAmount(units);
                } catch (e: any) {
                  setAllowanceErr(e?.message ?? String(e));
                }
              }}
              resetAllowanceToZero={() => void resetUsdtAllowanceToZero()}
            />
          </div>

          <div className="grid gap-2 lg:col-span-12 lg:col-start-1">
            <div className="flex items-center justify-center gap-2">
              <Badge className="bg-zinc-900 text-white hover:bg-zinc-900">Step 4</Badge>
              <div className="text-sm text-zinc-700">Create sessions and monitor agent activities</div>
            </div>
            <section className="relative mx-auto w-full rounded-2xl border border-zinc-200 bg-white/70 p-5 shadow-sm backdrop-blur">
              <div className={sessionShowSkeleton ? "pointer-events-none opacity-0" : ""}>
              

              <div className="mt-4 grid gap-3">
                <div className="rounded-xl border border-zinc-200 bg-white p-3 text-center text-sm text-zinc-700">
                  {!isConnected
                    ? "Connect your wallet first."
                    : wrongChain
                      ? "Switch your wallet network to Sepolia to manage sessions."
                      : selectedTokenId === null || !selectedNftContract
                        ? "Select an NFT to compute its agent wallet (TBA)."
                        : !tbaIsCurrent
                          ? "Computing the agent wallet for the selected NFT…"
                          : tbaDeployed === null
                            ? "Checking whether the agent wallet is deployed…"
                            : tbaDeployed !== true
                              ? "Deploy the agent wallet (TBA) before creating sessions."
                              : isNftOwner === null
                                ? "Checking NFT ownership…"
                                : isNftOwner === false
                                  ? "You're not the owner of this NFT. You can view, but only the owner can create/revoke sessions."
                                  : "Ready. Create spend-limited sessions for your agent."}
                </div>

                <fieldset disabled={!sessionPanelReady} className={sessionPanelReady ? "" : "opacity-60"}>
                  <div className="grid gap-3">
                    <div className="grid gap-1">
                      <div className="text-xs text-zinc-500">NFT Owner</div>
                      <div className="font-mono text-sm" suppressHydrationWarning>
                        {nftOwner ?? "—"}{" "}
                        {isNftOwner === true ? (
                          <Badge className="ml-2 bg-emerald-100 text-emerald-800 hover:bg-emerald-100">you</Badge>
                        ) : isNftOwner === false ? (
                          <Badge className="ml-2 bg-amber-100 text-amber-800 hover:bg-amber-100">not you</Badge>
                        ) : null}
                      </div>
                    </div>

	                  <div className="grid gap-3 2xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]">
                      <SessionBuilderForm
                        mounted={mounted}
                        sessionPanelReady={sessionPanelReady}
                        walletClientPresent={!!walletClient}
                        isNftOwner={isNftOwner}
                        sessionLabel={sessionLabel}
                        setSessionLabel={setSessionLabel}
                        regenerateSessionId={regenerateSessionId}
                        sessionValidForMin={sessionValidForMin}
                        setSessionValidForMin={setSessionValidForMin}
                        sessionMaxTotalUsdt={sessionMaxTotalUsdt}
                        setSessionMaxTotalUsdt={setSessionMaxTotalUsdt}
                        maxTotalExceedsAllowance={maxTotalExceedsAllowance}
                        maxTotalAllowanceHint={maxTotalAllowanceHint}
                        sessionTargets={sessionTargets}
                        setSessionTargets={setSessionTargets}
                        createSession={() => void createSession()}
                        sessionBusy={sessionBusy}
                        sessionTxHash={sessionTxHash}
                        sessionErr={sessionErr}
                        sessionPrompt={derivedSessionPrompt}
                        copiedSessionPrompt={copiedSessionPrompt}
                        setCopiedSessionPrompt={setCopiedSessionPrompt}
                      />

                      <div className="min-w-0 rounded-xl border border-zinc-200 bg-white p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-zinc-900">Your Sessions</div>
                          <Button
                            type="button"
                            variant="outline"
                            className="inline-flex w-auto whitespace-nowrap items-center justify-center rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60"
                            onClick={() => void refreshSessions()}
                            disabled={sessionsLoading || isNftOwner !== true}
                          >
                            {sessionsLoading ? "Refreshing…" : "Refresh"}
                          </Button>
                        </div>

                        <div className="mt-2 text-xs leading-5 text-zinc-500">
                          This list is fetched on-chain.
                        </div>

                        {sessionsErr ? <div className="mt-3 text-sm text-red-600">{sessionsErr}</div> : null}

                      <div className="mt-3">
                        {sessionIds.length === 0 ? (
                          <div className="grid min-h-[120px] place-items-center text-sm text-zinc-600">
                            No sessions recorded yet.
                          </div>
                        ) : (
                            <div className="max-w-full rounded-xl border border-zinc-200 bg-white">
                              <Table noScrollX className="w-full table-auto text-left text-sm">
                                <TableHeader className="sticky top-0 bg-zinc-50 text-xs text-zinc-600">
                                  <TableRow>
                                    <TableHead className="px-3 py-2 font-medium whitespace-normal">id</TableHead>
                                    <TableHead className="hidden px-3 py-2 font-medium whitespace-normal xl:table-cell">validUntil</TableHead>
                                    <TableHead className="px-3 py-2 font-medium whitespace-normal">spent / max</TableHead>
                                    <TableHead className="hidden px-3 py-2 font-medium whitespace-normal xl:table-cell">revoked</TableHead>
                                    <TableHead className="px-3 py-2 text-left font-medium whitespace-normal">action</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody className="divide-y divide-zinc-200 bg-white">
                                  {sessionIds.map((sid) => {
                                    const s = sessionsById[sid];
                                    const revoked = s ? Boolean(s[5]) : false;
                                    const spentStr = s ? `${formatUsdtUnits(s[3])} USDT` : "—";
                                    const maxStr = s ? `${formatUsdtUnits(s[2])} USDT` : "—";
                                    const validUntilLocal = s ? formatUnixSecLocal(mounted, s[1]) : "—";
                                    return (
                                      <TableRow key={sid}>
                                        <TableCell className="min-w-0 px-3 py-2 font-mono text-xs whitespace-normal" title={sid}>
                                          <button
                                            type="button"
                                            className="group min-w-0 cursor-pointer text-left disabled:cursor-not-allowed disabled:opacity-60"
                                            onClick={async () => {
                                              try {
                                                await navigator.clipboard.writeText(sid);
                                                setCopiedSessionId(sid);
                                                window.setTimeout(() => {
                                                  setCopiedSessionId((cur) => (cur === sid ? null : cur));
                                                }, 900);
                                              } catch {
                                                // ignore
                                              }
                                            }}
                                            disabled={!mounted}
                                            title={mounted ? "Click to copy session id" : "Loading…"}
                                          >
                                            <span className="inline-flex min-w-0 items-center gap-2">
                                              <span className="min-w-0 break-all underline decoration-zinc-300 underline-offset-2 transition-colors group-hover:decoration-zinc-600">
                                                {sid}
                                              </span>
                                              <span
                                                className={`inline-flex h-5 items-center rounded-full border px-2 text-[10px] font-medium transition-all ${
                                                  copiedSessionId === sid
                                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                                    : "border-transparent bg-transparent text-transparent"
                                                }`}
                                                aria-hidden={copiedSessionId !== sid}
                                              >
                                                Copied
                                              </span>
                                            </span>
                                          </button>
                                        </TableCell>
                                        <TableCell className="hidden min-w-0 px-3 py-2 font-mono text-xs whitespace-normal xl:table-cell">
                                          <span className="block break-words" title={s ? (s[1]?.toString?.() ?? String(s[1])) : ""}>
                                            {validUntilLocal}
                                          </span>
                                        </TableCell>
                                        <TableCell className="min-w-0 px-3 py-2 font-mono text-xs whitespace-normal">
                                          <span className="block break-words">
                                            {spentStr} / {maxStr}
                                          </span>
                                        </TableCell>
                                        <TableCell className="hidden px-3 py-2 text-xs whitespace-normal xl:table-cell">
                                          {s ? String(revoked) : "—"}
                                        </TableCell>
                                        <TableCell className="px-3 py-2 text-left">
                                          <Button
                                            type="button"
                                            variant="outline"
                                            className="w-auto whitespace-nowrap px-3 rounded-lg border border-zinc-300 bg-white py-1 text-xs font-medium hover:bg-zinc-50 disabled:opacity-60"
                                            onClick={() => void revokeSession(sid)}
                                            disabled={isNftOwner !== true || revoked}
                                          >
                                            Revoke
                                          </Button>
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 border-t border-zinc-200 pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-sm font-medium text-zinc-900">Session Log</div>
                        <Button
                          type="button"
                          variant="outline"
                          className="inline-flex w-auto whitespace-nowrap items-center justify-center rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-medium hover:bg-zinc-50 disabled:opacity-60"
                          onClick={() => {
                            setLogsErr(null);
                            setTxMethodByHash({});
                            setTxTargetByHash({});
                            setTxSelectorByHash({});
                            setTxOuterToByHash({});
                            setTxOuterSelectorByHash({});
                            void loadRecentSessionLogs();
                          }}
                          disabled={logsLoading || !logSessionId}
                        >
                          {logsLoading ? "Loading…" : "Load recent"}
                        </Button>
                      </div>

                      <div className="mt-3 grid gap-3">
                        <div className="grid gap-1">
                          <label className="text-xs font-medium text-zinc-600">Session</label>
                          <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild disabled={sessionIds.length === 0}>
                              <button
                                type="button"
                                className="h-10 w-full cursor-pointer rounded-xl border border-zinc-300/90 bg-gradient-to-b from-white to-zinc-50 px-3 font-mono text-left text-xs text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(24,24,27,0.06)] outline-none transition-all duration-200 hover:border-zinc-400 hover:from-white hover:to-white focus-visible:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <span className="flex items-center justify-between gap-2">
                                  <span className="min-w-0 truncate">{selectedLogSessionLabel}</span>
                                  <span className="shrink-0 text-sm text-zinc-500">▾</span>
                                </span>
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="max-h-72 min-w-[220px] overflow-auto rounded-xl border border-zinc-200 bg-white/95 p-1 shadow-lg backdrop-blur">
                              {sessionIds.map((sid) => (
                                <DropdownMenuItem
                                  key={sid}
                                  className="rounded-lg px-2 py-1.5 font-mono text-xs text-zinc-800 outline-none focus:bg-zinc-100 focus:text-zinc-900"
                                  onSelect={() => setLogSessionId(sid)}
                                >
                                  <span className="inline-flex w-4 items-center justify-center">
                                    {logSessionId === sid ? "✓" : ""}
                                  </span>
                                  <span>{sid.slice(0, 10)}…{sid.slice(-8)}</span>
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>

                      <div className="mt-3 rounded-xl border border-zinc-200 bg-white">
                        {logsLoading ? (
                          <div className="p-3">
                            <div className="animate-pulse space-y-2">
                              <div className="grid grid-cols-5 gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                                <div className="h-3 w-12 rounded bg-zinc-200" />
                                <div className="h-3 w-16 rounded bg-zinc-200" />
                                <div className="h-3 w-24 rounded bg-zinc-200" />
                                <div className="h-3 w-24 rounded bg-zinc-200" />
                                <div className="h-3 w-14 rounded bg-zinc-200" />
                              </div>
                              <div className="grid grid-cols-5 gap-2 rounded-lg px-3 py-2">
                                <div className="h-3 w-10 rounded bg-zinc-200" />
                                <div className="h-3 w-24 rounded bg-zinc-200" />
                                <div className="h-3 w-32 rounded bg-zinc-200" />
                                <div className="h-3 w-28 rounded bg-zinc-200" />
                                <div className="h-3 w-20 rounded bg-zinc-200" />
                              </div>
                              <div className="grid grid-cols-5 gap-2 rounded-lg px-3 py-2">
                                <div className="h-3 w-12 rounded bg-zinc-200" />
                                <div className="h-3 w-20 rounded bg-zinc-200" />
                                <div className="h-3 w-28 rounded bg-zinc-200" />
                                <div className="h-3 w-24 rounded bg-zinc-200" />
                                <div className="h-3 w-16 rounded bg-zinc-200" />
                              </div>
                              <div className="grid grid-cols-5 gap-2 rounded-lg px-3 py-2">
                                <div className="h-3 w-9 rounded bg-zinc-200" />
                                <div className="h-3 w-16 rounded bg-zinc-200" />
                                <div className="h-3 w-36 rounded bg-zinc-200" />
                                <div className="h-3 w-24 rounded bg-zinc-200" />
                                <div className="h-3 w-20 rounded bg-zinc-200" />
                              </div>
                            </div>
                          </div>
                        ) : sessionLogs.length === 0 ? (
                          <div className="grid min-h-[120px] place-items-center p-3 text-sm text-zinc-600">No logs yet.</div>
                        ) : (
                          <Table noScrollX className="w-full table-auto text-left text-sm">
                            <TableHeader className="sticky top-0 bg-zinc-50 text-xs text-zinc-600">
                              <TableRow>
                                <TableHead className="px-3 py-2 font-medium">block</TableHead>
                                <TableHead className="px-3 py-2 font-medium">event</TableHead>
                                <TableHead className="px-3 py-2 font-medium">function</TableHead>
                                <TableHead className="px-3 py-2 font-medium">details</TableHead>
                                <TableHead className="px-3 py-2 font-medium">tx</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody className="divide-y divide-zinc-200 bg-white">
                              {sessionLogs.map((e) => {
                                const method = txMethodByHash[e.txHash] ?? e.event;
                                const target = txTargetByHash[e.txHash];
                                const innerSel = txSelectorByHash[e.txHash];
                                const outerSel = txOuterSelectorByHash[e.txHash];
                                const innerSelLc = innerSel?.toLowerCase();
                                const outerSelLc = outerSel?.toLowerCase();
                                const innerSig =
                                  (innerSelLc && (selectorSigByHex[innerSelLc] ?? COMMON_SELECTOR_SIG[innerSelLc])) || null;
                                const outerSig =
                                  (outerSelLc && (selectorSigByHex[outerSelLc] ?? COMMON_SELECTOR_SIG[outerSelLc])) || null;
                                const fnLabel =
                                  method === "executeWithSession" || method === "execute"
                                    ? innerSig || innerSel || method
                                    : method === "handleOps"
                                      ? innerSig || innerSel || "handleOps"
                                      : method.startsWith("0x")
                                        ? outerSig || method
                                        : method;
                                const fnDisplay = target && (method === "executeWithSession" || method === "execute" || method === "handleOps")
                                  ? `${shortAddr(target)}.${fnLabel}`
                                  : fnLabel;
                                const spend = e.event === "SessionExecuted" ? formatUsdtUnits((e.args as any)?.spend) : null;
                                const details =
                                  e.event === "SessionExecuted"
                                    ? `spend=${spend} USDT`
                                    : e.event === "SessionCreated"
                                      ? "created"
                                      : e.event === "SessionActivated"
                                        ? "activated"
                                        : "revoked";
                                return (
                                  <TableRow key={`${e.txHash}:${e.logIndex}`}>
                                    <TableCell className="px-3 py-2 font-mono text-xs">{e.blockNumber.toString()}</TableCell>
                                    <TableCell className="px-3 py-2 font-mono text-xs">{e.event}</TableCell>
                                    <TableCell className="px-3 py-2 font-mono text-xs">{fnDisplay}</TableCell>
                                    <TableCell className="px-3 py-2 font-mono text-xs">{details}</TableCell>
                                    <TableCell className="px-3 py-2 font-mono text-xs">
                                      {e.txHash.slice(0, 10)}…{e.txHash.slice(-8)}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        )}
                      </div>
                    </div>
                  </div>
                </fieldset>
              </div>
              </div>
              {sessionShowSkeleton ? (
                <div className="absolute inset-0 z-10 p-5">
                  <div className="h-full animate-pulse">
                    <div className="grid gap-1">
                      <div className="h-3 w-24 rounded bg-zinc-200" />
                      <div className="h-4 w-80 max-w-full rounded bg-zinc-200" />
                    </div>
                    <div className="mt-4 h-16 rounded-xl border border-zinc-200 bg-white" />
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-zinc-200 bg-white p-4">
                        <div className="h-3 w-32 rounded bg-zinc-200" />
                        <div className="mt-3 h-9 w-full rounded bg-zinc-200" />
                        <div className="mt-3 h-9 w-full rounded bg-zinc-200" />
                        <div className="mt-3 h-20 w-full rounded bg-zinc-200" />
                      </div>
                      <div className="rounded-xl border border-zinc-200 bg-white p-4">
                        <div className="h-3 w-40 rounded bg-zinc-200" />
                        <div className="mt-3 h-44 w-full rounded bg-zinc-200" />
                      </div>
                    </div>
                    <div className="mt-4 h-40 rounded-xl border border-zinc-200 bg-white" />
                  </div>
                </div>
	              ) : null}
	            </section>
	          </div>
            </>
          ) : null}

	        </div>

        
      </div>
    </div>
  );
}
