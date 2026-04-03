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
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const searchRef = useRef<HTMLInputElement>(null);

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl w-full max-w-lg mx-4 shadow-2xl h-[75vh] flex flex-col overflow-hidden">
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
          <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
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
              <select
                value={deploymentType}
                onChange={(e) =>
                  setDeploymentType(e.target.value as DeploymentType)
                }
                className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="single_frontend">Single Frontend App</option>
                <option value="single_backend">Single Backend App</option>
                <option value="separate_frontend_backend">
                  Separate Frontend + Backend
                </option>
                <option value="monorepo_auto">
                  Monorepo / Auto-detect
                </option>
              </select>
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
                <div key={i} className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={v.key}
                    onChange={(e) => updateEnvVar(i, "key", e.target.value)}
                    placeholder="KEY"
                    className="flex-1 px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                  />
                  <input
                    type="text"
                    value={v.value}
                    onChange={(e) => updateEnvVar(i, "value", e.target.value)}
                    placeholder="value"
                    className="flex-1 px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => removeEnvVar(i)}
                    className="p-2 text-muted-foreground hover:text-destructive cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
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
