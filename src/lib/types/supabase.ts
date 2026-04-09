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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      broad_option_overrides: {
        Row: {
          broad_option_id: string
          created_at: string
          id: string
          override_type: string
          override_value: Json
          target_node_id: string | null
        }
        Insert: {
          broad_option_id: string
          created_at?: string
          id?: string
          override_type: string
          override_value: Json
          target_node_id?: string | null
        }
        Update: {
          broad_option_id?: string
          created_at?: string
          id?: string
          override_type?: string
          override_value?: Json
          target_node_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "broad_option_overrides_broad_option_id_fkey"
            columns: ["broad_option_id"]
            isOneToOne: false
            referencedRelation: "broad_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broad_option_overrides_target_node_id_fkey"
            columns: ["target_node_id"]
            isOneToOne: false
            referencedRelation: "estimate_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      broad_options: {
        Row: {
          created_at: string
          description: string | null
          estimate_id: string
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          estimate_id: string
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          estimate_id?: string
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "broad_options_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_assemblies: {
        Row: {
          assembly_data: Json
          category: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          assembly_data?: Json
          category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          assembly_data?: Json
          category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      catalog_items: {
        Row: {
          category: string | null
          created_at: string
          created_by: string | null
          default_labor_rate: number | null
          default_unit_cost: number | null
          default_unit_id: string | null
          description: string | null
          id: string
          is_active: boolean
          item_data: Json
          name: string
          node_type: Database["public"]["Enums"]["node_type"]
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          default_labor_rate?: number | null
          default_unit_cost?: number | null
          default_unit_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          item_data?: Json
          name: string
          node_type: Database["public"]["Enums"]["node_type"]
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          default_labor_rate?: number | null
          default_unit_cost?: number | null
          default_unit_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          item_data?: Json
          name?: string
          node_type?: Database["public"]["Enums"]["node_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_items_default_unit_id_fkey"
            columns: ["default_unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
        ]
      }
      client_project_access: {
        Row: {
          client_user_id: string
          granted_at: string
          granted_by: string | null
          id: string
          project_id: string
        }
        Insert: {
          client_user_id: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          project_id: string
        }
        Update: {
          client_user_id?: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_project_access_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      company_settings: {
        Row: {
          created_at: string
          default_contingency_rate: number
          default_markup_rate: number
          default_overhead_rate: number
          default_tax_rate: number
          default_unit_id: string | null
          id: string
          settings_json: Json
          singleton_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_contingency_rate?: number
          default_markup_rate?: number
          default_overhead_rate?: number
          default_tax_rate?: number
          default_unit_id?: string | null
          id?: string
          settings_json?: Json
          singleton_key?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_contingency_rate?: number
          default_markup_rate?: number
          default_overhead_rate?: number
          default_tax_rate?: number
          default_unit_id?: string | null
          id?: string
          settings_json?: Json
          singleton_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_settings_default_unit_id_fkey"
            columns: ["default_unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_codes: {
        Row: {
          created_at: string
          description: string | null
          division: string
          id: string
          parent_id: string | null
          sort_order: number | null
          subdivision: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          division: string
          id?: string
          parent_id?: string | null
          sort_order?: number | null
          subdivision?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          division?: string
          id?: string
          parent_id?: string | null
          sort_order?: number | null
          subdivision?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_codes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "cost_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_approvals: {
        Row: {
          author_id: string | null
          author_type: Database["public"]["Enums"]["author_type"]
          created_at: string
          estimate_id: string
          id: string
          notes: string | null
          option_set_id: string | null
          share_id: string | null
          status: Database["public"]["Enums"]["approval_status"]
        }
        Insert: {
          author_id?: string | null
          author_type: Database["public"]["Enums"]["author_type"]
          created_at?: string
          estimate_id: string
          id?: string
          notes?: string | null
          option_set_id?: string | null
          share_id?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
        }
        Update: {
          author_id?: string | null
          author_type?: Database["public"]["Enums"]["author_type"]
          created_at?: string
          estimate_id?: string
          id?: string
          notes?: string | null
          option_set_id?: string | null
          share_id?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
        }
        Relationships: [
          {
            foreignKeyName: "estimate_approvals_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_approvals_option_set_id_fkey"
            columns: ["option_set_id"]
            isOneToOne: false
            referencedRelation: "option_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_approvals_share_id_fkey"
            columns: ["share_id"]
            isOneToOne: false
            referencedRelation: "estimate_shares"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_comments: {
        Row: {
          author_id: string | null
          author_type: Database["public"]["Enums"]["author_type"]
          body: string
          created_at: string
          estimate_id: string
          id: string
          is_resolved: boolean
          node_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          share_id: string | null
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          author_type: Database["public"]["Enums"]["author_type"]
          body: string
          created_at?: string
          estimate_id: string
          id?: string
          is_resolved?: boolean
          node_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          share_id?: string | null
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          author_type?: Database["public"]["Enums"]["author_type"]
          body?: string
          created_at?: string
          estimate_id?: string
          id?: string
          is_resolved?: boolean
          node_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          share_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_comments_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_comments_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "estimate_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_comments_share_id_fkey"
            columns: ["share_id"]
            isOneToOne: false
            referencedRelation: "estimate_shares"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_nodes: {
        Row: {
          catalog_source_id: string | null
          client_visibility: Database["public"]["Enums"]["client_visibility"]
          created_at: string
          created_by: string | null
          description: string | null
          estimate_id: string
          flagged: boolean
          id: string
          name: string
          node_type: Database["public"]["Enums"]["node_type"]
          parent_id: string | null
          path: unknown
          search_vector: unknown
          sort_order: number
          total_price: number | null
          updated_at: string
          was_auto_promoted: boolean
        }
        Insert: {
          catalog_source_id?: string | null
          client_visibility?: Database["public"]["Enums"]["client_visibility"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          estimate_id: string
          flagged?: boolean
          id?: string
          name: string
          node_type?: Database["public"]["Enums"]["node_type"]
          parent_id?: string | null
          path?: unknown
          search_vector?: unknown
          sort_order?: number
          total_price?: number | null
          updated_at?: string
          was_auto_promoted?: boolean
        }
        Update: {
          catalog_source_id?: string | null
          client_visibility?: Database["public"]["Enums"]["client_visibility"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          estimate_id?: string
          flagged?: boolean
          id?: string
          name?: string
          node_type?: Database["public"]["Enums"]["node_type"]
          parent_id?: string | null
          path?: unknown
          search_vector?: unknown
          sort_order?: number
          total_price?: number | null
          updated_at?: string
          was_auto_promoted?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "estimate_nodes_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "estimate_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_nodes_history: {
        Row: {
          catalog_source_id: string | null
          change_type: string
          changed_at: string
          changed_by: string | null
          client_visibility:
            | Database["public"]["Enums"]["client_visibility"]
            | null
          created_at: string | null
          created_by: string | null
          description: string | null
          estimate_id: string | null
          flagged: boolean | null
          history_id: string
          name: string | null
          node_type: Database["public"]["Enums"]["node_type"] | null
          original_node_id: string
          parent_id: string | null
          path: unknown
          sort_order: number | null
          total_price: number | null
          updated_at: string | null
          was_auto_promoted: boolean | null
        }
        Insert: {
          catalog_source_id?: string | null
          change_type: string
          changed_at?: string
          changed_by?: string | null
          client_visibility?:
            | Database["public"]["Enums"]["client_visibility"]
            | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          estimate_id?: string | null
          flagged?: boolean | null
          history_id?: string
          name?: string | null
          node_type?: Database["public"]["Enums"]["node_type"] | null
          original_node_id: string
          parent_id?: string | null
          path?: unknown
          sort_order?: number | null
          total_price?: number | null
          updated_at?: string | null
          was_auto_promoted?: boolean | null
        }
        Update: {
          catalog_source_id?: string | null
          change_type?: string
          changed_at?: string
          changed_by?: string | null
          client_visibility?:
            | Database["public"]["Enums"]["client_visibility"]
            | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          estimate_id?: string | null
          flagged?: boolean | null
          history_id?: string
          name?: string | null
          node_type?: Database["public"]["Enums"]["node_type"] | null
          original_node_id?: string
          parent_id?: string | null
          path?: unknown
          sort_order?: number | null
          total_price?: number | null
          updated_at?: string | null
          was_auto_promoted?: boolean | null
        }
        Relationships: []
      }
      estimate_shares: {
        Row: {
          access_count: number
          created_at: string
          created_by: string | null
          estimate_id: string
          expires_at: string
          failed_attempts: number
          id: string
          is_revoked: boolean
          last_accessed_at: string | null
          locked_until: string | null
          pin_hash: string
          share_token: string
        }
        Insert: {
          access_count?: number
          created_at?: string
          created_by?: string | null
          estimate_id: string
          expires_at: string
          failed_attempts?: number
          id?: string
          is_revoked?: boolean
          last_accessed_at?: string | null
          locked_until?: string | null
          pin_hash: string
          share_token: string
        }
        Update: {
          access_count?: number
          created_at?: string
          created_by?: string | null
          estimate_id?: string
          expires_at?: string
          failed_attempts?: number
          id?: string
          is_revoked?: boolean
          last_accessed_at?: string | null
          locked_until?: string | null
          pin_hash?: string
          share_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_shares_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_snapshots: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          estimate_id: string
          estimate_status_at_time: Database["public"]["Enums"]["estimate_status"]
          id: string
          name: string
          node_count: number
          project_status_at_time: Database["public"]["Enums"]["project_status"]
          schema_version: number
          snapshot_data: Json
          snapshot_type: Database["public"]["Enums"]["snapshot_type"]
          total_price: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          estimate_id: string
          estimate_status_at_time: Database["public"]["Enums"]["estimate_status"]
          id?: string
          name: string
          node_count?: number
          project_status_at_time: Database["public"]["Enums"]["project_status"]
          schema_version?: number
          snapshot_data: Json
          snapshot_type?: Database["public"]["Enums"]["snapshot_type"]
          total_price?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          estimate_id?: string
          estimate_status_at_time?: Database["public"]["Enums"]["estimate_status"]
          id?: string
          name?: string
          node_count?: number
          project_status_at_time?: Database["public"]["Enums"]["project_status"]
          schema_version?: number
          snapshot_data?: Json
          snapshot_type?: Database["public"]["Enums"]["snapshot_type"]
          total_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "estimate_snapshots_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_view_state: {
        Row: {
          estimate_id: string
          updated_at: string
          user_id: string
          view_state: Json
        }
        Insert: {
          estimate_id: string
          updated_at?: string
          user_id: string
          view_state?: Json
        }
        Update: {
          estimate_id?: string
          updated_at?: string
          user_id?: string
          view_state?: Json
        }
        Relationships: [
          {
            foreignKeyName: "estimate_view_state_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      estimates: {
        Row: {
          created_at: string
          created_by: string | null
          default_contingency_rate: number | null
          default_markup_rate: number | null
          default_overhead_rate: number | null
          default_tax_rate: number | null
          description: string | null
          id: string
          name: string
          notes: string | null
          project_id: string
          status: Database["public"]["Enums"]["estimate_status"]
          updated_at: string
          version: number
          version_group_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_contingency_rate?: number | null
          default_markup_rate?: number | null
          default_overhead_rate?: number | null
          default_tax_rate?: number | null
          description?: string | null
          id?: string
          name: string
          notes?: string | null
          project_id: string
          status?: Database["public"]["Enums"]["estimate_status"]
          updated_at?: string
          version?: number
          version_group_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_contingency_rate?: number | null
          default_markup_rate?: number | null
          default_overhead_rate?: number | null
          default_tax_rate?: number | null
          description?: string | null
          id?: string
          name?: string
          notes?: string | null
          project_id?: string
          status?: Database["public"]["Enums"]["estimate_status"]
          updated_at?: string
          version?: number
          version_group_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estimates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      node_assembly_details: {
        Row: {
          archived_at: string | null
          assembly_unit_cost: number | null
          created_at: string
          id: string
          node_id: string
          quantity: number | null
          ratio_base: string | null
          specifications: string | null
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assembly_unit_cost?: number | null
          created_at?: string
          id?: string
          node_id: string
          quantity?: number | null
          ratio_base?: string | null
          specifications?: string | null
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assembly_unit_cost?: number | null
          created_at?: string
          id?: string
          node_id?: string
          quantity?: number | null
          ratio_base?: string | null
          specifications?: string | null
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "node_assembly_details_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: true
            referencedRelation: "estimate_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_assembly_details_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
        ]
      }
      node_item_details: {
        Row: {
          allowance_budget: number | null
          allowance_status: string | null
          archived_at: string | null
          created_at: string
          equipment_cost: number | null
          id: string
          is_allowance: boolean
          labor_cost: number | null
          labor_hours: number | null
          labor_rate: number | null
          markup_rate: number | null
          material_cost: number | null
          node_id: string
          overhead_rate: number | null
          purchasing_notes: string | null
          quantity: number | null
          specifications: string | null
          subcontractor_cost: number | null
          tax_rate: number | null
          unit_cost: number | null
          unit_id: string | null
          updated_at: string
          vendor_id: string | null
        }
        Insert: {
          allowance_budget?: number | null
          allowance_status?: string | null
          archived_at?: string | null
          created_at?: string
          equipment_cost?: number | null
          id?: string
          is_allowance?: boolean
          labor_cost?: number | null
          labor_hours?: number | null
          labor_rate?: number | null
          markup_rate?: number | null
          material_cost?: number | null
          node_id: string
          overhead_rate?: number | null
          purchasing_notes?: string | null
          quantity?: number | null
          specifications?: string | null
          subcontractor_cost?: number | null
          tax_rate?: number | null
          unit_cost?: number | null
          unit_id?: string | null
          updated_at?: string
          vendor_id?: string | null
        }
        Update: {
          allowance_budget?: number | null
          allowance_status?: string | null
          archived_at?: string | null
          created_at?: string
          equipment_cost?: number | null
          id?: string
          is_allowance?: boolean
          labor_cost?: number | null
          labor_hours?: number | null
          labor_rate?: number | null
          markup_rate?: number | null
          material_cost?: number | null
          node_id?: string
          overhead_rate?: number | null
          purchasing_notes?: string | null
          quantity?: number | null
          specifications?: string | null
          subcontractor_cost?: number | null
          tax_rate?: number | null
          unit_cost?: number | null
          unit_id?: string | null
          updated_at?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_item_details_vendor"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_item_details_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: true
            referencedRelation: "estimate_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_item_details_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
        ]
      }
      node_item_details_history: {
        Row: {
          allowance_budget: number | null
          allowance_status: string | null
          archived_at: string | null
          change_type: string
          changed_at: string
          changed_by: string | null
          created_at: string | null
          equipment_cost: number | null
          history_id: string
          is_allowance: boolean | null
          labor_cost: number | null
          labor_hours: number | null
          labor_rate: number | null
          markup_rate: number | null
          material_cost: number | null
          node_id: string | null
          original_detail_id: string
          overhead_rate: number | null
          purchasing_notes: string | null
          quantity: number | null
          specifications: string | null
          subcontractor_cost: number | null
          tax_rate: number | null
          unit_cost: number | null
          unit_id: string | null
          updated_at: string | null
          vendor_id: string | null
        }
        Insert: {
          allowance_budget?: number | null
          allowance_status?: string | null
          archived_at?: string | null
          change_type: string
          changed_at?: string
          changed_by?: string | null
          created_at?: string | null
          equipment_cost?: number | null
          history_id?: string
          is_allowance?: boolean | null
          labor_cost?: number | null
          labor_hours?: number | null
          labor_rate?: number | null
          markup_rate?: number | null
          material_cost?: number | null
          node_id?: string | null
          original_detail_id: string
          overhead_rate?: number | null
          purchasing_notes?: string | null
          quantity?: number | null
          specifications?: string | null
          subcontractor_cost?: number | null
          tax_rate?: number | null
          unit_cost?: number | null
          unit_id?: string | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Update: {
          allowance_budget?: number | null
          allowance_status?: string | null
          archived_at?: string | null
          change_type?: string
          changed_at?: string
          changed_by?: string | null
          created_at?: string | null
          equipment_cost?: number | null
          history_id?: string
          is_allowance?: boolean | null
          labor_cost?: number | null
          labor_hours?: number | null
          labor_rate?: number | null
          markup_rate?: number | null
          material_cost?: number | null
          node_id?: string | null
          original_detail_id?: string
          overhead_rate?: number | null
          purchasing_notes?: string | null
          quantity?: number | null
          specifications?: string | null
          subcontractor_cost?: number | null
          tax_rate?: number | null
          unit_cost?: number | null
          unit_id?: string | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Relationships: []
      }
      node_notes: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          format: string
          id: string
          is_client_visible: boolean
          is_internal: boolean
          node_id: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          format?: string
          id?: string
          is_client_visible?: boolean
          is_internal?: boolean
          node_id: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          format?: string
          id?: string
          is_client_visible?: boolean
          is_internal?: boolean
          node_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "node_notes_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "estimate_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      node_option_memberships: {
        Row: {
          alternative_id: string
          created_at: string
          id: string
          node_id: string
        }
        Insert: {
          alternative_id: string
          created_at?: string
          id?: string
          node_id: string
        }
        Update: {
          alternative_id?: string
          created_at?: string
          id?: string
          node_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "node_option_memberships_alternative_id_fkey"
            columns: ["alternative_id"]
            isOneToOne: false
            referencedRelation: "option_alternatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_option_memberships_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "estimate_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      option_alternatives: {
        Row: {
          created_at: string
          description: string | null
          group_id: string
          id: string
          is_selected: boolean
          name: string
          price_adjustment: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          group_id: string
          id?: string
          is_selected?: boolean
          name: string
          price_adjustment?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          group_id?: string
          id?: string
          is_selected?: boolean
          name?: string
          price_adjustment?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "option_alternatives_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "option_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      option_groups: {
        Row: {
          created_at: string
          description: string | null
          estimate_id: string
          group_type: Database["public"]["Enums"]["option_group_type"]
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          estimate_id: string
          group_type?: Database["public"]["Enums"]["option_group_type"]
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          estimate_id?: string
          group_type?: Database["public"]["Enums"]["option_group_type"]
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "option_groups_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      option_set_broad_selections: {
        Row: {
          broad_option_id: string
          option_set_id: string
        }
        Insert: {
          broad_option_id: string
          option_set_id: string
        }
        Update: {
          broad_option_id?: string
          option_set_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "option_set_broad_selections_broad_option_id_fkey"
            columns: ["broad_option_id"]
            isOneToOne: false
            referencedRelation: "broad_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "option_set_broad_selections_option_set_id_fkey"
            columns: ["option_set_id"]
            isOneToOne: false
            referencedRelation: "option_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      option_set_selections: {
        Row: {
          alternative_id: string
          id: string
          option_set_id: string
        }
        Insert: {
          alternative_id: string
          id?: string
          option_set_id: string
        }
        Update: {
          alternative_id?: string
          id?: string
          option_set_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "option_set_selections_alternative_id_fkey"
            columns: ["alternative_id"]
            isOneToOne: false
            referencedRelation: "option_alternatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "option_set_selections_option_set_id_fkey"
            columns: ["option_set_id"]
            isOneToOne: false
            referencedRelation: "option_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      option_sets: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          estimate_id: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          estimate_id: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          estimate_id?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "option_sets_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      phases: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          project_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          project_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          project_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "phases_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_parameters: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          project_id: string
          unit: string | null
          updated_at: string
          value: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          project_id: string
          unit?: string | null
          updated_at?: string
          value: number
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          project_id?: string
          unit?: string | null
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_parameters_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          bid_date: string | null
          city: string | null
          client_email: string | null
          client_name: string | null
          client_phone: string | null
          created_at: string
          created_by: string | null
          description: string | null
          end_date: string | null
          id: string
          name: string
          project_number: string | null
          start_date: string | null
          state: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          zip: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          bid_date?: string | null
          city?: string | null
          client_email?: string | null
          client_name?: string | null
          client_phone?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          name: string
          project_number?: string | null
          start_date?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          zip?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          bid_date?: string | null
          city?: string | null
          client_email?: string | null
          client_name?: string | null
          client_phone?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          name?: string
          project_number?: string | null
          start_date?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          zip?: string | null
        }
        Relationships: []
      }
      units_of_measure: {
        Row: {
          abbreviation: string
          category: string | null
          created_at: string
          id: string
          name: string
          sort_order: number | null
          updated_at: string
        }
        Insert: {
          abbreviation: string
          category?: string | null
          created_at?: string
          id?: string
          name: string
          sort_order?: number | null
          updated_at?: string
        }
        Update: {
          abbreviation?: string
          category?: string | null
          created_at?: string
          id?: string
          name?: string
          sort_order?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          preferences: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          preferences?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          preferences?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          pin_failed_attempts: number
          pin_hash: string | null
          pin_locked_until: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          pin_failed_attempts?: number
          pin_hash?: string | null
          pin_locked_until?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          pin_failed_attempts?: number
          pin_hash?: string | null
          pin_locked_until?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      vendors: {
        Row: {
          address: string | null
          contact_name: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      client_has_project_access: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      create_estimate_from_snapshot: {
        Args: {
          p_created_by: string
          p_new_name: string
          p_snapshot_id: string
        }
        Returns: string
      }
      create_estimate_snapshot: {
        Args: {
          p_created_by?: string
          p_estimate_id: string
          p_name: string
          p_snapshot_type?: Database["public"]["Enums"]["snapshot_type"]
        }
        Returns: string
      }
      current_snapshot_schema_version: { Args: never; Returns: number }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      deep_copy_estimate: {
        Args: {
          p_created_by?: string
          p_new_name?: string
          p_source_estimate_id: string
        }
        Returns: string
      }
      get_user_role: { Args: never; Returns: string }
      is_staff: { Args: never; Returns: boolean }
      restore_estimate_snapshot: {
        Args: {
          p_force?: boolean
          p_restored_by?: string
          p_snapshot_id: string
        }
        Returns: string
      }
      set_subtree_visibility: {
        Args: {
          p_node_id: string
          p_visibility: Database["public"]["Enums"]["client_visibility"]
        }
        Returns: number
      }
      text2ltree: { Args: { "": string }; Returns: unknown }
    }
    Enums: {
      app_role: "owner" | "employee" | "client" | "pending"
      approval_status: "pending" | "approved" | "rejected"
      author_type: "user" | "share"
      client_visibility: "visible" | "hidden" | "summary_only"
      estimate_status: "draft" | "preliminary" | "active" | "complete"
      node_type: "group" | "assembly" | "item"
      option_group_type: "selection" | "toggle"
      project_status:
        | "lead"
        | "in_design"
        | "bidding"
        | "under_contract"
        | "value_engineering"
        | "active_construction"
        | "closing_out"
        | "warranty_period"
        | "closed"
        | "archived"
      snapshot_type: "milestone" | "checkpoint"
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
      app_role: ["owner", "employee", "client", "pending"],
      approval_status: ["pending", "approved", "rejected"],
      author_type: ["user", "share"],
      client_visibility: ["visible", "hidden", "summary_only"],
      estimate_status: ["draft", "preliminary", "active", "complete"],
      node_type: ["group", "assembly", "item"],
      option_group_type: ["selection", "toggle"],
      project_status: [
        "lead",
        "in_design",
        "bidding",
        "under_contract",
        "value_engineering",
        "active_construction",
        "closing_out",
        "warranty_period",
        "closed",
        "archived",
      ],
      snapshot_type: ["milestone", "checkpoint"],
    },
  },
} as const
