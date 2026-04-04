import { Router, Response } from "express";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { supabaseAdmin } from "../db/supabase";
import { addDeployJob } from "../queue/deployQueue";
import { logger } from "../services/logger";

async function getUserGithubToken(userId: string): Promise<string | undefined> {
  const { data } = await supabaseAdmin
    .from("users")
    .select("github_access_token")
    .eq("id", userId)
    .single();
  return data?.github_access_token || undefined;
}

const router = Router();

router.post(
  "/:projectId",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const projectId = req.params.projectId as string;
    logger.info("DEPLOY", `Deploy requested for projectId=${projectId} by user=${req.userId}`);

    const { data: project, error } = await supabaseAdmin
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .eq("user_id", req.userId!)
      .single();

    if (error || !project) {
      logger.warn("DEPLOY", `Project not found or unauthorized: ${projectId}`);
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (project.status === "building") {
      logger.warn("DEPLOY", `Project ${project.slug} already building`);
      res.status(409).json({ error: "Deployment already in progress" });
      return;
    }

    // Create deployment record
    const { data: deployment, error: deployError } = await supabaseAdmin
      .from("deployments")
      .insert({
        project_id: projectId,
        status: "queued",
      })
      .select()
      .single();

    if (deployError || !deployment) {
      logger.error("DEPLOY", `Failed creating deployment record for project=${project.slug}`, deployError);
      res.status(500).json({ error: "Failed to create deployment" });
      return;
    }

    // Update project status
    await supabaseAdmin
      .from("projects")
      .update({ status: "building", updated_at: new Date().toISOString() })
      .eq("id", projectId);

    // Get GitHub token for private repo cloning
    const githubToken = await getUserGithubToken(req.userId!);
    logger.info(
      "DEPLOY",
      `Queueing deployment id=${deployment.id} for ${project.slug} (private clone token=${githubToken ? "yes" : "no"})`
    );

    // Add to deploy queue
    await addDeployJob({
      projectId,
      deploymentId: deployment.id,
      slug: project.slug,
      repoUrl: project.repo_url,
      stackInfo: project.stack_info,
      envVars: project.env_vars || [],
      githubToken,
    });

    res.json({ deployment, message: "Deployment started" });
  }
);

router.get(
  "/:projectId/status",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { projectId } = req.params;
    logger.info("DEPLOY_STATUS", `SSE status stream opened for projectId=${projectId}`);

    // SSE for real-time status
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const sendStatus = async () => {
      const { data: project } = await supabaseAdmin
        .from("projects")
        .select("status, live_url")
        .eq("id", projectId)
        .eq("user_id", req.userId!)
        .single();

      const { data: deployment } = await supabaseAdmin
        .from("deployments")
        .select("*")
        .eq("project_id", projectId)
        .order("started_at", { ascending: false })
        .limit(1)
        .single();

      if (project) {
        res.write(
          `data: ${JSON.stringify({ project, deployment })}\n\n`
        );
      }

      return project?.status === "deployed" || project?.status === "failed";
    };

    const done = await sendStatus();
    if (done) {
      res.end();
      return;
    }

    const interval = setInterval(async () => {
      const done = await sendStatus();
      if (done) {
        clearInterval(interval);
        res.end();
      }
    }, 3000);

    req.on("close", () => {
      clearInterval(interval);
      logger.info("DEPLOY_STATUS", `SSE status stream closed for projectId=${projectId}`);
    });
  }
);

router.get(
  "/:projectId/deployments",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { data, error } = await supabaseAdmin
      .from("deployments")
      .select("*")
      .eq("project_id", req.params.projectId)
      .order("started_at", { ascending: false })
      .limit(20);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ deployments: data });
  }
);

export default router;
