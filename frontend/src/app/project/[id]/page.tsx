"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { useSession } from "@/hooks/useSession";
import { api } from "@/lib/api";
import type { Project, Deployment } from "@/lib/types";
import {
  Activity,
  Rocket,
  ExternalLink,
  RotateCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Terminal,
  MessageSquare,
  PanelLeftOpen,
  PanelLeftClose,
} from "lucide-react";
import Link from "next/link";
import ChatPanel from "@/components/chat/ChatPanel";
import LogViewer from "@/components/project/LogViewer";
import { GlassPanel, GradientTitle, StatusChip } from "@/components/design/primitives";

const DEPLOY_STATUS_MAP: Record<string, { icon: any; color: string; label: string }> = {
  queued: { icon: Clock, color: "text-muted-foreground", label: "Queued" },
  building: { icon: Loader2, color: "text-warning", label: "Building" },
  pushing: { icon: Loader2, color: "text-warning", label: "Pushing" },
  deploying: { icon: Loader2, color: "text-warning", label: "Deploying" },
  success: { icon: CheckCircle2, color: "text-success", label: "Success" },
  failed: { icon: XCircle, color: "text-destructive", label: "Failed" },
};
const TERMINAL_DEPLOYMENT_STATUSES = new Set(["success", "failed"]);

function toMs(value?: string | null) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function upsertDeployment(
  deployments: Deployment[] | undefined,
  nextDeployment?: Deployment
) {
  if (!nextDeployment) return deployments;
  const list = deployments || [];
  const existingIndex = list.findIndex((d) => d.id === nextDeployment.id);
  if (existingIndex === -1) return [nextDeployment, ...list];
  return list.map((d) => (d.id === nextDeployment.id ? { ...d, ...nextDeployment } : d));
}

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { session } = useSession();
  const [project, setProject] = useState<Project | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [activeDeploymentId, setActiveDeploymentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"chat" | "logs" | "deployments">("chat");
  const [isChatExpanded, setIsChatExpanded] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const activeDeploymentIdRef = useRef<string | null>(null);
  const deployingRef = useRef(false);

  const closeStatusStream = () => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  };

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

  useEffect(() => {
    deployingRef.current = deploying;
  }, [deploying]);

  const startStatusStream = (projectId: string, token: string) => {
    closeStatusStream();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
    const es = new EventSource(
      `${apiUrl}/api/deploy/${projectId}/status?token=${token}`
    );
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      const data = JSON.parse(event.data) as {
        project?: Partial<Project>;
        deployment?: Deployment;
      };
      const latestDeployment = data.deployment;

      setProject((prev) =>
        prev
          ? {
              ...prev,
              ...data.project,
              deployments: upsertDeployment(prev.deployments, latestDeployment),
            }
          : prev
      );

      if (latestDeployment?.id === activeDeploymentIdRef.current) {
        if (TERMINAL_DEPLOYMENT_STATUSES.has(latestDeployment.status)) {
          setDeploying(false);
          setActiveDeploymentId(null);
          activeDeploymentIdRef.current = null;
          closeStatusStream();
          fetchProject();
        }
      }

      if (!activeDeploymentIdRef.current && latestDeployment?.id) {
        setActiveDeploymentId(latestDeployment.id);
        activeDeploymentIdRef.current = latestDeployment.id;
      }

      if (
        !activeDeploymentIdRef.current &&
        (data.project?.status === "deployed" || data.project?.status === "failed")
      ) {
        closeStatusStream();
        setDeploying(false);
        setActiveDeploymentId(null);
        activeDeploymentIdRef.current = null;
        fetchProject();
      }
    };

    es.onerror = () => {
      // Network hiccups can close SSE. Close stale stream and refresh.
      closeStatusStream();
      fetchProject();
      if (deployingRef.current) {
        setDeploying(false);
        setActiveDeploymentId(null);
        activeDeploymentIdRef.current = null;
      }
    };
  };

  const handleDeploy = async () => {
    if (!session?.access_token || !project) return;
    setDeploying(true);
    try {
      const deployResponse = await api(`/api/deploy/${project.id}`, {
        method: "POST",
        token: session.access_token,
      });
      const startedDeployment = deployResponse?.deployment as Deployment | undefined;
      if (startedDeployment?.id) {
        setActiveDeploymentId(startedDeployment.id);
        activeDeploymentIdRef.current = startedDeployment.id;
      }
      setProject((prev) =>
        prev
          ? {
              ...prev,
              status: "building",
              deployments: upsertDeployment(prev.deployments, startedDeployment),
            }
          : prev
      );

      startStatusStream(project.id, session.access_token);
    } catch (err: any) {
      console.error(
        "Failed to start deployment:",
        err?.message || "Failed to start deployment. Please check your repo access and try again."
      );
      setDeploying(false);
      setActiveDeploymentId(null);
      activeDeploymentIdRef.current = null;
    }
  };

  useEffect(() => {
    if (
      project?.id &&
      session?.access_token &&
      project.status === "building" &&
      !eventSourceRef.current
    ) {
      startStatusStream(project.id, session.access_token);
    }
  }, [project?.id, project?.status, session?.access_token]);

  useEffect(() => {
    return () => {
      closeStatusStream();
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

  const statusTone =
    project.status === "deployed"
      ? "success"
      : project.status === "failed"
        ? "danger"
        : project.status === "building"
          ? "warning"
          : "neutral";

  const statusMessage =
    project.status === "deployed"
      ? "Deployment is live and healthy. You can verify and share the URL."
      : project.status === "failed"
        ? "Latest deployment failed. Check logs and deployment stages to recover quickly."
        : project.status === "building"
          ? "Build and deployment are in progress. ZeroOps is streaming updates in real time."
          : "No active deployment right now. Trigger a deploy when ready.";

  const isDeployDisabled = deploying || project.status === "building";

  return (
    <motion.div
      className="grid h-full min-h-0 gap-4 overflow-hidden p-4"
      animate={{
        gridTemplateColumns: isChatExpanded
          ? "minmax(460px, 1.7fr) minmax(280px, 0.7fr)"
          : "390px minmax(0, 1fr)",
      }}
      transition={{ duration: 0.35, ease: "easeInOut" }}
    >
      {/* Left: Chat Panel */}
      <motion.div
        className="h-full min-h-0 overflow-hidden"
        animate={{ scale: isChatExpanded ? 1 : 1, opacity: 1 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
        <GlassPanel className="flex h-full min-h-0 flex-col overflow-hidden">
          <ChatPanel projectId={project.id} token={session?.access_token || ""} />
        </GlassPanel>
      </motion.div>

      {/* Right: Project Details */}
      <motion.div
        className="h-full min-h-0 overflow-hidden"
        animate={{ opacity: isChatExpanded ? 0.92 : 1, scale: isChatExpanded ? 0.99 : 1 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <GlassPanel className="no-scrollbar h-full min-h-0 overflow-auto">
          <div className={`border-b border-border ${isChatExpanded ? "p-4" : "p-6"}`}>
            <div className={`flex ${isChatExpanded ? "flex-col gap-3" : "items-center justify-between"}`}>
              <div>
                {isChatExpanded ? (
                  <>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Deployment Panel
                    </p>
                    <h2 className="mt-1 truncate text-xl font-semibold">{project.name}</h2>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {project.repo_owner}/{project.repo_name}
                    </p>
                  </>
                ) : (
                  <>
                    <GradientTitle
                      title={project.name}
                      subtitle={`${project.repo_owner}/${project.repo_name}`}
                    />
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Live deployment cockpit for this project.
                    </p>
                  </>
                )}
              </div>
              <div className={`flex items-center gap-2 ${isChatExpanded ? "justify-end" : ""}`}>
                {project.live_url && (
                  <a
                    href={project.live_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex items-center gap-2 rounded-lg border border-border transition-colors hover:bg-accent ${
                      isChatExpanded ? "px-2.5 py-2 text-xs" : "px-3 py-2 text-sm"
                    }`}
                  >
                    <ExternalLink className="w-4 h-4" />
                    {isChatExpanded ? "Open" : "Visit"}
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setIsChatExpanded((prev) => !prev)}
                  className={`flex items-center gap-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer ${
                    isChatExpanded ? "px-2.5 py-2 text-xs" : "px-3 py-2 text-sm"
                  }`}
                >
                  {isChatExpanded ? (
                    <>
                      <PanelLeftClose className="w-4 h-4" />
                      Exit Focus
                    </>
                  ) : (
                    <>
                      <PanelLeftOpen className="w-4 h-4" />
                      Expand Chat
                    </>
                  )}
                </button>
                <button
                  onClick={handleDeploy}
                  disabled={isDeployDisabled}
                  className={`flex items-center gap-2 rounded-lg bg-primary font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 cursor-pointer ${
                    isChatExpanded ? "px-3 py-2 text-xs" : "px-4 py-2 text-sm"
                  }`}
                >
                  {isDeployDisabled ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Rocket className="w-4 h-4" />
                  )}
                  {project.status === "building" ? "Building..." : deploying ? "Deploying..." : "Deploy"}
                </button>
              </div>
            </div>

            {/* Status bar */}
            <div className={`mt-4 flex flex-wrap items-center gap-2 ${isChatExpanded ? "text-xs" : "text-sm"}`}>
              <StatusChip
                label={project.status}
                tone={statusTone}
              />
              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
                <Activity className="h-3 w-3" />
                {project.stack_info?.type}
              </span>
              {project.live_url && (
                <span className={`text-muted-foreground truncate ${isChatExpanded ? "max-w-[180px] text-[11px]" : "text-xs"}`}>
                  {project.live_url}
                </span>
              )}
            </div>
          </div>

          {isChatExpanded ? (
            <div className="p-4">
              <GlassPanel className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Chat Focus Mode
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Chat takes priority. This side is compact so you can still deploy, open logs, and track status quickly.
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      setActiveTab("logs");
                      setIsChatExpanded(false);
                    }}
                    className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground cursor-pointer"
                  >
                    Open Logs
                  </button>
                  <button
                    onClick={() => {
                      setActiveTab("deployments");
                      setIsChatExpanded(false);
                    }}
                    className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground cursor-pointer"
                  >
                    Open Deployments
                  </button>
                </div>
              </GlassPanel>
            </div>
          ) : (
            <>
              {/* Tabs */}
              <div className="border-b border-border">
                <div className="flex gap-0">
                  {(["chat", "logs", "deployments"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`cursor-pointer border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                        activeTab === tab
                          ? "border-brand-cyan text-foreground bg-brand-cyan/10"
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
                  <div className="space-y-4">
                    <GlassPanel className="p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            ZeroOps Chat Guide
                          </p>
                          <h3 className="mt-1 text-lg font-semibold">Ask naturally. Get deployment answers fast.</h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Use the chat panel on the left. Here are practical prompts you can copy and use.
                          </p>
                        </div>
                        <motion.div
                          className={`h-3 w-3 rounded-full ${
                            project.status === "deployed"
                              ? "bg-success"
                              : project.status === "failed"
                                ? "bg-destructive"
                                : project.status === "building"
                                  ? "bg-warning"
                                  : "bg-muted-foreground"
                          }`}
                          animate={
                            project.status === "building"
                              ? { scale: [1, 1.35, 1], opacity: [0.7, 1, 0.7] }
                              : project.status === "failed"
                                ? { scale: [1, 1.15, 1] }
                                : project.status === "deployed"
                                  ? { opacity: [0.8, 1, 0.8] }
                                  : {}
                          }
                          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                        />
                      </div>
                    </GlassPanel>

                    <div className="grid gap-4 md:grid-cols-2">
                      <GlassPanel className="p-5">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Deployment examples</p>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                          <li>"Deploy this project now."</li>
                          <li>"Why is this deployment failing?"</li>
                          <li>"Show latest error logs only."</li>
                          <li>"Restart the service."</li>
                          <li>"Create a PR with this fix." (only when you confirm)</li>
                        </ul>
                      </GlassPanel>
                      <GlassPanel className="p-5">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Debugging examples</p>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                          <li>"Which stage failed in my latest deployment?"</li>
                          <li>"Summarize root cause from logs in simple words."</li>
                          <li>"Give step-by-step fix for this error."</li>
                          <li>"What env variables are likely missing?"</li>
                          <li>"After fix, tell me how to verify production is healthy."</li>
                        </ul>
                      </GlassPanel>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </GlassPanel>
      </motion.div>
    </motion.div>
  );
}

function DeploymentsList({ deployments }: { deployments: Deployment[] }) {
  const [expandedErrors, setExpandedErrors] = useState<Record<string, boolean>>({});

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
        const startedMs = toMs(d.started_at);
        const finishedMs = toMs(d.finished_at);
        const endMs =
          finishedMs ?? (TERMINAL_DEPLOYMENT_STATUSES.has(d.status) ? null : Date.now());
        const durationSeconds =
          startedMs && endMs ? Math.max(0, Math.floor((endMs - startedMs) / 1000)) : null;
        const durationLabel =
          durationSeconds === null
            ? null
            : `${String(Math.floor(durationSeconds / 60)).padStart(2, "0")}:${String(
                durationSeconds % 60
              ).padStart(2, "0")}`;

        return (
          <div
            key={d.id}
            className="flex items-start justify-between gap-4 p-4 border border-border rounded-lg"
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
                {durationLabel && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Duration: {durationLabel}
                  </p>
                )}
              </div>
            </div>
            {d.error_message && (
              <button
                type="button"
                onClick={() =>
                  setExpandedErrors((prev) => ({
                    ...prev,
                    [d.id]: !prev[d.id],
                  }))
                }
                className="max-w-md text-left"
              >
                <p className="text-xs text-destructive whitespace-pre-wrap wrap-break-word">
                  {expandedErrors[d.id]
                    ? d.error_message
                    : `${d.error_message.split("\n")[0].slice(0, 120)}${
                        d.error_message.length > 120 ? "..." : ""
                      }`}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {expandedErrors[d.id] ? "Click to collapse" : "Click to expand"}
                </p>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
