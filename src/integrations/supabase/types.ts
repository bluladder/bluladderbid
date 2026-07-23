export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      ai_escalations: {
        Row: {
          alert_count: number
          alert_error: string | null
          alert_last_attempt_at: string | null
          alert_status: string
          assigned_recipient: string | null
          best_callback_time: string | null
          category: string
          claimed_at: string | null
          claimed_by: string | null
          conversation_id: string | null
          created_at: string
          email_alert_error: string | null
          email_alert_status: string | null
          email_provider_response: string | null
          id: string
          last_alert_severity: string | null
          prospect_email: string | null
          prospect_name: string | null
          prospect_phone: string | null
          record_ref: string | null
          requested_contact_method: string | null
          resolution_notes: string | null
          resolved_at: string | null
          service_address: string | null
          service_requested: string | null
          severity: string
          sms_alert_status: string | null
          sms_provider_response: string | null
          status: string
          summary: string | null
          updated_at: string
        }
        Insert: {
          alert_count?: number
          alert_error?: string | null
          alert_last_attempt_at?: string | null
          alert_status?: string
          assigned_recipient?: string | null
          best_callback_time?: string | null
          category: string
          claimed_at?: string | null
          claimed_by?: string | null
          conversation_id?: string | null
          created_at?: string
          email_alert_error?: string | null
          email_alert_status?: string | null
          email_provider_response?: string | null
          id?: string
          last_alert_severity?: string | null
          prospect_email?: string | null
          prospect_name?: string | null
          prospect_phone?: string | null
          record_ref?: string | null
          requested_contact_method?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          service_address?: string | null
          service_requested?: string | null
          severity?: string
          sms_alert_status?: string | null
          sms_provider_response?: string | null
          status?: string
          summary?: string | null
          updated_at?: string
        }
        Update: {
          alert_count?: number
          alert_error?: string | null
          alert_last_attempt_at?: string | null
          alert_status?: string
          assigned_recipient?: string | null
          best_callback_time?: string | null
          category?: string
          claimed_at?: string | null
          claimed_by?: string | null
          conversation_id?: string | null
          created_at?: string
          email_alert_error?: string | null
          email_alert_status?: string | null
          email_provider_response?: string | null
          id?: string
          last_alert_severity?: string | null
          prospect_email?: string | null
          prospect_name?: string | null
          prospect_phone?: string | null
          record_ref?: string | null
          requested_contact_method?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          service_address?: string | null
          service_requested?: string | null
          severity?: string
          sms_alert_status?: string | null
          sms_provider_response?: string | null
          status?: string
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_escalations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_config: {
        Row: {
          created_at: string
          id: boolean
          inactivity_threshold_minutes: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: boolean
          inactivity_threshold_minutes?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: boolean
          inactivity_threshold_minutes?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      attribution_events: {
        Row: {
          booking_id: string | null
          created_at: string
          customer_id: string | null
          fbclid: string | null
          first_touch: Json | null
          id: string
          jobber_client_id: string | null
          jobber_job_id: string | null
          landing_page_slug: string | null
          last_touch: Json | null
          quote_id: string | null
          referrer: string | null
          source_session_id: string
          updated_at: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          customer_id?: string | null
          fbclid?: string | null
          first_touch?: Json | null
          id?: string
          jobber_client_id?: string | null
          jobber_job_id?: string | null
          landing_page_slug?: string | null
          last_touch?: Json | null
          quote_id?: string | null
          referrer?: string | null
          source_session_id: string
          updated_at?: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          customer_id?: string | null
          fbclid?: string | null
          first_touch?: Json | null
          id?: string
          jobber_client_id?: string | null
          jobber_job_id?: string | null
          landing_page_slug?: string | null
          last_touch?: Json | null
          quote_id?: string | null
          referrer?: string | null
          source_session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attribution_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "admin_marketing_funnel"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "attribution_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attribution_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attribution_events_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "admin_marketing_funnel"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "attribution_events_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      autosync_config: {
        Row: {
          created_at: string
          earliest_coverage_date: string | null
          enabled: boolean
          far_term_current_horizon_days: number
          far_term_daily_chunk_days: number
          far_term_max_horizon_days: number
          id: string
          last_far_term_sync: string | null
          last_full_sync_completed_at: string | null
          last_near_term_sync: string | null
          last_run_error: string | null
          last_run_status: string | null
          latest_coverage_date: string | null
          lock_acquired_at: string | null
          lock_holder_id: string | null
          near_term_horizon_days: number
          near_term_interval_minutes: number
          total_blocks_synced: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          earliest_coverage_date?: string | null
          enabled?: boolean
          far_term_current_horizon_days?: number
          far_term_daily_chunk_days?: number
          far_term_max_horizon_days?: number
          id?: string
          last_far_term_sync?: string | null
          last_full_sync_completed_at?: string | null
          last_near_term_sync?: string | null
          last_run_error?: string | null
          last_run_status?: string | null
          latest_coverage_date?: string | null
          lock_acquired_at?: string | null
          lock_holder_id?: string | null
          near_term_horizon_days?: number
          near_term_interval_minutes?: number
          total_blocks_synced?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          earliest_coverage_date?: string | null
          enabled?: boolean
          far_term_current_horizon_days?: number
          far_term_daily_chunk_days?: number
          far_term_max_horizon_days?: number
          id?: string
          last_far_term_sync?: string | null
          last_full_sync_completed_at?: string | null
          last_near_term_sync?: string | null
          last_run_error?: string | null
          last_run_status?: string | null
          latest_coverage_date?: string | null
          lock_acquired_at?: string | null
          lock_holder_id?: string | null
          near_term_horizon_days?: number
          near_term_interval_minutes?: number
          total_blocks_synced?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      availability_cache: {
        Row: {
          cache_key: string
          cached_at: string
          created_at: string
          expires_at: string
          from_date: string
          id: string
          to_date: string
          visits_json: Json
        }
        Insert: {
          cache_key: string
          cached_at?: string
          created_at?: string
          expires_at?: string
          from_date: string
          id?: string
          to_date: string
          visits_json?: Json
        }
        Update: {
          cache_key?: string
          cached_at?: string
          created_at?: string
          expires_at?: string
          from_date?: string
          id?: string
          to_date?: string
          visits_json?: Json
        }
        Relationships: []
      }
      big_job_settings: {
        Row: {
          allowed_tech_pairs: Json
          auto_assign_two_techs: boolean
          big_job_solo_hours_threshold: number | null
          big_job_trigger_mode: string | null
          big_job_value_threshold: number
          created_at: string
          crew_efficiency_factor: number
          id: string
          min_buffer_minutes: number | null
          pairing_mode: string | null
          updated_at: string
          workday_end_time: string | null
          workday_length_hours: number | null
          workday_start_time: string | null
        }
        Insert: {
          allowed_tech_pairs?: Json
          auto_assign_two_techs?: boolean
          big_job_solo_hours_threshold?: number | null
          big_job_trigger_mode?: string | null
          big_job_value_threshold?: number
          created_at?: string
          crew_efficiency_factor?: number
          id?: string
          min_buffer_minutes?: number | null
          pairing_mode?: string | null
          updated_at?: string
          workday_end_time?: string | null
          workday_length_hours?: number | null
          workday_start_time?: string | null
        }
        Update: {
          allowed_tech_pairs?: Json
          auto_assign_two_techs?: boolean
          big_job_solo_hours_threshold?: number | null
          big_job_trigger_mode?: string | null
          big_job_value_threshold?: number
          created_at?: string
          crew_efficiency_factor?: number
          id?: string
          min_buffer_minutes?: number | null
          pairing_mode?: string | null
          updated_at?: string
          workday_end_time?: string | null
          workday_length_hours?: number | null
          workday_start_time?: string | null
        }
        Relationships: []
      }
      booking_audit_log: {
        Row: {
          action: string
          booking_id: string
          changed_by: string
          changed_by_id: string | null
          created_at: string
          id: string
          is_admin_override: boolean
          new_values: Json | null
          old_values: Json | null
        }
        Insert: {
          action: string
          booking_id: string
          changed_by?: string
          changed_by_id?: string | null
          created_at?: string
          id?: string
          is_admin_override?: boolean
          new_values?: Json | null
          old_values?: Json | null
        }
        Update: {
          action?: string
          booking_id?: string
          changed_by?: string
          changed_by_id?: string | null
          created_at?: string
          id?: string
          is_admin_override?: boolean
          new_values?: Json | null
          old_values?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_audit_log_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "admin_marketing_funnel"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "booking_audit_log_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_crew_assignments: {
        Row: {
          booking_id: string
          calculated_duration_minutes: number | null
          created_at: string
          id: string
          leader_technician_id: string
          public_crew_label: string | null
          requires_admin_review: boolean
          review_reason: string | null
          staffing_segments: Json
          supporting_technician_ids: string[]
          updated_at: string
        }
        Insert: {
          booking_id: string
          calculated_duration_minutes?: number | null
          created_at?: string
          id?: string
          leader_technician_id: string
          public_crew_label?: string | null
          requires_admin_review?: boolean
          review_reason?: string | null
          staffing_segments?: Json
          supporting_technician_ids?: string[]
          updated_at?: string
        }
        Update: {
          booking_id?: string
          calculated_duration_minutes?: number | null
          created_at?: string
          id?: string
          leader_technician_id?: string
          public_crew_label?: string | null
          requires_admin_review?: boolean
          review_reason?: string | null
          staffing_segments?: Json
          supporting_technician_ids?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_crew_assignments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "admin_marketing_funnel"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "booking_crew_assignments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_crew_assignments_leader_technician_id_fkey"
            columns: ["leader_technician_id"]
            isOneToOne: false
            referencedRelation: "technicians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_crew_assignments_leader_technician_id_fkey"
            columns: ["leader_technician_id"]
            isOneToOne: false
            referencedRelation: "technicians_public"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_management_tokens: {
        Row: {
          booking_id: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          last_used_at: string | null
          management_session_expires_at: string | null
          management_session_hash: string | null
          revoked_at: string | null
          token_hash: string
          use_count: number
        }
        Insert: {
          booking_id: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          last_used_at?: string | null
          management_session_expires_at?: string | null
          management_session_hash?: string | null
          revoked_at?: string | null
          token_hash: string
          use_count?: number
        }
        Update: {
          booking_id?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          last_used_at?: string | null
          management_session_expires_at?: string | null
          management_session_hash?: string | null
          revoked_at?: string | null
          token_hash?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_management_tokens_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "admin_marketing_funnel"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "booking_management_tokens_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_step_events: {
        Row: {
          created_at: string
          id: string
          selected_slot_json: Json | null
          services_json: Json | null
          session_id: string
          step: string
          used_recommended_slot: boolean | null
          used_suggested_day: boolean | null
        }
        Insert: {
          created_at?: string
          id?: string
          selected_slot_json?: Json | null
          services_json?: Json | null
          session_id: string
          step: string
          used_recommended_slot?: boolean | null
          used_suggested_day?: boolean | null
        }
        Update: {
          created_at?: string
          id?: string
          selected_slot_json?: Json | null
          services_json?: Json | null
          session_id?: string
          step?: string
          used_recommended_slot?: boolean | null
          used_suggested_day?: boolean | null
        }
        Relationships: []
      }
      booking_test_runs: {
        Row: {
          auth_key: string | null
          booking_id: string | null
          checkpoint: string | null
          conversation_id: string | null
          correlation_id: string
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string | null
          jobber_job_id: string | null
          jobber_visit_id: string | null
          last_error: string | null
          last_error_step: string | null
          phase: string
          slot_id: string | null
          slot_start: string | null
          status: string
          steps: Json
          updated_at: string
        }
        Insert: {
          auth_key?: string | null
          booking_id?: string | null
          checkpoint?: string | null
          conversation_id?: string | null
          correlation_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string | null
          jobber_job_id?: string | null
          jobber_visit_id?: string | null
          last_error?: string | null
          last_error_step?: string | null
          phase?: string
          slot_id?: string | null
          slot_start?: string | null
          status?: string
          steps?: Json
          updated_at?: string
        }
        Update: {
          auth_key?: string | null
          booking_id?: string | null
          checkpoint?: string | null
          conversation_id?: string | null
          correlation_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string | null
          jobber_job_id?: string | null
          jobber_visit_id?: string | null
          last_error?: string | null
          last_error_step?: string | null
          phase?: string
          slot_id?: string | null
          slot_start?: string | null
          status?: string
          steps?: Json
          updated_at?: string
        }
        Relationships: []
      }
      bookings: {
        Row: {
          attribution: Json | null
          booked_bundle_savings: number | null
          booked_discount_amount: number | null
          booked_revenue: number | null
          booked_service_count: number | null
          booked_services: Json | null
          booked_subtotal: number | null
          booking_completed_at: string | null
          booking_version: number
          cancellation_lifecycle_version: number | null
          cancellation_needs_attention_reason: string | null
          cancellation_notes: string | null
          cancellation_reason: string | null
          cancellation_source: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          created_at: string
          customer_id: string
          discount_amount: number | null
          discount_code: string | null
          discount_snapshot: Json | null
          duration_minutes: number
          home_details_json: Json
          id: string
          input_snapshot: Json | null
          is_hidden: boolean
          is_test_fixture: boolean
          jobber_cancellation_status: string | null
          jobber_job_id: string | null
          jobber_quote_id: string | null
          jobber_visit_id: string | null
          line_item_snapshot: Json | null
          maintenance_last_notified_at: string | null
          meta_events_fired: Json
          notes: string | null
          prep_email_sent_at: string | null
          previous_scheduled_end: string | null
          previous_scheduled_start: string | null
          pricing_engine_version: string | null
          pricing_override_by: string | null
          pricing_override_reason: string | null
          pricing_rule_version: number | null
          property_id: string | null
          quote_id: string | null
          quote_to_booking_seconds: number | null
          reference_number: string
          reschedule_notes: string | null
          reschedule_reason: string | null
          reschedule_source: string | null
          rescheduled_at: string | null
          scheduled_end: string | null
          scheduled_start: string | null
          service_completed_at: string | null
          services_json: Json
          slot_released_at: string | null
          source_session_id: string | null
          status: Database["public"]["Enums"]["booking_status"]
          subtotal: number
          technician_id: string | null
          total: number
          updated_at: string
          utm_params_json: Json | null
        }
        Insert: {
          attribution?: Json | null
          booked_bundle_savings?: number | null
          booked_discount_amount?: number | null
          booked_revenue?: number | null
          booked_service_count?: number | null
          booked_services?: Json | null
          booked_subtotal?: number | null
          booking_completed_at?: string | null
          booking_version?: number
          cancellation_lifecycle_version?: number | null
          cancellation_needs_attention_reason?: string | null
          cancellation_notes?: string | null
          cancellation_reason?: string | null
          cancellation_source?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          created_at?: string
          customer_id: string
          discount_amount?: number | null
          discount_code?: string | null
          discount_snapshot?: Json | null
          duration_minutes: number
          home_details_json: Json
          id?: string
          input_snapshot?: Json | null
          is_hidden?: boolean
          is_test_fixture?: boolean
          jobber_cancellation_status?: string | null
          jobber_job_id?: string | null
          jobber_quote_id?: string | null
          jobber_visit_id?: string | null
          line_item_snapshot?: Json | null
          maintenance_last_notified_at?: string | null
          meta_events_fired?: Json
          notes?: string | null
          prep_email_sent_at?: string | null
          previous_scheduled_end?: string | null
          previous_scheduled_start?: string | null
          pricing_engine_version?: string | null
          pricing_override_by?: string | null
          pricing_override_reason?: string | null
          pricing_rule_version?: number | null
          property_id?: string | null
          quote_id?: string | null
          quote_to_booking_seconds?: number | null
          reference_number: string
          reschedule_notes?: string | null
          reschedule_reason?: string | null
          reschedule_source?: string | null
          rescheduled_at?: string | null
          scheduled_end?: string | null
          scheduled_start?: string | null
          service_completed_at?: string | null
          services_json: Json
          slot_released_at?: string | null
          source_session_id?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          subtotal: number
          technician_id?: string | null
          total: number
          updated_at?: string
          utm_params_json?: Json | null
        }
        Update: {
          attribution?: Json | null
          booked_bundle_savings?: number | null
          booked_discount_amount?: number | null
          booked_revenue?: number | null
          booked_service_count?: number | null
          booked_services?: Json | null
          booked_subtotal?: number | null
          booking_completed_at?: string | null
          booking_version?: number
          cancellation_lifecycle_version?: number | null
          cancellation_needs_attention_reason?: string | null
          cancellation_notes?: string | null
          cancellation_reason?: string | null
          cancellation_source?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          created_at?: string
          customer_id?: string
          discount_amount?: number | null
          discount_code?: string | null
          discount_snapshot?: Json | null
          duration_minutes?: number
          home_details_json?: Json
          id?: string
          input_snapshot?: Json | null
          is_hidden?: boolean
          is_test_fixture?: boolean
          jobber_cancellation_status?: string | null
          jobber_job_id?: string | null
          jobber_quote_id?: string | null
          jobber_visit_id?: string | null
          line_item_snapshot?: Json | null
          maintenance_last_notified_at?: string | null
          meta_events_fired?: Json
          notes?: string | null
          prep_email_sent_at?: string | null
          previous_scheduled_end?: string | null
          previous_scheduled_start?: string | null
          pricing_engine_version?: string | null
          pricing_override_by?: string | null
          pricing_override_reason?: string | null
          pricing_rule_version?: number | null
          property_id?: string | null
          quote_id?: string | null
          quote_to_booking_seconds?: number | null
          reference_number?: string
          reschedule_notes?: string | null
          reschedule_reason?: string | null
          reschedule_source?: string | null
          rescheduled_at?: string | null
          scheduled_end?: string | null
          scheduled_start?: string | null
          service_completed_at?: string | null
          services_json?: Json
          slot_released_at?: string | null
          source_session_id?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          subtotal?: number
          technician_id?: string | null
          total?: number
          updated_at?: string
          utm_params_json?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "admin_marketing_funnel"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "bookings_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "technicians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "technicians_public"
            referencedColumns: ["id"]
          },
        ]
      }
      business_knowledge: {
        Row: {
          applicable_region: string | null
          applicable_service: string | null
          category: string
          content: string
          created_at: string
          effective_date: string
          id: string
          is_active: boolean
          knowledge_key: string
          last_changed_at: string | null
          last_checked_at: string | null
          pending_content: string | null
          pending_source_hash: string | null
          priority: number
          requires_admin_input: boolean
          requires_owner_review: boolean
          review_status: string
          revision: number
          sort_order: number
          source_hash: string | null
          source_page: string | null
          source_type: string
          title: string
          updated_at: string
        }
        Insert: {
          applicable_region?: string | null
          applicable_service?: string | null
          category: string
          content: string
          created_at?: string
          effective_date?: string
          id?: string
          is_active?: boolean
          knowledge_key: string
          last_changed_at?: string | null
          last_checked_at?: string | null
          pending_content?: string | null
          pending_source_hash?: string | null
          priority?: number
          requires_admin_input?: boolean
          requires_owner_review?: boolean
          review_status?: string
          revision?: number
          sort_order?: number
          source_hash?: string | null
          source_page?: string | null
          source_type?: string
          title: string
          updated_at?: string
        }
        Update: {
          applicable_region?: string | null
          applicable_service?: string | null
          category?: string
          content?: string
          created_at?: string
          effective_date?: string
          id?: string
          is_active?: boolean
          knowledge_key?: string
          last_changed_at?: string | null
          last_checked_at?: string | null
          pending_content?: string | null
          pending_source_hash?: string | null
          priority?: number
          requires_admin_input?: boolean
          requires_owner_review?: boolean
          review_status?: string
          revision?: number
          sort_order?: number
          source_hash?: string | null
          source_page?: string | null
          source_type?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      business_knowledge_revisions: {
        Row: {
          category: string
          changed_at: string
          changed_by: string | null
          content: string
          effective_date: string
          id: string
          is_active: boolean
          knowledge_id: string
          knowledge_key: string
          revision: number
          title: string
        }
        Insert: {
          category: string
          changed_at?: string
          changed_by?: string | null
          content: string
          effective_date: string
          id?: string
          is_active: boolean
          knowledge_id: string
          knowledge_key: string
          revision: number
          title: string
        }
        Update: {
          category?: string
          changed_at?: string
          changed_by?: string | null
          content?: string
          effective_date?: string
          id?: string
          is_active?: boolean
          knowledge_id?: string
          knowledge_key?: string
          revision?: number
          title?: string
        }
        Relationships: []
      }
      callrail_inbound_events: {
        Row: {
          attempts: number
          claim_token: string | null
          claimed_at: string | null
          conversation_id: string | null
          created_at: string
          customer_id: string | null
          event_type: string
          from_phone: string | null
          id: string
          last_attempted_at: string | null
          last_error_category: string | null
          last_error_detail: string | null
          next_attempt_at: string | null
          owner_notification_skipped_reason: string | null
          owner_notified_at: string | null
          payload_safe: Json
          processed_at: string | null
          provider_message_id: string
          received_at: string
          replay_count: number
          replay_requested_at: string | null
          replay_requested_by: string | null
          sms_message_id: string | null
          status: string
          to_phone: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          claim_token?: string | null
          claimed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          customer_id?: string | null
          event_type?: string
          from_phone?: string | null
          id?: string
          last_attempted_at?: string | null
          last_error_category?: string | null
          last_error_detail?: string | null
          next_attempt_at?: string | null
          owner_notification_skipped_reason?: string | null
          owner_notified_at?: string | null
          payload_safe?: Json
          processed_at?: string | null
          provider_message_id: string
          received_at?: string
          replay_count?: number
          replay_requested_at?: string | null
          replay_requested_by?: string | null
          sms_message_id?: string | null
          status?: string
          to_phone?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          claim_token?: string | null
          claimed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          customer_id?: string | null
          event_type?: string
          from_phone?: string | null
          id?: string
          last_attempted_at?: string | null
          last_error_category?: string | null
          last_error_detail?: string | null
          next_attempt_at?: string | null
          owner_notification_skipped_reason?: string | null
          owner_notified_at?: string | null
          payload_safe?: Json
          processed_at?: string | null
          provider_message_id?: string
          received_at?: string
          replay_count?: number
          replay_requested_at?: string | null
          replay_requested_by?: string | null
          sms_message_id?: string | null
          status?: string
          to_phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      campaign_audit_log: {
        Row: {
          actor_id: string | null
          campaigns_enrolled: Json
          created_at: string
          customer_id: string | null
          details: Json
          event_type: string
          id: string
          messages_cancelled: number
          messages_started: number
          new_status:
            | Database["public"]["Enums"]["lead_lifecycle_status"]
            | null
          old_status:
            | Database["public"]["Enums"]["lead_lifecycle_status"]
            | null
          source: string
        }
        Insert: {
          actor_id?: string | null
          campaigns_enrolled?: Json
          created_at?: string
          customer_id?: string | null
          details?: Json
          event_type?: string
          id?: string
          messages_cancelled?: number
          messages_started?: number
          new_status?:
            | Database["public"]["Enums"]["lead_lifecycle_status"]
            | null
          old_status?:
            | Database["public"]["Enums"]["lead_lifecycle_status"]
            | null
          source?: string
        }
        Update: {
          actor_id?: string | null
          campaigns_enrolled?: Json
          created_at?: string
          customer_id?: string | null
          details?: Json
          event_type?: string
          id?: string
          messages_cancelled?: number
          messages_started?: number
          new_status?:
            | Database["public"]["Enums"]["lead_lifecycle_status"]
            | null
          old_status?:
            | Database["public"]["Enums"]["lead_lifecycle_status"]
            | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_audit_log_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_enrollments: {
        Row: {
          booking_id: string | null
          booking_version: number | null
          campaign_event_id: string | null
          campaign_id: string
          campaign_snapshot: Json | null
          campaign_version: number | null
          conversation_id: string | null
          created_at: string
          customer_id: string | null
          email: string | null
          enrolled_at: string
          event_name: string | null
          id: string
          lifecycle_status:
            | Database["public"]["Enums"]["lead_lifecycle_status"]
            | null
          paused_at: string | null
          paused_until: string | null
          phone: string | null
          reason: string | null
          status: string
          stopped_at: string | null
          stopped_reason: string | null
          suppressed: boolean
          suppressed_reason: string | null
          updated_at: string
        }
        Insert: {
          booking_id?: string | null
          booking_version?: number | null
          campaign_event_id?: string | null
          campaign_id: string
          campaign_snapshot?: Json | null
          campaign_version?: number | null
          conversation_id?: string | null
          created_at?: string
          customer_id?: string | null
          email?: string | null
          enrolled_at?: string
          event_name?: string | null
          id?: string
          lifecycle_status?:
            | Database["public"]["Enums"]["lead_lifecycle_status"]
            | null
          paused_at?: string | null
          paused_until?: string | null
          phone?: string | null
          reason?: string | null
          status?: string
          stopped_at?: string | null
          stopped_reason?: string | null
          suppressed?: boolean
          suppressed_reason?: string | null
          updated_at?: string
        }
        Update: {
          booking_id?: string | null
          booking_version?: number | null
          campaign_event_id?: string | null
          campaign_id?: string
          campaign_snapshot?: Json | null
          campaign_version?: number | null
          conversation_id?: string | null
          created_at?: string
          customer_id?: string | null
          email?: string | null
          enrolled_at?: string
          event_name?: string | null
          id?: string
          lifecycle_status?:
            | Database["public"]["Enums"]["lead_lifecycle_status"]
            | null
          paused_at?: string | null
          paused_until?: string | null
          phone?: string | null
          reason?: string | null
          status?: string
          stopped_at?: string | null
          stopped_reason?: string | null
          suppressed?: boolean
          suppressed_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_enrollments_campaign_event_id_fkey"
            columns: ["campaign_event_id"]
            isOneToOne: false
            referencedRelation: "campaign_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_enrollments_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "sms_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_enrollments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_events: {
        Row: {
          conversation_id: string | null
          created_at: string
          customer_id: string | null
          email: string | null
          enrollments_created: number
          event_name: string
          id: string
          idempotency_key: string
          metadata: Json
          phone: string | null
          processed_at: string | null
          source: string
          subject: string | null
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          customer_id?: string | null
          email?: string | null
          enrollments_created?: number
          event_name: string
          id?: string
          idempotency_key: string
          metadata?: Json
          phone?: string | null
          processed_at?: string | null
          source?: string
          subject?: string | null
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          customer_id?: string | null
          email?: string | null
          enrollments_created?: number
          event_name?: string
          id?: string
          idempotency_key?: string
          metadata?: Json
          phone?: string | null
          processed_at?: string | null
          source?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_events_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_launch_controls: {
        Row: {
          delivery_paused: boolean
          enrollment_paused: boolean
          id: number
          note: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          delivery_paused?: boolean
          enrollment_paused?: boolean
          id?: number
          note?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          delivery_paused?: boolean
          enrollment_paused?: boolean
          id?: number
          note?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      chat_conversations: {
        Row: {
          abandonment_emitted_version: string | null
          abandonment_swept_at: string | null
          ai_summary: string | null
          ai_summary_updated_at: string | null
          assigned_admin: string | null
          best_time_to_contact: string | null
          booking_status: string
          callback_requested: boolean
          campaign_status: string | null
          channel: string
          contact_method: string | null
          conversation_state: string
          created_at: string
          customer_id: string | null
          draft_context_version: string | null
          draft_edited_at: string | null
          draft_error: string | null
          draft_generated_at: string | null
          draft_model: string | null
          draft_sent_at: string | null
          draft_source_message_id: string | null
          draft_status: string | null
          facts: Json
          id: string
          internal_notes: string | null
          last_activity_at: string
          last_error: string | null
          last_inbound_at: string | null
          last_outbound_at: string | null
          manual_review_reason: string | null
          marketing_consent: boolean
          needs_attention: boolean
          pending_draft_reply: string | null
          pricing_version: number | null
          property_id: string | null
          prospect_email: string | null
          prospect_name: string | null
          prospect_phone: string | null
          quote_result: Json | null
          quote_session_id: string | null
          resolution_confidence: string | null
          resolution_method: string | null
          resolved: boolean
          selected_slot_id: string | null
          service_address: string | null
          service_area_result: Json | null
          service_area_status: string | null
          services_discussed: Json
          session_token: string
          slot_failure_count: number
          staff_takeover_at: string | null
          staff_takeover_by: string | null
          staff_takeover_reason: string | null
          status: string
          summary: string | null
          unresolved_reason: string | null
          updated_at: string
        }
        Insert: {
          abandonment_emitted_version?: string | null
          abandonment_swept_at?: string | null
          ai_summary?: string | null
          ai_summary_updated_at?: string | null
          assigned_admin?: string | null
          best_time_to_contact?: string | null
          booking_status?: string
          callback_requested?: boolean
          campaign_status?: string | null
          channel?: string
          contact_method?: string | null
          conversation_state?: string
          created_at?: string
          customer_id?: string | null
          draft_context_version?: string | null
          draft_edited_at?: string | null
          draft_error?: string | null
          draft_generated_at?: string | null
          draft_model?: string | null
          draft_sent_at?: string | null
          draft_source_message_id?: string | null
          draft_status?: string | null
          facts?: Json
          id?: string
          internal_notes?: string | null
          last_activity_at?: string
          last_error?: string | null
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          manual_review_reason?: string | null
          marketing_consent?: boolean
          needs_attention?: boolean
          pending_draft_reply?: string | null
          pricing_version?: number | null
          property_id?: string | null
          prospect_email?: string | null
          prospect_name?: string | null
          prospect_phone?: string | null
          quote_result?: Json | null
          quote_session_id?: string | null
          resolution_confidence?: string | null
          resolution_method?: string | null
          resolved?: boolean
          selected_slot_id?: string | null
          service_address?: string | null
          service_area_result?: Json | null
          service_area_status?: string | null
          services_discussed?: Json
          session_token: string
          slot_failure_count?: number
          staff_takeover_at?: string | null
          staff_takeover_by?: string | null
          staff_takeover_reason?: string | null
          status?: string
          summary?: string | null
          unresolved_reason?: string | null
          updated_at?: string
        }
        Update: {
          abandonment_emitted_version?: string | null
          abandonment_swept_at?: string | null
          ai_summary?: string | null
          ai_summary_updated_at?: string | null
          assigned_admin?: string | null
          best_time_to_contact?: string | null
          booking_status?: string
          callback_requested?: boolean
          campaign_status?: string | null
          channel?: string
          contact_method?: string | null
          conversation_state?: string
          created_at?: string
          customer_id?: string | null
          draft_context_version?: string | null
          draft_edited_at?: string | null
          draft_error?: string | null
          draft_generated_at?: string | null
          draft_model?: string | null
          draft_sent_at?: string | null
          draft_source_message_id?: string | null
          draft_status?: string | null
          facts?: Json
          id?: string
          internal_notes?: string | null
          last_activity_at?: string
          last_error?: string | null
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          manual_review_reason?: string | null
          marketing_consent?: boolean
          needs_attention?: boolean
          pending_draft_reply?: string | null
          pricing_version?: number | null
          property_id?: string | null
          prospect_email?: string | null
          prospect_name?: string | null
          prospect_phone?: string | null
          quote_result?: Json | null
          quote_session_id?: string | null
          resolution_confidence?: string | null
          resolution_method?: string | null
          resolved?: boolean
          selected_slot_id?: string | null
          service_address?: string | null
          service_area_result?: Json | null
          service_area_status?: string | null
          services_discussed?: Json
          session_token?: string
          slot_failure_count?: number
          staff_takeover_at?: string | null
          staff_takeover_by?: string | null
          staff_takeover_reason?: string | null
          status?: string
          summary?: string | null
          unresolved_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_conversations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string | null
          conversation_id: string
          created_at: string
          id: string
          role: string
          tool_name: string | null
          tool_result: Json | null
        }
        Insert: {
          content?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          tool_name?: string | null
          tool_result?: Json | null
        }
        Update: {
          content?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          tool_name?: string | null
          tool_result?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_consent: {
        Row: {
          booking_id: string | null
          campaign_event_id: string | null
          channel: Database["public"]["Enums"]["consent_channel"]
          consent_type: Database["public"]["Enums"]["consent_type"]
          conversation_id: string | null
          created_at: string
          customer_id: string | null
          email: string | null
          granted_at: string | null
          id: string
          language_shown: string | null
          metadata: Json
          opt_out_source: string | null
          phone: string | null
          revoked_at: string | null
          session_id: string | null
          source: string
          status: Database["public"]["Enums"]["consent_status"]
          updated_at: string
        }
        Insert: {
          booking_id?: string | null
          campaign_event_id?: string | null
          channel: Database["public"]["Enums"]["consent_channel"]
          consent_type: Database["public"]["Enums"]["consent_type"]
          conversation_id?: string | null
          created_at?: string
          customer_id?: string | null
          email?: string | null
          granted_at?: string | null
          id?: string
          language_shown?: string | null
          metadata?: Json
          opt_out_source?: string | null
          phone?: string | null
          revoked_at?: string | null
          session_id?: string | null
          source?: string
          status?: Database["public"]["Enums"]["consent_status"]
          updated_at?: string
        }
        Update: {
          booking_id?: string | null
          campaign_event_id?: string | null
          channel?: Database["public"]["Enums"]["consent_channel"]
          consent_type?: Database["public"]["Enums"]["consent_type"]
          conversation_id?: string | null
          created_at?: string
          customer_id?: string | null
          email?: string | null
          granted_at?: string | null
          id?: string
          language_shown?: string | null
          metadata?: Json
          opt_out_source?: string | null
          phone?: string | null
          revoked_at?: string | null
          session_id?: string | null
          source?: string
          status?: Database["public"]["Enums"]["consent_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_consent_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "admin_marketing_funnel"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "communication_consent_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_consent_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_consent_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_consent_events: {
        Row: {
          action: string
          actor_id: string | null
          channel: Database["public"]["Enums"]["consent_channel"] | null
          consent_id: string | null
          consent_type: Database["public"]["Enums"]["consent_type"] | null
          created_at: string
          email: string | null
          id: string
          language_shown: string | null
          metadata: Json
          phone: string | null
          source: string | null
          status: Database["public"]["Enums"]["consent_status"] | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          channel?: Database["public"]["Enums"]["consent_channel"] | null
          consent_id?: string | null
          consent_type?: Database["public"]["Enums"]["consent_type"] | null
          created_at?: string
          email?: string | null
          id?: string
          language_shown?: string | null
          metadata?: Json
          phone?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["consent_status"] | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          channel?: Database["public"]["Enums"]["consent_channel"] | null
          consent_id?: string | null
          consent_type?: Database["public"]["Enums"]["consent_type"] | null
          created_at?: string
          email?: string | null
          id?: string
          language_shown?: string | null
          metadata?: Json
          phone?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["consent_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_consent_events_consent_id_fkey"
            columns: ["consent_id"]
            isOneToOne: false
            referencedRelation: "communication_consent"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_requests: {
        Row: {
          appointment_status: string | null
          booking_id: string | null
          created_at: string
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          id: string
          ip_hash: string | null
          note: string | null
          owner_error: string | null
          owner_notification_status: string
          owner_provider_message_id: string | null
          page_url: string | null
          property_address: string | null
          quote_id: string | null
          request_key: string
          services: Json | null
          source: string
          total: number | null
        }
        Insert: {
          appointment_status?: string | null
          booking_id?: string | null
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          ip_hash?: string | null
          note?: string | null
          owner_error?: string | null
          owner_notification_status?: string
          owner_provider_message_id?: string | null
          page_url?: string | null
          property_address?: string | null
          quote_id?: string | null
          request_key: string
          services?: Json | null
          source?: string
          total?: number | null
        }
        Update: {
          appointment_status?: string | null
          booking_id?: string | null
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          ip_hash?: string | null
          note?: string | null
          owner_error?: string | null
          owner_notification_status?: string
          owner_provider_message_id?: string | null
          page_url?: string | null
          property_address?: string | null
          quote_id?: string | null
          request_key?: string
          services?: Json | null
          source?: string
          total?: number | null
        }
        Relationships: []
      }
      conversation_outcomes: {
        Row: {
          classified_at: string
          classifier_version: string
          confidence: number
          conversation_id: string
          created_at: string
          deterministic: boolean
          evidence: Json
          inactivity_threshold_minutes_used: number
          outcome: string
          reason: string
          updated_at: string
        }
        Insert: {
          classified_at?: string
          classifier_version: string
          confidence?: number
          conversation_id: string
          created_at?: string
          deterministic?: boolean
          evidence?: Json
          inactivity_threshold_minutes_used: number
          outcome: string
          reason: string
          updated_at?: string
        }
        Update: {
          classified_at?: string
          classifier_version?: string
          confidence?: number
          conversation_id?: string
          created_at?: string
          deterministic?: boolean
          evidence?: Json
          inactivity_threshold_minutes_used?: number
          outcome?: string
          reason?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_outcomes_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_reviews: {
        Row: {
          admin_notes: string | null
          assigned_admin: string | null
          booking_state: string | null
          conversation_id: string
          created_at: string
          id: string
          model_version: string | null
          outcome: string | null
          prompt_version: string | null
          quote_state: string | null
          signal_details: Json
          signals: string[]
          status: string
          summary: string | null
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          assigned_admin?: string | null
          booking_state?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          model_version?: string | null
          outcome?: string | null
          prompt_version?: string | null
          quote_state?: string | null
          signal_details?: Json
          signals?: string[]
          status?: string
          summary?: string | null
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          assigned_admin?: string | null
          booking_state?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          model_version?: string | null
          outcome?: string | null
          prompt_version?: string | null
          quote_state?: string | null
          signal_details?: Json
          signals?: string[]
          status?: string
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_reviews_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_config: {
        Row: {
          created_at: string
          crew_size_max: number
          crew_size_min: number
          default_public_crew_label: string
          hide_technician_names: boolean
          id: string
          productivity_multipliers: Json
          singleton: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          crew_size_max?: number
          crew_size_min?: number
          default_public_crew_label?: string
          hide_technician_names?: boolean
          id?: string
          productivity_multipliers?: Json
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          crew_size_max?: number
          crew_size_min?: number
          default_public_crew_label?: string
          hide_technician_names?: boolean
          id?: string
          productivity_multipliers?: Json
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      customer_access_test_authorizations: {
        Row: {
          authorized_by: string
          consumed_at: string | null
          correlation_id: string
          created_at: string
          expires_at: string
          id: string
          idempotency_key: string
          recipient: string
          result_json: Json | null
          target_id: string | null
          test_type: string
        }
        Insert: {
          authorized_by: string
          consumed_at?: string | null
          correlation_id?: string
          created_at?: string
          expires_at: string
          id?: string
          idempotency_key: string
          recipient: string
          result_json?: Json | null
          target_id?: string | null
          test_type: string
        }
        Update: {
          authorized_by?: string
          consumed_at?: string | null
          correlation_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          idempotency_key?: string
          recipient?: string
          result_json?: Json | null
          target_id?: string | null
          test_type?: string
        }
        Relationships: []
      }
      customer_account_match_issues: {
        Row: {
          candidate_customer_ids: string[]
          created_at: string
          id: string
          notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_customer_id: string | null
          status: string
          updated_at: string
          verified_email: string | null
          verified_phone: string | null
        }
        Insert: {
          candidate_customer_ids: string[]
          created_at?: string
          id?: string
          notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_customer_id?: string | null
          status?: string
          updated_at?: string
          verified_email?: string | null
          verified_phone?: string | null
        }
        Update: {
          candidate_customer_ids?: string[]
          created_at?: string
          id?: string
          notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_customer_id?: string | null
          status?: string
          updated_at?: string
          verified_email?: string | null
          verified_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_account_match_issues_resolved_customer_id_fkey"
            columns: ["resolved_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_accounts: {
        Row: {
          auth_linked_at: string | null
          auth_provider: string | null
          auth_user_id: string | null
          created_at: string
          customer_id: string
          id: string
          last_verified_at: string
          updated_at: string
          verified_email: string | null
          verified_phone: string | null
        }
        Insert: {
          auth_linked_at?: string | null
          auth_provider?: string | null
          auth_user_id?: string | null
          created_at?: string
          customer_id: string
          id?: string
          last_verified_at?: string
          updated_at?: string
          verified_email?: string | null
          verified_phone?: string | null
        }
        Update: {
          auth_linked_at?: string | null
          auth_provider?: string | null
          auth_user_id?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          last_verified_at?: string
          updated_at?: string
          verified_email?: string | null
          verified_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_accounts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_auth_link_events: {
        Row: {
          auth_email: string | null
          auth_provider: string | null
          auth_user_id: string | null
          created_at: string
          customer_id: string | null
          detail: string | null
          id: string
          matched_count: number | null
          outcome: string
        }
        Insert: {
          auth_email?: string | null
          auth_provider?: string | null
          auth_user_id?: string | null
          created_at?: string
          customer_id?: string | null
          detail?: string | null
          id?: string
          matched_count?: number | null
          outcome: string
        }
        Update: {
          auth_email?: string | null
          auth_provider?: string | null
          auth_user_id?: string | null
          created_at?: string
          customer_id?: string | null
          detail?: string | null
          id?: string
          matched_count?: number | null
          outcome?: string
        }
        Relationships: []
      }
      customer_portal_sessions: {
        Row: {
          absolute_expires_at: string
          created_at: string
          customer_account_id: string
          id: string
          ip_hash: string | null
          last_seen_at: string
          revoked_at: string | null
          session_token_hash: string
          user_agent_hash: string | null
        }
        Insert: {
          absolute_expires_at: string
          created_at?: string
          customer_account_id: string
          id?: string
          ip_hash?: string | null
          last_seen_at?: string
          revoked_at?: string | null
          session_token_hash: string
          user_agent_hash?: string | null
        }
        Update: {
          absolute_expires_at?: string
          created_at?: string
          customer_account_id?: string
          id?: string
          ip_hash?: string | null
          last_seen_at?: string
          revoked_at?: string | null
          session_token_hash?: string
          user_agent_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_portal_sessions_customer_account_id_fkey"
            columns: ["customer_account_id"]
            isOneToOne: false
            referencedRelation: "customer_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_properties: {
        Row: {
          active: boolean
          authorization_status: string
          created_at: string
          customer_id: string
          id: string
          is_primary: boolean
          label: string | null
          property_id: string
          relationship_type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          authorization_status?: string
          created_at?: string
          customer_id: string
          id?: string
          is_primary?: boolean
          label?: string | null
          property_id: string
          relationship_type?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          authorization_status?: string
          created_at?: string
          customer_id?: string
          id?: string
          is_primary?: boolean
          label?: string | null
          property_id?: string
          relationship_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_properties_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_properties_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_verification_challenges: {
        Row: {
          attempts: number
          callrail_message_id: string | null
          channel: string
          correlation_id: string
          created_at: string
          delivery_status: string | null
          expires_at: string
          id: string
          ip_hash: string | null
          max_attempts: number
          otp_hash: string
          phone_hash: string | null
          provider: string | null
          provider_accepted_at: string | null
          provider_conversation_id: string | null
          provider_message_id: string | null
          provider_response_kind: string | null
          provider_status: string | null
          recipient_hint: string | null
          status: string
          updated_at: string
          usable_until: string | null
          verified_at: string | null
        }
        Insert: {
          attempts?: number
          callrail_message_id?: string | null
          channel?: string
          correlation_id?: string
          created_at?: string
          delivery_status?: string | null
          expires_at: string
          id?: string
          ip_hash?: string | null
          max_attempts?: number
          otp_hash: string
          phone_hash?: string | null
          provider?: string | null
          provider_accepted_at?: string | null
          provider_conversation_id?: string | null
          provider_message_id?: string | null
          provider_response_kind?: string | null
          provider_status?: string | null
          recipient_hint?: string | null
          status?: string
          updated_at?: string
          usable_until?: string | null
          verified_at?: string | null
        }
        Update: {
          attempts?: number
          callrail_message_id?: string | null
          channel?: string
          correlation_id?: string
          created_at?: string
          delivery_status?: string | null
          expires_at?: string
          id?: string
          ip_hash?: string | null
          max_attempts?: number
          otp_hash?: string
          phone_hash?: string | null
          provider?: string | null
          provider_accepted_at?: string | null
          provider_conversation_id?: string | null
          provider_message_id?: string | null
          provider_response_kind?: string | null
          provider_status?: string | null
          recipient_hint?: string | null
          status?: string
          updated_at?: string
          usable_until?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      customer_verification_config: {
        Row: {
          booking_link_ttl_hours: number
          id: string
          max_attempts: number
          otp_ttl_seconds: number
          per_ip_max_per_hour: number
          per_phone_cooldown_seconds: number
          per_phone_max_per_hour: number
          session_absolute_seconds: number
          session_inactivity_seconds: number
          updated_at: string
        }
        Insert: {
          booking_link_ttl_hours?: number
          id?: string
          max_attempts?: number
          otp_ttl_seconds?: number
          per_ip_max_per_hour?: number
          per_phone_cooldown_seconds?: number
          per_phone_max_per_hour?: number
          session_absolute_seconds?: number
          session_inactivity_seconds?: number
          updated_at?: string
        }
        Update: {
          booking_link_ttl_hours?: number
          id?: string
          max_attempts?: number
          otp_ttl_seconds?: number
          per_ip_max_per_hour?: number
          per_phone_cooldown_seconds?: number
          per_phone_max_per_hour?: number
          session_absolute_seconds?: number
          session_inactivity_seconds?: number
          updated_at?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          address: string | null
          auth_user_id: string | null
          created_at: string
          customer_type: string
          email: string
          email_paused: boolean
          first_name: string | null
          id: string
          jobber_client_id: string | null
          last_name: string | null
          lifecycle_changed_at: string | null
          lifecycle_source: string | null
          lifecycle_status:
            | Database["public"]["Enums"]["lead_lifecycle_status"]
            | null
          notes: string | null
          phone: string | null
          preferred_contact_method: string | null
          preferred_email: string | null
          preferred_phone: string | null
          sms_paused: boolean
          updated_at: string
        }
        Insert: {
          address?: string | null
          auth_user_id?: string | null
          created_at?: string
          customer_type?: string
          email: string
          email_paused?: boolean
          first_name?: string | null
          id?: string
          jobber_client_id?: string | null
          last_name?: string | null
          lifecycle_changed_at?: string | null
          lifecycle_source?: string | null
          lifecycle_status?:
            | Database["public"]["Enums"]["lead_lifecycle_status"]
            | null
          notes?: string | null
          phone?: string | null
          preferred_contact_method?: string | null
          preferred_email?: string | null
          preferred_phone?: string | null
          sms_paused?: boolean
          updated_at?: string
        }
        Update: {
          address?: string | null
          auth_user_id?: string | null
          created_at?: string
          customer_type?: string
          email?: string
          email_paused?: boolean
          first_name?: string | null
          id?: string
          jobber_client_id?: string | null
          last_name?: string | null
          lifecycle_changed_at?: string | null
          lifecycle_source?: string | null
          lifecycle_status?:
            | Database["public"]["Enums"]["lead_lifecycle_status"]
            | null
          notes?: string | null
          phone?: string | null
          preferred_contact_method?: string | null
          preferred_email?: string | null
          preferred_phone?: string | null
          sms_paused?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      discount_codes: {
        Row: {
          code: string
          created_at: string
          description: string | null
          discount_type: string
          discount_value: number
          expires_at: string | null
          id: string
          is_active: boolean
          max_uses: number | null
          updated_at: string
          usage_count: number
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          discount_type: string
          discount_value: number
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          updated_at?: string
          usage_count?: number
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          discount_type?: string
          discount_value?: number
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          updated_at?: string
          usage_count?: number
        }
        Relationships: []
      }
      drive_time_cache: {
        Row: {
          created_at: string
          dest_hash: string
          distance_meters: number | null
          drive_minutes: number
          expires_at: string
          id: string
          origin_hash: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          dest_hash: string
          distance_meters?: number | null
          drive_minutes: number
          expires_at?: string
          id?: string
          origin_hash: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          dest_hash?: string
          distance_meters?: number | null
          drive_minutes?: number
          expires_at?: string
          id?: string
          origin_hash?: string
          updated_at?: string
        }
        Relationships: []
      }
      drive_time_config: {
        Row: {
          allow_long_first_drive: boolean
          base_buffer_minutes: number
          buffer_tiers: Json
          created_at: string
          earliest_start_hour: number
          id: string
          last_job_buffer_minutes: number
          latest_start_hour: number
          max_drive_time_minutes: number
          no_long_last_drive: boolean
          office_address: string | null
          updated_at: string
        }
        Insert: {
          allow_long_first_drive?: boolean
          base_buffer_minutes?: number
          buffer_tiers?: Json
          created_at?: string
          earliest_start_hour?: number
          id?: string
          last_job_buffer_minutes?: number
          latest_start_hour?: number
          max_drive_time_minutes?: number
          no_long_last_drive?: boolean
          office_address?: string | null
          updated_at?: string
        }
        Update: {
          allow_long_first_drive?: boolean
          base_buffer_minutes?: number
          buffer_tiers?: Json
          created_at?: string
          earliest_start_hour?: number
          id?: string
          last_job_buffer_minutes?: number
          latest_start_hour?: number
          max_drive_time_minutes?: number
          no_long_last_drive?: boolean
          office_address?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      eligibility_rules: {
        Row: {
          allowed_tech_ids: string[] | null
          conditions: Json
          created_at: string
          default_tech_id: string | null
          description: string | null
          excluded_tech_ids: string[] | null
          id: string
          is_active: boolean
          priority: number
          rule_name: string
          rule_type: string
          updated_at: string
        }
        Insert: {
          allowed_tech_ids?: string[] | null
          conditions?: Json
          created_at?: string
          default_tech_id?: string | null
          description?: string | null
          excluded_tech_ids?: string[] | null
          id?: string
          is_active?: boolean
          priority?: number
          rule_name: string
          rule_type?: string
          updated_at?: string
        }
        Update: {
          allowed_tech_ids?: string[] | null
          conditions?: Json
          created_at?: string
          default_tech_id?: string | null
          description?: string | null
          excluded_tech_ids?: string[] | null
          id?: string
          is_active?: boolean
          priority?: number
          rule_name?: string
          rule_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eligibility_rules_default_tech_id_fkey"
            columns: ["default_tech_id"]
            isOneToOne: false
            referencedRelation: "technicians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eligibility_rules_default_tech_id_fkey"
            columns: ["default_tech_id"]
            isOneToOne: false
            referencedRelation: "technicians_public"
            referencedColumns: ["id"]
          },
        ]
      }
      email_inbound_messages: {
        Row: {
          booking_id: string | null
          conversation_id: string | null
          created_at: string
          from_email: string
          html_body: string | null
          id: string
          processed_at: string | null
          processing_error: string | null
          provider: string
          provider_message_id: string | null
          quote_id: string | null
          raw_payload: Json
          received_at: string
          reply_token: string | null
          subject: string | null
          suppressed: boolean
          text_body: string | null
          to_email: string
        }
        Insert: {
          booking_id?: string | null
          conversation_id?: string | null
          created_at?: string
          from_email: string
          html_body?: string | null
          id?: string
          processed_at?: string | null
          processing_error?: string | null
          provider?: string
          provider_message_id?: string | null
          quote_id?: string | null
          raw_payload?: Json
          received_at?: string
          reply_token?: string | null
          subject?: string | null
          suppressed?: boolean
          text_body?: string | null
          to_email: string
        }
        Update: {
          booking_id?: string | null
          conversation_id?: string | null
          created_at?: string
          from_email?: string
          html_body?: string | null
          id?: string
          processed_at?: string | null
          processing_error?: string | null
          provider?: string
          provider_message_id?: string | null
          quote_id?: string | null
          raw_payload?: Json
          received_at?: string
          reply_token?: string | null
          subject?: string | null
          suppressed?: boolean
          text_body?: string | null
          to_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_inbound_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_inbound_messages_reply_token_fkey"
            columns: ["reply_token"]
            isOneToOne: false
            referencedRelation: "email_reply_tokens"
            referencedColumns: ["token"]
          },
        ]
      }
      email_reply_tokens: {
        Row: {
          booking_id: string | null
          conversation_id: string | null
          created_at: string
          customer_id: string | null
          expires_at: string
          metadata: Json
          purpose: string
          quote_id: string | null
          recipient_email: string
          revoked_at: string | null
          token: string
        }
        Insert: {
          booking_id?: string | null
          conversation_id?: string | null
          created_at?: string
          customer_id?: string | null
          expires_at?: string
          metadata?: Json
          purpose: string
          quote_id?: string | null
          recipient_email: string
          revoked_at?: string | null
          token: string
        }
        Update: {
          booking_id?: string | null
          conversation_id?: string | null
          created_at?: string
          customer_id?: string | null
          expires_at?: string
          metadata?: Json
          purpose?: string
          quote_id?: string | null
          recipient_email?: string
          revoked_at?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_reply_tokens_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_attempts: {
        Row: {
          accepted_at: string | null
          bounced_at: string | null
          complained_at: string | null
          created_at: string
          delayed_at: string | null
          delivered_at: string | null
          failure_category: string | null
          failure_reason: string | null
          http_status: number | null
          id: string
          last_event_at: string | null
          last_event_type: string | null
          metadata: Json
          provider: string
          provider_message_id: string | null
          quote_id: string | null
          recipient_email: string
          sent_at: string | null
          source_session_id: string | null
          status: string
          submitted_at: string
          suppressed_at: string | null
          template: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          bounced_at?: string | null
          complained_at?: string | null
          created_at?: string
          delayed_at?: string | null
          delivered_at?: string | null
          failure_category?: string | null
          failure_reason?: string | null
          http_status?: number | null
          id?: string
          last_event_at?: string | null
          last_event_type?: string | null
          metadata?: Json
          provider?: string
          provider_message_id?: string | null
          quote_id?: string | null
          recipient_email: string
          sent_at?: string | null
          source_session_id?: string | null
          status: string
          submitted_at?: string
          suppressed_at?: string | null
          template: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          bounced_at?: string | null
          complained_at?: string | null
          created_at?: string
          delayed_at?: string | null
          delivered_at?: string | null
          failure_category?: string | null
          failure_reason?: string | null
          http_status?: number | null
          id?: string
          last_event_at?: string | null
          last_event_type?: string | null
          metadata?: Json
          provider?: string
          provider_message_id?: string | null
          quote_id?: string | null
          recipient_email?: string
          sent_at?: string | null
          source_session_id?: string | null
          status?: string
          submitted_at?: string
          suppressed_at?: string | null
          template?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_suppressions: {
        Row: {
          created_at: string
          email: string
          id: string
          notes: string | null
          provider_event_id: string | null
          reason: string
          source: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          notes?: string | null
          provider_event_id?: string | null
          reason: string
          source?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          notes?: string | null
          provider_event_id?: string | null
          reason?: string
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      embed_presets: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          embed_height: string
          embed_width: string
          id: string
          name: string
          selected_page: string
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          embed_height?: string
          embed_width?: string
          id?: string
          name: string
          selected_page?: string
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          embed_height?: string
          embed_width?: string
          id?: string
          name?: string
          selected_page?: string
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: []
      }
      escalation_recipients: {
        Row: {
          categories: Json
          created_at: string
          email: string | null
          handles_urgent: boolean
          id: string
          is_enabled: boolean
          name: string
          phone: string
          role: string
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          categories?: Json
          created_at?: string
          email?: string | null
          handles_urgent?: boolean
          id?: string
          is_enabled?: boolean
          name: string
          phone: string
          role?: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          categories?: Json
          created_at?: string
          email?: string | null
          handles_urgent?: boolean
          id?: string
          is_enabled?: boolean
          name?: string
          phone?: string
          role?: string
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      escalation_settings: {
        Row: {
          after_hours_behavior: string
          alert_cooldown_minutes: number
          business_hours_end: number
          business_hours_start: number
          created_at: string
          dashboard_base_url: string | null
          email_alerts_enabled: boolean
          id: string
          internal_alerts_enabled: boolean
          notify_email: string | null
          singleton: boolean
          updated_at: string
        }
        Insert: {
          after_hours_behavior?: string
          alert_cooldown_minutes?: number
          business_hours_end?: number
          business_hours_start?: number
          created_at?: string
          dashboard_base_url?: string | null
          email_alerts_enabled?: boolean
          id?: string
          internal_alerts_enabled?: boolean
          notify_email?: string | null
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          after_hours_behavior?: string
          alert_cooldown_minutes?: number
          business_hours_end?: number
          business_hours_start?: number
          created_at?: string
          dashboard_base_url?: string | null
          email_alerts_enabled?: boolean
          id?: string
          internal_alerts_enabled?: boolean
          notify_email?: string | null
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      jobber_busy_blocks: {
        Row: {
          client_address: string | null
          client_name: string | null
          created_at: string
          crew_id: string
          end_at: string
          id: string
          jobber_job_id: string | null
          jobber_visit_id: string | null
          source: string
          start_at: string
          status: string | null
          updated_at: string
        }
        Insert: {
          client_address?: string | null
          client_name?: string | null
          created_at?: string
          crew_id: string
          end_at: string
          id?: string
          jobber_job_id?: string | null
          jobber_visit_id?: string | null
          source?: string
          start_at: string
          status?: string | null
          updated_at?: string
        }
        Update: {
          client_address?: string | null
          client_name?: string | null
          created_at?: string
          crew_id?: string
          end_at?: string
          id?: string
          jobber_job_id?: string | null
          jobber_visit_id?: string | null
          source?: string
          start_at?: string
          status?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      jobber_oauth_states: {
        Row: {
          consumed_at: string | null
          created_at: string
          expires_at: string
          state: string
          user_id: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          state: string
          user_id: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      jobber_oauth_tokens: {
        Row: {
          access_token: string
          created_at: string
          expires_at: string
          id: string
          refresh_token: string
          scope: string | null
          updated_at: string
        }
        Insert: {
          access_token: string
          created_at?: string
          expires_at: string
          id?: string
          refresh_token: string
          scope?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string
          created_at?: string
          expires_at?: string
          id?: string
          refresh_token?: string
          scope?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      jobber_sync_state: {
        Row: {
          backfill_horizon_days: number
          backfill_in_progress: boolean
          backfill_started_at: string | null
          id: string
          last_backfill_at: string | null
          updated_at: string
        }
        Insert: {
          backfill_horizon_days?: number
          backfill_in_progress?: boolean
          backfill_started_at?: string | null
          id?: string
          last_backfill_at?: string | null
          updated_at?: string
        }
        Update: {
          backfill_horizon_days?: number
          backfill_in_progress?: boolean
          backfill_started_at?: string | null
          id?: string
          last_backfill_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      jobber_webhook_events: {
        Row: {
          event_id: string | null
          headers: Json | null
          id: string
          payload: Json | null
          processed_at: string | null
          processing_error: string | null
          raw_body: string | null
          received_at: string
          topic: string | null
        }
        Insert: {
          event_id?: string | null
          headers?: Json | null
          id?: string
          payload?: Json | null
          processed_at?: string | null
          processing_error?: string | null
          raw_body?: string | null
          received_at?: string
          topic?: string | null
        }
        Update: {
          event_id?: string | null
          headers?: Json | null
          id?: string
          payload?: Json | null
          processed_at?: string | null
          processing_error?: string | null
          raw_body?: string | null
          received_at?: string
          topic?: string | null
        }
        Relationships: []
      }
      knowledge_gaps: {
        Row: {
          approved_answer_version: number | null
          approved_at: string | null
          approved_by: string | null
          category: string | null
          channel: string | null
          conversation_count: number
          conversion_outcome: string | null
          created_at: string
          exact_question: string | null
          example_wording: string | null
          first_seen_at: string
          grouping_confidence: number
          grouping_key: string
          handoff_count: number
          id: string
          internal_notes: string | null
          last_seen_at: string
          normalized_question: string
          owner_id: string | null
          reason: string | null
          related_knowledge_id: string | null
          service: string | null
          status: string
          suggested_answer: string | null
          updated_at: string
        }
        Insert: {
          approved_answer_version?: number | null
          approved_at?: string | null
          approved_by?: string | null
          category?: string | null
          channel?: string | null
          conversation_count?: number
          conversion_outcome?: string | null
          created_at?: string
          exact_question?: string | null
          example_wording?: string | null
          first_seen_at?: string
          grouping_confidence?: number
          grouping_key: string
          handoff_count?: number
          id?: string
          internal_notes?: string | null
          last_seen_at?: string
          normalized_question: string
          owner_id?: string | null
          reason?: string | null
          related_knowledge_id?: string | null
          service?: string | null
          status?: string
          suggested_answer?: string | null
          updated_at?: string
        }
        Update: {
          approved_answer_version?: number | null
          approved_at?: string | null
          approved_by?: string | null
          category?: string | null
          channel?: string | null
          conversation_count?: number
          conversion_outcome?: string | null
          created_at?: string
          exact_question?: string | null
          example_wording?: string | null
          first_seen_at?: string
          grouping_confidence?: number
          grouping_key?: string
          handoff_count?: number
          id?: string
          internal_notes?: string | null
          last_seen_at?: string
          normalized_question?: string
          owner_id?: string | null
          reason?: string | null
          related_knowledge_id?: string | null
          service?: string | null
          status?: string
          suggested_answer?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_gaps_related_knowledge_id_fkey"
            columns: ["related_knowledge_id"]
            isOneToOne: false
            referencedRelation: "business_knowledge"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          active: boolean
          body: string
          category: string
          channel: string
          created_at: string
          description: string | null
          id: string
          name: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          body?: string
          category?: string
          channel?: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          body?: string
          category?: string
          channel?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      notification_events: {
        Row: {
          booking_id: string | null
          channel: string
          created_at: string
          customer_action: string | null
          customer_action_at: string | null
          event_type: string
          id: string
          notification_content: Json | null
          sent_at: string | null
          suppressed: boolean
          suppressed_reason: string | null
          triggered_by: string
          triggered_by_id: string | null
        }
        Insert: {
          booking_id?: string | null
          channel?: string
          created_at?: string
          customer_action?: string | null
          customer_action_at?: string | null
          event_type: string
          id?: string
          notification_content?: Json | null
          sent_at?: string | null
          suppressed?: boolean
          suppressed_reason?: string | null
          triggered_by?: string
          triggered_by_id?: string | null
        }
        Update: {
          booking_id?: string | null
          channel?: string
          created_at?: string
          customer_action?: string | null
          customer_action_at?: string | null
          event_type?: string
          id?: string
          notification_content?: Json | null
          sent_at?: string | null
          suppressed?: boolean
          suppressed_reason?: string | null
          triggered_by?: string
          triggered_by_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "admin_marketing_funnel"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "notification_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_confirmations: {
        Row: {
          admin_note: string | null
          booking_id: string
          change_type: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          new_values: Json
          old_values: Json
          responded_at: string | null
          show_price_change: boolean
          status: string
          token: string
        }
        Insert: {
          admin_note?: string | null
          booking_id: string
          change_type: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          new_values: Json
          old_values: Json
          responded_at?: string | null
          show_price_change?: boolean
          status?: string
          token: string
        }
        Update: {
          admin_note?: string | null
          booking_id?: string
          change_type?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          new_values?: Json
          old_values?: Json
          responded_at?: string | null
          show_price_change?: boolean
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_confirmations_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "admin_marketing_funnel"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "pending_confirmations_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_number_revisions: {
        Row: {
          changed_at: string
          changed_by: string | null
          display_format: string
          e164: string
          id: string
          is_active: boolean
          is_public: boolean
          label: string
          phone_id: string
          purpose: string
          revision: number
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          display_format: string
          e164: string
          id?: string
          is_active: boolean
          is_public: boolean
          label: string
          phone_id: string
          purpose: string
          revision: number
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          display_format?: string
          e164?: string
          id?: string
          is_active?: boolean
          is_public?: boolean
          label?: string
          phone_id?: string
          purpose?: string
          revision?: number
        }
        Relationships: []
      }
      phone_numbers: {
        Row: {
          created_at: string
          description: string | null
          display_format: string
          e164: string
          effective_date: string
          id: string
          is_active: boolean
          is_public: boolean
          label: string
          provider: string | null
          purpose: string
          revision: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_format: string
          e164: string
          effective_date?: string
          id?: string
          is_active?: boolean
          is_public?: boolean
          label: string
          provider?: string | null
          purpose: string
          revision?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_format?: string
          e164?: string
          effective_date?: string
          id?: string
          is_active?: boolean
          is_public?: boolean
          label?: string
          provider?: string | null
          purpose?: string
          revision?: number
          updated_at?: string
        }
        Relationships: []
      }
      pricing_config: {
        Row: {
          config_key: string
          config_value: Json
          created_at: string
          description: string | null
          id: string
          updated_at: string
        }
        Insert: {
          config_key: string
          config_value: Json
          created_at?: string
          description?: string | null
          id?: string
          updated_at?: string
        }
        Update: {
          config_key?: string
          config_value?: Json
          created_at?: string
          description?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      pricing_versions: {
        Row: {
          config_snapshot: Json
          created_at: string
          id: string
          note: string | null
          published_at: string
          published_by: string | null
          version: number
        }
        Insert: {
          config_snapshot: Json
          created_at?: string
          id?: string
          note?: string | null
          published_at?: string
          published_by?: string | null
          version: number
        }
        Update: {
          config_snapshot?: Json
          created_at?: string
          id?: string
          note?: string | null
          published_at?: string
          published_by?: string | null
          version?: number
        }
        Relationships: []
      }
      properties: {
        Row: {
          active: boolean
          city: string | null
          created_at: string
          id: string
          jobber_property_id: string | null
          latitude: number | null
          longitude: number | null
          normalized_address: string
          postal_code: string | null
          property_type: string
          state: string | null
          street: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          city?: string | null
          created_at?: string
          id?: string
          jobber_property_id?: string | null
          latitude?: number | null
          longitude?: number | null
          normalized_address: string
          postal_code?: string | null
          property_type?: string
          state?: string | null
          street?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          city?: string | null
          created_at?: string
          id?: string
          jobber_property_id?: string | null
          latitude?: number | null
          longitude?: number | null
          normalized_address?: string
          postal_code?: string | null
          property_type?: string
          state?: string | null
          street?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      property_facts: {
        Row: {
          confidence: number | null
          created_at: string
          created_by_id: string | null
          created_by_type: string
          fact_type: string
          id: string
          last_verified_at: string | null
          observed_at: string | null
          property_id: string
          source: string
          source_record_id: string | null
          superseded_at: string | null
          unit: string | null
          updated_at: string
          value_numeric: number | null
          value_text: string | null
          verification_status: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          created_by_id?: string | null
          created_by_type?: string
          fact_type: string
          id?: string
          last_verified_at?: string | null
          observed_at?: string | null
          property_id: string
          source: string
          source_record_id?: string | null
          superseded_at?: string | null
          unit?: string | null
          updated_at?: string
          value_numeric?: number | null
          value_text?: string | null
          verification_status?: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          created_by_id?: string | null
          created_by_type?: string
          fact_type?: string
          id?: string
          last_verified_at?: string | null
          observed_at?: string | null
          property_id?: string
          source?: string
          source_record_id?: string | null
          superseded_at?: string | null
          unit?: string | null
          updated_at?: string
          value_numeric?: number | null
          value_text?: string | null
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_facts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_resume_tokens: {
        Row: {
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          issued_reason: string | null
          last_used_at: string | null
          purpose: string
          quote_id: string
          revoked_at: string | null
          token_hash: string
          use_count: number
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          issued_reason?: string | null
          last_used_at?: string | null
          purpose?: string
          quote_id: string
          revoked_at?: string | null
          token_hash: string
          use_count?: number
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          issued_reason?: string | null
          last_used_at?: string | null
          purpose?: string
          quote_id?: string
          revoked_at?: string | null
          token_hash?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_resume_tokens_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "admin_marketing_funnel"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "quote_resume_tokens_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_sessions: {
        Row: {
          bid_request_status: string | null
          booking_ready: boolean
          channel: string
          conversation_ids: string[]
          created_at: string
          customer_id: string | null
          email_normalized: string | null
          expires_at: string | null
          field_status: Json
          fields: Json
          human_pricing_required: boolean
          id: string
          last_step: string | null
          phone_e164: string | null
          property_id: string | null
          quote_id: string | null
          quote_status: string
          required_remaining: string[]
          resume_token_id: string | null
          updated_at: string
        }
        Insert: {
          bid_request_status?: string | null
          booking_ready?: boolean
          channel: string
          conversation_ids?: string[]
          created_at?: string
          customer_id?: string | null
          email_normalized?: string | null
          expires_at?: string | null
          field_status?: Json
          fields?: Json
          human_pricing_required?: boolean
          id?: string
          last_step?: string | null
          phone_e164?: string | null
          property_id?: string | null
          quote_id?: string | null
          quote_status?: string
          required_remaining?: string[]
          resume_token_id?: string | null
          updated_at?: string
        }
        Update: {
          bid_request_status?: string | null
          booking_ready?: boolean
          channel?: string
          conversation_ids?: string[]
          created_at?: string
          customer_id?: string | null
          email_normalized?: string | null
          expires_at?: string | null
          field_status?: Json
          fields?: Json
          human_pricing_required?: boolean
          id?: string
          last_step?: string | null
          phone_e164?: string | null
          property_id?: string | null
          quote_id?: string | null
          quote_status?: string
          required_remaining?: string[]
          resume_token_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_sessions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          abandonment_emitted_version: string | null
          abandonment_swept_at: string | null
          attribution: Json | null
          authoritative_snapshot: Json | null
          confirmed_at: string | null
          converted_at: string | null
          converted_booking_id: string | null
          created_at: string
          customer_email: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          decline_notes: string | null
          decline_reason: string | null
          decline_source: string | null
          decline_version: number | null
          declined_at: string | null
          declined_by: string | null
          discount_amount: number | null
          discount_code: string | null
          discount_snapshot: Json | null
          emailed_at: string | null
          estimated_quote_revenue: number | null
          expires_at: string | null
          home_details_json: Json
          id: string
          idempotency_key: string | null
          input_snapshot: Json | null
          jobber_quote_id: string | null
          last_activity_at: string
          line_item_snapshot: Json | null
          pricing_engine_version: string | null
          pricing_rule_version: number | null
          property_id: string | null
          quote_completion_seconds: number | null
          quote_type: string | null
          saved_at: string | null
          services_json: Json
          session_id: string | null
          source_session_id: string | null
          status: Database["public"]["Enums"]["quote_status"]
          subtotal: number
          superseded_at: string | null
          superseded_by: string | null
          total: number
          updated_at: string
          utm_params_json: Json | null
          viewed_at: string | null
        }
        Insert: {
          abandonment_emitted_version?: string | null
          abandonment_swept_at?: string | null
          attribution?: Json | null
          authoritative_snapshot?: Json | null
          confirmed_at?: string | null
          converted_at?: string | null
          converted_booking_id?: string | null
          created_at?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          decline_notes?: string | null
          decline_reason?: string | null
          decline_source?: string | null
          decline_version?: number | null
          declined_at?: string | null
          declined_by?: string | null
          discount_amount?: number | null
          discount_code?: string | null
          discount_snapshot?: Json | null
          emailed_at?: string | null
          estimated_quote_revenue?: number | null
          expires_at?: string | null
          home_details_json: Json
          id?: string
          idempotency_key?: string | null
          input_snapshot?: Json | null
          jobber_quote_id?: string | null
          last_activity_at?: string
          line_item_snapshot?: Json | null
          pricing_engine_version?: string | null
          pricing_rule_version?: number | null
          property_id?: string | null
          quote_completion_seconds?: number | null
          quote_type?: string | null
          saved_at?: string | null
          services_json: Json
          session_id?: string | null
          source_session_id?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal: number
          superseded_at?: string | null
          superseded_by?: string | null
          total: number
          updated_at?: string
          utm_params_json?: Json | null
          viewed_at?: string | null
        }
        Update: {
          abandonment_emitted_version?: string | null
          abandonment_swept_at?: string | null
          attribution?: Json | null
          authoritative_snapshot?: Json | null
          confirmed_at?: string | null
          converted_at?: string | null
          converted_booking_id?: string | null
          created_at?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          decline_notes?: string | null
          decline_reason?: string | null
          decline_source?: string | null
          decline_version?: number | null
          declined_at?: string | null
          declined_by?: string | null
          discount_amount?: number | null
          discount_code?: string | null
          discount_snapshot?: Json | null
          emailed_at?: string | null
          estimated_quote_revenue?: number | null
          expires_at?: string | null
          home_details_json?: Json
          id?: string
          idempotency_key?: string | null
          input_snapshot?: Json | null
          jobber_quote_id?: string | null
          last_activity_at?: string
          line_item_snapshot?: Json | null
          pricing_engine_version?: string | null
          pricing_rule_version?: number | null
          property_id?: string | null
          quote_completion_seconds?: number | null
          quote_type?: string | null
          saved_at?: string | null
          services_json?: Json
          session_id?: string | null
          source_session_id?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal?: number
          superseded_at?: string | null
          superseded_by?: string | null
          total?: number
          updated_at?: string
          utm_params_json?: Json | null
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_converted_booking_id_fkey"
            columns: ["converted_booking_id"]
            isOneToOne: false
            referencedRelation: "admin_marketing_funnel"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "quotes_converted_booking_id_fkey"
            columns: ["converted_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "admin_marketing_funnel"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "quotes_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_buckets: {
        Row: {
          bucket_key: string
          count: number
          updated_at: string
          window_ms: number
          window_start: string
        }
        Insert: {
          bucket_key: string
          count?: number
          updated_at?: string
          window_ms: number
          window_start: string
        }
        Update: {
          bucket_key?: string
          count?: number
          updated_at?: string
          window_ms?: number
          window_start?: string
        }
        Relationships: []
      }
      resend_webhook_events: {
        Row: {
          event_type: string
          id: string
          payload: Json
          provider_message_id: string | null
          received_at: string
          svix_id: string
        }
        Insert: {
          event_type: string
          id?: string
          payload: Json
          provider_message_id?: string | null
          received_at?: string
          svix_id: string
        }
        Update: {
          event_type?: string
          id?: string
          payload?: Json
          provider_message_id?: string | null
          received_at?: string
          svix_id?: string
        }
        Relationships: []
      }
      saved_scenarios: {
        Row: {
          additional_services: Json
          created_at: string
          created_by: string
          description: string | null
          home_details: Json
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          additional_services: Json
          created_at?: string
          created_by: string
          description?: string | null
          home_details: Json
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          additional_services?: Json
          created_at?: string
          created_by?: string
          description?: string | null
          home_details?: Json
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      schedule_blocks: {
        Row: {
          block_category: string | null
          block_type: string
          created_at: string
          created_by: string | null
          end_at: string
          id: string
          is_all_day: boolean | null
          notes: string | null
          reason: string | null
          start_at: string
          technician_id: string
          updated_at: string
        }
        Insert: {
          block_category?: string | null
          block_type?: string
          created_at?: string
          created_by?: string | null
          end_at: string
          id?: string
          is_all_day?: boolean | null
          notes?: string | null
          reason?: string | null
          start_at: string
          technician_id: string
          updated_at?: string
        }
        Update: {
          block_category?: string | null
          block_type?: string
          created_at?: string
          created_by?: string | null
          end_at?: string
          id?: string
          is_all_day?: boolean | null
          notes?: string | null
          reason?: string | null
          start_at?: string
          technician_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_blocks_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "technicians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_blocks_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "technicians_public"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_reconciliation_runs: {
        Row: {
          blocks_added: number
          blocks_corrected: number
          blocks_pruned: number
          completed_at: string | null
          created_by: string | null
          error: string | null
          horizon_days: number
          id: string
          jobber_visits: number
          mirror_blocks: number
          mismatch_count: number
          missing_count: number
          mode: string
          orphan_count: number
          report: Json | null
          started_at: string
          status: string
          trigger: string
        }
        Insert: {
          blocks_added?: number
          blocks_corrected?: number
          blocks_pruned?: number
          completed_at?: string | null
          created_by?: string | null
          error?: string | null
          horizon_days?: number
          id?: string
          jobber_visits?: number
          mirror_blocks?: number
          mismatch_count?: number
          missing_count?: number
          mode?: string
          orphan_count?: number
          report?: Json | null
          started_at?: string
          status?: string
          trigger?: string
        }
        Update: {
          blocks_added?: number
          blocks_corrected?: number
          blocks_pruned?: number
          completed_at?: string | null
          created_by?: string | null
          error?: string | null
          horizon_days?: number
          id?: string
          jobber_visits?: number
          mirror_blocks?: number
          mismatch_count?: number
          missing_count?: number
          mode?: string
          orphan_count?: number
          report?: Json | null
          started_at?: string
          status?: string
          trigger?: string
        }
        Relationships: []
      }
      schedule_sync_runs: {
        Row: {
          blocks_inserted: number
          chunk_days: number
          chunks_completed: number
          completed_at: string | null
          current_cursor_date: string | null
          from_date: string
          id: string
          last_error: string | null
          started_at: string
          status: string
          to_date: string
          total_chunks: number
          updated_at: string
          visits_synced: number
        }
        Insert: {
          blocks_inserted?: number
          chunk_days?: number
          chunks_completed?: number
          completed_at?: string | null
          current_cursor_date?: string | null
          from_date: string
          id?: string
          last_error?: string | null
          started_at?: string
          status?: string
          to_date: string
          total_chunks?: number
          updated_at?: string
          visits_synced?: number
        }
        Update: {
          blocks_inserted?: number
          chunk_days?: number
          chunks_completed?: number
          completed_at?: string | null
          current_cursor_date?: string | null
          from_date?: string
          id?: string
          last_error?: string | null
          started_at?: string
          status?: string
          to_date?: string
          total_chunks?: number
          updated_at?: string
          visits_synced?: number
        }
        Relationships: []
      }
      service_area_config: {
        Row: {
          allowed_cities: Json
          allowed_postal_codes: Json
          center_address: string | null
          created_at: string
          id: string
          is_configured: boolean
          manual_review_counties: Json
          out_of_area_message: string
          radius_miles: number | null
          singleton: boolean
          state_code: string
          updated_at: string
        }
        Insert: {
          allowed_cities?: Json
          allowed_postal_codes?: Json
          center_address?: string | null
          created_at?: string
          id?: string
          is_configured?: boolean
          manual_review_counties?: Json
          out_of_area_message?: string
          radius_miles?: number | null
          singleton?: boolean
          state_code?: string
          updated_at?: string
        }
        Update: {
          allowed_cities?: Json
          allowed_postal_codes?: Json
          center_address?: string | null
          created_at?: string
          id?: string
          is_configured?: boolean
          manual_review_counties?: Json
          out_of_area_message?: string
          radius_miles?: number | null
          singleton?: boolean
          state_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      service_education_content: {
        Row: {
          body: string
          channel: string
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          send_after_days: number
          service_key: string
          sort_order: number
          subject: string | null
          updated_at: string
        }
        Insert: {
          body: string
          channel?: string
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          send_after_days?: number
          service_key: string
          sort_order?: number
          subject?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          send_after_days?: number
          service_key?: string
          sort_order?: number
          subject?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      service_maintenance_intervals: {
        Row: {
          advisory: string | null
          created_at: string
          display_name: string
          id: string
          interval_days: number
          is_active: boolean
          service_key: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          advisory?: string | null
          created_at?: string
          display_name: string
          id?: string
          interval_days: number
          is_active?: boolean
          service_key: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          advisory?: string | null
          created_at?: string
          display_name?: string
          id?: string
          interval_days?: number
          is_active?: boolean
          service_key?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      service_preparation_config: {
        Row: {
          created_at: string
          display_name: string
          id: string
          instructions: Json
          is_active: boolean
          notes: string | null
          service_key: string
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          instructions?: Json
          is_active?: boolean
          notes?: string | null
          service_key: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          instructions?: Json
          is_active?: boolean
          notes?: string | null
          service_key?: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      service_staffing_requirements: {
        Row: {
          created_at: string
          id: string
          lead_vehicle_required: boolean
          max_technicians: number | null
          min_technicians: number
          notes: string | null
          preferred_technicians: number | null
          service_key: string
          solo_allowed: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          lead_vehicle_required?: boolean
          max_technicians?: number | null
          min_technicians?: number
          notes?: string | null
          preferred_technicians?: number | null
          service_key: string
          solo_allowed?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          lead_vehicle_required?: boolean
          max_technicians?: number | null
          min_technicians?: number
          notes?: string | null
          preferred_technicians?: number | null
          service_key?: string
          solo_allowed?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      slot_reservations: {
        Row: {
          booking_id: string | null
          created_at: string
          crew_id: string
          end_at: string
          expires_at: string
          group_id: string
          id: string
          idempotency_key: string | null
          jobber_job_id: string | null
          jobber_visit_id: string | null
          result_json: Json | null
          session_id: string | null
          start_at: string
          status: string
          updated_at: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          crew_id: string
          end_at: string
          expires_at?: string
          group_id: string
          id?: string
          idempotency_key?: string | null
          jobber_job_id?: string | null
          jobber_visit_id?: string | null
          result_json?: Json | null
          session_id?: string | null
          start_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          crew_id?: string
          end_at?: string
          expires_at?: string
          group_id?: string
          id?: string
          idempotency_key?: string | null
          jobber_job_id?: string | null
          jobber_visit_id?: string | null
          result_json?: Json | null
          session_id?: string | null
          start_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      sms_campaign_steps: {
        Row: {
          active: boolean
          body_template: string
          business_hours_only: boolean
          campaign_id: string
          channel: string
          content_config: Json
          created_at: string
          delay_hours: number
          id: string
          is_marketing: boolean
          step_order: number
          subject: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          body_template: string
          business_hours_only?: boolean
          campaign_id: string
          channel?: string
          content_config?: Json
          created_at?: string
          delay_hours?: number
          id?: string
          is_marketing?: boolean
          step_order?: number
          subject?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          body_template?: string
          business_hours_only?: boolean
          campaign_id?: string
          channel?: string
          content_config?: Json
          created_at?: string
          delay_hours?: number
          id?: string
          is_marketing?: boolean
          step_order?: number
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_campaign_steps_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "sms_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_campaigns: {
        Row: {
          abandonment_delay_minutes: number | null
          active: boolean
          audience_conditions: Json
          campaign_kind: string
          created_at: string
          description: string | null
          effective_end: string | null
          effective_start: string | null
          event_name: string | null
          historical_backfill_enabled: boolean
          id: string
          is_terminal_phase: boolean
          lifecycle_status:
            | Database["public"]["Enums"]["lead_lifecycle_status"]
            | null
          name: string
          reentry_cooldown_hours: number | null
          reentry_enabled: boolean
          required_consent: Database["public"]["Enums"]["consent_type"] | null
          status: string
          stop_conditions: Json
          trigger_event: Database["public"]["Enums"]["sms_trigger_event"] | null
          updated_at: string
          version: number
        }
        Insert: {
          abandonment_delay_minutes?: number | null
          active?: boolean
          audience_conditions?: Json
          campaign_kind?: string
          created_at?: string
          description?: string | null
          effective_end?: string | null
          effective_start?: string | null
          event_name?: string | null
          historical_backfill_enabled?: boolean
          id?: string
          is_terminal_phase?: boolean
          lifecycle_status?:
            | Database["public"]["Enums"]["lead_lifecycle_status"]
            | null
          name: string
          reentry_cooldown_hours?: number | null
          reentry_enabled?: boolean
          required_consent?: Database["public"]["Enums"]["consent_type"] | null
          status?: string
          stop_conditions?: Json
          trigger_event?:
            | Database["public"]["Enums"]["sms_trigger_event"]
            | null
          updated_at?: string
          version?: number
        }
        Update: {
          abandonment_delay_minutes?: number | null
          active?: boolean
          audience_conditions?: Json
          campaign_kind?: string
          created_at?: string
          description?: string | null
          effective_end?: string | null
          effective_start?: string | null
          event_name?: string | null
          historical_backfill_enabled?: boolean
          id?: string
          is_terminal_phase?: boolean
          lifecycle_status?:
            | Database["public"]["Enums"]["lead_lifecycle_status"]
            | null
          name?: string
          reentry_cooldown_hours?: number | null
          reentry_enabled?: boolean
          required_consent?: Database["public"]["Enums"]["consent_type"] | null
          status?: string
          stop_conditions?: Json
          trigger_event?:
            | Database["public"]["Enums"]["sms_trigger_event"]
            | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      sms_messages: {
        Row: {
          attempts: number
          body: string
          booking_id: string | null
          callrail_message_id: string | null
          campaign_id: string | null
          campaign_step_id: string | null
          channel: string
          created_at: string
          customer_id: string | null
          enrollment_id: string | null
          error: string | null
          id: string
          max_attempts: number
          message_kind: string
          next_retry_at: string | null
          provider: string | null
          provider_accepted_at: string | null
          provider_conversation_id: string | null
          provider_message_id: string | null
          provider_response_kind: string | null
          provider_status: string | null
          quote_id: string | null
          send_at: string
          sent_at: string | null
          status: Database["public"]["Enums"]["sms_status"]
          subject: string | null
          suppressed: boolean
          suppressed_reason: string | null
          to_email: string | null
          to_number: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          body: string
          booking_id?: string | null
          callrail_message_id?: string | null
          campaign_id?: string | null
          campaign_step_id?: string | null
          channel?: string
          created_at?: string
          customer_id?: string | null
          enrollment_id?: string | null
          error?: string | null
          id?: string
          max_attempts?: number
          message_kind?: string
          next_retry_at?: string | null
          provider?: string | null
          provider_accepted_at?: string | null
          provider_conversation_id?: string | null
          provider_message_id?: string | null
          provider_response_kind?: string | null
          provider_status?: string | null
          quote_id?: string | null
          send_at?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["sms_status"]
          subject?: string | null
          suppressed?: boolean
          suppressed_reason?: string | null
          to_email?: string | null
          to_number?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          body?: string
          booking_id?: string | null
          callrail_message_id?: string | null
          campaign_id?: string | null
          campaign_step_id?: string | null
          channel?: string
          created_at?: string
          customer_id?: string | null
          enrollment_id?: string | null
          error?: string | null
          id?: string
          max_attempts?: number
          message_kind?: string
          next_retry_at?: string | null
          provider?: string | null
          provider_accepted_at?: string | null
          provider_conversation_id?: string | null
          provider_message_id?: string | null
          provider_response_kind?: string | null
          provider_status?: string | null
          quote_id?: string | null
          send_at?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["sms_status"]
          subject?: string | null
          suppressed?: boolean
          suppressed_reason?: string | null
          to_email?: string | null
          to_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_messages_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "admin_marketing_funnel"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "sms_messages_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "sms_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_campaign_step_id_fkey"
            columns: ["campaign_step_id"]
            isOneToOne: false
            referencedRelation: "sms_campaign_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "admin_marketing_funnel"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "sms_messages_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_opt_outs: {
        Row: {
          created_at: string
          id: string
          last_inbound_body: string | null
          opted_in_at: string | null
          opted_out: boolean
          opted_out_at: string | null
          phone: string
          reason: string | null
          source: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_inbound_body?: string | null
          opted_in_at?: string | null
          opted_out?: boolean
          opted_out_at?: string | null
          phone: string
          reason?: string | null
          source?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_inbound_body?: string | null
          opted_in_at?: string | null
          opted_out?: boolean
          opted_out_at?: string | null
          phone?: string
          reason?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      staff_reply_test_authorizations: {
        Row: {
          authorized_by: string | null
          channel: string
          consumed_at: string | null
          consumed_message_id: string | null
          conversation_id: string
          created_at: string
          expires_at: string
          id: string
        }
        Insert: {
          authorized_by?: string | null
          channel: string
          consumed_at?: string | null
          consumed_message_id?: string | null
          conversation_id: string
          created_at?: string
          expires_at?: string
          id?: string
        }
        Update: {
          authorized_by?: string | null
          channel?: string
          consumed_at?: string | null
          consumed_message_id?: string | null
          conversation_id?: string
          created_at?: string
          expires_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_reply_test_authorizations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      system_issues: {
        Row: {
          associated_ref: string | null
          conversation_id: string | null
          created_at: string
          dedupe_key: string
          details: Json | null
          first_seen_at: string
          id: string
          issue_type: string
          last_alerted_at: string | null
          last_seen_at: string
          occurrence_count: number
          owner_id: string | null
          resolution_notes: string | null
          severity: string
          status: string
          suggested_action: string | null
          updated_at: string
        }
        Insert: {
          associated_ref?: string | null
          conversation_id?: string | null
          created_at?: string
          dedupe_key: string
          details?: Json | null
          first_seen_at?: string
          id?: string
          issue_type: string
          last_alerted_at?: string | null
          last_seen_at?: string
          occurrence_count?: number
          owner_id?: string | null
          resolution_notes?: string | null
          severity?: string
          status?: string
          suggested_action?: string | null
          updated_at?: string
        }
        Update: {
          associated_ref?: string | null
          conversation_id?: string | null
          created_at?: string
          dedupe_key?: string
          details?: Json | null
          first_seen_at?: string
          id?: string
          issue_type?: string
          last_alerted_at?: string | null
          last_seen_at?: string
          occurrence_count?: number
          owner_id?: string | null
          resolution_notes?: string | null
          severity?: string
          status?: string
          suggested_action?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_issues_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      system_test_config: {
        Row: {
          id: string
          suppress_all: boolean
          suppress_reason: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          suppress_all?: boolean
          suppress_reason?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          suppress_all?: boolean
          suppress_reason?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      technician_service_rates: {
        Row: {
          buffer_minutes: number
          created_at: string
          dollars_per_hour: number
          id: string
          service_type: Database["public"]["Enums"]["service_type"]
          technician_id: string
          updated_at: string
        }
        Insert: {
          buffer_minutes?: number
          created_at?: string
          dollars_per_hour?: number
          id?: string
          service_type: Database["public"]["Enums"]["service_type"]
          technician_id: string
          updated_at?: string
        }
        Update: {
          buffer_minutes?: number
          created_at?: string
          dollars_per_hour?: number
          id?: string
          service_type?: Database["public"]["Enums"]["service_type"]
          technician_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "technician_service_rates_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "technicians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technician_service_rates_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "technicians_public"
            referencedColumns: ["id"]
          },
        ]
      }
      technicians: {
        Row: {
          buffer_minutes: number | null
          created_at: string
          customer_bookable_lead: boolean
          eligible_leader_ids: string[]
          email: string | null
          has_company_vehicle: boolean
          id: string
          is_active: boolean
          jobber_user_id: string
          location_type: string
          max_crew_size: number | null
          max_drive_time_minutes: number | null
          max_stories: number | null
          name: string
          public_display_name: string | null
          role: string
          role_effective_at: string | null
          schedule_end_hour: number | null
          schedule_start_hour: number | null
          service_capabilities: Json | null
          skill_level: string | null
          starting_address: string | null
          updated_at: string
          work_days: Json | null
        }
        Insert: {
          buffer_minutes?: number | null
          created_at?: string
          customer_bookable_lead?: boolean
          eligible_leader_ids?: string[]
          email?: string | null
          has_company_vehicle?: boolean
          id?: string
          is_active?: boolean
          jobber_user_id: string
          location_type?: string
          max_crew_size?: number | null
          max_drive_time_minutes?: number | null
          max_stories?: number | null
          name: string
          public_display_name?: string | null
          role?: string
          role_effective_at?: string | null
          schedule_end_hour?: number | null
          schedule_start_hour?: number | null
          service_capabilities?: Json | null
          skill_level?: string | null
          starting_address?: string | null
          updated_at?: string
          work_days?: Json | null
        }
        Update: {
          buffer_minutes?: number | null
          created_at?: string
          customer_bookable_lead?: boolean
          eligible_leader_ids?: string[]
          email?: string | null
          has_company_vehicle?: boolean
          id?: string
          is_active?: boolean
          jobber_user_id?: string
          location_type?: string
          max_crew_size?: number | null
          max_drive_time_minutes?: number | null
          max_stories?: number | null
          name?: string
          public_display_name?: string | null
          role?: string
          role_effective_at?: string | null
          schedule_end_hour?: number | null
          schedule_start_hour?: number | null
          service_capabilities?: Json | null
          skill_level?: string | null
          starting_address?: string | null
          updated_at?: string
          work_days?: Json | null
        }
        Relationships: []
      }
      test_identities: {
        Row: {
          active: boolean
          authorization_consumed_at: string | null
          authorization_expires_at: string | null
          authorized_by: string | null
          authorized_conversation_id: string | null
          authorized_idempotency_key: string | null
          authorized_result: Json | null
          authorized_slot_id: string | null
          created_at: string
          email: string | null
          id: string
          live_jobber_test_enabled: boolean
          name: string
          note: string | null
          phone: string | null
          protected: boolean
          updated_at: string
        }
        Insert: {
          active?: boolean
          authorization_consumed_at?: string | null
          authorization_expires_at?: string | null
          authorized_by?: string | null
          authorized_conversation_id?: string | null
          authorized_idempotency_key?: string | null
          authorized_result?: Json | null
          authorized_slot_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          live_jobber_test_enabled?: boolean
          name: string
          note?: string | null
          phone?: string | null
          protected?: boolean
          updated_at?: string
        }
        Update: {
          active?: boolean
          authorization_consumed_at?: string | null
          authorization_expires_at?: string | null
          authorized_by?: string | null
          authorized_conversation_id?: string | null
          authorized_idempotency_key?: string | null
          authorized_result?: Json | null
          authorized_slot_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          live_jobber_test_enabled?: boolean
          name?: string
          note?: string | null
          phone?: string | null
          protected?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      weather_status: {
        Row: {
          advisory_message: string | null
          created_at: string
          id: string
          internal_note: string | null
          singleton: boolean
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          advisory_message?: string | null
          created_at?: string
          id?: string
          internal_note?: string | null
          singleton?: boolean
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          advisory_message?: string | null
          created_at?: string
          id?: string
          internal_note?: string | null
          singleton?: boolean
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      admin_marketing_funnel: {
        Row: {
          attribution_id: string | null
          booked_bundle_savings: number | null
          booked_discount_amount: number | null
          booked_revenue: number | null
          booked_service_count: number | null
          booked_services: Json | null
          booked_subtotal: number | null
          booking_completed_at: string | null
          booking_id: string | null
          booking_status: Database["public"]["Enums"]["booking_status"] | null
          city: string | null
          estimated_quote_revenue: number | null
          fbclid: string | null
          first_touch: Json | null
          jobber_job_id: string | null
          jobber_visit_id: string | null
          landing_page_slug: string | null
          last_touch: Json | null
          quote_created_at: string | null
          quote_id: string | null
          quote_status: Database["public"]["Enums"]["quote_status"] | null
          quoted_total: number | null
          referrer: string | null
          source_session_id: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          visitor_at: string | null
          zip_code: string | null
        }
        Relationships: []
      }
      eligibility_rules_public: {
        Row: {
          conditions: Json | null
          created_at: string | null
          description: string | null
          id: string | null
          is_active: boolean | null
          priority: number | null
          rule_name: string | null
          rule_type: string | null
          updated_at: string | null
        }
        Insert: {
          conditions?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string | null
          is_active?: boolean | null
          priority?: number | null
          rule_name?: string | null
          rule_type?: string | null
          updated_at?: string | null
        }
        Update: {
          conditions?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string | null
          is_active?: boolean | null
          priority?: number | null
          rule_name?: string | null
          rule_type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      property_facts_current: {
        Row: {
          confidence: number | null
          created_at: string | null
          created_by_id: string | null
          created_by_type: string | null
          fact_type: string | null
          id: string | null
          last_verified_at: string | null
          observed_at: string | null
          property_id: string | null
          source: string | null
          source_record_id: string | null
          unit: string | null
          updated_at: string | null
          value_numeric: number | null
          value_text: string | null
          verification_status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "property_facts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      technicians_public: {
        Row: {
          buffer_minutes: number | null
          created_at: string | null
          id: string | null
          is_active: boolean | null
          jobber_user_id: string | null
          location_type: string | null
          max_drive_time_minutes: number | null
          max_stories: number | null
          name: string | null
          schedule_end_hour: number | null
          schedule_start_hour: number | null
          service_capabilities: Json | null
          skill_level: string | null
          updated_at: string | null
          work_days: Json | null
        }
        Insert: {
          buffer_minutes?: number | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          jobber_user_id?: string | null
          location_type?: string | null
          max_drive_time_minutes?: number | null
          max_stories?: number | null
          name?: string | null
          schedule_end_hour?: number | null
          schedule_start_hour?: number | null
          service_capabilities?: Json | null
          skill_level?: string | null
          updated_at?: string | null
          work_days?: Json | null
        }
        Update: {
          buffer_minutes?: number | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          jobber_user_id?: string | null
          location_type?: string | null
          max_drive_time_minutes?: number | null
          max_stories?: number | null
          name?: string | null
          schedule_end_hour?: number | null
          schedule_start_hour?: number | null
          service_capabilities?: Json | null
          skill_level?: string | null
          updated_at?: string | null
          work_days?: Json | null
        }
        Relationships: []
      }
    }
    Functions: {
      acquire_autosync_lock: {
        Args: { p_holder_id: string; p_lock_ttl_minutes?: number }
        Returns: boolean
      }
      admin_set_lifecycle: {
        Args: {
          p_customer_id: string
          p_status: Database["public"]["Enums"]["lead_lifecycle_status"]
        }
        Returns: undefined
      }
      apply_lifecycle_status: {
        Args: {
          p_customer_id: string
          p_source?: string
          p_status: Database["public"]["Enums"]["lead_lifecycle_status"]
        }
        Returns: undefined
      }
      authorize_customer_access_test: {
        Args: {
          p_idempotency_key: string
          p_recipient: string
          p_target_id: string
          p_test_type: string
          p_ttl_minutes?: number
        }
        Returns: Json
      }
      authorize_live_jobber_test: {
        Args: {
          p_conversation_id: string
          p_email: string
          p_idempotency_key: string
          p_slot_id: string
          p_ttl_minutes?: number
        }
        Returns: Json
      }
      authorize_staff_test_reply: {
        Args: { p_channel: string; p_conversation_id: string }
        Returns: string
      }
      can_edit_crew_rules: { Args: never; Returns: boolean }
      can_manage_schedule_blocks: { Args: never; Returns: boolean }
      can_override_bookings: { Args: never; Returns: boolean }
      check_and_increment_rate_limit: {
        Args: { _key: string; _limit: number; _window_ms: number }
        Returns: {
          allowed: boolean
          current_count: number
          reset_at: string
        }[]
      }
      claim_callrail_event_for_replay: {
        Args: { _actor: string; _id: string }
        Returns: {
          id: string
          prior_status: string
          provider_message_id: string
        }[]
      }
      claim_due_callrail_retries: {
        Args: { _limit: number }
        Returns: {
          id: string
        }[]
      }
      claim_due_sms: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          body: string
          booking_id: string | null
          callrail_message_id: string | null
          campaign_id: string | null
          campaign_step_id: string | null
          channel: string
          created_at: string
          customer_id: string | null
          enrollment_id: string | null
          error: string | null
          id: string
          max_attempts: number
          message_kind: string
          next_retry_at: string | null
          provider: string | null
          provider_accepted_at: string | null
          provider_conversation_id: string | null
          provider_message_id: string | null
          provider_response_kind: string | null
          provider_status: string | null
          quote_id: string | null
          send_at: string
          sent_at: string | null
          status: Database["public"]["Enums"]["sms_status"]
          subject: string | null
          suppressed: boolean
          suppressed_reason: string | null
          to_email: string | null
          to_number: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "sms_messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      clear_live_jobber_authorization: {
        Args: { p_email: string }
        Returns: undefined
      }
      compute_customer_lifecycle: {
        Args: { p_customer_id: string }
        Returns: Database["public"]["Enums"]["lead_lifecycle_status"]
      }
      confirm_booking_slot: {
        Args: {
          p_booking_id: string
          p_group_id: string
          p_job_id: string
          p_result: Json
          p_visit_id: string
        }
        Returns: undefined
      }
      consent_allows: {
        Args: {
          p_channel: Database["public"]["Enums"]["consent_channel"]
          p_email?: string
          p_phone?: string
          p_required: Database["public"]["Enums"]["consent_type"]
        }
        Returns: boolean
      }
      consume_customer_access_test_auth: {
        Args: { p_idempotency_key: string; p_test_type: string }
        Returns: Json
      }
      consume_live_jobber_authorization: {
        Args: {
          p_conversation_id: string
          p_email: string
          p_idempotency_key: string
          p_slot_id: string
        }
        Returns: Json
      }
      consume_staff_test_reply_auth: {
        Args: { p_channel: string; p_conversation_id: string }
        Returns: string
      }
      create_customer_access_test_booking_fixture: {
        Args: never
        Returns: string
      }
      current_pricing_version: { Args: never; Returns: number }
      expire_stale_reservations: { Args: never; Returns: number }
      generate_booking_reference: { Args: never; Returns: string }
      has_admin_level: {
        Args: { _min_level: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_read_only_admin: { Args: never; Returns: boolean }
      publish_pricing_version: { Args: { p_note?: string }; Returns: number }
      quote_has_real_services: { Args: { p: Json }; Returns: boolean }
      record_consent: {
        Args: {
          p_actor_id?: string
          p_booking_id?: string
          p_channel: Database["public"]["Enums"]["consent_channel"]
          p_consent_type: Database["public"]["Enums"]["consent_type"]
          p_conversation_id?: string
          p_customer_id?: string
          p_email?: string
          p_language_shown?: string
          p_metadata?: Json
          p_phone?: string
          p_session_id?: string
          p_source?: string
          p_status: Database["public"]["Enums"]["consent_status"]
        }
        Returns: string
      }
      record_customer_access_test_result: {
        Args: { p_id: string; p_result: Json }
        Returns: undefined
      }
      record_live_jobber_authorization_result: {
        Args: { p_email: string; p_result: Json }
        Returns: undefined
      }
      release_autosync_lock: {
        Args: { p_error?: string; p_holder_id: string; p_status?: string }
        Returns: boolean
      }
      release_booking_slot: { Args: { p_group_id: string }; Returns: undefined }
      render_msg_template: {
        Args: { tmpl: string; vars: Json }
        Returns: string
      }
      reserve_booking_slot: {
        Args: {
          p_crew_ids: string[]
          p_end: string
          p_idempotency_key?: string
          p_session?: string
          p_start: string
          p_ttl_minutes?: number
        }
        Returns: Json
      }
      services_label: { Args: { p: Json }; Returns: string }
      set_reservation_job: {
        Args: { p_group_id: string; p_job_id: string }
        Returns: undefined
      }
      update_autosync_coverage: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role:
        | "admin"
        | "user"
        | "owner_admin"
        | "operations_admin"
        | "read_only_admin"
      booking_status:
        | "pending"
        | "confirmed"
        | "scheduled"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "pending_confirmation"
        | "needs_attention"
      consent_channel: "sms" | "email"
      consent_status: "granted" | "revoked" | "unknown"
      consent_type: "transactional" | "requested_follow_up" | "marketing"
      lead_lifecycle_status:
        | "open"
        | "pending"
        | "approved"
        | "booked"
        | "declined"
        | "quote_saved"
        | "completed"
        | "rebook_window"
        | "expired"
      quote_status:
        | "pending"
        | "viewed"
        | "converted"
        | "expired"
        | "declined"
        | "saved"
        | "emailed"
      service_type:
        | "windows_exterior"
        | "windows_interior"
        | "gutters"
        | "house_wash"
        | "roof_wash"
        | "driveway"
        | "pressure_wash_addon"
      sms_status:
        | "pending"
        | "sent"
        | "failed"
        | "cancelled"
        | "inbound"
        | "processing"
        | "accepted"
      sms_trigger_event:
        | "quote_created"
        | "appointment_scheduled"
        | "appointment_rescheduled"
        | "appointment_cancelled"
        | "appointment_completed"
        | "manual"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "user",
        "owner_admin",
        "operations_admin",
        "read_only_admin",
      ],
      booking_status: [
        "pending",
        "confirmed",
        "scheduled",
        "in_progress",
        "completed",
        "cancelled",
        "pending_confirmation",
        "needs_attention",
      ],
      consent_channel: ["sms", "email"],
      consent_status: ["granted", "revoked", "unknown"],
      consent_type: ["transactional", "requested_follow_up", "marketing"],
      lead_lifecycle_status: [
        "open",
        "pending",
        "approved",
        "booked",
        "declined",
        "quote_saved",
        "completed",
        "rebook_window",
        "expired",
      ],
      quote_status: [
        "pending",
        "viewed",
        "converted",
        "expired",
        "declined",
        "saved",
        "emailed",
      ],
      service_type: [
        "windows_exterior",
        "windows_interior",
        "gutters",
        "house_wash",
        "roof_wash",
        "driveway",
        "pressure_wash_addon",
      ],
      sms_status: [
        "pending",
        "sent",
        "failed",
        "cancelled",
        "inbound",
        "processing",
        "accepted",
      ],
      sms_trigger_event: [
        "quote_created",
        "appointment_scheduled",
        "appointment_rescheduled",
        "appointment_cancelled",
        "appointment_completed",
        "manual",
      ],
    },
  },
} as const
