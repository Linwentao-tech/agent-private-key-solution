"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

export function SessionBuilderForm(props: {
  mounted: boolean;
  sessionPanelReady: boolean;
  walletClientPresent: boolean;
  isNftOwner: boolean | null;

  sessionLabel: string;
  setSessionLabel: (v: string) => void;
  regenerateSessionId: () => void;

  sessionValidForMin: string;
  setSessionValidForMin: (v: string) => void;

  sessionMaxTotalUsdt: string;
  setSessionMaxTotalUsdt: (v: string) => void;
  maxTotalExceedsAllowance: boolean;
  maxTotalAllowanceHint: string | null;

  sessionTargets: string;
  setSessionTargets: (v: string) => void;

  createSession: () => void;
  sessionBusy: boolean;
  sessionTxHash: `0x${string}` | null;
  sessionErr: string | null;

  sessionPrompt: string | null;
  copiedSessionPrompt: boolean;
  setCopiedSessionPrompt: (v: boolean) => void;
}) {
  const {
    mounted,
    sessionPanelReady,
    walletClientPresent,
    isNftOwner,
    sessionLabel,
    setSessionLabel,
    regenerateSessionId,
    sessionValidForMin,
    setSessionValidForMin,
    sessionMaxTotalUsdt,
    setSessionMaxTotalUsdt,
    maxTotalExceedsAllowance,
    maxTotalAllowanceHint,
    sessionTargets,
    setSessionTargets,
    createSession,
    sessionBusy,
    sessionTxHash,
    sessionErr,
    sessionPrompt,
    copiedSessionPrompt,
    setCopiedSessionPrompt,
  } = props;
  const validForId = React.useId();
  const validForOptions = [
    { value: "5", label: "5 min" },
    { value: "15", label: "15 min" },
    { value: "30", label: "30 min" },
    { value: "60", label: "60 min" },
    { value: "240", label: "240 min" },
    { value: "1440", label: "1440 min (1 day)" },
    { value: "10080", label: "10080 min (7 days)" },
  ];
  const validForLabel = validForOptions.find((o) => o.value === sessionValidForMin)?.label ?? "Choose…";
  const [targetDraft, setTargetDraft] = React.useState("");
  const targetItems = React.useMemo(
    () =>
      sessionTargets
        .split(/[,\n]/g)
        .map((x) => x.trim())
        .filter(Boolean),
    [sessionTargets],
  );
  const draftIsAddress = /^0x[a-fA-F0-9]{40}$/.test(targetDraft.trim());

  function addTargetFromDraft() {
    const next = targetDraft.trim();
    if (!next) return;
    if (!/^0x[a-fA-F0-9]{40}$/.test(next)) return;
    const dedup = new Map<string, string>();
    for (const t of targetItems) dedup.set(t.toLowerCase(), t);
    dedup.set(next.toLowerCase(), next);
    setSessionTargets([...dedup.values()].join("\n"));
    setTargetDraft("");
  }

  function removeTarget(value: string) {
    const next = targetItems.filter((t) => t.toLowerCase() !== value.toLowerCase());
    setSessionTargets(next.join("\n"));
  }

  return (
    <div className="min-w-0 rounded-xl border border-zinc-200 bg-white p-4">
      <div className="text-sm font-medium text-zinc-900">Create Session</div>
      <div className="mt-1 text-xs text-zinc-500">
        Budget token is fixed to Sepolia USDT. We auto-include it as an allowed target.
      </div>

      <div className="mt-4 grid gap-3">
        <div className="grid gap-x-4 gap-y-3">
          <div className="grid min-w-0 gap-1">
            <label className="text-sm text-zinc-600">Session Label</label>
            <Input
              className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-zinc-900"
              value={sessionLabel}
              onChange={(e) => setSessionLabel(e.target.value)}
              placeholder="session-1"
              onBlur={regenerateSessionId}
            />
          </div>
          <div className="grid min-w-0 gap-1">
            <label className="text-sm text-zinc-600" htmlFor={validForId}>Valid For</label>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild disabled={!sessionPanelReady}>
                <button
                  id={validForId}
                  type="button"
                  className="h-10 w-full cursor-pointer rounded-xl border border-zinc-300/90 bg-gradient-to-b from-white to-zinc-50 px-3 font-mono text-left text-sm text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(24,24,27,0.06)] outline-none transition-all duration-200 hover:border-zinc-400 hover:from-white hover:to-white focus-visible:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate">{validForLabel}</span>
                    <span className="shrink-0 text-sm text-zinc-500">▾</span>
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[220px]">
                {validForOptions.map((opt) => (
                  <DropdownMenuItem
                    key={opt.value}
                    className="font-mono text-sm"
                    onSelect={() => setSessionValidForMin(opt.value)}
                  >
                    <span className="inline-flex w-4 items-center justify-center">
                      {sessionValidForMin === opt.value ? "✓" : ""}
                    </span>
                    <span>{opt.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="grid gap-1">
          <label className="text-sm text-zinc-600">Max Total (USDT)</label>
          <Input
            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-zinc-900"
            value={sessionMaxTotalUsdt}
            onChange={(e) => setSessionMaxTotalUsdt(e.target.value)}
            placeholder="1.5"
          />
          {maxTotalAllowanceHint ? (
            <div className={`text-xs ${maxTotalExceedsAllowance ? "text-red-600" : "text-zinc-500"}`}>
              {maxTotalExceedsAllowance
                ? `Max Total exceeds allowance. ${maxTotalAllowanceHint}`
                : maxTotalAllowanceHint}
            </div>
          ) : null}
        </div>

        <div className="grid gap-1">
          <label className="text-sm text-zinc-600 font-bold">Whitelist Targets</label>
          <div className="text-xs text-zinc-500">
            Example: 0x0829c21655B4E6332cb562CfD0667008023A2F2A (mock in-game shop contract used to purchase items with
            USDT), or any other address your agent may need to interact with.
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="h-9 min-w-[220px] flex-1 rounded-xl border border-zinc-300 bg-white px-3 font-mono text-sm outline-none focus:border-zinc-900"
                value={targetDraft}
                onChange={(e) => setTargetDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTargetFromDraft();
                  }
                }}
                placeholder="0x..."
                spellCheck={false}
              />
              <Button
                type="button"
                variant="outline"
                className="h-9 w-auto whitespace-nowrap rounded-xl border border-zinc-300 bg-white px-3 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60"
                onClick={addTargetFromDraft}
                disabled={!draftIsAddress}
                title="Add target"
              >
                + Add
              </Button>
            </div>

            {!targetDraft.trim() || draftIsAddress ? null : (
              <div className="mt-2 text-xs text-red-600">Address format must be 0x + 40 hex chars.</div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {targetItems.length === 0 ? (
              <div className="text-xs text-zinc-500">No targets added.</div>
              ) : (
                targetItems.map((t) => (
                  <div
                    key={t.toLowerCase()}
                    className="inline-flex max-w-full items-center gap-2 rounded-xl border border-zinc-200 bg-white px-2 py-1"
                  >
                    <span className="truncate font-mono text-xs text-zinc-800" title={t}>
                      {t}
                    </span>
                    <button
                      type="button"
                      className="cursor-pointer rounded-md px-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
                      onClick={() => removeTarget(t)}
                      title="Remove target"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            className="inline-flex w-auto whitespace-nowrap items-center justify-center rounded-xl bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
            onClick={createSession}
            disabled={sessionBusy || !walletClientPresent || isNftOwner !== true || maxTotalExceedsAllowance}
            title={isNftOwner !== true ? "Only NFT owner can create sessions" : "Create session"}
          >
            {sessionBusy ? "Creating…" : "Create Session"}
          </Button>
          {sessionTxHash ? (
            <div className="max-w-full break-all font-mono text-xs text-zinc-600">tx: {sessionTxHash}</div>
          ) : null}
        </div>

        {sessionErr ? <div className="text-sm text-red-600">{sessionErr}</div> : null}

        {sessionPrompt ? (
          <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-medium text-zinc-600">Agent Prompt Example:</div>
              <Button
                type="button"
                variant="outline"
                className="inline-flex w-auto whitespace-nowrap items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 py-1 text-[11px] font-medium hover:bg-zinc-50 disabled:opacity-60"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(sessionPrompt);
                    setCopiedSessionPrompt(true);
                    window.setTimeout(() => setCopiedSessionPrompt(false), 900);
                  } catch {
                    // ignore
                  }
                }}
                disabled={!mounted}
                title={mounted ? "Copy prompt" : "Loading…"}
              >
                {copiedSessionPrompt ? "Copied" : "Copy"}
              </Button>
            </div>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-800">
              <code suppressHydrationWarning>{sessionPrompt}</code>
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}
