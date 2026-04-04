"use client";

import { createClient } from "@/lib/supabase/client";
import { ArrowRight, ShieldCheck } from "lucide-react";
import Image from "next/image";
import { GlassPanel } from "@/components/design/primitives";

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

export default function LoginPage() {
  const handleLogin = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: "repo read:user user:email",
      },
    });
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-2">
        <GlassPanel className="p-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
            <Image src="/logo.png" alt="ZeroOps logo" width={44} height={44} />
            ZeroOps Access Portal
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight">
            Connect GitHub. Deploy with AI.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in once and get a Cursor-like deployment cockpit with chat-native debugging.
          </p>
          <div className="mt-8 space-y-3">
            <div className="rounded-xl border border-border bg-background/40 p-3 text-sm text-muted-foreground">
              Repo analysis + deployment planning
            </div>
            <div className="rounded-xl border border-border bg-background/40 p-3 text-sm text-muted-foreground">
              Runtime logs + AI diagnosis loop
            </div>
            <div className="rounded-xl border border-border bg-background/40 p-3 text-sm text-muted-foreground">
              Optional fix PR flow with explicit approval
            </div>
          </div>
        </GlassPanel>

        <GlassPanel className="p-8">
          <div className="mb-7">
            <div className="inline-flex items-center gap-2">
              <div className="rounded-xl bg-brand-violet/20 p-2">
                <ShieldCheck className="h-5 w-5 text-brand-violet" />
              </div>
              <span className="text-xl font-semibold">Secure Sign In</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              We request repo access only to build, deploy, and open approved fix PRs.
            </p>
          </div>

          <button
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 rounded-xl bg-primary px-6 py-3.5 text-base font-medium text-primary-foreground transition hover:opacity-90 cursor-pointer"
          >
            <GitHubIcon className="w-5 h-5" />
            Continue with GitHub
            <ArrowRight className="h-4 w-4" />
          </button>

          <p className="mt-5 text-center text-xs text-muted-foreground">
            By continuing, you allow ZeroOps to read repositories and deployment metadata.
          </p>
        </GlassPanel>
      </div>
    </main>
  );
}
