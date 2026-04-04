import { GoogleGenAI } from "@google/genai";
import { RepoFile } from "./github";
import { StackInfo } from "./analyzer";

export interface DeploymentPlan {
  appPath: string;
  installCommand: string;
  buildCommand: string | null;
  runCommand: string;
  outputDir: string | null;
  healthPath: string;
  runtime: "node" | "python" | "static";
  notes: string[];
}

function isFrontendOnly(stack: StackInfo) {
  return stack.backend === null && (stack.frontend === "react" || stack.frontend === "static");
}

function containsPreviewOrDev(runCommand: string) {
  const lc = runCommand.toLowerCase();
  return (
    lc.includes("vite preview") ||
    lc.includes("npm run preview") ||
    lc.includes("pnpm preview") ||
    lc.includes("yarn preview") ||
    lc.includes("npm run dev") ||
    lc.includes("pnpm dev") ||
    lc.includes("yarn dev")
  );
}

function normalizeFrontendRunCommand(plan: DeploymentPlan): DeploymentPlan {
  const outputDir = plan.outputDir || "dist";
  return {
    ...plan,
    runCommand: `serve -s ${outputDir} -l 3000`,
    healthPath: "/",
    notes: [...plan.notes, `Normalized frontend run command to static serve from "${outputDir}" on port 3000.`],
  };
}

function parseJsonSafe<T = any>(input?: string): T | null {
  if (!input) return null;
  try {
    return JSON.parse(input) as T;
  } catch {
    return null;
  }
}

function inferPackageManager(appPath: string, files: RepoFile[]) {
  const fileAt = (name: string) =>
    files.some((f) => f.path === `${appPath}/${name}` || f.path === name);
  if (fileAt("pnpm-lock.yaml")) return "pnpm";
  if (fileAt("yarn.lock")) return "yarn";
  return "npm";
}

function pmInstall(pm: string): string {
  if (pm === "pnpm") return "pnpm install --frozen-lockfile || pnpm install";
  if (pm === "yarn") return "yarn install --frozen-lockfile || yarn install";
  return "npm ci || npm install";
}

function buildCandidates(files: RepoFile): never {
  throw new Error("unreachable");
}

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "." : path.slice(0, idx);
}

function pickBestPythonAppPath(files: RepoFile[]): string {
  const filePaths = files.filter((f) => f.type === "file").map((f) => f.path);
  const score = new Map<string, number>();
  const add = (dir: string, points: number) =>
    score.set(dir, (score.get(dir) || 0) + points);

  for (const p of filePaths) {
    const d = dirname(p);
    if (p.endsWith("/requirements.txt") || p === "requirements.txt") add(d, 5);
    if (p.endsWith("/pyproject.toml") || p === "pyproject.toml") add(d, 5);
    if (p.endsWith("/Pipfile") || p === "Pipfile") add(d, 4);
    if (p.endsWith("/start.py") || p === "start.py") add(d, 6);
    if (p.endsWith("/app.py") || p === "app.py") add(d, 4);
    if (p.endsWith("/main.py") || p === "main.py") add(d, 4);
  }

  let bestDir = ".";
  let bestScore = -1;
  for (const [dir, s] of score.entries()) {
    if (s > bestScore) {
      bestDir = dir;
      bestScore = s;
    }
  }
  return bestDir;
}

function hasFileInAppPath(files: RepoFile[], appPath: string, name: string): boolean {
  return files.some(
    (f) =>
      f.type === "file" &&
      (f.path === name ||
        f.path === `${appPath}/${name}`)
  );
}

function normalizePythonPlanWithRepoFiles(
  stack: StackInfo,
  refined: DeploymentPlan,
  files: RepoFile[]
): DeploymentPlan {
  if (stack.backend !== "python") return refined;

  let appPath = refined.appPath || ".";
  const bestPath = pickBestPythonAppPath(files);
  const hasAnyPythonSignalAtRefined =
    hasFileInAppPath(files, appPath, "start.py") ||
    hasFileInAppPath(files, appPath, "app.py") ||
    hasFileInAppPath(files, appPath, "main.py") ||
    hasFileInAppPath(files, appPath, "requirements.txt") ||
    hasFileInAppPath(files, appPath, "pyproject.toml");
  if (!hasAnyPythonSignalAtRefined && bestPath !== ".") {
    appPath = bestPath;
  }

  const hasStart = hasFileInAppPath(files, appPath, "start.py");
  const hasApp = hasFileInAppPath(files, appPath, "app.py");
  const hasMain = hasFileInAppPath(files, appPath, "main.py");
  const hasReq = hasFileInAppPath(files, appPath, "requirements.txt");
  const hasPyproject = hasFileInAppPath(files, appPath, "pyproject.toml");

  let runCommand = refined.runCommand || "python app.py";
  if (hasStart) runCommand = "python start.py";
  else if (hasMain && runCommand.includes("app.py")) runCommand = "python main.py";
  else if (!hasApp && hasMain) runCommand = "python main.py";
  else if (!hasApp && !hasMain && !hasStart) runCommand = "python app.py";

  let installCommand = refined.installCommand || "pip install --no-cache-dir flask";
  if (hasReq) installCommand = "pip install --no-cache-dir -r requirements.txt";
  else if (hasPyproject) installCommand = "pip install --no-cache-dir .";

  return {
    ...refined,
    appPath,
    runCommand,
    installCommand,
    healthPath: refined.healthPath || "/",
    notes: [
      ...(refined.notes || []),
      `Python normalization applied: appPath=${appPath}, run="${runCommand}"`,
    ],
  };
}

export function createRuleBasedPlan(
  files: RepoFile[],
  fileContents: Record<string, string>,
  stack: StackInfo
): DeploymentPlan {
  const packageJsonPaths = files
    .filter((f) => f.type === "file" && f.path.endsWith("package.json"))
    .map((f) => f.path);

  const rootPkg = parseJsonSafe<any>(fileContents["package.json"]);
  const rootScripts = rootPkg?.scripts || {};

  // 1) Next.js/fullstack frontend
  if (stack.type === "nextjs") {
    const pm = inferPackageManager(".", files);
    return {
      appPath: ".",
      installCommand: pmInstall(pm),
      buildCommand: rootScripts.build ? `${pm === "yarn" ? "yarn build" : pm === "pnpm" ? "pnpm build" : "npm run build"}` : null,
      runCommand: rootScripts.start
        ? pm === "yarn"
          ? "yarn start"
          : pm === "pnpm"
            ? "pnpm start"
            : "npm run start"
        : "node server.js",
      outputDir: ".next",
      healthPath: "/",
      runtime: "node",
      notes: ["Detected Next.js app."],
    };
  }

  // 2) Static frontend (no package manager app)
  if (stack.frontend === "static") {
    const candidates = [".", "dist", "build", "public"];
    const found = candidates.find((dir) =>
      files.some((f) =>
        dir === "."
          ? f.path === "index.html"
          : f.path === `${dir}/index.html`
      )
    );

    return {
      appPath: ".",
      installCommand: "npm i -g serve",
      buildCommand: null,
      runCommand: `serve -s ${found || "."} -l 3000`,
      outputDir: found || ".",
      healthPath: "/",
      runtime: "static",
      notes: [`Detected static frontend; output dir=${found || "."}`],
    };
  }

  // 3) React/Vite style frontend
  if (stack.frontend === "react" && stack.backend === null) {
    const appPath = ".";
    const pm = inferPackageManager(appPath, files);
    const scripts = rootScripts;
    const buildCommand = scripts.build
      ? pm === "yarn"
        ? "yarn build"
        : pm === "pnpm"
          ? "pnpm build"
          : "npm run build"
      : null;

    const outputDir = stack.buildOutputDir || "dist";
    return {
      appPath,
      installCommand: pmInstall(pm),
      buildCommand,
      runCommand: `serve -s ${outputDir} -l 3000`,
      outputDir,
      healthPath: "/",
      runtime: "node",
      notes: ["Detected JS frontend app."],
    };
  }

  // 4) Node backend
  if (stack.backend === "node") {
    const appPath = ".";
    const pm = inferPackageManager(appPath, files);
    const scripts = rootScripts;
    let runCommand = "node index.js";
    if (scripts.start) {
      runCommand =
        pm === "yarn"
          ? "yarn start"
          : pm === "pnpm"
            ? "pnpm start"
            : "npm run start";
    } else if (rootPkg?.main) {
      runCommand = `node ${rootPkg.main}`;
    }

    return {
      appPath,
      installCommand: pmInstall(pm),
      buildCommand: scripts.build
        ? pm === "yarn"
          ? "yarn build"
          : pm === "pnpm"
            ? "pnpm build"
            : "npm run build"
        : null,
      runCommand,
      outputDir: null,
      healthPath: "/health",
      runtime: "node",
      notes: ["Detected Node backend app."],
    };
  }

  // 5) Python backend
  if (stack.backend === "python") {
    const appPath = pickBestPythonAppPath(files);
    const fileAt = (name: string) =>
      files.some((f) => f.type === "file" && (f.path === name || f.path === `${appPath}/${name}`));
    const hasReq = fileAt("requirements.txt");
    const hasPyproject = fileAt("pyproject.toml");
    const hasStart = fileAt("start.py");
    const hasApp = fileAt("app.py");
    const hasMain = fileAt("main.py");
    const reqText =
      appPath === "." ? fileContents["requirements.txt"] : fileContents[`${appPath}/requirements.txt`];
    const hasUvicorn = (reqText || "").toLowerCase().includes("uvicorn");
    const hasFastapi = (reqText || "").toLowerCase().includes("fastapi");

    let installCommand = "pip install --no-cache-dir flask";
    if (hasReq) installCommand = "pip install --no-cache-dir -r requirements.txt";
    else if (hasPyproject) installCommand = "pip install --no-cache-dir .";

    let runCommand = "python app.py";
    if (hasStart) runCommand = "python start.py";
    else if (hasMain) runCommand = "python main.py";
    else if (hasApp && hasUvicorn) runCommand = "uvicorn app:app --host 0.0.0.0 --port 3000";
    else if (hasApp) runCommand = "python app.py";

    return {
      appPath,
      installCommand,
      buildCommand: null,
      runCommand,
      outputDir: null,
      healthPath: hasFastapi ? "/health" : "/",
      runtime: "python",
      notes: [
        `Detected Python backend app at "${appPath}".`,
        hasStart ? "Using start.py as entrypoint." : "Using inferred Python entrypoint.",
      ],
    };
  }

  // Fallback: strict unknown handling
  return {
    appPath: ".",
    installCommand: "echo \"Unsupported stack for auto-plan\" && exit 1",
    buildCommand: null,
    runCommand: "echo \"Unsupported stack for auto-plan\" && exit 1",
    outputDir: null,
    healthPath: "/",
    runtime: "static",
    notes: ["Unsupported stack: provide a Dockerfile or supported app structure."],
  };
}

export async function refinePlanWithGemini(
  files: RepoFile[],
  fileContents: Record<string, string>,
  stack: StackInfo,
  plan: DeploymentPlan
): Promise<DeploymentPlan> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return plan;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const samplePaths = files
      .filter((f) => f.type === "file")
      .slice(0, 250)
      .map((f) => f.path);

    const prompt = `You are a deployment planner.
Given stack + repo files, refine commands.
Return JSON only with this exact schema:
{
  "appPath":"string",
  "installCommand":"string",
  "buildCommand":"string|null",
  "runCommand":"string",
  "outputDir":"string|null",
  "healthPath":"string",
  "runtime":"node|python|static",
  "notes":["string"]
}

Current stack: ${JSON.stringify(stack)}
Current plan: ${JSON.stringify(plan)}
Repo file paths sample: ${JSON.stringify(samplePaths)}
Key files: ${JSON.stringify(fileContents)}

Rules:
- Prefer existing package scripts if present.
- If frontend output dir uncertain, keep outputDir null and runCommand that can still work.
- Do not invent nonexistent files.
- runCommand must run on Linux shell.`;

    const frontendOnly = isFrontendOnly(stack);
    const fullPrompt = frontendOnly
      ? `${prompt}
- For frontend-only apps, DO NOT use dev/preview servers. Use production static serving on port 3000.`
      : prompt;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: fullPrompt,
      config: { responseMimeType: "application/json" },
    });

    const parsed = JSON.parse(response.text || "{}") as Partial<DeploymentPlan>;
    const refined: DeploymentPlan = {
      appPath: parsed.appPath || plan.appPath,
      installCommand: parsed.installCommand || plan.installCommand,
      buildCommand:
        parsed.buildCommand === null || typeof parsed.buildCommand === "string"
          ? parsed.buildCommand
          : plan.buildCommand,
      runCommand: parsed.runCommand || plan.runCommand,
      outputDir:
        parsed.outputDir === null || typeof parsed.outputDir === "string"
          ? parsed.outputDir
          : plan.outputDir,
      healthPath: parsed.healthPath || plan.healthPath,
      runtime:
        parsed.runtime === "node" ||
        parsed.runtime === "python" ||
        parsed.runtime === "static"
          ? parsed.runtime
          : plan.runtime,
      notes: Array.isArray(parsed.notes) ? parsed.notes : plan.notes,
    };

    if (isFrontendOnly(stack) && containsPreviewOrDev(refined.runCommand)) {
      return normalizeFrontendRunCommand({
        ...refined,
        outputDir: refined.outputDir || plan.outputDir || "dist",
      });
    }

    return normalizePythonPlanWithRepoFiles(stack, refined, files);
  } catch {
    return plan;
  }
}

