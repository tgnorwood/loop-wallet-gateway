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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      app_assets: {
        Row: {
          amount: number
          app_id: string | null
          created_at: string
          id: string
          kind: string
          metadata: Json
          name: string
          wallet_id: string
        }
        Insert: {
          amount?: number
          app_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          metadata?: Json
          name: string
          wallet_id: string
        }
        Update: {
          amount?: number
          app_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          metadata?: Json
          name?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_assets_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "registered_apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_assets_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      app_connections: {
        Row: {
          app_id: string
          created_at: string
          id: string
          revoked_at: string | null
          wallet_id: string
        }
        Insert: {
          app_id: string
          created_at?: string
          id?: string
          revoked_at?: string | null
          wallet_id: string
        }
        Update: {
          app_id?: string
          created_at?: string
          id?: string
          revoked_at?: string | null
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_connections_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "registered_apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_connections_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          app_id: string | null
          created_at: string
          details: Json
          id: string
          ip: string | null
          method: string | null
          wallet_id: string | null
        }
        Insert: {
          action: string
          app_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          ip?: string | null
          method?: string | null
          wallet_id?: string | null
        }
        Update: {
          action?: string
          app_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          ip?: string | null
          method?: string | null
          wallet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "registered_apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_codes: {
        Row: {
          app_id: string
          code_challenge: string | null
          code_hash: string
          created_at: string
          expires_at: string
          id: string
          used_at: string | null
          wallet_id: string
        }
        Insert: {
          app_id: string
          code_challenge?: string | null
          code_hash: string
          created_at?: string
          expires_at: string
          id?: string
          used_at?: string | null
          wallet_id: string
        }
        Update: {
          app_id?: string
          code_challenge?: string | null
          code_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          used_at?: string | null
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auth_codes_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "registered_apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auth_codes_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          count: number
          key: string
          window_start: string
        }
        Insert: {
          count?: number
          key: string
          window_start?: string
        }
        Update: {
          count?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      registered_apps: {
        Row: {
          allowed_origins: string[]
          api_enabled: boolean
          created_at: string
          id: string
          key_hash: string
          key_prefix: string
          name: string
          popup_enabled: boolean
          revoked_at: string | null
          sandbox: boolean
          trusted_oauth: boolean
        }
        Insert: {
          allowed_origins?: string[]
          api_enabled?: boolean
          created_at?: string
          id?: string
          key_hash: string
          key_prefix: string
          name: string
          popup_enabled?: boolean
          revoked_at?: string | null
          sandbox?: boolean
          trusted_oauth?: boolean
        }
        Update: {
          allowed_origins?: string[]
          api_enabled?: boolean
          created_at?: string
          id?: string
          key_hash?: string
          key_prefix?: string
          name?: string
          popup_enabled?: boolean
          revoked_at?: string | null
          sandbox?: boolean
          trusted_oauth?: boolean
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wallet_sessions: {
        Row: {
          app_id: string | null
          created_at: string
          expires_at: string
          id: string
          ip: string | null
          revoked_at: string | null
          token_hash: string
          user_agent: string | null
          wallet_id: string
        }
        Insert: {
          app_id?: string | null
          created_at?: string
          expires_at: string
          id?: string
          ip?: string | null
          revoked_at?: string | null
          token_hash: string
          user_agent?: string | null
          wallet_id: string
        }
        Update: {
          app_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          ip?: string | null
          revoked_at?: string | null
          token_hash?: string
          user_agent?: string | null
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_sessions_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "registered_apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_sessions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_verifications: {
        Row: {
          app_id: string | null
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          last_sent_at: string
          wallet_id: string
        }
        Insert: {
          app_id?: string | null
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          last_sent_at?: string
          wallet_id: string
        }
        Update: {
          app_id?: string | null
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          last_sent_at?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_verifications_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "registered_apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_verifications_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          address: string
          class_hash: string
          created_at: string
          created_by_app: string | null
          deployed: boolean
          email: string
          encrypted_private_key: string
          id: string
          network: string
          public_key: string
          updated_at: string
          user_id: string | null
          verified: boolean
          verified_method: string | null
        }
        Insert: {
          address: string
          class_hash: string
          created_at?: string
          created_by_app?: string | null
          deployed?: boolean
          email: string
          encrypted_private_key: string
          id?: string
          network?: string
          public_key: string
          updated_at?: string
          user_id?: string | null
          verified?: boolean
          verified_method?: string | null
        }
        Update: {
          address?: string
          class_hash?: string
          created_at?: string
          created_by_app?: string | null
          deployed?: boolean
          email?: string
          encrypted_private_key?: string
          id?: string
          network?: string
          public_key?: string
          updated_at?: string
          user_id?: string | null
          verified?: boolean
          verified_method?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
    },
  },
} as const
