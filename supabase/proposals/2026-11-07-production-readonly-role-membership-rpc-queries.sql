-- ==============================================================================
-- ORVA STORE — Production READ-ONLY inspection queries (role membership + RPC)
-- Date: 2026-11-07
--
-- PURPOSE
--   Capture, for a LATER authorized manual run (Supabase SQL editor or an
--   authorized MCP connection), the evidence needed to close the two open
--   audit gaps:
--     Gap A — role memberships granting SELECT/UPDATE/DELETE on orders/rate_limits.
--     Gap B — SECURITY DEFINER / exposed RPC reaching orders, rate_limits or
--             other sensitive tables.
--
-- GUARANTEES
--   * This file contains SELECT statements ONLY.
--   * NO DDL, NO DML, NO GRANT, NO REVOKE — it never changes state.
--   * NO secrets: raw plan-qual expressions (polqual) are deliberately NOT
--     printed. The policy inventory shows metadata and a boolean marker only.
--   * Nothing in this file is run in this task. It is for manual, authorized
--     execution later. Local disposable equivalents were exercised instead.
--
-- HOW TO RUN (later)
--   1. Backup first: pg_dump -s (schema only) + snapshot of role/grant catalogs.
--   2. Run Q1..Q16 in order inside a role that can read pg_catalog (any SQL
--      editor connection is sufficient; nothing here requires elevated rights).
--   3. Do NOT paste results into channels that log output if Section Q14 is used.
--   4. Compare against the expected-empty/nonempty notes; record raw output in
--      the internal incident bundle, not in git.
--
-- WARNINGS
--   * Do NOT run on production without explicit approval.
--   * Do NOT extend this file with DDL/DML once executed.
-- ==============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- Q1. Direct roles relevant to the storefront and their attributes.
-- Expected: anon/authenticated are NOLOGIN, ROLINHERIT true, not SUPERUSER, not BYPASSRLS.
-- Any SUPERUSER/BYPASSRLS row in this output is an immediate escalation flag.
-- ──────────────────────────────────────────────────────────────────────────────
SELECT rolname, rolsuper, rolinherit, rolbypassrls, rolcanlogin
FROM pg_roles
WHERE rolname IN ('anon', 'authenticated', 'service_role', 'authenticator', 'postgres')
ORDER BY rolname;

-- ──────────────────────────────────────────────────────────────────────────────
-- Q2. Direct memberships of anon / authenticated (including grant options PG16+).
-- Reports INHERIT and SET options explicitly. Expected for a clean deployment:
-- ZERO rows for anon/authenticated, unless a deliberate, documented custom role exists.
-- ──────────────────────────────────────────────────────────────────────────────
SELECT granted_role.rolname AS granted_role,
       member_role.rolname AS member_role,
       am.admin_option,
       am.inherit_option,
       am.set_option
FROM pg_auth_members am
JOIN pg_roles granted_role ON granted_role.oid = am.roleid
JOIN pg_roles member_role ON member_role.oid = am.member
WHERE member_role.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY member_role.rolname, granted_role.rolname;

-- ──────────────────────────────────────────────────────────────────────────────
-- Q3. INDIRECT memberships (multi-hop) for anon / authenticated.
-- Semantics: INHERIT applies per hop — inherit_option=false anywhere in the path
-- breaks automatic inheritance for that path (SET ROLE may still work if set_option=true).
-- depth >= 2 indicates an intermediate role such as a custom "readers"/"admins" role.
-- Expected: zero rows, or only documented custom roles.
-- ──────────────────────────────────────────────────────────────────────────────
WITH RECURSIVE chain AS (
  SELECT member_role.rolname AS member_role,
         granted_role.rolname AS granted_role,
         1 AS depth,
         ARRAY[member_role.rolname, granted_role.rolname] AS path,
         am.inherit_option AS inherit_option,
         am.set_option AS set_option
  FROM pg_auth_members am
  JOIN pg_roles granted_role ON granted_role.oid = am.roleid
  JOIN pg_roles member_role ON member_role.oid = am.member
  WHERE member_role.rolname IN ('anon', 'authenticated')
  UNION ALL
  SELECT ch.member_role,
         granted_role.rolname,
         ch.depth + 1,
         ch.path || granted_role.rolname,
         ch.inherit_option AND am.inherit_option,
         ch.set_option AND am.set_option
  FROM chain ch
  JOIN pg_roles granted_mid ON granted_mid.rolname = ch.granted_role
  JOIN pg_auth_members am ON am.member = granted_mid.oid
  JOIN pg_roles granted_role ON granted_role.oid = am.roleid
  WHERE ch.depth < 8
    AND NOT (granted_role.rolname = ANY (ch.path))
)
SELECT member_role, granted_role, depth, inherit_option, set_option, array_to_string(path, ' -> ') AS path
FROM chain
ORDER BY member_role, depth, granted_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- Q4. Role-level attribute check for every non-system role granted to anon/authenticated.
-- Flags INHERIT=false (member must SET ROLE to use rights, usable as a containment
-- tool) and any SUPERUSER/BYPASSRLS intermediate role — separate from grant ACLs.
-- ──────────────────────────────────────────────────────────────────────────────
SELECT r.rolname, r.rolsuper, r.rolinherit, r.rolbypassrls
FROM pg_roles r
WHERE r.oid IN (SELECT DISTINCT roleid FROM pg_auth_members
                WHERE member IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')))
ORDER BY r.rolname;

-- ──────────────────────────────────────────────────────────────────────────────
-- Q5. Table-level privileges on orders and rate_limits (storefront-relevant grantees).
-- Catches residual direct grants and PUBLIC grants.
-- Expected after the four proposal files: zero rows for anon/authenticated/PUBLIC.
-- ──────────────────────────────────────────────────────────────────────────────
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('orders', 'rate_limits')
  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
ORDER BY table_name, grantee, privilege_type;

-- ──────────────────────────────────────────────────────────────────────────────
-- Q6. Column-level privileges on orders and rate_limits (same grantees).
-- Expected after proposals: zero rows for anon/authenticated/PUBLIC.
-- ──────────────────────────────────────────────────────────────────────────────
SELECT table_name, column_name, grantee, privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND table_name IN ('orders', 'rate_limits')
  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
ORDER BY table_name, grantee, column_name, privilege_type;

-- ──────────────────────────────────────────────────────────────────────────────
-- Q7. Policies on orders and rate_limits — metadata only (no polqual, no tokens).
-- 'has_token_literal' only signals a matching fragment exists in the policy body;
-- it does NOT reveal the value. Run outside verbose consoles.
-- ──────────────────────────────────────────────────────────────────────────────
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       p.polname AS policy_name,
       p.polcmd AS command,
       (SELECT array_agg(rolname ORDER BY rolname)
          FROM pg_roles r WHERE r.oid = ANY (p.polroles)) AS target_roles,
       CASE WHEN position('token' IN coalesce(p.polqual::text, '')) > 0 THEN true ELSE false END AS has_token_literal,
       octet_length(coalesce(p.polqual::text, '')) AS policy_expression_bytes,
       CASE WHEN position('token' IN coalesce(p.polwithcheck::text, '')) > 0 THEN true ELSE false END AS check_has_token_literal
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('orders', 'rate_limits')
ORDER BY c.relname, p.polname;

-- ──────────────────────────────────────────────────────────────────────────────
-- Q8. Roles with SUPERUSER or BYPASSRLS reachable by anon/authenticated directly
-- or via any membership path. Any row here means the storefront roles can reach a
-- high-privilege identity; inspect before applying ANY RLS-based proposal.
-- ──────────────────────────────────────────────────────────────────────────────
WITH RECURSIVE reachable AS (
  SELECT oid, rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
  UNION
  SELECT granted.oid, granted.rolname
  FROM reachable rr
  JOIN pg_auth_members am ON am.member = rr.oid
  JOIN pg_roles granted ON granted.oid = am.roleid
)
SELECT DISTINCT r.rolname, r.rolsuper, r.rolbypassrls
FROM reachable rr
JOIN pg_roles r ON r.oid = rr.oid
WHERE r.rolsuper OR r.rolbypassrls
ORDER BY r.rolname;

-- ──────────────────────────────────────────────────────────────────────────────
-- Q9. Views in public that any storefront role can read without base-table rights.
-- Owner-privileged (definer-style) views bypass caller privileges. A row here means
-- the proposal files do not close the path — WITH (security_invoker = on) or a
-- REVOKE SELECT on the view is required.
-- ──────────────────────────────────────────────────────────────────────────────
SELECT c.relname AS view_name,
       (SELECT rolname FROM pg_roles r WHERE r.oid = c.relowner) AS view_owner,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_can_select_view,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_can_select_view
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'v'
  AND (
    has_table_privilege('anon', c.oid, 'SELECT')
    OR has_table_privilege('authenticated', c.oid, 'SELECT')
  )
ORDER BY c.relname;

-- ──────────────────────────────────────────────────────────────────────────────
-- Q10. SECURITY DEFINER functions in public (and any other exposed schema).
-- proconfig tells whether a fixed search_path was pinned; NULL/missing means the
-- definer is search-sensitive and must be reviewed before exposing EXECUTE.
-- ──────────────────────────────────────────────────────────────────────────────
SELECT n.nspname AS schema_name,
       p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       (SELECT rolname FROM pg_roles r WHERE r.oid = p.proowner) AS owner,
       p.prosecdef AS security_definer,
       p.proconfig AS role_search_path,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
       has_function_privilege('PUBLIC', p.oid, 'EXECUTE') AS public_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public')
ORDER BY n.nspname, p.proname;

-- ──────────────────────────────────────────────────────────────────────────────
-- Q11. EXECUTE privileges on every function in public, as seen by storefront grantees.
-- Signature-qualified, so arguments are covered per overload.
-- ──────────────────────────────────────────────────────────────────────────────
SELECT n.nspname AS schema_name,
       p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       (SELECT rolname FROM pg_roles r WHERE r.oid = p.proowner) AS owner,
       p.prosecdef AS security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
       has_function_privilege('PUBLIC', p.oid, 'EXECUTE') AS public_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public')
ORDER BY n.nspname, p.proname, arguments;

-- ──────────────────────────────────────────────────────────────────────────────
-- Q12. Functions whose declared implementation references public.orders or
-- public.rate_limits via hard dependencies (pg_depend). Dynamic EXECUTE() and
-- string-based table references are NOT captured — cross-check with Q10/Q11 and
-- pg_get_functiondef for functions that reach orders/rate_limits indirectly.
-- ──────────────────────────────────────────────────────────────────────────────
SELECT DISTINCT n.nspname AS schema_name,
       p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       CASE dep.refobjid WHEN 'public.orders'::regclass THEN 'orders' ELSE 'rate_limits' END AS references_table,
       p.prosecdef AS security_definer,
       (SELECT rolname FROM pg_roles r WHERE r.oid = p.proowner) AS owner
FROM pg_depend dep
JOIN pg_proc p ON p.oid = dep.objid
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE dep.refobjid IN ('public.orders'::regclass, 'public.rate_limits'::regclass)
ORDER BY references_table, n.nspname, p.proname;

-- ──────────────────────────────────────────────────────────────────────────────
-- Q13. SECURITY DEFINER functions with no pinned search_path.
-- Any row here must be reviewed: move to a non-exposed schema, set search_path,
-- or convert to SECURITY INVOKER as appropriate. Do NOT mass-revoke EXECUTE.
-- ──────────────────────────────────────────────────────────────────────────────
SELECT n.nspname AS schema_name,
       p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       p.proconfig AS role_search_path
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prosecdef
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS setting
    WHERE setting LIKE 'search_path=%'
  )
ORDER BY n.nspname, p.proname;

-- ──────────────────────────────────────────────────────────────────────────────
-- Q14. ACLs on functions (raw pg_proc.proacl). Interpretation help:
--   NULL      -> default ACL in effect (EXECUTE usually to PUBLIC)
--   contains  anon=e / authenticated=e / =e  -> explicit storefront grants
-- Use to confirm whether Q11's booleans match the underlying ACL.
-- ──────────────────────────────────────────────────────────────────────────────
SELECT n.nspname AS schema_name,
       p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       p.prosecdef AS security_definer,
       p.proacl AS acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public')
ORDER BY n.nspname, p.proname;

-- ──────────────────────────────────────────────────────────────────────────────
-- Q15. Post-proposals residue on orders / rate_limits for storefront grantees.
-- ZERO rows expected for SELECT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER.
-- INSERT rows for anon/authenticated are expected (Checkout) and reviewed separately.
-- ──────────────────────────────────────────────────────────────────────────────
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       grantee.rolname AS grantee,
       privilege_type
FROM (
  SELECT DISTINCT grantee, privilege_type, table_schema AS schema_field, table_name
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name IN ('orders', 'rate_limits')
) gt
JOIN pg_namespace n ON n.nspname = gt.schema_field
JOIN pg_class c ON c.relname = gt.table_name AND c.relnamespace = n.oid
JOIN pg_roles grantee ON grantee.rolname = gt.grantee OR gt.grantee = 'PUBLIC'
WHERE gt.grantee IN ('anon', 'authenticated', 'PUBLIC')
  AND gt.privilege_type IN ('SELECT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
ORDER BY c.relname, grantee.rolname, privilege_type;

-- ──────────────────────────────────────────────────────────────────────────────
-- Q16. Function EXECUTE residue for PUBLIC/anon/authenticated (post-remediation).
-- ZERO rows expected for any definer that reads/writes orders or rate_limits.
-- (Dynamic-EXECUTE functions also appear here if they carry catalog dependencies.)
-- ──────────────────────────────────────────────────────────────────────────────
SELECT n.nspname AS schema_name,
       p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       p.prosecdef AS security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
       has_function_privilege('PUBLIC', p.oid, 'EXECUTE') AS public_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public')
  AND p.prosecdef
  AND (
    has_function_privilege('anon', p.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
    OR has_function_privilege('PUBLIC', p.oid, 'EXECUTE')
  )
ORDER BY n.nspname, p.proname;

-- ==============================================================================
-- End of file. Expected companion artifacts:
--   * Backup of pg_policy, role_table_grants, column_privileges for public.orders
--     and public.rate_limits BEFORE any proposal execution.
--   * Incident bundle capturing Q1..Q16 output (internal storage, not git).
--   * A separate, explicitly-scoped membership remediation proposal ONLY if Q2/Q3
--     (or Q8) returns rows — never a broad unqualified membership revocation.
-- ==============================================================================
