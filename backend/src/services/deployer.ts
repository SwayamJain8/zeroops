import {
  CodeBuildClient,
  StartBuildCommand,
  BatchGetBuildsCommand,
} from "@aws-sdk/client-codebuild";
import {
  ECRClient,
  DescribeRepositoriesCommand,
  CreateRepositoryCommand,
} from "@aws-sdk/client-ecr";
import {
  AppRunnerClient,
  CreateServiceCommand,
  UpdateServiceCommand,
  DescribeServiceCommand,
  ListServicesCommand,
  StartDeploymentCommand,
  DeleteServiceCommand,
} from "@aws-sdk/client-apprunner";
import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { StackInfo } from "./analyzer";

const region = process.env.AWS_REGION || "us-east-1";
const accountId = process.env.AWS_ACCOUNT_ID!;

const codebuild = new CodeBuildClient({ region });
const ecr = new ECRClient({ region });
const apprunner = new AppRunnerClient({ region });
const cwLogs = new CloudWatchLogsClient({ region });

export function generateDockerfile(stack: StackInfo): string {
  // Use ECR Public Gallery mirrors to avoid Docker Hub rate limits
  const NODE_IMAGE = "public.ecr.aws/docker/library/node:20-alpine";
  const PYTHON_IMAGE = "public.ecr.aws/docker/library/python:3.12-slim";

  if (stack.type === "nextjs") {
    return `FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]`;
  }

  if (stack.backend === "node") {
    return `FROM ${NODE_IMAGE}
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
ENV PORT=3000
CMD ${JSON.stringify((stack.startCommand || "npm start").split(" "))}`;
  }

  if (stack.backend === "python") {
    return `FROM ${PYTHON_IMAGE}
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 3000
ENV PORT=3000
CMD ["python", "app.py"]`;
  }

  if (stack.frontend === "react") {
    const preferred = stack.buildOutputDir || "";
    return `FROM ${NODE_IMAGE}
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm install
COPY . .
RUN npm run build || npm run build --if-present
RUN npm i -g serve
ENV PREFERRED_OUTPUT_DIR="${preferred}"
EXPOSE 3000
CMD ["sh", "-c", "set -e; if [ -n \\"$PREFERRED_OUTPUT_DIR\\" ] && [ -f \\"/app/$PREFERRED_OUTPUT_DIR/index.html\\" ]; then TARGET=\\"/app/$PREFERRED_OUTPUT_DIR\\"; elif [ -f /app/dist/index.html ]; then TARGET=/app/dist; elif [ -f /app/build/index.html ]; then TARGET=/app/build; elif [ -f /app/out/index.html ]; then TARGET=/app/out; elif [ -f /app/public/index.html ]; then TARGET=/app/public; else echo 'No frontend build output found. Checked: preferred, dist, build, out, public'; echo 'Directory listing:'; ls -la /app; exit 1; fi; echo \\"Serving frontend from $TARGET\\"; serve -s \\"$TARGET\\" -l 3000"]`;
  }

  if (stack.frontend === "static") {
    return `FROM ${NODE_IMAGE}
WORKDIR /app
RUN npm i -g serve
COPY . /tmp/src
RUN if [ -f /tmp/src/index.html ]; then cp -r /tmp/src/* /app/; \\
    elif [ -f /tmp/src/dist/index.html ]; then cp -r /tmp/src/dist/* /app/; \\
    elif [ -f /tmp/src/build/index.html ]; then cp -r /tmp/src/build/* /app/; \\
    elif [ -f /tmp/src/public/index.html ]; then cp -r /tmp/src/public/* /app/; \\
    else echo "ERROR: No index.html found in root/dist/build/public"; ls -la /tmp/src; exit 1; fi
EXPOSE 3000
CMD ["serve", "-s", "/app", "-l", "3000"]`;
  }

  return `FROM ${NODE_IMAGE}
WORKDIR /app
COPY . .
RUN npm install --only=production 2>/dev/null || true
EXPOSE 3000
ENV PORT=3000
CMD ["npm", "start"]`;
}

export function generateBuildSpec(
  repoUrl: string,
  ecrRepoUri: string,
  imageTag: string,
  dockerfileContent: string,
  githubToken?: string,
  forceDockerfile: boolean = false
): string {
  const b64Dockerfile = Buffer.from(dockerfileContent).toString("base64");

  // Insert GitHub token into clone URL for private repos
  let cloneUrl = repoUrl;
  if (githubToken) {
    cloneUrl = repoUrl.replace(
      "https://github.com/",
      `https://${githubToken}@github.com/`
    );
  }

  return `version: 0.2
phases:
  pre_build:
    commands:
      - echo "=== Step 1/4 - Logging in to ECR ==="
      - aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${accountId}.dkr.ecr.${region}.amazonaws.com
      - echo "=== Step 2/4 - Cloning repository ==="
      - git clone ${cloneUrl} /app/repo
      - cd /app/repo
      - echo "=== Repo contents ==="
      - ls -la
      - |
        if [ ! -f Dockerfile ]; then
          echo "=== No Dockerfile found, generating one ==="
          echo "${b64Dockerfile}" | base64 -d > Dockerfile
          echo "=== Generated Dockerfile ==="
          cat Dockerfile
        else
          if [ "${forceDockerfile ? "1" : "0"}" = "1" ]; then
            echo "=== Forcing generated Dockerfile for this stack ==="
            echo "${b64Dockerfile}" | base64 -d > Dockerfile
            cat Dockerfile
          else
            echo "=== Using existing Dockerfile ==="
            cat Dockerfile
          fi
        fi
  build:
    commands:
      - echo "=== Step 3/4 - Building Docker image ==="
      - cd /app/repo
      - docker build -t ${ecrRepoUri}:${imageTag} .
  post_build:
    commands:
      - echo "=== Step 4/4 - Pushing to ECR ==="
      - docker push ${ecrRepoUri}:${imageTag}
      - echo "=== Build complete ==="`;
}

export async function ensureEcrRepo(slug: string): Promise<string> {
  const repoName = `${process.env.ECR_REPOSITORY_PREFIX || "zeroops"}/${slug}`;

  try {
    const { repositories } = await ecr.send(
      new DescribeRepositoriesCommand({ repositoryNames: [repoName] })
    );
    return repositories![0].repositoryUri!;
  } catch {
    const { repository } = await ecr.send(
      new CreateRepositoryCommand({
        repositoryName: repoName,
        imageScanningConfiguration: { scanOnPush: true },
      })
    );
    return repository!.repositoryUri!;
  }
}

export async function triggerBuild(
  projectSlug: string,
  repoUrl: string,
  stack: StackInfo,
  imageTag: string,
  githubToken?: string
): Promise<{ buildId: string; ecrUri: string }> {
  const ecrUri = await ensureEcrRepo(projectSlug);
  const dockerfile = generateDockerfile(stack);
  const forceDockerfile = stack.frontend === "static";
  const buildSpec = generateBuildSpec(
    repoUrl,
    ecrUri,
    imageTag,
    dockerfile,
    githubToken,
    forceDockerfile
  );

  const { build } = await codebuild.send(
    new StartBuildCommand({
      projectName: process.env.CODEBUILD_PROJECT_NAME || "zeroops-builder",
      buildspecOverride: buildSpec,
      sourceTypeOverride: "NO_SOURCE",
      environmentVariablesOverride: [
        { name: "IMAGE_TAG", value: imageTag, type: "PLAINTEXT" },
        { name: "ECR_REPO", value: ecrUri, type: "PLAINTEXT" },
      ],
    })
  );

  return { buildId: build!.id!, ecrUri };
}

export async function getBuildStatus(
  buildId: string
): Promise<{ status: string; complete: boolean }> {
  const { builds } = await codebuild.send(
    new BatchGetBuildsCommand({ ids: [buildId] })
  );

  const build = builds![0];
  return {
    status: build.buildStatus || "IN_PROGRESS",
    complete: build.buildComplete || false,
  };
}

export async function getCodeBuildLogs(buildId: string): Promise<string> {
  try {
    const { builds } = await codebuild.send(
      new BatchGetBuildsCommand({ ids: [buildId] })
    );
    const build = builds?.[0];
    if (!build?.logs?.groupName || !build?.logs?.streamName) {
      return "No build logs available.";
    }

    const { events } = await cwLogs.send(
      new GetLogEventsCommand({
        logGroupName: build.logs.groupName,
        logStreamName: build.logs.streamName,
        startFromHead: false,
        limit: 40,
      })
    );

    if (!events || events.length === 0) return "Build logs are empty.";

    return events
      .map((e) => e.message?.trim())
      .filter(Boolean)
      .join("\n");
  } catch (err: any) {
    return `Could not fetch build logs: ${err.message}`;
  }
}

export async function createOrUpdateAppRunner(
  slug: string,
  ecrUri: string,
  imageTag: string,
  envVars: { key: string; value: string }[]
): Promise<{ serviceArn: string; serviceUrl: string }> {
  const imageUri = `${ecrUri}:${imageTag}`;

  const runtimeEnv: Record<string, string> = { PORT: "3000" };
  envVars.forEach((v) => {
    runtimeEnv[v.key] = v.value;
  });

  const existingService = await findAppRunnerService(slug);

  if (existingService) {
    await apprunner.send(
      new UpdateServiceCommand({
        ServiceArn: existingService.arn,
        SourceConfiguration: {
          ImageRepository: {
            ImageIdentifier: imageUri,
            ImageRepositoryType: "ECR",
            ImageConfiguration: {
              Port: "3000",
              RuntimeEnvironmentVariables: runtimeEnv,
            },
          },
          AuthenticationConfiguration: {
            AccessRoleArn: `arn:aws:iam::${accountId}:role/AppRunnerECRAccessRole`,
          },
        },
      })
    );

    return { serviceArn: existingService.arn, serviceUrl: existingService.url };
  }

  const { Service } = await apprunner.send(
    new CreateServiceCommand({
      ServiceName: `zeroops-${slug}`,
      SourceConfiguration: {
        ImageRepository: {
          ImageIdentifier: imageUri,
          ImageRepositoryType: "ECR",
          ImageConfiguration: {
            Port: "3000",
            RuntimeEnvironmentVariables: runtimeEnv,
          },
        },
        AuthenticationConfiguration: {
          AccessRoleArn: `arn:aws:iam::${accountId}:role/AppRunnerECRAccessRole`,
        },
      },
      InstanceConfiguration: {
        Cpu: "0.25 vCPU",
        Memory: "0.5 GB",
      },
    })
  );

  return {
    serviceArn: Service!.ServiceArn!,
    serviceUrl: `https://${Service!.ServiceUrl}`,
  };
}

async function findAppRunnerService(
  slug: string
): Promise<{ arn: string; url: string } | null> {
  const { ServiceSummaryList } = await apprunner.send(
    new ListServicesCommand({})
  );

  const service = ServiceSummaryList?.find(
    (s) => s.ServiceName === `zeroops-${slug}`
  );

  if (!service) return null;

  const { Service } = await apprunner.send(
    new DescribeServiceCommand({ ServiceArn: service.ServiceArn! })
  );

  return {
    arn: Service!.ServiceArn!,
    url: `https://${Service!.ServiceUrl}`,
  };
}

export async function restartAppRunnerService(serviceArn: string) {
  await apprunner.send(
    new StartDeploymentCommand({ ServiceArn: serviceArn })
  );
}

export async function deleteAppRunnerService(serviceArn: string) {
  await apprunner.send(
    new DeleteServiceCommand({ ServiceArn: serviceArn })
  );
}
