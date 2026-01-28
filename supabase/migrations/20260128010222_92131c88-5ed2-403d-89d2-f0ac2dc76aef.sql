-- Update technicians table with capability fields (stored in service_capabilities JSON)
-- The service_capabilities column already exists as JSONB, we'll use it for structured capabilities

-- Seed default eligibility rules if none exist
INSERT INTO eligibility_rules (rule_name, priority, rule_type, conditions, description, is_active)
SELECT 
  'Windows-only requires bundle-eligible tech',
  10,
  'hard_exclude',
  jsonb_build_object(
    'services_include', ARRAY['windows_exterior', 'windows_interior'],
    'services_exclude', ARRAY['gutters', 'house_wash', 'pressure_wash_addon', 'driveway'],
    'exclude_capability', 'requires_bundle_for_windows'
  ),
  'Exclude technicians who require bundle (gutters/pressure) when booking is windows-only',
  true
WHERE NOT EXISTS (SELECT 1 FROM eligibility_rules WHERE rule_name = 'Windows-only requires bundle-eligible tech');

INSERT INTO eligibility_rules (rule_name, priority, rule_type, conditions, description, is_active)
SELECT 
  'Pressure washing requires equipment',
  5,
  'hard_exclude',
  jsonb_build_object(
    'services_include', ARRAY['pressure_wash_addon', 'driveway', 'house_wash'],
    'require_capability', 'has_pressure_washer'
  ),
  'Only technicians with pressure washing equipment can do pressure washing services',
  true
WHERE NOT EXISTS (SELECT 1 FROM eligibility_rules WHERE rule_name = 'Pressure washing requires equipment');

INSERT INTO eligibility_rules (rule_name, priority, rule_type, conditions, description, is_active)
SELECT 
  'Big job auto-crew assignment',
  1,
  'preference',
  jsonb_build_object(
    'min_price', 900,
    'require_crew_size', 2,
    'require_capability', 'eligible_for_big_job_pairing'
  ),
  'Jobs over threshold automatically get assigned to two-person crew',
  true
WHERE NOT EXISTS (SELECT 1 FROM eligibility_rules WHERE rule_name = 'Big job auto-crew assignment');

INSERT INTO eligibility_rules (rule_name, priority, rule_type, conditions, description, is_active)
SELECT 
  'Gutter cleaning capability required',
  15,
  'hard_exclude',
  jsonb_build_object(
    'services_include', ARRAY['gutters'],
    'require_capability', 'can_do_gutters'
  ),
  'Only technicians with gutter cleaning capability can perform gutter services',
  true
WHERE NOT EXISTS (SELECT 1 FROM eligibility_rules WHERE rule_name = 'Gutter cleaning capability required');

-- Ensure big_job_settings has a default row
INSERT INTO big_job_settings (id, big_job_value_threshold, auto_assign_two_techs, crew_efficiency_factor, allowed_tech_pairs)
SELECT 
  'default',
  900,
  true,
  1.8,
  '[]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM big_job_settings WHERE id = 'default');