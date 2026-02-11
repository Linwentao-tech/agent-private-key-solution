import type { Address } from "viem";

function extractAlchemyKeyFromRpcUrl(rpcUrl?: string) {
  if (!rpcUrl) return null;
  // Example: https://eth-sepolia.g.alchemy.com/v2/<KEY>
  const m = rpcUrl.match(/alchemy\.com\/v2\/([^/?#]+)/i);
  return m?.[1] ?? null;
}

function getAlchemyApiKey() {
  return (
    process.env.NEXT_PUBLIC_ALCHEMY_API_KEY ||
    extractAlchemyKeyFromRpcUrl(process.env.NEXT_PUBLIC_RPC_URL)
  );
}

function getAlchemyNftBaseUrl() {
  // Keep it simple for now: this app is configured for Sepolia.
  // Mainnet equivalent would be: https://eth-mainnet.g.alchemy.com/nft/v3/<KEY>/getNFTsForOwner
  const apiKey = getAlchemyApiKey();
  if (!apiKey) {
    throw new Error(
      "Alchemy NFT API key not configured. Set NEXT_PUBLIC_ALCHEMY_API_KEY or use an Alchemy NEXT_PUBLIC_RPC_URL.",
    );
  }
  return `https://eth-sepolia.g.alchemy.com/nft/v3/${apiKey}/getNFTsForOwner`;
}

function parseTokenId(raw: unknown): bigint | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  try {
    if (s.startsWith("0x") || s.startsWith("0X")) return BigInt(s);
    if (/^\d+$/.test(s)) return BigInt(s);
    return null;
  } catch {
    return null;
  }
}

function asAddressOrNull(v: unknown): Address | null {
  if (typeof v !== "string") return null;
  if (!v.startsWith("0x")) return null;
  return v as Address;
}

export type OwnedCollection = {
  contractAddress: Address;
  name?: string;
  tokenIds: bigint[];
  // tokenId (decimal string) -> lightweight metadata
  tokenMedia?: Record<string, { title?: string; imageUrl?: string }>;
};

function ipfsToHttp(url: string): string {
  const s = url.trim();
  if (!s) return s;
  if (s.startsWith("ipfs://")) {
    // `ipfs://Qm...` or `ipfs://ipfs/Qm...`
    const path = s.replace("ipfs://", "");
    const clean = path.startsWith("ipfs/") ? path.slice("ipfs/".length) : path;
    return `https://ipfs.io/ipfs/${clean}`;
  }
  return s;
}

function pickImageUrl(it: any): string | null {
  // Alchemy NFT API v3 often provides: it.image.cachedUrl/thumbnailUrl/originalUrl/pngUrl
  const candidates: unknown[] = [
    it?.image?.cachedUrl,
    it?.image?.pngUrl,
    it?.image?.thumbnailUrl,
    it?.image?.originalUrl,
    it?.media?.[0]?.gateway,
    it?.media?.[0]?.raw,
    it?.raw?.metadata?.image,
    it?.metadata?.image,
  ];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const u = ipfsToHttp(c);
    if (u && /^https?:\/\//i.test(u)) return u;
  }
  return null;
}

export async function fetchOwnedCollectionsAlchemy(params: {
  owner: Address;
  withMetadata?: boolean;
  pageSize?: number;
}) {
  const base = getAlchemyNftBaseUrl();
  const ownedByContract = new Map<string, OwnedCollection>();

  let pageKey: string | undefined;
  const pageSize = params.pageSize ?? 100;
  const withMetadata = params.withMetadata ?? true;

  for (let i = 0; i < 50; i += 1) {
    const url = new URL(base);
    url.searchParams.set("owner", params.owner);
    url.searchParams.set("withMetadata", withMetadata ? "true" : "false");
    url.searchParams.set("pageSize", String(pageSize));
    if (pageKey) url.searchParams.set("pageKey", pageKey);

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Alchemy getNFTsForOwner failed: HTTP ${res.status} ${text}`);
    }
    const json = (await res.json()) as any;

    const items = (json?.ownedNfts ?? []) as any[];
    for (const it of items) {
      const contractAddr =
        asAddressOrNull(it?.contract?.address) ?? asAddressOrNull(it?.contractAddress);
      if (!contractAddr) continue;

      const tokenId = parseTokenId(it?.tokenId);
      if (tokenId === null) continue;

      const key = contractAddr.toLowerCase();
      const existing = ownedByContract.get(key) ?? {
        contractAddress: contractAddr,
        name: typeof it?.contract?.name === "string" ? it.contract.name : undefined,
        tokenIds: [] as bigint[],
        tokenMedia: {} as Record<string, { title?: string; imageUrl?: string }>,
      };
      existing.tokenIds.push(tokenId);

      // Best-effort image for UI preview.
      const tokenKey = tokenId.toString();
      const title =
        typeof it?.title === "string"
          ? it.title
          : typeof it?.name === "string"
            ? it.name
            : typeof it?.raw?.metadata?.name === "string"
              ? it.raw.metadata.name
              : undefined;
      const imageUrl = pickImageUrl(it) ?? undefined;
      if (existing.tokenMedia && (title || imageUrl)) {
        existing.tokenMedia[tokenKey] = { title, imageUrl };
      }

      ownedByContract.set(key, existing);
    }

    pageKey = json?.pageKey;
    if (!pageKey) break;
  }

  const collections = [...ownedByContract.values()].map((c) => {
    c.tokenIds.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return c;
  });
  collections.sort((a, b) => {
    const an = a.name ?? "";
    const bn = b.name ?? "";
    if (an && bn && an !== bn) return an.localeCompare(bn);
    if (a.contractAddress.toLowerCase() < b.contractAddress.toLowerCase()) return -1;
    if (a.contractAddress.toLowerCase() > b.contractAddress.toLowerCase()) return 1;
    return 0;
  });

  return collections;
}
