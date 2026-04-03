import { Octokit } from "@octokit/rest";

export interface RepoFile {
  path: string;
  type: "file" | "dir";
  size?: number;
}

export interface RepoContents {
  files: RepoFile[];
  fileContents: Record<string, string>;
}

export function createOctokitClient(token: string): Octokit {
  return new Octokit({ auth: token });
}

export async function fetchRepoTree(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<RepoFile[]> {
  const { data } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: "HEAD",
    recursive: "true",
  });

  return data.tree
    .filter((item) => item.path && item.type)
    .map((item) => ({
      path: item.path!,
      type: item.type === "blob" ? "file" : "dir",
      size: item.size,
    }));
}

const KEY_FILES = [
  "package.json",
  "requirements.txt",
  "Pipfile",
  "pyproject.toml",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "index.html",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "tsconfig.json",
  "vite.config.ts",
  "vite.config.js",
  "angular.json",
  "nuxt.config.ts",
  ".env.example",
  "go.mod",
  "Cargo.toml",
  "Gemfile",
];

export async function fetchKeyFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  tree: RepoFile[]
): Promise<Record<string, string>> {
  const contents: Record<string, string> = {};
  const filesToFetch = tree.filter(
    (f) => f.type === "file" && KEY_FILES.includes(f.path.split("/").pop()!)
  );

  const rootFiles = filesToFetch.filter(
    (f) => !f.path.includes("/") || f.path.split("/").length <= 2
  );

  await Promise.all(
    rootFiles.slice(0, 10).map(async (file) => {
      try {
        const { data } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: file.path,
        });
        if ("content" in data && data.content) {
          contents[file.path] = Buffer.from(data.content, "base64").toString(
            "utf-8"
          );
        }
      } catch {
        // skip unreadable files
      }
    })
  );

  return contents;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  private: boolean;
  language: string | null;
  updated_at: string;
  default_branch: string;
}

export async function listUserRepos(
  octokit: Octokit,
  page: number = 1,
  perPage: number = 30
): Promise<{ repos: GitHubRepo[]; hasMore: boolean }> {
  const { data } = await octokit.rest.repos.listForAuthenticatedUser({
    sort: "updated",
    direction: "desc",
    per_page: perPage,
    page,
    affiliation: "owner,collaborator,organization_member",
  });

  return {
    repos: data.map((r) => ({
      id: r.id,
      name: r.name,
      full_name: r.full_name,
      html_url: r.html_url,
      description: r.description,
      private: r.private,
      language: r.language,
      updated_at: r.updated_at || "",
      default_branch: r.default_branch,
    })),
    hasMore: data.length === perPage,
  };
}

export async function searchUserRepos(
  octokit: Octokit,
  query: string
): Promise<GitHubRepo[]> {
  const { data: user } = await octokit.rest.users.getAuthenticated();
  const { data } = await octokit.rest.search.repos({
    q: `${query} user:${user.login}`,
    sort: "updated",
    per_page: 20,
  });

  return data.items.map((r) => ({
    id: r.id,
    name: r.name,
    full_name: r.full_name,
    html_url: r.html_url,
    description: r.description,
    private: r.private,
    language: r.language,
    updated_at: r.updated_at || "",
    default_branch: r.default_branch,
  }));
}

export async function createBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  branchName: string,
  baseBranch: string = "main"
): Promise<string> {
  const { data: ref } = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${baseBranch}`,
  });

  const { data: newRef } = await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: ref.object.sha,
  });

  return newRef.object.sha;
}

export async function commitFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  filePath: string,
  content: string,
  message: string
) {
  const { data: existingFile } = await octokit.rest.repos
    .getContent({ owner, repo, path: filePath, ref: branch })
    .catch(() => ({ data: null }));

  const sha = existingFile && "sha" in existingFile ? existingFile.sha : undefined;

  return octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: filePath,
    message,
    content: Buffer.from(content).toString("base64"),
    branch,
    sha,
  });
}

export async function createPullRequest(
  octokit: Octokit,
  owner: string,
  repo: string,
  title: string,
  body: string,
  head: string,
  base: string = "main"
) {
  const { data } = await octokit.rest.pulls.create({
    owner,
    repo,
    title,
    body,
    head,
    base,
  });

  return { url: data.html_url, number: data.number };
}
