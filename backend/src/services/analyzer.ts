import { RepoFile } from "./github";
import { GoogleGenAI } from "@google/genai";

export interface StackInfo {
  type: "frontend" | "backend" | "fullstack" | "nextjs" | "unknown";
  frontend: "react" | "vue" | "angular" | "static" | null;
  backend: "node" | "python" | "go" | "ruby" | null;
  envVars: string[];
  startCommand: string;
  packageManager: "npm" | "yarn" | "pnpm" | "pip" | null;
  hasDockerfile: boolean;
  buildOutputDir?: string | null;
  deploymentMode?:
    | "single_frontend"
    | "single_backend"
    | "separate_frontend_backend"
    | "monorepo_auto";
}

export type DeploymentIntent =
  | "single_frontend"
  | "single_backend"
  | "separate_frontend_backend"
  | "monorepo_auto";

export function analyzeStack(
  files: RepoFile[],
  fileContents: Record<string, string>
): StackInfo {
  const filePaths = files.map((f) => f.path);
  const hasFile = (name: string) =>
    filePaths.some((p) => p === name || p.endsWith(`/${name}`));

  const result: StackInfo = {
    type: "unknown",
    frontend: null,
    backend: null,
    envVars: [],
    startCommand: "",
    packageManager: null,
    hasDockerfile: hasFile("Dockerfile"),
    buildOutputDir: null,
  };

  const packageJson = fileContents["package.json"];
  let pkg: any = null;
  if (packageJson) {
    try {
      pkg = JSON.parse(packageJson);
    } catch {}
  }

  // Package manager detection
  if (hasFile("pnpm-lock.yaml")) result.packageManager = "pnpm";
  else if (hasFile("yarn.lock")) result.packageManager = "yarn";
  else if (hasFile("package-lock.json") || hasFile("package.json"))
    result.packageManager = "npm";
  else if (hasFile("requirements.txt") || hasFile("Pipfile"))
    result.packageManager = "pip";

  // Next.js detection
  if (
    hasFile("next.config.js") ||
    hasFile("next.config.mjs") ||
    hasFile("next.config.ts") ||
    (pkg?.dependencies?.next)
  ) {
    result.type = "nextjs";
    result.frontend = "react";
    result.backend = "node";
    result.startCommand = "npm run build && npm start";
    result.buildOutputDir = ".next";
    return extractEnvVars(result, fileContents);
  }

  // Frontend framework detection
  if (pkg?.dependencies?.react || pkg?.dependencies?.["react-dom"]) {
    result.frontend = "react";
  } else if (pkg?.dependencies?.vue) {
    result.frontend = "vue";
  } else if (hasFile("angular.json") || pkg?.dependencies?.["@angular/core"]) {
    result.frontend = "angular";
  } else if (hasFile("index.html") && !pkg) {
    result.frontend = "static";
  }

  // Backend detection
  if (pkg?.dependencies?.express || pkg?.dependencies?.fastify || pkg?.dependencies?.koa) {
    result.backend = "node";
  } else if (hasFile("requirements.txt") || hasFile("Pipfile") || hasFile("pyproject.toml")) {
    result.backend = "python";
  } else if (hasFile("go.mod")) {
    result.backend = "go";
  } else if (hasFile("Gemfile")) {
    result.backend = "ruby";
  }

  // Type classification
  if (result.frontend && result.backend) {
    result.type = "fullstack";
  } else if (result.frontend) {
    result.type = "frontend";
  } else if (result.backend) {
    result.type = "backend";
  }

  // Start command
  if (result.backend === "node") {
    result.startCommand =
      pkg?.scripts?.start
        ? "npm start"
        : pkg?.main
          ? `node ${pkg.main}`
          : "node index.js";
  } else if (result.backend === "python") {
    result.startCommand = "python app.py";
  } else if (result.frontend === "static") {
    result.startCommand = "npx serve .";
  } else if (result.frontend === "react") {
    result.startCommand = "npm run build && npx serve -s build";
    result.buildOutputDir = inferBuildOutputDir(fileContents, hasFile);
  }

  return extractEnvVars(result, fileContents);
}

function inferBuildOutputDir(
  fileContents: Record<string, string>,
  hasFile: (name: string) => boolean
): string | null {
  const packageJson = fileContents["package.json"];
  let pkg: any = null;
  try {
    pkg = packageJson ? JSON.parse(packageJson) : null;
  } catch {
    pkg = null;
  }

  const buildScript: string = pkg?.scripts?.build || "";
  // Explicit outDir in script
  const outDirMatch = buildScript.match(/--outDir\s+([^\s]+)/i);
  if (outDirMatch?.[1]) return outDirMatch[1];

  // Framework heuristics
  if (hasFile("vite.config.ts") || hasFile("vite.config.js")) return "dist";
  if (
    pkg?.dependencies?.["react-scripts"] ||
    pkg?.devDependencies?.["react-scripts"]
  ) {
    return "build";
  }

  // Safe default candidates handled later in deploy stage
  return null;
}

function extractEnvVars(
  info: StackInfo,
  fileContents: Record<string, string>
): StackInfo {
  const envExample = fileContents[".env.example"];
  if (envExample) {
    const vars = envExample
      .split("\n")
      .filter((line) => line.includes("=") && !line.startsWith("#"))
      .map((line) => line.split("=")[0].trim())
      .filter(Boolean);
    info.envVars = vars;
  }
  return info;
}

export async function analyzeStackWithAIRefinement(
  files: RepoFile[],
  fileContents: Record<string, string>,
  deploymentIntent: DeploymentIntent
): Promise<StackInfo> {
  const ruleBased = analyzeStack(files, fileContents);
  ruleBased.deploymentMode = deploymentIntent;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return ruleBased;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const samplePaths = files
      .filter((f) => f.type === "file")
      .slice(0, 200)
      .map((f) => f.path);

    const prompt = `You are a deployment stack classifier.
Return STRICT JSON only.

User-selected deployment intent: ${deploymentIntent}
Rule-based detection result: ${JSON.stringify(ruleBased)}
Repository file paths (sample): ${JSON.stringify(samplePaths)}
Known key file contents: ${JSON.stringify(fileContents)}

Return JSON exactly:
{
  "type": "frontend|backend|fullstack|nextjs|unknown",
  "frontend": "react|vue|angular|static|null",
  "backend": "node|python|go|ruby|null",
  "startCommand": "string",
  "buildOutputDir": "string|null",
  "envVars": ["A","B"],
  "packageManager": "npm|yarn|pnpm|pip|null",
  "hasDockerfile": true,
  "deploymentMode": "${deploymentIntent}"
}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });

    const parsed = JSON.parse(response.text || "{}") as Partial<StackInfo>;
    return {
      type: parsed.type || ruleBased.type,
      frontend: parsed.frontend ?? ruleBased.frontend,
      backend: parsed.backend ?? ruleBased.backend,
      envVars: Array.isArray(parsed.envVars) ? parsed.envVars : ruleBased.envVars,
      startCommand: parsed.startCommand || ruleBased.startCommand,
      buildOutputDir:
        typeof (parsed as any).buildOutputDir === "string" ||
        (parsed as any).buildOutputDir === null
          ? ((parsed as any).buildOutputDir as string | null)
          : ruleBased.buildOutputDir ?? null,
      packageManager: parsed.packageManager ?? ruleBased.packageManager,
      hasDockerfile:
        typeof parsed.hasDockerfile === "boolean"
          ? parsed.hasDockerfile
          : ruleBased.hasDockerfile,
      deploymentMode: deploymentIntent,
    };
  } catch {
    return ruleBased;
  }
}
