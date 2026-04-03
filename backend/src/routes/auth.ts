import { Router, Response } from "express";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { supabaseAdmin } from "../db/supabase";
import { createOctokitClient, listUserRepos, searchUserRepos } from "../services/github";

const router = Router();

router.get(
  "/me",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("id", req.userId!)
      .single();

    if (error) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({ user: data });
  }
);

router.post(
  "/sync",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { github_id, avatar_url, github_access_token } = req.body;

    const { data, error } = await supabaseAdmin
      .from("users")
      .upsert(
        {
          id: req.userId!,
          email: req.userEmail!,
          github_id,
          avatar_url,
          github_access_token,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      )
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ user: data });
  }
);

router.get(
  "/repos",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const search = req.query.search as string | undefined;

    const { data: user } = await supabaseAdmin
      .from("users")
      .select("github_access_token")
      .eq("id", req.userId!)
      .single();

    if (!user?.github_access_token) {
      res.status(400).json({ error: "GitHub token not found. Please re-login." });
      return;
    }

    try {
      const octokit = createOctokitClient(user.github_access_token);

      if (search && search.trim()) {
        const repos = await searchUserRepos(octokit, search.trim());
        res.json({ repos, hasMore: false });
      } else {
        const result = await listUserRepos(octokit, page, 30);
        res.json(result);
      }
    } catch (err: any) {
      res.status(500).json({ error: `Failed to fetch repos: ${err.message}` });
    }
  }
);

export default router;
