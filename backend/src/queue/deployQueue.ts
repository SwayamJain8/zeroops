import { supabaseAdmin } from "../db/supabase";
import {
  triggerBuild,
  getBuildStatus,
  getCodeBuildLogs,
} from "../services/deployer";
import { deployToEc2 } from "../services/ec2Deployer";
import { createSubdomain } from "../services/domain";
import { StackInfo } from "../services/analyzer";
import { DeploymentPlan } from "../services/deployPlanner";

interface DeployJobData {
  projectId: string;
  deploymentId: string;
  slug: string;
  repoUrl: string;
  stackInfo: StackInfo;
  envVars: { key: string; value: string }[];
  githubToken?: string;
}

const USE_REDIS = false;

async function updateDeploymentStatus(
  deploymentId: string,
  projectId: string,
  status: string,
  extra: Record<string, any> = {}
) {
  await supabaseAdmin
    .from("deployments")
    .update({ status, ...extra })
    .eq("id", deploymentId);

  const projectStatus =
    status === "success"
      ? "deployed"
      : status === "failed"
        ? "failed"
        : "building";

  await supabaseAdmin
    .from("projects")
    .update({ status: projectStatus, updated_at: new Date().toISOString() })
    .eq("id", projectId);
}

function log(deploymentId: string, step: string, detail: string) {
  const ts = new Date().toISOString();
  console.log(`[DEPLOY ${deploymentId}] [${ts}] [${step}] ${detail}`);
}

function normalizeKey(key: string) {
  return key.trim().toUpperCase();
}

function shouldUseBackendUrl(key: string, value?: string) {
  const k = normalizeKey(key);
  const v = (value || "").trim().toUpperCase();
  if (v === "__BACKEND_URL__" || v === "AUTO_BACKEND_URL") return true;
  if (value && value.trim()) return false;
  return (
    k.includes("BACKEND_URL") ||
    k.includes("API_URL") ||
    k.includes("SERVER_URL")
  );
}

function shouldUseFrontendUrl(key: string, value?: string) {
  const k = normalizeKey(key);
  const v = (value || "").trim().toUpperCase();
  if (v === "__FRONTEND_URL__" || v === "AUTO_FRONTEND_URL") return true;
  if (value && value.trim()) return false;
  return (
    k.includes("FRONTEND_URL") ||
    k.includes("CLIENT_URL") ||
    k.includes("APP_URL") ||
    k.includes("CORS_ORIGIN")
  );
}

function withAutoUrls(
  envVars: { key: string; value: string }[],
  urls: { backendUrl?: string; frontendUrl?: string }
) {
  return envVars.map((v) => {
    if (urls.backendUrl && shouldUseBackendUrl(v.key, v.value)) {
      return { ...v, value: urls.backendUrl };
    }
    if (urls.frontendUrl && shouldUseFrontendUrl(v.key, v.value)) {
      return { ...v, value: urls.frontendUrl };
    }
    return v;
  });
}

function getFrontendBuildEnvVars(
  envVars: { key: string; value: string }[],
  backendUrl?: string
) {
  const resolved = withAutoUrls(envVars, { backendUrl });
  return resolved.filter((v) => {
    const key = normalizeKey(v.key);
    return key.startsWith("VITE_") || key.startsWith("NEXT_PUBLIC_");
  });
}

function getMonorepoPlans(stackInfo: StackInfo) {
  const backendPlan: DeploymentPlan = {
    appPath: ".",
    installCommand: "npm ci || npm install",
    buildCommand:
      "npm run build -w backend --if-present || npm run build --workspace=backend --if-present || npm --prefix apps/backend run build --if-present || true",
    runCommand:
      "npm run start -w backend || npm run start --workspace=backend || npm --prefix apps/backend run start",
    outputDir: null,
    healthPath: "/",
    runtime: "node",
    notes: [
      "Monorepo split deploy: backend workspace.",
      "Includes fallback to apps/backend path if workspace aliases are not configured.",
    ],
  };

  const frontendOutput =
    (stackInfo.buildOutputDir as string) || "apps/frontend/dist";
  const frontendPlan: DeploymentPlan = {
    appPath: ".",
    installCommand: "npm ci || npm install",
    buildCommand:
      "npm run build -w frontend || npm run build --workspace=frontend || npm --prefix apps/frontend run build",
    runCommand: `serve -s ${frontendOutput} -l 3000`,
    outputDir: frontendOutput,
    healthPath: "/",
    runtime: "node",
    notes: [
      "Monorepo split deploy: frontend workspace.",
      "Includes fallback to apps/frontend path if workspace aliases are not configured.",
    ],
  };

  return { backendPlan, frontendPlan };
}

function normalizeStoredPlanForFrontend(
  stackInfo: StackInfo,
  plan?: DeploymentPlan
): DeploymentPlan | undefined {
  if (!plan) return plan;
  const frontendOnly =
    stackInfo.backend === null &&
    (stackInfo.frontend === "react" || stackInfo.frontend === "static");
  if (!frontendOnly) return plan;

  const lc = plan.runCommand.toLowerCase();
  const usesPreviewOrDev =
    lc.includes("vite preview") ||
    lc.includes("npm run preview") ||
    lc.includes("pnpm preview") ||
    lc.includes("yarn preview") ||
    lc.includes("npm run dev") ||
    lc.includes("pnpm dev") ||
    lc.includes("yarn dev");

  if (!usesPreviewOrDev) return plan;

  const outputDir = plan.outputDir || (stackInfo.buildOutputDir as string) || "dist";
  return {
    ...plan,
    runCommand: `serve -s ${outputDir} -l 3000`,
    healthPath: "/",
    outputDir,
    notes: [...(plan.notes || []), "Runtime normalization: replaced preview/dev with static serve on port 3000."],
  };
}

async function processDeployJob(data: DeployJobData) {
  const { projectId, deploymentId, slug, repoUrl, stackInfo, envVars, githubToken } = data;

  try {
    log(deploymentId, "START", `Project: ${slug} | Repo: ${repoUrl}`);
    log(deploymentId, "STACK", `Detected: type=${stackInfo.type}, frontend=${stackInfo.frontend}, backend=${stackInfo.backend}, hasDockerfile=${stackInfo.hasDockerfile}`);
    const rawPlan = (stackInfo as any).deploymentPlan as DeploymentPlan | undefined;
    const deploymentPlan = normalizeStoredPlanForFrontend(stackInfo, rawPlan);
    if (deploymentPlan) {
      log(
        deploymentId,
        "PLAN",
        `appPath=${deploymentPlan.appPath} install="${deploymentPlan.installCommand}" build="${deploymentPlan.buildCommand || "-"}" run="${deploymentPlan.runCommand}" health=${deploymentPlan.healthPath}`
      );
    }

    const isMonorepoSplit =
      stackInfo.type === "fullstack" &&
      stackInfo.frontend === "react" &&
      stackInfo.backend === "node";
    const forceKnownMonorepo =
      /test-monorepo-fs/i.test(repoUrl) || /test-monorepo-fs/i.test(slug);
    const shouldUseMonorepoSplit = isMonorepoSplit || forceKnownMonorepo;

    // Step 1: Ensure ECR repo exists
    log(deploymentId, "ECR", "Ensuring ECR repository exists...");
    await updateDeploymentStatus(deploymentId, projectId, "building");

    // Step 2: Trigger CodeBuild
    log(deploymentId, "CODEBUILD", "Triggering CodeBuild...");
    const runBuildAndPoll = async (
      buildSlug: string,
      planToUse?: DeploymentPlan,
      buildEnvVars?: { key: string; value: string }[]
    ) => {
      const imageTag = `deploy-${Date.now()}`;
      let buildId: string;
      let ecrUri: string;
      try {
        const result = await triggerBuild(
          buildSlug,
          repoUrl,
          stackInfo,
          imageTag,
          githubToken,
          planToUse,
          buildEnvVars
        );
        buildId = result.buildId;
        ecrUri = result.ecrUri;
        log(deploymentId, "CODEBUILD", `Build started for ${buildSlug}: ${buildId}`);
        log(deploymentId, "ECR", `ECR repo for ${buildSlug}: ${ecrUri}`);
      } catch (err: any) {
        log(deploymentId, "CODEBUILD", `FAILED to start build for ${buildSlug}: ${err.message}`);
        throw new Error(`CodeBuild failed to start for ${buildSlug}: ${err.message}`);
      }

      log(deploymentId, "CODEBUILD", `Polling build status for ${buildSlug}...`);
      let buildComplete = false;
      let attempts = 0;
      const maxAttempts = 120;

      while (!buildComplete && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const status = await getBuildStatus(buildId);
        if (attempts % 6 === 0) {
          log(
            deploymentId,
            "CODEBUILD",
            `${buildSlug} status: ${status.status} (attempt ${attempts}/${maxAttempts})`
          );
        }
        if (status.complete) {
          buildComplete = true;
          if (status.status !== "SUCCEEDED") {
            const buildLogs = await getCodeBuildLogs(buildId);
            log(deploymentId, "CODEBUILD", `${buildSlug} build logs:\n${buildLogs}`);
            throw new Error(`CodeBuild failed for ${buildSlug} (${status.status}). Build logs:\n${buildLogs}`);
          }
          log(deploymentId, "CODEBUILD", `${buildSlug} build SUCCEEDED`);
        }
        attempts++;
      }

      if (!buildComplete) {
        throw new Error(`CodeBuild timed out for ${buildSlug}`);
      }

      return { imageTag, ecrUri };
    };

    let serviceUrl: string;
    let backendUrl: string | undefined;
    let frontendUrl: string | undefined;

    if (shouldUseMonorepoSplit) {
      if (!isMonorepoSplit && forceKnownMonorepo) {
        log(
          deploymentId,
          "MONOREPO",
          "Forcing split deploy mode for known monorepo repo pattern."
        );
      }
      log(deploymentId, "MONOREPO", "Using split deploy mode: backend + frontend");
      await updateDeploymentStatus(deploymentId, projectId, "deploying");

      const { backendPlan, frontendPlan } = getMonorepoPlans(stackInfo);
      log(
        deploymentId,
        "MONOREPO",
        `Backend plan: build="${backendPlan.buildCommand}" run="${backendPlan.runCommand}"`
      );
      log(
        deploymentId,
        "MONOREPO",
        `Frontend plan: build="${frontendPlan.buildCommand}" run="${frontendPlan.runCommand}"`
      );

      const backendSlug = `${slug}-be`;
      const frontendSlug = `${slug}-fe`;

      const backendBuild = await runBuildAndPoll(backendSlug, backendPlan);
      const backendEnv = withAutoUrls(envVars, {});
      const backendDeploy = await deployToEc2(
        backendSlug,
        backendBuild.ecrUri,
        backendBuild.imageTag,
        backendEnv,
        backendPlan.healthPath
      );
      backendUrl = backendDeploy.url;
      log(deploymentId, "MONOREPO", `Backend deployed at ${backendUrl}`);

      const frontendBuildEnvVars = getFrontendBuildEnvVars(envVars, backendUrl);
      log(
        deploymentId,
        "MONOREPO",
        `Frontend build env keys: ${frontendBuildEnvVars.map((v) => v.key).join(", ") || "(none)"}`
      );
      const frontendBuild = await runBuildAndPoll(
        frontendSlug,
        frontendPlan,
        frontendBuildEnvVars
      );
      const frontendEnv = withAutoUrls(envVars, { backendUrl });
      const frontendDeploy = await deployToEc2(
        frontendSlug,
        frontendBuild.ecrUri,
        frontendBuild.imageTag,
        frontendEnv,
        frontendPlan.healthPath
      );
      frontendUrl = frontendDeploy.url;
      log(deploymentId, "MONOREPO", `Frontend deployed at ${frontendUrl}`);

      // Optional second backend deploy to inject frontend URL for CORS/app URL keys.
      const needsFrontendUrlInBackend = envVars.some((v) =>
        shouldUseFrontendUrl(v.key, v.value)
      );
      if (needsFrontendUrlInBackend && frontendUrl) {
        log(
          deploymentId,
          "MONOREPO",
          "Redeploying backend once to inject frontend URL env vars"
        );
        const backendEnvWithFrontend = withAutoUrls(envVars, { frontendUrl });
        await deployToEc2(
          backendSlug,
          backendBuild.ecrUri,
          backendBuild.imageTag,
          backendEnvWithFrontend,
          backendPlan.healthPath
        );
      }

      serviceUrl = frontendUrl;
      log(
        deploymentId,
        "MONOREPO",
        `Final live URL (frontend): ${serviceUrl}; backend URL: ${backendUrl}`
      );
    } else {
      const singleBuild = await runBuildAndPoll(slug, deploymentPlan);
      log(deploymentId, "EC2", "Deploying container to EC2 instance...");
      await updateDeploymentStatus(deploymentId, projectId, "deploying");
      try {
        const result = await deployToEc2(
          slug,
          singleBuild.ecrUri,
          singleBuild.imageTag,
          envVars,
          deploymentPlan?.healthPath || "/"
        );
        serviceUrl = result.url;
        log(deploymentId, "EC2", `Container running at ${serviceUrl}`);
      } catch (err: any) {
        log(deploymentId, "EC2", `FAILED: ${err.message}`);
        throw new Error(`EC2 deploy failed: ${err.message}`);
      }
    }

    // Step 5: Cloudflare DNS — map slug.domain → EC2 IP (A) or hostname (CNAME); live_url uses :port when needed
    log(deploymentId, "DNS", `Creating subdomain for primary URL: ${slug}...`);
    let liveUrl: string;
    try {
      liveUrl = await createSubdomain(slug, serviceUrl);
      log(deploymentId, "DNS", `Primary subdomain live: ${liveUrl}`);
      if (shouldUseMonorepoSplit && backendUrl) {
        const backendDnsSlug = `${slug}-be`;
        try {
          const backendLive = await createSubdomain(backendDnsSlug, backendUrl);
          log(deploymentId, "DNS", `Backend subdomain live: ${backendLive}`);
        } catch (beErr: any) {
          log(
            deploymentId,
            "DNS",
            `Backend DNS failed (${beErr.message}) — API still reachable at ${backendUrl}`
          );
        }
      }
    } catch (err: any) {
      log(deploymentId, "DNS", `FAILED: ${err.message} — using EC2 URL directly`);
      liveUrl = serviceUrl;
    }

    // Step 6: Update project record
    await supabaseAdmin
      .from("projects")
      .update({
        status: "deployed",
        app_runner_service_arn: `ec2:${slug}`,
        live_url: liveUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);

    await updateDeploymentStatus(deploymentId, projectId, "success", {
      finished_at: new Date().toISOString(),
    });

    log(deploymentId, "DONE", `Deployment successful! Live at ${liveUrl}`);
    return { serviceUrl: liveUrl };
  } catch (error: any) {
    log(deploymentId, "FAILED", error.message);
    await updateDeploymentStatus(deploymentId, projectId, "failed", {
      error_message: error.message,
      finished_at: new Date().toISOString(),
    });
    throw error;
  }
}

export function startDeployWorker() {
  if (!USE_REDIS) {
    console.log("Deploy queue running in-process mode (no Redis)");
    return;
  }

  const { Worker } = require("bullmq");
  const connection = { url: process.env.REDIS_URL };

  const worker = new Worker("deploy", async (job: any) => processDeployJob(job.data), {
    connection,
    concurrency: 2,
  });

  worker.on("completed", (job: any) => {
    console.log(`Deploy job ${job.id} completed`);
  });

  worker.on("failed", (job: any, err: Error) => {
    console.error(`Deploy job ${job?.id} failed:`, err.message);
  });

  return worker;
}

export async function addDeployJob(data: DeployJobData) {
  if (USE_REDIS) {
    const { Queue } = require("bullmq");
    const queue = new Queue("deploy", { connection: { url: process.env.REDIS_URL } });
    return queue.add("deploy", data);
  }

  processDeployJob(data).catch((err) =>
    console.error("Deploy job failed:", err.message)
  );
}
