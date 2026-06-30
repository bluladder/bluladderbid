
CREATE OR REPLACE FUNCTION public.tg_recompute_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_customer uuid; v_new public.lead_lifecycle_status; v_current public.lead_lifecycle_status;
BEGIN
  v_customer := COALESCE(NEW.customer_id, OLD.customer_id);
  IF v_customer IS NULL THEN RETURN NEW; END IF;
  BEGIN
    v_new := public.compute_customer_lifecycle(v_customer);
    IF v_new IS NULL THEN RETURN NEW; END IF;
    SELECT lifecycle_status INTO v_current FROM public.customers WHERE id = v_customer;
    IF v_current IS DISTINCT FROM v_new THEN
      PERFORM public.apply_lifecycle_status(v_customer, v_new, 'auto');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'lifecycle recompute skipped for customer %: %', v_customer, SQLERRM;
  END;
  RETURN NEW;
END$$;
