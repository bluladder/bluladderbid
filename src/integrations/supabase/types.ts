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
        ]
      }
      customers: {
        Row: {
          address: string | null
          auth_user_id: string | null
          created_at: string
          email: string
          first_name: string | null
          id: string
          jobber_client_id: string | null
          last_name: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          auth_user_id?: string | null
          created_at?: string
          email: string
          first_name?: string | null
          id?: string
          jobber_client_id?: string | null
          last_name?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          auth_user_id?: string | null
          created_at?: string
          email?: string
          first_name?: string | null
          id?: string
          jobber_client_id?: string | null
          last_name?: string | null
          phone?: string | null
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
        ]
      }
      technicians: {
        Row: {
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          jobber_user_id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          jobber_user_id: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          jobber_user_id?: string
          name?: string
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
      [_ in never]: never
    }
    Functions: {
      generate_booking_reference: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "user"
      booking_status:
        | "pending"
        | "confirmed"
        | "scheduled"
        | "in_progress"
        | "completed"
        | "cancelled"
      quote_status: "pending" | "viewed" | "converted" | "expired" | "declined"
      service_type:
        | "windows_exterior"
        | "windows_interior"
        | "gutters"
        | "house_wash"
        | "roof_wash"
        | "driveway"
        | "pressure_wash_addon"
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
      app_role: ["admin", "user"],
      booking_status: [
        "pending",
        "confirmed",
        "scheduled",
        "in_progress",
        "completed",
        "cancelled",
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
    },
  },
} as const
