-- Replace single-key uniqueness with composite (visit + crew) so multi-technician
-- (team) jobs keep one busy block PER assigned technician instead of overwriting.
ALTER TABLE public.jobber_busy_blocks
  DROP CONSTRAINT IF EXISTS jobber_busy_blocks_jobber_visit_id_key;

DROP INDEX IF EXISTS public.jobber_busy_blocks_jobber_visit_id_key;

ALTER TABLE public.jobber_busy_blocks
  ADD CONSTRAINT jobber_busy_blocks_visit_crew_key UNIQUE (jobber_visit_id, crew_id);