"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  Bot,
  CloudUpload,
  Loader2,
  GitPullRequest,
  LogOut,
  Rocket,
  TerminalSquare,
  ArrowRight,
} from "lucide-react";
import { GlassPanel, GradientTitle, StatusChip } from "@/components/design/primitives";
import { useSession } from "@/hooks/useSession";
import { createClient } from "@/lib/supabase/client";

const steps = [
  {
    icon: TerminalSquare,
    title: "Analyze Repository",
    description: "AI understands stack, scripts, build output, and runtime constraints.",
  },
  {
    icon: CloudUpload,
    title: "Build + Deploy",
    description: "CodeBuild + ECR + EC2 pipeline with live deployment telemetry.",
  },
  {
    icon: Bot,
    title: "Debug With AI",
    description: "Chat assistant inspects status, logs, and failure stage in real time.",
  },
  {
    icon: GitPullRequest,
    title: "Auto-Fix PR",
    description: "When approved, ZeroOps can generate and open a patch PR for recovery.",
  },
];

export default function Home() {
  const { session, loading } = useSession();
  const router = useRouter();

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

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.refresh();
  };

  return (
    <main className="relative h-[100dvh] overflow-hidden px-4 pb-0 pt-6 sm:px-8 sm:pt-7">
      <div className="mx-auto flex h-full max-w-7xl flex-col">
        <motion.header
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="mb-6 flex items-center justify-between"
        >
          <Link href="/" className="flex items-center gap-0.5">
            <Image src="/logo.png" alt="ZeroOps logo" width={92} height={92} />
            <span className="text-lg font-semibold">ZeroOps</span>
          </Link>
          <div className="flex items-center gap-2">
            {loading ? (
              <span className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading
              </span>
            ) : session ? (
              <>
                <button
                  onClick={handleLogout}
                  className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground cursor-pointer"
                >
                  <LogOut className="h-4 w-4" />
                  Logout
                </button>
                <Link
                  href="/dashboard"
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                >
                  Open Workspace
                </Link>
              </>
            ) : (
              <button
                onClick={handleLogin}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground cursor-pointer"
              >
                Sign in with GitHub
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </motion.header>

        <section className="grid gap-6 lg:grid-cols-2">
          <GlassPanel className="flex min-h-[380px] flex-col p-8">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip label="AI Deployment Workspace" />
              <StatusChip label="v1.0.0" tone="success" />
            </div>
            <div className="flex flex-1 items-center">
              <div className="space-y-5">
                <GradientTitle
                  title="From vibe coding to vibe deploying."
                  subtitle="ZeroOps turns every deployment into an interactive AI workflow with live logs, actionable diagnostics, and recovery suggestions."
                />
                <p className="text-sm text-muted-foreground">
                  Plan builds, launch safely, and resolve failures without leaving your workflow.
                </p>
              </div>
            </div>
            <div className="pt-6">
              <div className="flex flex-wrap gap-3">
                {session ? (
                  <>
                    <Link
                      href="/dashboard"
                      className="rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
                    >
                      Open Workspace
                    </Link>
                    <button
                      onClick={handleLogout}
                      className="rounded-xl border border-border px-5 py-3 text-sm text-muted-foreground transition hover:text-foreground cursor-pointer"
                    >
                      Logout
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleLogin}
                    className="inline-flex items-center gap-2 rounded-xl border border-border px-5 py-3 text-sm text-muted-foreground transition hover:text-foreground cursor-pointer"
                  >
                    Explore Workflow
                  </button>
                )}
              </div>
            </div>
          </GlassPanel>

          <GlassPanel className="relative flex min-h-[360px] flex-col overflow-hidden p-6">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7 }}
              className="surface-glass-strong flex-1 rounded-2xl p-5"
            >
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm font-semibold tracking-wide text-foreground">Deployment Copilot Console</p>
                <StatusChip label="Live Tool Calls" tone="success" />
              </div>
              <div className="space-y-3 text-sm">
                <div className="rounded-xl bg-accent p-3 text-accent-foreground">
                  Why is deployment failing for project `zeroops-ms`?
                </div>
                <div className="rounded-xl border border-border p-3 text-muted-foreground">
                  Checking status {"->"} fetching logs {"->"} root cause identified: bad PORT env.
                </div>
                <div className="rounded-xl border border-success/40 bg-success/10 p-3 text-success">
                  Suggested fix ready. Want me to create PR?
                </div>
              </div>
            </motion.div>
            <div className="mt-4 rounded-xl border border-border/70 bg-background/50 p-3 text-xs text-muted-foreground">
              UI built with Watermelon UI component patterns.
            </div>
          </GlassPanel>
        </section>

        <section id="workflow" className="mt-6 scroll-mt-24">
          <h2 className="mb-4 text-xl font-semibold">Deployment Intelligence Workflow</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {steps.map((step, i) => (
              <motion.div
                key={step.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: i * 0.1 }}
              >
                <GlassPanel className="h-full p-5">
                  <step.icon className="h-5 w-5 text-brand-cyan" />
                  <h3 className="mt-3 font-medium">{step.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
                </GlassPanel>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="mt-6 pb-2">
          <GlassPanel className="flex flex-col items-start justify-between gap-5 p-8 md:flex-row md:items-center">
            <div>
              <h3 className="text-2xl font-semibold">Build the next-gen deploy workflow.</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Bring your repositories. ZeroOps handles deployment complexity and AI debugging.
              </p>
            </div>
            {session ? (
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
              >
                <Rocket className="h-4 w-4" />
                Enter ZeroOps
              </Link>
            ) : (
              <button
                onClick={handleLogin}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground cursor-pointer"
              >
                Sign in with GitHub
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </GlassPanel>
        </section>
      </div>
    </main>
  );
}
