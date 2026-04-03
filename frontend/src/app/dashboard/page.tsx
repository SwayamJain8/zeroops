"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/hooks/useSession";
import { api } from "@/lib/api";
import type { Project } from "@/lib/types";
import { Plus, Folder, ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";
import CreateProjectModal from "@/components/project/CreateProjectModal";

const STATUS_COLORS: Record<string, string> = {
  idle: "bg-muted-foreground/20 text-muted-foreground",
  building: "bg-warning/20 text-warning",
  deployed: "bg-success/20 text-success",
  failed: "bg-destructive/20 text-destructive",
};

export default function DashboardPage() {
  const { session } = useSession();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

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

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground mt-1">
            Deploy and manage your applications.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          New Project
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-border rounded-xl">
          <Folder className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-medium mb-1">No projects yet</h3>
          <p className="text-muted-foreground text-sm mb-4">
            Connect a GitHub repo to get started.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Create Project
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/project/${project.id}`}
              className="block p-5 border border-border rounded-xl bg-card hover:border-foreground/20 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center">
                    <Folder className="w-4 h-4 text-accent-foreground" />
                  </div>
                  <div>
                    <h3 className="font-medium">{project.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {project.repo_owner}/{project.repo_name}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      STATUS_COLORS[project.status]
                    }`}
                  >
                    {project.status}
                  </span>
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

              <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                <span className="px-2 py-0.5 rounded bg-accent">
                  {project.stack_info?.type || "unknown"}
                </span>
                {project.stack_info?.frontend && (
                  <span>{project.stack_info.frontend}</span>
                )}
                {project.stack_info?.backend && (
                  <span>{project.stack_info.backend}</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

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
