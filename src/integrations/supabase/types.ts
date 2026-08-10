Warning: truncated output (original token count: 57101)
Total output lines: 7140

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
      action_inbox_items: {
        Row: {
          booking_id: string | null
          conversation_id: string | null
          created_at: string
          customer_id: string | null
          dedupe_key: string | null
          due_at: string | null
          id: string
          knowledge_gap_id: string | null
          knowledge_key: string | null
          metadata: Json
          owner_user_id: string | null
          priority: Database["public"]["Enums"]["action_inbox_priority"]
          quote_id: string | null
          recommended_action: string | null
          resolution_note: string | null
          resolved_at: string | null
          snooze_until: string | null
          source_channel: string | null
          status: Database["public"]["Enums"]["action_inbox_status"]
          suggested_response: string | null
          summary: string | null
          title: string
          type: Database["public"]["Enums"]["action_inbox_type"]
          updated_at: string
        }
        Insert: {
          booking_id?: string | null
          conversation_id?: string | null
          created_at?: string
          customer_id?: string | null
          dedupe_key?: string | null
          due_at?: string | null
          id?: string
          knowledge_gap_id?: string | null
          knowledge_key?: string | null
          metadata?: Json
          owner_user_id?: string | null
          priority?: Database["public"]["Enums"]["action_inbox_priority"]
          quote_id?: string | null
          recommended_action?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          snooze_until?: string | null
          source_channel?: string | null
          status?: Database["public"]["Enums"]["action_inbox_status"]
          suggested_response?: string | null
          summary?: string | null
          title: string
          type: Database["public"]["Enums"]["action_inbox_type"]
          updated_at?: string
        }
        Update: {
          booking_id?: string | null
          conversation_id?: string | null
          created_at?: string
          customer_id?: string | null
          dedupe_key?: string | null
          due_at?: string | null
          id?: string
          knowledge_gap_id?: string | null
          knowledge_key?: string | null
          metadata?: Json
          owner_user_id?: string | null
          priority?: Database["public"]["Enums"]["action_inbox_priority"]
          quote_id?: string | null
          recommended_action?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          snooze_until?: string | null
          source_channel?: string | null
          status?: Database["public"]["Enums"]["action_inbox_status"]
          suggested_response?: string | null
          summary?: string | null
          title?: string
          type?: Database["public"]["Enums"]["action_inbox_type"]
          updated_at?: string
        }
        Relationships: []
      }
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
          attribution_campaign: string | null
          attribution_content: string | null
          attribution_medium: string | null
          attribution_source: string | null
          booking_id: string | null
          callrail_campaign: string | null
          callrail_tracking_number: string | null
          created_at: string
          customer_id: string | null
          fbclid: string | null
          first_touch: Json | null
          first_touch_referrer: string | null
          id: string
          jobber_client_id: string | null
          jobber_job_id: string | null
          landing_page_slug: string | null
          last_touch: Json | null
          last_touch_referrer: string | null
          normalized_source_key: string | null
          quote_id: string | null
          referrer: string | null
          self_reported_source: string | null
          self_reported_source_detail: string | null
          source_required_resolved_at: string | null
          source_session_id: string
          updated_at: string
        }
        Insert: {
          attribution_campaign?: string | null
          attribution_content?: string | null
          attribution_medium?: string | null
          attribution_source?: string | null
          booking_id?: string | null
          callrail_campaign?: string | null
          callrail_tracking_number?: string | null
          created_at?: string
          customer_id?: string | null
          fbclid?: string | null
          first_touch?: Json | null
          first_touch_referrer?: string | null
          id?: string
          jobber_client_id?: string | null
          jobber_job_id?: string | null
          landing_page_slug?: string | null
          last_touch?: Json | null
          last_touch_referrer?: string | null
          normalized_source_key?: string | null
          quote_id?: string | null
          referrer?: string | null
          self_reported_source?: string | null
          self_reported_source_detail?: string | null
          source_required_resolved_at?: string | null
          source_session_id: string
          updated_at?: string
        }
        Update: {
          attribution_campaign?: string | null
          attribution_content?: string | null
          attribution_medium?: string | null
          attribution_source?: string | null
          booking_id?: string | null
          callrail_campaign?: string | null
          callrail_tracking_number?: string | null
          created_at?: string
          customer_id?: string | null
          fbclid?: string | null
          first_touch?: Json | null
          first_touch_referrer?: string | null
          id?: string
          jobber_client_id?: string | null
          jobber_job_id?: string | null
          landing_page_slug?: string | null
          last_touch?: Json | null
          last_touch_referrer?: string | null
          normalized_source_key?: string | null
          quote_id?: string | null
          referrer?: string | null
          self_reported_source?: string | null
          self_reported_source_detail?: string | null
          source_required_resolved_at?: string | null
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
            foreignKeyName: "attribution_events_normalized_source_key_fkey"
            columns: ["normalized_source_key"]
            isOneToOne: false
            referencedRelation: "lead_source_definitions"
            referencedColumns: ["source_key"]
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
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
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
            foreignKeyName: "bookings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          confidence: string
          content: string
          created_at: string
          effective_at: string | null
          effective_date: string
          expires_at: string | null
          id: string
          internal_policy: string | null
          is_active: boolean
          knowledge_key: string
          last_changed_at: string | null
          last_checked_at: string | null
          owner_notes: string | null
          pending_content: string | null
          pending_source_hash: string | null
          priority: number
          published_at: string | null
          question: string | null
          record_number: number | null
          related_records: number[]
          requires_admin_input: boolean
          requires_owner_review: boolean
          review_status: string
          revision: number
          sales_guidance: string | null
          sort_order: number
          source_hash: string | null
          source_page: string | null
          source_type: string
          tags: string[]
          title: string
          updated_at: string
          updated_by: string | null
          voice_answer: string | null
        }
        Insert: {
          applicable_region?: string | null
          applicable_service?: string | null
          category: string
          confidence?: string
          content: string
          created_at?: string
          effective_at?: string | null
          effective_date?: string
          expires_at?: string | null
          id?: string
          internal_policy?: string | null
          is_active?: boolean
          knowledge_key: string
          last_changed_at?: string | null
          last_checked_at?: string | null
          owner_notes?: string | null
          pending_content?: string | null
          pending_source_hash?: string | null
          priority?: number
          published_at?: string | null
          question?: string | null
          record_number?: number | null
          related_records?: number[]
          requires_admin_input?: boolean
          requires_owner_review?: boolean
          review_status?: string
          revision?: number
          sales_guidance?: string | null
          sort_order?: number
          source_hash?: string | null
          source_page?: string | null
          source_type?: string
          tags?: string[]
          title: string
          updated_at?: string
          updated_by?: string | null
          voice_answer?: string | null
        }
        Update: {
          applicable_region?: string | null
          applicable_service?: string | null
          category?: string
          confidence?: string
          content?: string
          created_at?: string
          effective_at?: string | null
          effective_date?: string
          expires_at?: string | null
          id?: string
          internal_policy?: string | null
          is_active?: boolean
          knowledge_key?: string
          last_changed_at?: string | null
          last_checked_at?: string | null
          owner_notes?: string | null
          pending_content?: string | null
          pending_source_hash?: string | null
          priority?: number
          published_at?: string | null
          question?: string | null
          record_number?: number | null
          related_records?: number[]
          requires_admin_input?: boolean
          requires_owner_review?: boolean
          review_status?: string
          revision?: number
          sales_guidance?: string | null
          sort_order?: number
          source_hash?: string | null
          source_page?: string | null
          source_type?: string
          tags?: string[]
          title?: string
          updated_at?: string
          updated_by?: string | null
          voice_answer?: string | null
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
          ai_autoreply_paused: boolean
          ai_autoreply_paused_at: string | null
          ai_autoreply_paused_by: string | null
          ai_summary: string | null
          ai_summary_updated_at: string | null
          assigned_admin: string | null
          awaiting_email_disambiguation: boolean
          best_time_to_contact: string | null
          booking_status: string
          callback_requested: boolean
          campaign_status: string | null
          channel: string
          confirmed_email: string | null
          confirmed_email_at: string | null
          confirmed_email_customer_id: string | null
          confirmed_email_sms_id: string | null
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
          organization_id: string | null
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
          ai_autoreply_paused?: boolean
          ai_autoreply_paused_at?: string | null
          ai_autoreply_paused_by?: string | null
          ai_summary?: string | null
          ai_summary_updated_at?: string | null
          assigned_admin?: string | null
          awaiting_email_disambiguation?: boolean
          best_time_to_contact?: string | null
          booking_status?: string
          callback_requested?: boolean
          campaign_status?: string | null
          channel?: string
          confirmed_email?: string | null
          confirmed_email_at?: string | null
          confirmed_email_customer_id?: string | null
          confirmed_email_sms_id?: string | null
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
          organization_id?: string | null
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
          ai_autoreply_paused?: boolean
          ai_autoreply_paused_at?: string | null
          ai_autoreply_paused_by?: string | null
          ai_summary?: string | null
          ai_summary_updated_at?: string | null
          assigned_admin?: string | null
          awaiting_email_disambiguation?: boolean
          best_time_to_contact?: string | null
          booking_status?: string
          callback_requested?: boolean
          campaign_status?: string | null
          channel?: string
          confirmed_email?: string | null
          confirmed_email_at?: string | null
          confirmed_email_customer_id?: string | null
          confirmed_email_sms_id?: string | null
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
          …27101 tokens truncated…
          booking_result: Json | null
          booking_timezone: string | null
          confirmation_ack_sms_id: string | null
          confirmation_requested_at: string
          confirmed_at: string | null
          conversation_id: string
          created_at: string
          crew_ids: string[]
          customer_id: string
          error_code: string | null
          execution_started_at: string | null
          execution_token: string | null
          expires_at: string
          failure_class: string | null
          failure_reason: string | null
          id: string
          idempotency_key: string
          inbound_confirmation_sms_id: string | null
          jobber_job_id: string | null
          jobber_visit_id: string | null
          last_error: string | null
          last_error_at: string | null
          local_committed_at: string | null
          outbound_sms_id: string | null
          presentation_id: string | null
          pricing_version: number
          property_id: string
          provider_request: Json | null
          provider_response: Json | null
          quote_session_id: string | null
          reconciliation_status: string | null
          reference_number: string | null
          scheduled_end: string
          scheduled_start: string
          services_json: Json
          slot_group_id: string | null
          status: string
          summary_text: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          authoritative_total: number
          booked_at?: string | null
          booking_id?: string | null
          booking_idempotency_key?: string | null
          booking_result?: Json | null
          booking_timezone?: string | null
          confirmation_ack_sms_id?: string | null
          confirmation_requested_at?: string
          confirmed_at?: string | null
          conversation_id: string
          created_at?: string
          crew_ids: string[]
          customer_id: string
          error_code?: string | null
          execution_started_at?: string | null
          execution_token?: string | null
          expires_at: string
          failure_class?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key: string
          inbound_confirmation_sms_id?: string | null
          jobber_job_id?: string | null
          jobber_visit_id?: string | null
          last_error?: string | null
          last_error_at?: string | null
          local_committed_at?: string | null
          outbound_sms_id?: string | null
          presentation_id?: string | null
          pricing_version: number
          property_id: string
          provider_request?: Json | null
          provider_response?: Json | null
          quote_session_id?: string | null
          reconciliation_status?: string | null
          reference_number?: string | null
          scheduled_end: string
          scheduled_start: string
          services_json: Json
          slot_group_id?: string | null
          status?: string
          summary_text: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          authoritative_total?: number
          booked_at?: string | null
          booking_id?: string | null
          booking_idempotency_key?: string | null
          booking_result?: Json | null
          booking_timezone?: string | null
          confirmation_ack_sms_id?: string | null
          confirmation_requested_at?: string
          confirmed_at?: string | null
          conversation_id?: string
          created_at?: string
          crew_ids?: string[]
          customer_id?: string
          error_code?: string | null
          execution_started_at?: string | null
          execution_token?: string | null
          expires_at?: string
          failure_class?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          inbound_confirmation_sms_id?: string | null
          jobber_job_id?: string | null
          jobber_visit_id?: string | null
          last_error?: string | null
          last_error_at?: string | null
          local_committed_at?: string | null
          outbound_sms_id?: string | null
          presentation_id?: string | null
          pricing_version?: number
          property_id?: string
          provider_request?: Json | null
          provider_response?: Json | null
          quote_session_id?: string | null
          reconciliation_status?: string | null
          reference_number?: string | null
          scheduled_end?: string
          scheduled_start?: string
          services_json?: Json
          slot_group_id?: string | null
          status?: string
          summary_text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_booking_confirmations_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "admin_marketing_funnel"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "sms_booking_confirmations_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_booking_confirmations_confirmation_ack_sms_id_fkey"
            columns: ["confirmation_ack_sms_id"]
            isOneToOne: false
            referencedRelation: "sms_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_booking_confirmations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_booking_confirmations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_booking_confirmations_inbound_confirmation_sms_id_fkey"
            columns: ["inbound_confirmation_sms_id"]
            isOneToOne: false
            referencedRelation: "sms_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_booking_confirmations_outbound_sms_id_fkey"
            columns: ["outbound_sms_id"]
            isOneToOne: false
            referencedRelation: "sms_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_booking_confirmations_presentation_id_fkey"
            columns: ["presentation_id"]
            isOneToOne: false
            referencedRelation: "sms_availability_presentations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_booking_confirmations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_booking_confirmations_quote_session_id_fkey"
            columns: ["quote_session_id"]
            isOneToOne: false
            referencedRelation: "quote_sessions"
            referencedColumns: ["id"]
          },
        ]
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
          outbound_idempotency_key: string | null
          outbox_state: string | null
          provider: string | null
          provider_accepted_at: string | null
          provider_conversation_id: string | null
          provider_dispatched_at: string | null
          provider_message_id: string | null
          provider_response_kind: string | null
          provider_status: string | null
          quote_id: string | null
          send_at: string
          send_claim_at: string | null
          send_claim_token: string | null
          send_error_at: string | null
          send_error_code: string | null
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
          outbound_idempotency_key?: string | null
          outbox_state?: string | null
          provider?: string | null
          provider_accepted_at?: string | null
          provider_conversation_id?: string | null
          provider_dispatched_at?: string | null
          provider_message_id?: string | null
          provider_response_kind?: string | null
          provider_status?: string | null
          quote_id?: string | null
          send_at?: string
          send_claim_at?: string | null
          send_claim_token?: string | null
          send_error_at?: string | null
          send_error_code?: string | null
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
          outbound_idempotency_key?: string | null
          outbox_state?: string | null
          provider?: string | null
          provider_accepted_at?: string | null
          provider_conversation_id?: string | null
          provider_dispatched_at?: string | null
          provider_message_id?: string | null
          provider_response_kind?: string | null
          provider_status?: string | null
          quote_id?: string | null
          send_at?: string
          send_claim_at?: string | null
          send_claim_token?: string | null
          send_error_at?: string | null
          send_error_code?: string | null
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
          ai_sms_autobook_enabled: boolean
          ai_sms_enabled: boolean
          id: string
          suppress_all: boolean
          suppress_reason: string | null
          updated_at: string
        }
        Insert: {
          ai_sms_autobook_enabled?: boolean
          ai_sms_enabled?: boolean
          id?: string
          suppress_all?: boolean
          suppress_reason?: string | null
          updated_at?: string
        }
        Update: {
          ai_sms_autobook_enabled?: boolean
          ai_sms_enabled?: boolean
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
      voice_external_action_claims: {
        Row: {
          action_key: string
          call_id: string
          claim_token: string
          created_at: string
          finished_at: string | null
          organization_id: string
          status: string
          turn_id: string
        }
        Insert: {
          action_key: string
          call_id: string
          claim_token: string
          created_at?: string
          finished_at?: string | null
          organization_id: string
          status: string
          turn_id: string
        }
        Update: {
          action_key?: string
          call_id?: string
          claim_token?: string
          created_at?: string
          finished_at?: string | null
          organization_id?: string
          status?: string
          turn_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_external_action_claims_organization_id_call_id_turn__fkey"
            columns: ["organization_id", "call_id", "turn_id"]
            isOneToOne: false
            referencedRelation: "voice_turn_claims"
            referencedColumns: ["organization_id", "call_id", "turn_id"]
          },
        ]
      }
      voice_turn_claims: {
        Row: {
          call_id: string
          claim_token: string
          completed_at: string | null
          content_hash: string
          created_at: string
          lease_expires_at: string
          organization_id: string
          position: number
          status: string
          turn_id: string
        }
        Insert: {
          call_id: string
          claim_token: string
          completed_at?: string | null
          content_hash: string
          created_at?: string
          lease_expires_at: string
          organization_id: string
          position: number
          status: string
          turn_id: string
        }
        Update: {
          call_id?: string
          claim_token?: string
          completed_at?: string | null
          content_hash?: string
          created_at?: string
          lease_expires_at?: string
          organization_id?: string
          position?: number
          status?: string
          turn_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_turn_claims_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
      activate_presentation_atomic: {
        Args: {
          p_id: string
          p_outbound_message_preview: string
          p_outbound_sms_id: string
        }
        Returns: string
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
          outbound_idempotency_key: string | null
          outbox_state: string | null
          provider: string | null
          provider_accepted_at: string | null
          provider_conversation_id: string | null
          provider_dispatched_at: string | null
          provider_message_id: string | null
          provider_response_kind: string | null
          provider_status: string | null
          quote_id: string | null
          send_at: string
          send_claim_at: string | null
          send_claim_token: string | null
          send_error_at: string | null
          send_error_code: string | null
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
      claim_sms_booking_execution: {
        Args: {
          p_claim_source?: string
          p_confirmation_id: string
          p_execution_token: string
        }
        Returns: Json
      }
      claim_sms_outbox_send: {
        Args: {
          p_body: string
          p_claim_token: string
          p_message_kind: string
          p_outbound_key: string
          p_stale_claim_seconds?: number
          p_to_number: string
        }
        Returns: Json
      }
      claim_sms_reconciliation_execution: {
        Args: { p_confirmation_id: string; p_execution_token: string }
        Returns: Json
      }
      claim_voice_external_action: {
        Args: {
          p_action_key: string
          p_call_id: string
          p_claim_token: string
          p_organization_id: string
          p_turn_id: string
        }
        Returns: {
          status: string
        }[]
      }
      claim_voice_turn: {
        Args: {
          p_call_id: string
          p_claim_token: string
          p_content_hash: string
          p_organization_id: string
          p_position: number
          p_turn_id: string
        }
        Returns: {
          status: string
        }[]
      }
      clear_live_jobber_authorization: {
        Args: { p_email: string }
        Returns: undefined
      }
      commit_sms_booking_success: {
        Args: {
          p_booking_id: string
          p_booking_result: Json
          p_confirmation_id: string
          p_execution_token: string
          p_hold_group_id: string
          p_jobber_job_id: string
          p_jobber_visit_id: string
          p_presentation_id: string
          p_provider_response: Json
          p_reference_number: string
        }
        Returns: Json
      }
      complete_voice_turn: {
        Args: {
          p_call_id: string
          p_organization_id: string
          p_turn_id: string
        }
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
      expire_stale_presentation_holds: { Args: never; Returns: number }
      expire_stale_reservations: { Args: never; Returns: number }
      finalize_sms_outbox_send: {
        Args: {
          p_claim_token: string
          p_error: string
          p_new_state: string
          p_provider_conversation_id: string
          p_provider_message_id: string
          p_provider_response_kind: string
          p_provider_status: string
          p_sms_message_id: string
        }
        Returns: Json
      }
      finish_voice_external_action: {
        Args: {
          p_action_key: string
          p_call_id: string
          p_organization_id: string
          p_outcome: string
          p_turn_id: string
        }
        Returns: undefined
      }
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
      is_authoritative_voice_turn: {
        Args: {
          p_call_id: string
          p_organization_id: string
          p_turn_id: string
        }
        Returns: boolean
      }
      is_read_only_admin: { Args: never; Returns: boolean }
      mark_sms_booking_recoverable_failure: {
        Args: {
          p_confirmation_id: string
          p_error_code: string
          p_execution_token: string
          p_failure_class: string
          p_last_error: string
          p_provider_request: Json
          p_provider_response: Json
          p_reconciliation_status: string
        }
        Returns: Json
      }
      mark_sms_booking_terminal_failure: {
        Args: {
          p_confirmation_id: string
          p_error_code: string
          p_execution_token: string
          p_failure_class: string
          p_last_error: string
          p_provider_response: Json
        }
        Returns: Json
      }
      mark_voice_turn_uncertain: {
        Args: {
          p_call_id: string
          p_organization_id: string
          p_turn_id: string
        }
        Returns: undefined
      }
      normalize_lead_source: { Args: { p_value: string }; Returns: string }
      protect_reservation_for_execution: {
        Args: { p_group_id: string; p_min_expires_at: string }
        Returns: Json
      }
      publish_pricing_version: { Args: { p_note?: string }; Returns: number }
      quote_has_real_services: { Args: { p: Json }; Returns: boolean }
      reconcile_sms_booking_matched: {
        Args: {
          p_confirmation_id: string
          p_execution_token: string
          p_jobber_job_id: string
          p_jobber_visit_id: string
          p_reference_number: string
        }
        Returns: Json
      }
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
      report_knowledge_feedback: {
        Args: {
          p_answer_text: string
          p_conversation_id: string
          p_created_by: string
          p_knowledge_keys: string[]
          p_message_id: string
          p_reporter_note: string
        }
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
      search_published_business_knowledge: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          category: string
          content: string
          knowledge_key: string
          priority: number
          question: string
          rank: number
          title: string
          voice_answer: string
        }[]
      }
      services_label: { Args: { p: Json }; Returns: string }
      set_reservation_job: {
        Args: { p_group_id: string; p_job_id: string }
        Returns: undefined
      }
      unprotect_reservation_after_failure: {
        Args: {
          p_group_id: string
          p_hold_ttl_minutes?: number
          p_new_status?: string
        }
        Returns: Json
      }
      update_autosync_coverage: { Args: never; Returns: undefined }
      validate_lead_source_submission: {
        Args: { p_source_detail?: string; p_source_key: string }
        Returns: boolean
      }
    }
    Enums: {
      action_inbox_priority: "low" | "normal" | "high" | "urgent"
      action_inbox_status:
        | "open"
        | "in_progress"
        | "snoozed"
        | "resolved"
        | "dismissed"
      action_inbox_type:
        | "knowledge_gap"
        | "low_confidence_answer"
        | "reported_bad_answer"
        | "missed_call_followup"
        | "promised_callback"
        | "email_draft_review"
        | "complaint_or_risk"
        | "quote_followup"
        | "content_recommendation"
        | "policy_conflict"
        | "integration_error"
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
      action_inbox_priority: ["low", "normal", "high", "urgent"],
      action_inbox_status: [
        "open",
        "in_progress",
        "snoozed",
        "resolved",
        "dismissed",
      ],
      action_inbox_type: [
        "knowledge_gap",
        "low_confidence_answer",
        "reported_bad_answer",
        "missed_call_followup",
        "promised_callback",
        "email_draft_review",
        "complaint_or_risk",
        "quote_followup",
        "content_recommendation",
        "policy_conflict",
        "integration_error",
      ],
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
