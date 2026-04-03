"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { useSession } from "@/hooks/useSession";
import { api } from "@/lib/api";
import type { Project, Deployment } from "@/lib/types";
import {
  Rocket,
  ExternalLink,
  RotateCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Terminal,
  MessageSquare,
} from "lucide-react";
import Link from "next/link";
import ChatPanel from "@/components/chat/ChatPanel";
import LogViewer from "@/components/project/LogViewer";

const DEPLOY_STATUS_MAP: Record<string, { icon: any; color: string; label: string }> = {
  queued: { icon: Clock, color: "text-muted-foreground", label: "Queued" },
  building: { icon: Loader2, color: "text-warning", label: "Building" },
  pushing: { icon: Loader2, color: "text-warning", label: "Pushing" },
  deploying: { icon: Loader2, color: "text-warning", label: "Deploying" },
  success: { icon: CheckCircle2, color: "text-success", label: "Success" },
  failed: { icon: XCircle, color: "text-destructive", label: "Failed" },
};

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { session } = useSession();
  const [project, setProject] = useState<Project | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"chat" | "logs" | "deployments">("chat");
  const eventSourceRef = useRef<EventSource | null>(null);

  const fetchProject = async () => {
    if (!session?.access_token) return;
    try {
      const data = await api(`/api/projects/${id}`, { token: session.access_token });
      setProject(data.project);
    } catch (err) {
      console.error("Failed to fetch project:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProject();
  }, [session, id]);

  const handleDeploy = async () => {
    if (!session?.access_token || !project) return;
    setDeploying(true);
    try {
      await api(`/api/deploy/${project.id}`, {
        method: "POST",
        token: session.access_token,
      });

      // Start SSE polling
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
      const es = new EventSource(
        `${apiUrl}/api/deploy/${project.id}/status?token=${session.access_token}`
      );
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        const data = JSON.parse(event.data);
        setProject((prev) =>
          prev ? { ...prev, ...data.project, deployments: prev.deployments } : prev
        );
        if (data.project.status === "deployed" || data.project.status === "failed") {
          es.close();
          setDeploying(false);
          fetchProject();
        }
      };

      es.onerror = () => {
        es.close();
        setDeploying(false);
        fetchProject();
      };
    } catch (err) {
      console.error("Deploy failed:", err);
      setDeploying(false);
    }
  };

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Project not found.</p>
        <Link href="/dashboard" className="text-primary underline mt-2 inline-block">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      {/* Left: Chat Panel */}
      <div className="w-[420px] border-r border-border flex flex-col">
        <ChatPanel projectId={project.id} token={session?.access_token || ""} />
      </div>

      {/* Right: Project Details */}
      <div className="flex-1 overflow-auto">
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">{project.name}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {project.repo_owner}/{project.repo_name}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {project.live_url && (
                <a
                  href={project.live_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-accent transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  Visit
                </a>
              )}
              <button
                onClick={handleDeploy}
                disabled={deploying}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
              >
                {deploying ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Rocket className="w-4 h-4" />
                )}
                {deploying ? "Deploying..." : "Deploy"}
              </button>
            </div>
          </div>

          {/* Status bar */}
          <div className="mt-4 flex items-center gap-4 text-sm">
            <span
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                project.status === "deployed"
                  ? "bg-success/20 text-success"
                  : project.status === "failed"
                    ? "bg-destructive/20 text-destructive"
                    : project.status === "building"
                      ? "bg-warning/20 text-warning"
                      : "bg-muted text-muted-foreground"
              }`}
            >
              {project.status === "building" && (
                <Loader2 className="w-3 h-3 animate-spin" />
              )}
              {project.status}
            </span>
            <span className="px-2 py-0.5 rounded bg-accent text-xs">
              {project.stack_info?.type}
            </span>
            {project.live_url && (
              <span className="text-xs text-muted-foreground truncate">
                {project.live_url}
              </span>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-border">
          <div className="flex gap-0">
            {(["chat", "logs", "deployments"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                  activeTab === tab
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab === "chat" && <MessageSquare className="w-4 h-4 inline mr-1.5" />}
                {tab === "logs" && <Terminal className="w-4 h-4 inline mr-1.5" />}
                {tab === "deployments" && <RotateCw className="w-4 h-4 inline mr-1.5" />}
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === "logs" && (
            <LogViewer
              projectId={project.id}
              token={session?.access_token || ""}
            />
          )}
          {activeTab === "deployments" && (
            <DeploymentsList deployments={project.deployments || []} />
          )}
          {activeTab === "chat" && (
            <div className="text-center text-muted-foreground py-12">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>Use the chat panel on the left to interact with your deployment.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DeploymentsList({ deployments }: { deployments: Deployment[] }) {
  if (deployments.length === 0) {
    return (
      <p className="text-muted-foreground text-sm text-center py-12">
        No deployments yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {deployments.map((d) => {
        const statusInfo = DEPLOY_STATUS_MAP[d.status] || DEPLOY_STATUS_MAP.queued;
        const StatusIcon = statusInfo.icon;
        return (
          <div
            key={d.id}
            className="flex items-center justify-between p-4 border border-border rounded-lg"
          >
            <div className="flex items-center gap-3">
              <StatusIcon
                className={`w-5 h-5 ${statusInfo.color} ${
                  d.status === "building" || d.status === "deploying"
                    ? "animate-spin"
                    : ""
                }`}
              />
              <div>
                <p className="text-sm font-medium">{statusInfo.label}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(d.started_at).toLocaleString()}
                </p>
              </div>
            </div>
            {d.error_message && (
              <p className="text-xs text-destructive max-w-xs truncate">
                {d.error_message}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
