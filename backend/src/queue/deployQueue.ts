import { supabaseAdmin } from "../db/supabase";
import {
  triggerBuild,
  getBuildStatus,
  getCodeBuildLogs,
} from "../services/deployer";
import { deployToEc2 } from "../services/ec2Deployer";
import { createSubdomain } from "../services/domain";
import { StackInfo } from "../services/analyzer";

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

async function processDeployJob(data: DeployJobData) {
  const { projectId, deploymentId, slug, repoUrl, stackInfo, envVars, githubToken } = data;

  try {
    log(deploymentId, "START", `Project: ${slug} | Repo: ${repoUrl}`);
    log(deploymentId, "STACK", `Detected: type=${stackInfo.type}, frontend=${stackInfo.frontend}, backend=${stackInfo.backend}, hasDockerfile=${stackInfo.hasDockerfile}`);

    // Step 1: Ensure ECR repo exists
    log(deploymentId, "ECR", "Ensuring ECR repository exists...");
    await updateDeploymentStatus(deploymentId, projectId, "building");

    // Step 2: Trigger CodeBuild
    log(deploymentId, "CODEBUILD", "Triggering CodeBuild...");
    const imageTag = `deploy-${Date.now()}`;
    let buildId: string;
    let ecrUri: string;
    try {
      const result = await triggerBuild(slug, repoUrl, stackInfo, imageTag, githubToken);
      buildId = result.buildId;
      ecrUri = result.ecrUri;
      log(deploymentId, "CODEBUILD", `Build started: ${buildId}`);
      log(deploymentId, "ECR", `ECR repo: ${ecrUri}`);
    } catch (err: any) {
      log(deploymentId, "CODEBUILD", `FAILED to start build: ${err.message}`);
      throw new Error(`CodeBuild failed to start: ${err.message}`);
    }

    // Step 3: Poll build status
    log(deploymentId, "CODEBUILD", "Polling build status...");
    let buildComplete = false;
    let attempts = 0;
    const maxAttempts = 120;

    while (!buildComplete && attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const status = await getBuildStatus(buildId);

      if (attempts % 6 === 0) {
        log(deploymentId, "CODEBUILD", `Status: ${status.status} (attempt ${attempts}/${maxAttempts})`);
      }

      if (status.complete) {
        buildComplete = true;
        if (status.status !== "SUCCEEDED") {
          log(deploymentId, "CODEBUILD", `Build FAILED with status: ${status.status}`);
          log(deploymentId, "CODEBUILD", "Fetching build logs...");
          const buildLogs = await getCodeBuildLogs(buildId);
          log(deploymentId, "CODEBUILD", `Build logs:\n${buildLogs}`);
          throw new Error(`CodeBuild failed (${status.status}). Build logs:\n${buildLogs}`);
        }
        log(deploymentId, "CODEBUILD", "Build SUCCEEDED");
      }
      attempts++;
    }

    if (!buildComplete) {
      log(deploymentId, "CODEBUILD", "Build TIMED OUT after 10 minutes");
      throw new Error("CodeBuild timed out after 10 minutes");
    }

    // Step 4: Deploy container to EC2
    log(deploymentId, "EC2", "Deploying container to EC2 instance...");
    await updateDeploymentStatus(deploymentId, projectId, "deploying");

    let serviceUrl: string;
    try {
      const result = await deployToEc2(slug, ecrUri, imageTag, envVars);
      serviceUrl = result.url;
      log(deploymentId, "EC2", `Container running at ${serviceUrl}`);
    } catch (err: any) {
      log(deploymentId, "EC2", `FAILED: ${err.message}`);
      throw new Error(`EC2 deploy failed: ${err.message}`);
    }

    // Step 5: Create Cloudflare subdomain
    log(deploymentId, "DNS", `Creating subdomain: ${slug}...`);
    let liveUrl: string;
    try {
      liveUrl = await createSubdomain(slug, serviceUrl);
      log(deploymentId, "DNS", `Subdomain live: ${liveUrl}`);
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
