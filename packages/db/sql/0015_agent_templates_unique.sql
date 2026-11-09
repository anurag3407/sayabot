-- Fix unique index on agent_templates so ON CONFLICT (org_id, slug) works for both NULL and non-NULL org_id
drop index if exists public.agent_templates_org_slug_idx;
create unique index agent_templates_org_slug_idx
  on public.agent_templates (org_id, slug) nulls not distinct;
