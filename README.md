# ZeroOps

AI-powered deployment that talks back. Deploy apps, debug failures, and fix issues through a chat interface.

## Architecture

- **Frontend**: Next.js 16 (App Router), TypeScript, Tailwind CSS v4, Watermelon UI
- **Backend**: Express 5, TypeScript
- **Auth + DB**: Supabase (GitHub OAuth + PostgreSQL)
- **AI**: Gemini 2.5 Flash with function calling
- **Infra**: AWS CodeBuild, ECR, App Runner
- **DNS**: Cloudflare (subdomain routing to `*.zeroops.com`)
- **Queue**: BullMQ (Redis) with in-process fallback

## Quick Start

### Prerequisites

- Node.js 20+
- A Supabase project with GitHub OAuth configured
- AWS account with CodeBuild project, ECR, and App Runner access
- Cloudflare zone for your domain
- Gemini API key
- Redis (optional, for production queue)

### Setup

```bash
# Clone and install
cp .env.example .env
# Fill in your values in .env

# Backend
cd backend
npm install
npm run dev

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

### Supabase Setup

1. Create a new Supabase project
2. Enable GitHub OAuth in Authentication > Providers
3. Run the SQL migration in `backend/supabase/migration.sql` via the SQL Editor
4. Copy your project URL and keys to `.env`

### AWS Setup

1. Create a CodeBuild project named `zeroops-builder` with Docker support
2. Create an IAM role `AppRunnerECRAccessRole` with ECR pull permissions
3. Ensure your AWS credentials have access to CodeBuild, ECR, App Runner, and CloudWatch Logs

### GitHub Webhook (for auto-redeploy)

1. In your GitHub repo, go to Settings > Webhooks
2. Payload URL: `https://your-backend.com/api/webhooks/github`
3. Content type: `application/json`
4. Secret: same as `GITHUB_WEBHOOK_SECRET` in `.env`
5. Events: Just the `push` event

## Environment Variables

See `.env.example` for the full list with descriptions.

## Project Structure

```
frontend/          Next.js app with chat-first UI
  src/app/         App Router pages (login, dashboard, project)
  src/components/  UI components (chat, project, shared)
  src/lib/         Supabase client, API client, types
  src/hooks/       React hooks (useSession)

backend/           Express API server
  src/routes/      REST + SSE endpoints
  src/services/    Business logic (deployer, agent, GitHub, logs)
  src/tools/       AI agent tool implementations
  src/queue/       BullMQ deploy job queue
  src/middleware/   Auth middleware
  supabase/        SQL migration
```

## User Flow

1. Sign in with GitHub
2. Create a project (paste a GitHub repo URL)
3. System auto-detects the stack (Node, Python, React, Next.js, etc.)
4. Click Deploy — CodeBuild builds a Docker image, pushes to ECR, runs on App Runner
5. Get a live URL at `project-slug.zeroops.com`
6. If deployment fails, ask the AI: "Why is it failing?"
7. AI fetches logs, diagnoses the error, and suggests a fix
8. Confirm the fix — AI creates a PR on GitHub
9. Merge the PR — webhook triggers auto-redeploy
