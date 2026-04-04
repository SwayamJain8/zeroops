"use client";

import { useMemo, useState } from "react";
import { ChevronDown, KeyRound, Sparkles } from "lucide-react";

const providers = [
  { id: "gemini", label: "Gemini (active)", enabled: true },
  { id: "openai", label: "OpenAI (bring your key)", enabled: false },
  { id: "anthropic", label: "Anthropic (bring your key)", enabled: false },
];

export default function LlmProviderSelector() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("gemini");

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === selected) || providers[0],
    [selected]
  );

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-accent/50 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <Sparkles className="h-3.5 w-3.5 text-brand-violet" />
        {selectedProvider.label}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-border bg-card p-2 shadow-xl">
          {providers.map((provider) => (
            <button
              key={provider.id}
              onClick={() => {
                setSelected(provider.id);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-xs ${
                provider.id === selected
                  ? "bg-primary/15 text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              <span>{provider.label}</span>
              {!provider.enabled && <KeyRound className="h-3.5 w-3.5 text-brand-cyan" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

