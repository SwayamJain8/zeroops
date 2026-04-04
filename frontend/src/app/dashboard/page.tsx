"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/hooks/useSession";
import { api } from "@/lib/api";
import type { Project } from "@/lib/types";
import {
  Activity,
  CalendarClock,
  ExternalLink,
  FolderGit2,
  Layers,
  Loader2,
  Plus,
  Search,
} from "lucide-react";
import Link from "next/link";
import CreateProjectModal from "@/components/project/CreateProjectModal";
import { GlassPanel, GradientTitle, StatusChip } from "@/components/design/primitives";

export default function DashboardPage() {
  const { session } = useSession();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "failed" | "deployed" | "building" | "idle"
  >("all");

  const fetchProjects = async () => {
    if (!session?.access_token) return;
    try {
      const data = await api("/api/projects", { token: session.access_token });
      setProjects(data.projects);
    } catch (err) {
      console.error("Failed to fetch projects:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, [session]);

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesStatus =
        statusFilter === "all" ? true : project.status === statusFilter;
      if (!matchesStatus) return false;
      if (!query) return true;
      return (
        project.name.toLowerCase().includes(query) ||
        project.repo_owner.toLowerCase().includes(query) ||
        project.repo_name.toLowerCase().includes(query) ||
        String(project.stack_info?.type || "").toLowerCase().includes(query)
      );
    });
  }, [projects, search, statusFilter]);

  const formatProjectDateTime = (value: string) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "Unknown time";
    return new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(parsed);
  };

  const statusOptions: Array<{
    value: "all" | "failed" | "deployed" | "building" | "idle";
    label: string;
    className: string;
  }> = [
    { value: "all", label: "All", className: "border-border text-muted-foreground" },
    { value: "failed", label: "Failed", className: "border-destructive/40 text-destructive" },
    { value: "deployed", label: "Deployed", className: "border-success/40 text-success" },
    { value: "building", label: "Building", className: "border-warning/40 text-warning" },
    { value: "idle", label: "Idle", className: "border-brand-violet/40 text-brand-violet" },
  ];

  return (
    <div className="h-full overflow-auto p-6 lg:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <GradientTitle
            title="Deployment Command Center"
            subtitle="Manage repositories, inspect runtime state, and launch deployments from one practical cockpit."
          />
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            New Project
          </button>
        </div>

        <div className="mb-5 grid gap-4 md:grid-cols-3">
          <GlassPanel className="p-4">
            <p className="text-xs text-muted-foreground">Total Projects</p>
            <p className="mt-2 text-2xl font-semibold">{projects.length}</p>
          </GlassPanel>
          <GlassPanel className="p-4">
            <p className="text-xs text-muted-foreground">Active Deployments</p>
            <p className="mt-2 text-2xl font-semibold">
              {projects.filter((p) => p.status === "building").length}
            </p>
          </GlassPanel>
          <GlassPanel className="p-4">
            <p className="text-xs text-muted-foreground">Live Apps</p>
            <p className="mt-2 text-2xl font-semibold">
              {projects.filter((p) => p.status === "deployed").length}
            </p>
          </GlassPanel>
        </div>

        <GlassPanel className="mb-5 p-4">
          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Filter Projects
            </p>
            <div className="flex items-center gap-3">
              <div className="group flex flex-1 items-center gap-2 rounded-xl border border-border/70 bg-background/60 px-3 py-2.5 transition focus-within:border-brand-cyan/50 focus-within:ring-2 focus-within:ring-brand-cyan/20">
                <Search className="h-4 w-4 text-muted-foreground transition group-focus-within:text-brand-cyan" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by project, owner, repository, or stack..."
                  className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {statusOptions.map((option) => {
                  const isActive = option.value === statusFilter;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setStatusFilter(option.value)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        isActive
                          ? `${option.className} bg-background/90 ring-2 ring-brand-cyan/40`
                          : `${option.className} bg-background/40 hover:bg-background/70`
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </GlassPanel>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : projects.length === 0 ? (
          <GlassPanel className="py-20 text-center">
            <FolderGit2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <h3 className="font-medium mb-1">No projects yet</h3>
            <p className="text-muted-foreground text-sm mb-4">
              Connect a repository and let ZeroOps configure deployment automatically.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Create Project
            </button>
          </GlassPanel>
        ) : filteredProjects.length === 0 ? (
          <GlassPanel className="py-16 text-center">
            <p className="text-sm text-muted-foreground">
              No projects match your search/filter.
            </p>
          </GlassPanel>
        ) : (
          <div className="grid gap-4">
            {filteredProjects.map((project) => (
              <Link
                key={project.id}
                href={`/project/${project.id}`}
                className="block"
              >
                <GlassPanel className="p-5 transition-all hover:-translate-y-0.5 hover:border-brand-violet/40">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
                        <FolderGit2 className="w-4 h-4 text-accent-foreground" />
                      </div>
                      <div>
                        <h3 className="font-medium">{project.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {project.repo_owner}/{project.repo_name}
                        </p>
                        <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <CalendarClock className="h-3 w-3" />
                          Created {formatProjectDateTime(project.created_at)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <StatusChip
                        label={project.status}
                        tone={
                          project.status === "deployed"
                            ? "success"
                            : project.status === "failed"
                              ? "danger"
                              : project.status === "building"
                                ? "warning"
                                : "neutral"
                        }
                      />
                      {project.live_url && (
                        <a
                          href={project.live_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-3 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-muted-foreground">
                        <Layers className="h-3 w-3" />
                        {project.stack_info?.type || "unknown"}
                      </span>
                      {project.stack_info?.frontend && (
                        <span className="inline-flex items-center rounded-full border border-border px-2.5 py-1 text-muted-foreground">
                          FE: {project.stack_info.frontend}
                        </span>
                      )}
                      {project.stack_info?.backend && (
                        <span className="inline-flex items-center rounded-full border border-border px-2.5 py-1 text-muted-foreground">
                          BE: {project.stack_info.backend}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-muted-foreground">
                        <Activity className="h-3 w-3" />
                        Open workspace
                      </span>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground">
                      <CalendarClock className="h-3 w-3" />
                      Updated {formatProjectDateTime(project.updated_at)}
                    </span>
                  </div>
                </GlassPanel>
              </Link>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateProjectModal
          token={session?.access_token || ""}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            fetchProjects();
          }}
        />
      )}
    </div>
  );
}
