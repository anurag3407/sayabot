-- 0029_mcp_stdio_enum.sql
-- Local MCP apps (Airtable, Brave, Obsidian, …) speak over stdio, not HTTP.
-- ADD VALUE cannot run inside a transaction, so this file is only that statement.
alter type public.mcp_transport add value if not exists 'stdio';
