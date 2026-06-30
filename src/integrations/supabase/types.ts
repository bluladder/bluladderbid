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
      bookings: {
        Row: {
          created_at: string
          customer_id: string
          discount_amount: number | null
          discount_code: string | null
          duration_minutes: number
          home_details_json: Json
          id: string
          is_hidden: boolean
          jobber_job_id: string | null
          jobber_quote_id: string | null
          jobber_visit_id: string | null
          notes: string | null
          reference_number: string
          scheduled_end: string | null
          scheduled_start: string | null
          services_json: Json
          status: Database["public"]["Enums"]["booking_status"]
          subtotal: number
          technician_id: string | null
          total: number
          updated_at: string
          utm_params_json: Json | null
        }
        Insert: {
          created_at?: string
          customer_id: string
          discount_amount?: number | null
          discount_code?: string | null
          duration_minutes: number
          home_details_json: Json
          id?: string
          is_hidden?: boolean
          jobber_job_id?: string | null
          jobber_quote_id?: string | null
          jobber_visit_id?: string | null
          notes?: string | null
          reference_number: string
          scheduled_end?: string | null
          scheduled_start?: string | null
          services_json: Json
          status?: Database["public"]["Enums"]["booking_status"]
          subtotal: number
          technician_id?: string | null
          total: number
          updated_at?: string
          utm_params_json?: Json | null
        }
        Update: {
          created_at?: string
          customer_id?: string
          discount_amount?: number | null
          discount_code?: string | null
          duration_minutes?: number
          home_details_json?: Json
          id?: string
          is_hidden?: boolean
          jobber_job_id?: string | null
          jobber_quote_id?: string | null
          jobber_visit_id?: string | null
          notes?: string | null
          reference_number?: string
          scheduled_end?: string | null
          scheduled_start?: string | null
          services_json?: Json
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
          campaign_id: string
          created_at: string
          customer_id: string
          enrolled_at: string
          id: string
          lifecycle_status:
            | Database["public"]["Enums"]["lead_lifecycle_status"]
            | null
          status: string
          updated_at: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          customer_id: string
          enrolled_at?: string
          id?: string
          lifecycle_status?:
            | Database["public"]["Enums"]["lead_lifecycle_status"]
            | null
          status?: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          customer_id?: string
          enrolled_at?: string
          id?: string
          lifecycle_status?:
            | Database["public"]["Enums"]["lead_lifecycle_status"]
            | null
          status?: string
          updated_at?: string
        }
        Relationships: [
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
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
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
      quotes: {
        Row: {
          converted_at: string | null
          converted_booking_id: string | null
          created_at: string
          customer_email: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          discount_amount: number | null
          discount_code: string | null
          expires_at: string | null
          home_details_json: Json
          id: string
          services_json: Json
          session_id: string | null
          status: Database["public"]["Enums"]["quote_status"]
          subtotal: number
          total: number
          updated_at: string
          utm_params_json: Json | null
          viewed_at: string | null
        }
        Insert: {
          converted_at?: string | null
          converted_booking_id?: string | null
          created_at?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          discount_amount?: number | null
          discount_code?: string | null
          expires_at?: string | null
          home_details_json: Json
          id?: string
          services_json: Json
          session_id?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal: number
          total: number
          updated_at?: string
          utm_params_json?: Json | null
          viewed_at?: string | null
        }
        Update: {
          converted_at?: string | null
          converted_booking_id?: string | null
          created_at?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          discount_amount?: number | null
          discount_code?: string | null
          expires_at?: string | null
          home_details_json?: Json
          id?: string
          services_json?: Json
          session_id?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal?: number
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
      sms_campaign_steps: {
        Row: {
          active: boolean
          body_template: string
          campaign_id: string
          channel: string
          created_at: string
          delay_hours: number
          id: string
          step_order: number
          subject: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          body_template: string
          campaign_id: string
          channel?: string
          created_at?: string
          delay_hours?: number
          id?: string
          step_order?: number
          subject?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          body_template?: string
          campaign_id?: string
          channel?: string
          created_at?: string
          delay_hours?: number
          id?: string
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
          active: boolean
          campaign_kind: string
          created_at: string
          description: string | null
          id: string
          lifecycle_status:
            | Database["public"]["Enums"]["lead_lifecycle_status"]
            | null
          name: string
          trigger_event: Database["public"]["Enums"]["sms_trigger_event"] | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          campaign_kind?: string
          created_at?: string
          description?: string | null
          id?: string
          lifecycle_status?:
            | Database["public"]["Enums"]["lead_lifecycle_status"]
            | null
          name: string
          trigger_event?:
            | Database["public"]["Enums"]["sms_trigger_event"]
            | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          campaign_kind?: string
          created_at?: string
          description?: string | null
          id?: string
          lifecycle_status?:
            | Database["public"]["Enums"]["lead_lifecycle_status"]
            | null
          name?: string
          trigger_event?:
            | Database["public"]["Enums"]["sms_trigger_event"]
            | null
          updated_at?: string
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
          message_kind: string
          quote_id: string | null
          send_at: string
          sent_at: string | null
          status: Database["public"]["Enums"]["sms_status"]
          subject: string | null
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
          message_kind?: string
          quote_id?: string | null
          send_at?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["sms_status"]
          subject?: string | null
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
          message_kind?: string
          quote_id?: string | null
          send_at?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["sms_status"]
          subject?: string | null
          to_email?: string | null
          to_number?: string | null
          updated_at?: string
        }
        Relationships: [
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
          email: string | null
          id: string
          is_active: boolean
          jobber_user_id: string
          location_type: string
          max_drive_time_minutes: number | null
          max_stories: number | null
          name: string
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
          email?: string | null
          id?: string
          is_active?: boolean
          jobber_user_id: string
          location_type?: string
          max_drive_time_minutes?: number | null
          max_stories?: number | null
          name: string
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
          email?: string | null
          id?: string
          is_active?: boolean
          jobber_user_id?: string
          location_type?: string
          max_drive_time_minutes?: number | null
          max_stories?: number | null
          name?: string
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
      can_edit_crew_rules: { Args: never; Returns: boolean }
      can_manage_schedule_blocks: { Args: never; Returns: boolean }
      can_override_bookings: { Args: never; Returns: boolean }
      compute_customer_lifecycle: {
        Args: { p_customer_id: string }
        Returns: Database["public"]["Enums"]["lead_lifecycle_status"]
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
      is_read_only_admin: { Args: never; Returns: boolean }
      quote_has_real_services: { Args: { p: Json }; Returns: boolean }
      release_autosync_lock: {
        Args: { p_error?: string; p_holder_id: string; p_status?: string }
        Returns: boolean
      }
      render_msg_template: {
        Args: { tmpl: string; vars: Json }
        Returns: string
      }
      services_label: { Args: { p: Json }; Returns: string }
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
      lead_lifecycle_status:
        | "open"
        | "pending"
        | "approved"
        | "booked"
        | "declined"
      quote_status: "pending" | "viewed" | "converted" | "expired" | "declined"
      service_type:
        | "windows_exterior"
        | "windows_interior"
        | "gutters"
        | "house_wash"
        | "roof_wash"
        | "driveway"
        | "pressure_wash_addon"
      sms_status: "pending" | "sent" | "failed" | "cancelled" | "inbound"
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
      ],
      lead_lifecycle_status: [
        "open",
        "pending",
        "approved",
        "booked",
        "declined",
      ],
      quote_status: ["pending", "viewed", "converted", "expired", "declined"],
      service_type: [
        "windows_exterior",
        "windows_interior",
        "gutters",
        "house_wash",
        "roof_wash",
        "driveway",
        "pressure_wash_addon",
      ],
      sms_status: ["pending", "sent", "failed", "cancelled", "inbound"],
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
