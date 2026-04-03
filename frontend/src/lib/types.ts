export interface User {
  id: string;
  email: string;
  github_id: string;
  avatar_url: string;
  created_at: string;
}

export interface StackInfo {
  type: "frontend" | "backend" | "fullstack" | "nextjs" | "unknown";
  frontend: "react" | "vue" | "angular" | "static" | null;
  backend: "node" | "python" | "go" | "ruby" | null;
  envVars: string[];
  startCommand: string;
  packageManager: "npm" | "yarn" | "pnpm" | "pip" | null;
  hasDockerfile: boolean;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  repo_url: string;
  repo_owner: string;
  repo_name: string;
  stack_info: StackInfo;
  status: "idle" | "building" | "deployed" | "failed";
  app_runner_service_arn: string | null;
  live_url: string | null;
  env_vars: { key: string; value: string }[];
  created_at: string;
  updated_at: string;
  deployments?: Deployment[];
}

export interface Deployment {
  id: string;
  project_id: string;
  status: "queued" | "building" | "pushing" | "deploying" | "success" | "failed";
  build_log_url: string | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface ChatMessage {
  id: string;
  project_id: string;
  user_id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  tool_calls?: any;
  created_at: string;
}
