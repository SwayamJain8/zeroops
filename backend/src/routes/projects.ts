import { Router, Response } from "express";
import { z } from "zod/v4";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { supabaseAdmin } from "../db/supabase";
import { createOctokitClient, fetchRepoTree, fetchKeyFiles } from "../services/github";
import {
  analyzeStackWithAIRefinement,
  type DeploymentIntent,
} from "../services/analyzer";
import {
  createRuleBasedPlan,
  refinePlanWithGemini,
} from "../services/deployPlanner";

const router = Router();

const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  repo_url: z.string().url(),
  deployment_type: z
    .enum([
      "single_frontend",
      "single_backend",
      "separate_frontend_backend",
      "monorepo_auto",
    ])
    .default("monorepo_auto"),
  env_vars: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function parseRepoUrl(url: string): { owner: string; repo: string } {
  const match = url.match(/github\.com\/([^/]+)\/([^/.\s]+)/);
  if (!match) throw new Error("Invalid GitHub repo URL");
  return { owner: match[1], repo: match[2] };
}

router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { data, error } = await supabaseAdmin
      .from("projects")
      .select("*, deployments(id, status, started_at, finished_at)")
      .eq("user_id", req.userId!)
      .order("created_at", { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ projects: data });
  }
);

router.get(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { data, error } = await supabaseAdmin
      .from("projects")
      .select("*, deployments(id, status, started_at, finished_at, error_message)")
      .eq("id", req.params.id)
      .eq("user_id", req.userId!)
      .single();

    if (error) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    res.json({ project: data });
  }
);

router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }

    const { name, repo_url, env_vars, deployment_type } = parsed.data;

    let repoInfo;
    try {
      repoInfo = parseRepoUrl(repo_url);
    } catch {
      res.status(400).json({ error: "Invalid GitHub repo URL" });
      return;
    }

    // Get user's GitHub token
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("github_access_token")
      .eq("id", req.userId!)
      .single();

    if (!user?.github_access_token) {
      res.status(400).json({ error: "GitHub token not found. Please re-authenticate." });
      return;
    }

    // Analyze repo
    let stackInfo;
    let deploymentPlan;
    try {
      const octokit = createOctokitClient(user.github_access_token);
      const tree = await fetchRepoTree(octokit, repoInfo.owner, repoInfo.repo);
      const keyFiles = await fetchKeyFiles(octokit, repoInfo.owner, repoInfo.repo, tree);
      stackInfo = await analyzeStackWithAIRefinement(
        tree,
        keyFiles,
        deployment_type as DeploymentIntent
      );
      const rulePlan = createRuleBasedPlan(tree, keyFiles, stackInfo);
      deploymentPlan = await refinePlanWithGemini(tree, keyFiles, stackInfo, rulePlan);
    } catch (err: any) {
      res.status(400).json({ error: `Failed to analyze repo: ${err.message}` });
      return;
    }

    const slug = slugify(name) + "-" + Math.random().toString(36).slice(2, 6);

    const { data, error } = await supabaseAdmin
      .from("projects")
      .insert({
        user_id: req.userId!,
        name,
        slug,
        repo_url,
        repo_owner: repoInfo.owner,
        repo_name: repoInfo.repo,
        stack_info: { ...stackInfo, deploymentMode: deployment_type, deploymentPlan },
        env_vars: env_vars || [],
        status: "idle",
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(201).json({ project: data });
  }
);

router.delete(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { error } = await supabaseAdmin
      .from("projects")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", req.userId!);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ success: true });
  }
);

export default router;
