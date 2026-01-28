-- PART 1: Extend app_role enum with granular admin types
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'owner_admin';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'operations_admin';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'read_only_admin';