-- 0028_mcp_oauth.sql
-- Browser sign-in (OAuth 2.1 + dynamic client registration) for MCP servers, so Marketplace apps
-- that only offer "Sign in with ..." can be connected from inside Sayabot.
-- Idempotent: migrate.ts re-applies every file in sql/ on each run.

alter table public.mcp_servers
  add column if not exists auth_kind text not null default 'static',
  add column if not exists oauth_enc text,
  add column if not exists auth_status text not null default 'ok',
  add column if not exists catalog_app text;

do $$ begin
  alter table public.mcp_servers
    add constraint mcp_servers_auth_kind_check check (auth_kind in ('static', 'oauth'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.mcp_servers
    add constraint mcp_servers_auth_status_check check (auth_status in ('ok', 'pending', 'signed_out'));
exception when duplicate_object then null;
end $$;

create index if not exists mcp_servers_catalog_app_idx
  on public.mcp_servers (org_id, catalog_app);

-- oauth_enc is sealed with MESH_KEK like headers_enc, so RLS reads of the row expose no tokens.
