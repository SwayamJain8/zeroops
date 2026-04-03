import { supabaseAdmin } from "../db/supabase";
import {
  createOctokitClient,
  createBranch,
  commitFile,
  createPullRequest,
} from "../services/github";

export const createFixPrToolDefinition = {
  name: "create_fix_pr",
  description:
    "Create a pull request with a code fix for the user's project. Use this when the user confirms they want to apply a fix you suggested.",
  parameters: {
    type: "object" as const,
    properties: {
      projectId: {
        type: "string",
        description: "The project ID to fix",
      },
      filePath: {
        type: "string",
        description: "Path to the file to modify (e.g., 'Dockerfile', 'package.json')",
      },
      newContent: {
        type: "string",
        description: "The full new content of the file",
      },
      commitMessage: {
        type: "string",
        description: "Descriptive commit message for the fix",
      },
      prTitle: {
        type: "string",
        description: "Title for the pull request",
      },
      prBody: {
        type: "string",
        description: "Description of what the fix does and why",
      },
    },
    required: [
      "projectId",
      "filePath",
      "newContent",
      "commitMessage",
      "prTitle",
      "prBody",
    ],
  },
};

export interface FixPrArgs {
  projectId: string;
  filePath: string;
  newContent: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
}

export async function executeCreateFixPr(args: FixPrArgs): Promise<string> {
  const { data: project, error: projError } = await supabaseAdmin
    .from("projects")
    .select("repo_owner, repo_name, user_id, name")
    .eq("id", args.projectId)
    .single();

  if (projError || !project) {
    return "Error: Project not found.";
  }

  const { data: user, error: userError } = await supabaseAdmin
    .from("users")
    .select("github_access_token")
    .eq("id", project.user_id)
    .single();

  if (userError || !user?.github_access_token) {
    return "Error: GitHub token not found. Please re-authenticate.";
  }

  try {
    const octokit = createOctokitClient(user.github_access_token);
    const branchName = `zeroops-fix/${Date.now()}`;

    await createBranch(
      octokit,
      project.repo_owner,
      project.repo_name,
      branchName
    );

    await commitFile(
      octokit,
      project.repo_owner,
      project.repo_name,
      branchName,
      args.filePath,
      args.newContent,
      args.commitMessage
    );

    const pr = await createPullRequest(
      octokit,
      project.repo_owner,
      project.repo_name,
      args.prTitle,
      `${args.prBody}\n\n---\n_Created by ZeroOps AI_`,
      branchName
    );

    return `Pull request created successfully!\n\n**${args.prTitle}**\n${pr.url}\n\nMerge the PR and the app will automatically redeploy.`;
  } catch (err: any) {
    return `Failed to create PR: ${err.message}`;
  }
}
