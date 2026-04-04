"use client";

import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/hooks/useSession";
import { useAuthSync } from "@/hooks/useAuthSync";
import {
  LayoutDashboard,
  Rocket,
  LogOut,
  Loader2,
  BrainCircuit,
  PackageCheck,
  Bug,
  GitPullRequest,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { GlassPanel } from "@/components/design/primitives";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { session, loading } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  useAuthSync();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-dvh overflow-hidden p-4">
      <div className="mx-auto flex h-full min-h-0 max-w-[1500px] gap-4">
        <aside className="w-72 shrink-0">
          <GlassPanel className="flex h-full flex-col p-4">
            <Link href="/" className="flex items-center gap-0.5">
              <Image src="/logo.png" alt="ZeroOps logo" width={74} height={74} />
              <div>
                <p className="text-base font-semibold">ZeroOps</p>
                <p className="text-xs text-muted-foreground">AI Deploy Workspace</p>
              </div>
            </Link>

            <div className="mt-4 rounded-xl border border-border bg-background/50 p-3">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground/90">
                  Live Pipeline
                </p>
                <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
                  Active
                </span>
              </div>
              <div className="space-y-2">
                {[
                  { icon: BrainCircuit, label: "AI Plan" },
                  { icon: PackageCheck, label: "Build + Deploy" },
                  { icon: Bug, label: "Runtime Debug" },
                  { icon: GitPullRequest, label: "Fix PR (optional)" },
                ].map((step) => (
                  <div
                    key={step.label}
                    className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/40 px-2.5 py-2 text-xs text-muted-foreground"
                  >
                    <step.icon className="h-3.5 w-3.5 text-brand-cyan" />
                    <span>{step.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <nav className="mt-4 flex-1 space-y-1">
              {NAV_ITEMS.map((item) => {
                const isActive = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    }`}
                  >
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="mt-4 rounded-xl border border-border bg-background/40 p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Product Version
              </p>
              <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-semibold text-success">
                <Rocket className="h-3.5 w-3.5" />
                v1.0.0
              </div>
            </div>

            <div className="mt-4 border-t border-border pt-3">
              <div className="flex items-center gap-2 px-1 py-2">
                {session?.user?.user_metadata?.avatar_url && (
                  <img
                    src={session.user.user_metadata.avatar_url}
                    alt="Avatar"
                    className="w-7 h-7 rounded-full"
                  />
                )}
                <span className="text-sm text-muted-foreground truncate flex-1">
                  {session?.user?.user_metadata?.user_name || session?.user?.email}
                </span>
                <button
                  onClick={handleLogout}
                  className="p-1 hover:text-foreground text-muted-foreground transition-colors cursor-pointer"
                  title="Sign out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          </GlassPanel>
        </aside>

        <main className="flex-1 min-h-0 overflow-hidden">
          <GlassPanel className="h-full min-h-0 overflow-hidden">{children}</GlassPanel>
        </main>
      </div>
    </div>
  );
}
