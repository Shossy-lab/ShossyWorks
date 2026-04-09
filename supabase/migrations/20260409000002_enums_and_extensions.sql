-- Phase 1A-1: Enums & Extensions
-- Creates project_status and estimate_status CREATE TYPE enums.
-- Also ensures ltree extension exists (idempotent).
-- Note: app_role enum ALREADY EXISTS from 00000000000001_auth_roles.sql
--   with values: owner, employee, client
--   plus 'pending' added in 20260406000001_security_fixes.sql

-- ── Extensions (idempotent) ──────────────────────────────────
CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Project Status Enum ──────────────────────────────────────
-- 10 stages mirroring real construction project lifecycle.
-- Order matters: CREATE TYPE preserves definition order for < > comparisons.
CREATE TYPE public.project_status AS ENUM (
  'lead',
  'in_design',
  'bidding',
  'under_contract',
  'value_engineering',
  'active_construction',
  'closing_out',
  'warranty_period',
  'closed',
  'archived'
);

-- ── Estimate Status Enum ─────────────────────────────────────
-- 4 stages for estimate lifecycle.
-- Deliberately simple — "sent" and "approved" are tracked as events
-- in estimate_shares and estimate_approvals tables, not as statuses.
CREATE TYPE public.estimate_status AS ENUM (
  'draft',
  'preliminary',
  'active',
  'complete'
);

-- ── Node Type Enum ───────────────────────────────────────────
-- Already referenced in research but not yet created.
CREATE TYPE public.node_type AS ENUM (
  'group',
  'assembly',
  'item'
);

-- ── Client Visibility Enum ───────────────────────────────────
-- Three-level visibility for client-facing estimate views.
-- 'visible': client sees all fields
-- 'hidden': client cannot see the node at all
-- 'summary_only': client sees name + total price only (no detail breakdown)
CREATE TYPE public.client_visibility AS ENUM (
  'visible',
  'hidden',
  'summary_only'
);

-- ── Snapshot Type Enum ───────────────────────────────────────
CREATE TYPE public.snapshot_type AS ENUM (
  'milestone',
  'checkpoint'
);

-- ── Option Group Type Enum ───────────────────────────────────
-- 'selection': mutually exclusive alternatives (pick one)
-- 'toggle': additive on/off (include or exclude)
CREATE TYPE public.option_group_type AS ENUM (
  'selection',
  'toggle'
);

-- ── Approval Status Enum ─────────────────────────────────────
CREATE TYPE public.approval_status AS ENUM (
  'pending',
  'approved',
  'rejected'
);

-- ── Comment Author Type Enum ─────────────────────────────────
CREATE TYPE public.author_type AS ENUM (
  'user',
  'share'
);
