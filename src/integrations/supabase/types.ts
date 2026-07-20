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
          cancellation_needs_attention_reason: string | null
          cancellation_source: string | null
          cancelled_at: string | null
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
          jobber_job_id: string | null
          jobber_quote_id: string | null
          jobber_visit_id: string | null
          line_item_snapshot: Json | null
          meta_events_fired: Json
          notes: string | null
          pricing_engine_version: string | null
          pricing_override_by: string | null
          pricing_override_reason: string | null
          pricing_rule_version: number | null
          quote_id: string | null
          quote_to_booking_seconds: number | null
          reference_number: string
          scheduled_end: string | null
          scheduled_start: string | null
          services_json: Json
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
          cancellation_needs_attention_reason?: string | null
          cancellation_source?: string | null
          cancelled_at?: string | null
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
          jobber_job_id?: string | null
          jobber_quote_id?: string | null
          jobber_visit_id?: string | null
          line_item_snapshot?: Json | null
          meta_events_fired?: Json
          notes?: string | null
          pricing_engine_version?: string | null
          pricing_override_by?: string | null
          pricing_override_reason?: string | null
          pricing_rule_version?: number | null
          quote_id?: string | null
          quote_to_booking_seconds?: number | null
          reference_number: string
          scheduled_end?: string | null
          scheduled_start?: string | null
          services_json: Json
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
          cancellation_needs_attention_reason?: string | null
          cancellation_source?: string | null
          cancelled_at?: string | null
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
          jobber_job_id?: string | null
          jobber_quote_id?: string | null
          jobber_visit_id?: string | null
          line_item_snapshot?: Json | null
          meta_events_fired?: Json
          notes?: string | null
          pricing_engine_version?: string | null
          pricing_override_by?: string | null
          pricing_override_reason?: string | null
          pricing_rule_version?: number | null
          quote_id?: string | null
          quote_to_booking_seconds?: number | null
          reference_number?: string
          scheduled_end?: string | null
          scheduled_start?: string | null
          services_json?: Json
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
          facts: Json
          id: string
          internal_notes: string | null
          last_activity_at: string
          last_error: string | null
          manual_review_reason: string | null
          marketing_consent: boolean
          needs_attention: boolean
          pricing_version: number | null
          prospect_email: string | null
          prospect_name: string | null
          prospect_phone: string | null
          quote_result: Json | null
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
          facts?: Json
          id?: string
          internal_notes?: string | null
          last_activity_at?: string
          last_error?: string | null
          manual_review_reason?: string | null
          marketing_consent?: boolean
          needs_attention?: boolean
          pricing_version?: number | null
          prospect_email?: string | null
          prospect_name?: string | null
          prospect_phone?: string | null
          quote_result?: Json | null
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
          facts?: Json
          id?: string
          internal_notes?: string | null
          last_activity_at?: string
          last_error?: string | null
          manual_review_reason?: string | null
          marketing_consent?: boolean
          needs_attention?: boolean
          pricing_version?: number | null
          prospect_email?: string | null
          prospect_name?: string | null
          prospect_phone?: string | null
          quote_result?: Json | null
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
          updated_at?: string
        }
        Relationships: []
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
          verified_phone: string
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
          verified_phone: string
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
          verified_phone?: string
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
          created_at: string
          customer_id: string
          id: string
          last_verified_at: string
          updated_at: string
          verified_email: string | null
          verified_phone: string | null
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          last_verified_at?: string
          updated_at?: string
          verified_email?: string | null
          verified_phone?: string | null
        }
        Update: {
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
      customer_verification_challenges: {
        Row: {
          attempts: number
          callrail_message_id: string | null
          correlation_id: string
          created_at: string
          delivery_status: string | null
          expires_at: string
          id: string
          ip_hash: string | null
          max_attempts: number
          otp_hash: string
          phone_hash: string
          status: string
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          attempts?: number
          callrail_message_id?: string | null
          correlation_id?: string
          created_at?: string
          delivery_status?: string | null
          expires_at: string
          id?: string
          ip_hash?: string | null
          max_attempts?: number
          otp_hash: string
          phone_hash: string
          status?: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          attempts?: number
          callrail_message_id?: string | null
          correlation_id?: string
          created_at?: string
          delivery_status?: string | null
          expires_at?: string
          id?: string
          ip_hash?: string | null
          max_attempts?: number
          otp_hash?: string
          phone_hash?: string
          status?: string
          updated_at?: string
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
          phone: string | null
          sms_paused: boolean
          updated_at: string
        }
        Insert: {
          address?: string | null
          auth_user_id?: string | null
          created_at?: string
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
          phone?: string | null
          sms_paused?: boolean
          updated_at?: string
        }
        Update: {
          address?: string | null
          auth_user_id?: string | null
          created_at?: string
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
          phone?: string | null
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
          category: string | null
          conversation_count: number
          created_at: string
          example_wording: string | null
          first_seen_at: string
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
          updated_at: string
        }
        Insert: {
          category?: string | null
          conversation_count?: number
          created_at?: string
          example_wording?: string | null
          first_seen_at?: string
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
          updated_at?: string
        }
        Update: {
          category?: string | null
          conversation_count?: number
          created_at?: string
          example_wording?: string | null
          first_seen_at?: string
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
      quotes: {
        Row: {
          abandonment_emitted_version: string | null
          abandonment_swept_at: string | null
          attribution: Json | null
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
          quote_completion_seconds: number | null
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
          quote_completion_seconds?: number | null
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
          quote_completion_seconds?: number | null
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
          id: string
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
          id?: string
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
          id?: string
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
