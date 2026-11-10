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
      chain_events: {
        Row: {
          amount: number
          block_number: number
          created_at: string
          from_address: string
          id: string
          ordinal: number
          to_address: string
          token_id: string
          tx_hash: string
        }
        Insert: {
          amount: number
          block_number: number
          created_at?: string
          from_address: string
          id?: string
          ordinal: number
          to_address: string
          token_id: string
          tx_hash: string
        }
        Update: {
          amount?: number
          block_number?: number
          created_at?: string
          from_address?: string
          id?: string
          ordinal?: number
          to_address?: string
          token_id?: string
          tx_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "chain_events_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      collections: {
        Row: {
          address: string | null
          app_id: string
          created_at: string
          created_tx: string | null
          frozen: boolean
          id: string
          is_test: boolean
          name: string
          network: string
          owner_wallet_id: string
          royalty_bps: number
          royalty_receiver: string | null
          symbol: string
        }
        Insert: {
          address?: string | null
          app_id: string
          created_at?: string
          created_tx?: string | null
          frozen?: boolean
          id?: string
          is_test?: boolean
          name: string
          network?: string
          owner_wallet_id: string
          royalty_bps?: number
          royalty_receiver?: string | null
          symbol: string
        }
        Update: {
          address?: string | null
          app_id?: string
          created_at?: string
          created_tx?: string | null
          frozen?: boolean
          id?: string
          is_test?: boolean
          name?: string
          network?: string
          owner_wallet_id?: string
          royalty_bps?: number
          royalty_receiver?: string | null
          symbol?: string
        }
        Relationships: []
      }
      nfts: {
        Row: {
          attributes: Json
          collection_id: string
          created_at: string
          frozen: boolean
          id: string
          media: Json
          minted_tx: string | null
          owner_address: string
          owner_wallet_id: string | null
          token_id: string
          token_uri: string | null
          updated_at: string
        }
        Insert: {
          attributes?: Json
          collection_id: string
          created_at?: string
          frozen?: boolean
          id?: string
          media?: Json
          minted_tx?: string | null
          owner_address: string
          owner_wallet_id?: string | null
          token_id: string
          token_uri?: string | null
          updated_at?: string
        }
        Update: {
          attributes?: Json
          collection_id?: string
          created_at?: string
          frozen?: boolean
          id?: string
          media?: Json
          minted_tx?: string | null
          owner_address?: string
          owner_wallet_id?: string | null
          token_id?: string
          token_uri?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nfts_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
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
          daily_distribute_cap: number | null
          daily_mint_cap: number | null
          id: string
          key_hash: string
          key_prefix: string
          mainnet_enabled: boolean
          name: string
          popup_enabled: boolean
          rate_limit_per_min: number
          revoked_at: string | null
          sandbox: boolean
          trusted_oauth: boolean
          webhook_secret: string | null
          webhook_url: string | null
        }
        Insert: {
          allowed_origins?: string[]
          api_enabled?: boolean
          created_at?: string
          daily_distribute_cap?: number | null
          daily_mint_cap?: number | null
          id?: string
          key_hash: string
          key_prefix: string
          mainnet_enabled?: boolean
          name: string
          popup_enabled?: boolean
          rate_limit_per_min?: number
          revoked_at?: string | null
          sandbox?: boolean
          trusted_oauth?: boolean
          webhook_secret?: string | null
          webhook_url?: string | null
        }
        Update: {
          allowed_origins?: string[]
          api_enabled?: boolean
          created_at?: string
          daily_distribute_cap?: number | null
          daily_mint_cap?: number | null
          id?: string
          key_hash?: string
          key_prefix?: string
          mainnet_enabled?: boolean
          name?: string
          popup_enabled?: boolean
          rate_limit_per_min?: number
          revoked_at?: string | null
          sandbox?: boolean
          trusted_oauth?: boolean
          webhook_secret?: string | null
          webhook_url?: string | null
        }
        Relationships: []
      }
      token_holders: {
        Row: {
          address: string
          balance: number
          token_id: string
          updated_at: string
        }
        Insert: {
          address: string
          balance: number
          token_id: string
          updated_at?: string
        }
        Update: {
          address?: string
          balance?: number
          token_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "token_holders_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      tokens: {
        Row: {
          address: string | null
          app_id: string
          created_at: string
          created_tx: string | null
          creator_ref: string | null
          decimals: number
          event_count: number
          holder_count: number
          id: string
          imported_from: string | null
          is_test: boolean
          name: string
          network: string
          swappable: boolean
          symbol: string
          sync_continuation: string | null
          sync_enabled: boolean
          sync_error: string | null
          sync_target_block: number | null
          synced_at: string | null
          synced_block: number | null
          total_supply: number | null
        }
        Insert: {
          address?: string | null
          app_id: string
          created_at?: string
          created_tx?: string | null
          creator_ref?: string | null
          decimals?: number
          event_count?: number
          holder_count?: number
          id?: string
          imported_from?: string | null
          is_test?: boolean
          name: string
          network?: string
          swappable?: boolean
          symbol: string
          sync_continuation?: string | null
          sync_enabled?: boolean
          sync_error?: string | null
          sync_target_block?: number | null
          synced_at?: string | null
          synced_block?: number | null
          total_supply?: number | null
        }
        Update: {
          address?: string | null
          app_id?: string
          created_at?: string
          created_tx?: string | null
          creator_ref?: string | null
          decimals?: number
          event_count?: number
          holder_count?: number
          id?: string
          imported_from?: string | null
          is_test?: boolean
          name?: string
          network?: string
          swappable?: boolean
          symbol?: string
          sync_continuation?: string | null
          sync_enabled?: boolean
          sync_error?: string | null
          sync_target_block?: number | null
          synced_at?: string | null
          synced_block?: number | null
          total_supply?: number | null
        }
        Relationships: []
      }
      transactions: {
        Row: {
          app_id: string
          attempts: number
          confirmed_at: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          idempotency_key: string
          network: string
          next_attempt_at: string | null
          request: Json
          request_hash: string
          result: Json | null
          signer_key: string
          started_at: string | null
          status: string
          submitted_at: string | null
          tx_hash: string | null
          type: string
          wallet_id: string | null
        }
        Insert: {
          app_id: string
          attempts?: number
          confirmed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          idempotency_key: string
          network?: string
          next_attempt_at?: string | null
          request?: Json
          request_hash: string
          result?: Json | null
          signer_key: string
          started_at?: string | null
          status?: string
          submitted_at?: string | null
          tx_hash?: string | null
          type: string
          wallet_id?: string | null
        }
        Update: {
          app_id?: string
          attempts?: number
          confirmed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          idempotency_key?: string
          network?: string
          next_attempt_at?: string | null
          request?: Json
          request_hash?: string
          result?: Json | null
          signer_key?: string
          started_at?: string | null
          status?: string
          submitted_at?: string | null
          tx_hash?: string | null
          type?: string
          wallet_id?: string | null
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
          app_id: string | null
          class_hash: string
          created_at: string
          created_by_app: string | null
          deployed: boolean
          email: string | null
          encrypted_private_key: string
          external_id: string | null
          id: string
          imported_from: string | null
          key_version: number
          kind: string
          label: string | null
          network: string
          public_key: string
          updated_at: string
          user_id: string | null
          verified: boolean
          verified_method: string | null
        }
        Insert: {
          address: string
          app_id?: string | null
          class_hash: string
          created_at?: string
          created_by_app?: string | null
          deployed?: boolean
          email?: string | null
          encrypted_private_key: string
          external_id?: string | null
          id?: string
          imported_from?: string | null
          key_version?: number
          kind?: string
          label?: string | null
          network?: string
          public_key: string
          updated_at?: string
          user_id?: string | null
          verified?: boolean
          verified_method?: string | null
        }
        Update: {
          address?: string
          app_id?: string | null
          class_hash?: string
          created_at?: string
          created_by_app?: string | null
          deployed?: boolean
          email?: string | null
          encrypted_private_key?: string
          external_id?: string | null
          id?: string
          imported_from?: string | null
          key_version?: number
          kind?: string
          label?: string | null
          network?: string
          public_key?: string
          updated_at?: string
          user_id?: string | null
          verified?: boolean
          verified_method?: string | null
        }
        Relationships: []
      }
      webhook_deliveries: {
        Row: {
          app_id: string
          attempts: number
          created_at: string
          event: string
          id: string
          last_error: string | null
          next_attempt_at: string
          payload: Json
          status: string
          transaction_id: string
        }
        Insert: {
          app_id: string
          attempts?: number
          created_at?: string
          event: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          payload: Json
          status?: string
          transaction_id: string
        }
        Update: {
          app_id?: string
          attempts?: number
          created_at?: string
          event?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          payload?: Json
          status?: string
          transaction_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_transactions: {
        Args: { _max?: number }
        Returns: {
          app_id: string
          attempts: number
          confirmed_at: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          idempotency_key: string
          network: string
          next_attempt_at: string | null
          request: Json
          request_hash: string
          result: Json | null
          signer_key: string
          started_at: string | null
          status: string
          submitted_at: string | null
          tx_hash: string | null
          type: string
          wallet_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "transactions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      recompute_token_holders: { Args: { _token: string }; Returns: undefined }
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
