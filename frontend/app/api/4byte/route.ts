export const runtime = "nodejs";

type FourByteResult = {
  id: number;
  text_signature: string;
  hex_signature: string;
};

type FourByteResponse = {
  count: number;
  next: string | null;
  previous: string | null;
  results: FourByteResult[];
};

// Simple in-memory cache (good enough for a dashboard page).
const cache = new Map<string, { textSignature: string | null; ts: number }>();
const TTL_MS = 1000 * 60 * 60; // 1 hour

export async function GET(req: Request) {
  const url = new URL(req.url);
  const hex = (url.searchParams.get("hex") || "").toLowerCase();

  if (!/^0x[0-9a-f]{8}$/.test(hex)) {
    return Response.json({ textSignature: null, error: "Invalid selector" }, { status: 400 });
  }

  const now = Date.now();
  const cached = cache.get(hex);
  if (cached && now - cached.ts < TTL_MS) {
    return Response.json({ textSignature: cached.textSignature });
  }

  try {
    const upstream = `https://www.4byte.directory/api/v1/signatures/?hex_signature=${encodeURIComponent(hex)}`;
    const r = await fetch(upstream, { headers: { accept: "application/json" } });
    if (!r.ok) {
      cache.set(hex, { textSignature: null, ts: now });
      return Response.json({ textSignature: null }, { status: 200 });
    }
    const j = (await r.json()) as FourByteResponse;
    const sigs = (j?.results || [])
      .map((x) => x?.text_signature)
      .filter((s): s is string => typeof s === "string" && s.length > 0);

    // Heuristic: prefer the shortest signature (often the canonical one).
    const best = sigs.length ? sigs.slice().sort((a, b) => a.length - b.length)[0] : null;

    cache.set(hex, { textSignature: best, ts: now });
    return Response.json({ textSignature: best }, { status: 200 });
  } catch {
    cache.set(hex, { textSignature: null, ts: now });
    return Response.json({ textSignature: null }, { status: 200 });
  }
}

