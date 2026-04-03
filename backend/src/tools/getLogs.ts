import { supabaseAdmin } from "../db/supabase";
import { getRecentErrors, getAppRunnerLogs } from "../services/logs";

export const getLogsToolDefinition = {
  name: "get_logs",
  description:
    "Fetch recent application logs for a project. Returns error logs by default. Use this when the user asks why their app is failing or wants to see logs.",
  parameters: {
    type: "object" as const,
    properties: {
      projectId: {
        type: "string",
        description: "The project ID to get logs for",
      },
      errorsOnly: {
        type: "boolean",
        description: "If true, only return error/warning logs. Defaults to true.",
      },
    },
    required: ["projectId"],
  },
};

export async function executeGetLogs(
  projectId: string,
  errorsOnly: boolean = true
): Promise<string> {
  const { data: project, error } = await supabaseAdmin
    .from("projects")
    .select("app_runner_service_arn, status, name, stack_info")
    .eq("id", projectId)
    .single();

  if (error || !project) {
    return "Error: Project not found.";
  }

  // Check recent deployment records for errors (works even before App Runner is created)
  const { data: recentDeployments } = await supabaseAdmin
    .from("deployments")
    .select("status, error_message, started_at, finished_at")
    .eq("project_id", projectId)
    .order("started_at", { ascending: false })
    .limit(5);

  const failedDeployments = recentDeployments?.filter(
    (d) => d.status === "failed" && d.error_message
  );

  let deploymentErrors = "";
  if (failedDeployments && failedDeployments.length > 0) {
    deploymentErrors = failedDeployments
      .map(
        (d) =>
          `[${new Date(d.started_at).toISOString()}] [DEPLOY FAILED] ${d.error_message}`
      )
      .join("\n");
  }

  // If no App Runner service exists, return deployment errors or helpful message
  if (!project.app_runner_service_arn) {
    if (deploymentErrors) {
      return `Project "${project.name}" (stack: ${JSON.stringify(project.stack_info)}) failed during deployment. No App Runner service was created.\n\nDeployment errors:\n${deploymentErrors}\n\nThe build likely failed during the CodeBuild phase (Docker build). Common causes:\n- Missing Dockerfile or incorrect auto-generated Dockerfile\n- Build command failing (missing dependencies)\n- Wrong port configuration`;
    }

    if (project.status === "idle") {
      return `Project "${project.name}" has not been deployed yet. Use deploy_app to start a deployment.`;
    }

    return `Project "${project.name}" is in status "${project.status}" but has no App Runner service. ${
      project.status === "building"
        ? "A deployment is currently in progress."
        : "Try deploying again."
    }`;
  }

  // Try fetching App Runner logs
  try {
    const logs = errorsOnly
      ? await getRecentErrors(project.app_runner_service_arn, 20)
      : await getAppRunnerLogs(project.app_runner_service_arn, false, 20);

    let result = "";

    if (logs.length > 0) {
      const formatted = logs
        .map(
          (l) =>
            `[${new Date(l.timestamp).toISOString()}] [${l.level.toUpperCase()}] ${l.message}`
        )
        .join("\n");
      result += `Recent ${errorsOnly ? "error " : ""}logs for "${project.name}":\n\n${formatted}`;
    } else {
      result += errorsOnly
        ? "No errors found in application logs."
        : "No application logs found yet.";
    }

    if (deploymentErrors) {
      result += `\n\nRecent deployment failures:\n${deploymentErrors}`;
    }

    return result;
  } catch (err: any) {
    let result = `Failed to fetch application logs: ${err.message}`;
    if (deploymentErrors) {
      result += `\n\nBut here are the deployment errors:\n${deploymentErrors}`;
    }
    return result;
  }
}
