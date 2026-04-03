-- ZeroOps Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Users table
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  github_id text,
  avatar_url text,
  github_access_token text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Projects table
create type project_status as enum ('idle', 'building', 'deployed', 'failed');

create table if not exists public.projects (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  slug text not null unique,
  repo_url text not null,
  repo_owner text not null,
  repo_name text not null,
  stack_info jsonb default '{}',
  status project_status default 'idle',
  app_runner_service_arn text,
  live_url text,
  env_vars jsonb default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Deployments table
create type deployment_status as enum ('queued', 'building', 'pushing', 'deploying', 'success', 'failed');

create table if not exists public.deployments (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  status deployment_status default 'queued',
  build_log_url text,
  error_message text,
  started_at timestamptz default now(),
  finished_at timestamptz
);

-- Chat messages table
create type chat_role as enum ('user', 'assistant', 'tool');

create table if not exists public.chat_messages (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role chat_role not null,
  content text not null,
  tool_calls jsonb,
  created_at timestamptz default now()
);

-- Indexes
create index idx_projects_user_id on public.projects(user_id);
create index idx_projects_slug on public.projects(slug);
create index idx_deployments_project_id on public.deployments(project_id);
create index idx_chat_messages_project_id on public.chat_messages(project_id);

-- RLS policies
alter table public.users enable row level security;
alter table public.projects enable row level security;
alter table public.deployments enable row level security;
alter table public.chat_messages enable row level security;

create policy "Users can read own data" on public.users
  for select using (auth.uid() = id);

create policy "Users can update own data" on public.users
  for update using (auth.uid() = id);

create policy "Users can read own projects" on public.projects
  for select using (auth.uid() = user_id);

create policy "Users can insert own projects" on public.projects
  for insert with check (auth.uid() = user_id);

create policy "Users can update own projects" on public.projects
  for update using (auth.uid() = user_id);

create policy "Users can delete own projects" on public.projects
  for delete using (auth.uid() = user_id);

create policy "Users can read own deployments" on public.deployments
  for select using (
    exists (select 1 from public.projects where projects.id = deployments.project_id and projects.user_id = auth.uid())
  );

create policy "Users can read own chat messages" on public.chat_messages
  for select using (auth.uid() = user_id);

create policy "Users can insert own chat messages" on public.chat_messages
  for insert with check (auth.uid() = user_id);
