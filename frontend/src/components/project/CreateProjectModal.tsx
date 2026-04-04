"use client";

import { useEffect, useState, useRef } from "react";
import { api } from "@/lib/api";
import {
  X,
  Loader2,
  Plus,
  Trash2,
  Search,
  Lock,
  Globe,
  ChevronDown,
} from "lucide-react";

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  private: boolean;
  language: string | null;
  updated_at: string;
}

interface Props {
  token: string;
  onClose: () => void;
  onCreated: () => void;
}

type DeploymentType =
  | "single_frontend"
  | "single_backend"
  | "separate_frontend_backend"
  | "monorepo_auto";

const LANG_COLORS: Record<string, string> = {
  TypeScript: "bg-blue-500",
  JavaScript: "bg-yellow-400",
  Python: "bg-green-500",
  HTML: "bg-orange-500",
  CSS: "bg-purple-500",
  Go: "bg-cyan-500",
  Rust: "bg-orange-700",
  Java: "bg-red-500",
  Ruby: "bg-red-600",
};

export default function CreateProjectModal({
  token,
  onClose,
  onCreated,
}: Props) {
  const [step, setStep] = useState<"pick" | "configure">("pick");
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [search, setSearch] = useState("");
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const [name, setName] = useState("");
  const [deploymentType, setDeploymentType] =
    useState<DeploymentType>("monorepo_auto");
  const [deploymentOpen, setDeploymentOpen] = useState(false);
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const searchRef = useRef<HTMLInputElement>(null);
  const deploymentDropdownRef = useRef<HTMLDivElement>(null);

  const fetchRepos = async (p: number = 1, searchQuery: string = "") => {
    setLoadingRepos(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(p));
      if (searchQuery) params.set("search", searchQuery);

      const data = await api(`/api/auth/repos?${params.toString()}`, { token });
      if (p === 1) {
        setRepos(data.repos);
      } else {
        setRepos((prev) => [...prev, ...data.repos]);
      }
      setHasMore(data.hasMore || false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingRepos(false);
    }
  };

  useEffect(() => {
    fetchRepos();
    setTimeout(() => searchRef.current?.focus(), 100);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        deploymentDropdownRef.current &&
        !deploymentDropdownRef.current.contains(event.target as Node)
      ) {
        setDeploymentOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearch = (value: string) => {
    setSearch(value);
    if (searchTimeout) clearTimeout(searchTimeout);
    const timeout = setTimeout(() => {
      setPage(1);
      fetchRepos(1, value);
    }, 400);
    setSearchTimeout(timeout);
  };

  const handleSelectRepo = (repo: GitHubRepo) => {
    setSelectedRepo(repo);
    setName(repo.name);
    setStep("configure");
  };

  const handleLoadMore = () => {
    const next = page + 1;
    setPage(next);
    fetchRepos(next, search);
  };

  const addEnvVar = () => setEnvVars([...envVars, { key: "", value: "" }]);
  const removeEnvVar = (index: number) =>
    setEnvVars(envVars.filter((_, i) => i !== index));
  const updateEnvVar = (i: number, field: "key" | "value", val: string) => {
    const updated = [...envVars];
    updated[i][field] = val;
    setEnvVars(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRepo) return;
    setLoading(true);
    setError("");

    try {
      await api("/api/projects", {
        method: "POST",
        token,
        body: JSON.stringify({
          name,
          repo_url: selectedRepo.html_url,
          deployment_type: deploymentType,
          env_vars: envVars.filter((v) => v.key.trim()),
        }),
      });
      onCreated();
    } catch (err: any) {
      setError(err.message || "Failed to create project");
    } finally {
      setLoading(false);
    }
  };

  const deploymentTypeOptions: { value: DeploymentType; label: string }[] = [
    { value: "single_frontend", label: "Single Frontend App" },
    { value: "single_backend", label: "Single Backend App" },
    {
      value: "separate_frontend_backend",
      label: "Separate Frontend + Backend",
    },
    { value: "monorepo_auto", label: "Monorepo / Auto-detect" },
  ];

  const selectedDeploymentLabel =
    deploymentTypeOptions.find((option) => option.value === deploymentType)?.label ??
    "Monorepo / Auto-detect";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl w-full max-w-2xl mx-4 shadow-2xl h-[75vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold">
            {step === "pick" ? "Select Repository" : "Configure Project"}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-accent rounded-md transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {step === "pick" ? (
          <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
            {/* Search */}
            <div className="p-4 border-b border-border shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Search repositories..."
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>

            {/* Repo list */}
            <div className="overflow-y-auto min-h-0 flex-1 p-2">
              {loadingRepos && repos.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : repos.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-8">
                  No repositories found.
                </p>
              ) : (
                <>
                  {repos.map((repo) => (
                    <button
                      key={repo.id}
                      onClick={() => handleSelectRepo(repo)}
                      className="w-full text-left px-3 py-3 rounded-lg hover:bg-accent transition-colors cursor-pointer flex items-start gap-3"
                    >
                      <div className="mt-0.5">
                        {repo.private ? (
                          <Lock className="w-4 h-4 text-muted-foreground" />
                        ) : (
                          <Globe className="w-4 h-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">
                            {repo.full_name}
                          </span>
                        </div>
                        {repo.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {repo.description}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-1">
                          {repo.language && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <span
                                className={`w-2 h-2 rounded-full ${LANG_COLORS[repo.language] || "bg-gray-400"}`}
                              />
                              {repo.language}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {new Date(repo.updated_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}

                  {hasMore && (
                    <button
                      onClick={handleLoadMore}
                      disabled={loadingRepos}
                      className="w-full py-3 text-sm text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 cursor-pointer"
                    >
                      {loadingRepos ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <ChevronDown className="w-4 h-4" />
                          Load more
                        </>
                      )}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto overflow-x-hidden">
            <div className="rounded-lg border border-border bg-background/50 p-3 text-xs text-muted-foreground">
              Pro tip: for monorepo, add env placeholders like
              <span className="mx-1 font-mono text-foreground">VITE_API_URL=__BACKEND_URL__</span>
              and
              <span className="ml-1 font-mono text-foreground">CORS_ORIGIN=__FRONTEND_URL__</span>.
            </div>
            {/* Selected repo */}
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-accent text-sm">
              {selectedRepo?.private ? (
                <Lock className="w-4 h-4 text-muted-foreground shrink-0" />
              ) : (
                <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
              <span className="font-medium truncate">
                {selectedRepo?.full_name}
              </span>
              <button
                type="button"
                onClick={() => setStep("pick")}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              >
                Change
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">
                Project Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">
                Deployment Type
              </label>
              <div ref={deploymentDropdownRef} className="relative">
                <button
                  type="button"
                  onClick={() => setDeploymentOpen((prev) => !prev)}
                  className="inline-flex w-full items-center justify-between rounded-lg border border-input bg-background px-3 py-2.5 text-sm transition hover:border-brand-cyan/40 focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <span>{selectedDeploymentLabel}</span>
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition ${deploymentOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {deploymentOpen && (
                  <div className="absolute left-0 top-[calc(100%+0.4rem)] z-20 w-full rounded-lg border border-border bg-background p-1.5 shadow-xl">
                    {deploymentTypeOptions.map((option) => {
                      const isActive = option.value === deploymentType;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            setDeploymentType(option.value);
                            setDeploymentOpen(false);
                          }}
                          className={`w-full rounded-md px-3 py-2 text-left text-sm transition ${
                            isActive
                              ? "bg-brand-cyan/15 text-foreground"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground"
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Use <span className="font-mono">monorepo_auto</span> for
                <span className="mx-1 font-mono">apps/frontend</span> +
                <span className="ml-1 font-mono">apps/backend</span> structures.
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium">
                  Environment Variables
                </label>
                <button
                  type="button"
                  onClick={addEnvVar}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>
              {envVars.map((v, i) => (
                <div key={i} className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <input
                    type="text"
                    value={v.key}
                    onChange={(e) => updateEnvVar(i, "key", e.target.value)}
                    placeholder="KEY"
                    className="min-w-0 px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                  />
                  <input
                    type="text"
                    value={v.value}
                    onChange={(e) => updateEnvVar(i, "value", e.target.value)}
                    placeholder="value"
                    className="min-w-0 px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => removeEnvVar(i)}
                    className="h-10 w-10 justify-self-end p-2 text-muted-foreground hover:text-destructive cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Reserved key: <span className="font-mono">PORT</span> is managed automatically at deploy time.
              </p>
            </div>

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStep("pick")}
                className="px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-accent transition-colors cursor-pointer"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Create Project
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
