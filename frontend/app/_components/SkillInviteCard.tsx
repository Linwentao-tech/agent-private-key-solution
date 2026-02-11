"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

export function SkillInviteCard(props: {
  skillUrl: string;
  mounted: boolean;
  copiedSkill: boolean;
  setCopiedSkill: React.Dispatch<React.SetStateAction<boolean>>;
  skillInviteText: string;
}) {
  const { skillUrl, mounted, copiedSkill, setCopiedSkill, skillInviteText } = props;

  return (
    <section className="mx-auto w-full max-w-4xl rounded-2xl border border-zinc-200 bg-white/70 p-3.5 shadow-sm backdrop-blur lg:col-span-12 lg:col-start-1">
      <div className="grid place-items-center gap-2 text-center">
        <div className="text-base font-semibold tracking-tight">Send Your AI Agent This Skill</div>
      </div>

      <div className="mt-2.5 grid gap-1.5">
        <div className="rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-left text-xs text-zinc-800">
          <div className="flex flex-wrap items-center justify-between gap-3" suppressHydrationWarning>
            <div className="min-w-0">
              Read{" "}
              <a
                className="break-all font-mono text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-500"
                href={skillUrl}
                target="_blank"
                rel="noreferrer"
              >
                {skillUrl}
              </a>{" "}
              and follow the instructions.
            </div>
            <Button
              type="button"
              size="sm"
              className="h-7 w-auto whitespace-nowrap rounded-lg bg-zinc-900 px-3 text-xs text-white hover:bg-zinc-800 disabled:opacity-60"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(skillInviteText);
                  setCopiedSkill(true);
                  window.setTimeout(() => setCopiedSkill(false), 1200);
                } catch {
                  // ignore
                }
              }}
              disabled={!mounted}
              title={mounted ? "Copy" : "Loading…"}
            >
              {copiedSkill ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
        <div className="grid gap-0.5 text-xs font-medium leading-tight text-zinc-500">
          <div>
            1. Set <span className="font-mono">PIMLICO_RPC_URL</span> (an environment variable) or any other AA Bundler
            RPC for your agent.
          </div>
          <div>2. Copy this message and send it to your agent.</div>
        </div>
      </div>
    </section>
  );
}
