-- Computer providers: an E2B key per workspace, and a VPS reached by host, user and a
-- sealed SSH private key as well as by an SSH config alias. Idempotent.

alter table public.org_computer_settings
  add column if not exists e2b_ciphertext text,
  add column if not exists e2b_iv text,
  add column if not exists e2b_tag text,
  add column if not exists e2b_last4 text,
  add column if not exists vps_host text,
  add column if not exists vps_user text,
  add column if not exists vps_port integer,
  add column if not exists vps_key_ciphertext text,
  add column if not exists vps_key_iv text,
  add column if not exists vps_key_tag text;
