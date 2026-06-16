export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export interface Database {
    public: {
        Tables: {
            projects: {
                Row: {
                    id: string
                    name: string
                    status: string | null
                    team_id: string | null
                    created_by: string | null
                    created_at: string | null
                    updated_at: string | null
                }
                Insert: {
                    id?: string
                    name: string
                    status?: string | null
                    team_id?: string | null
                    created_by?: string | null
                    created_at?: string | null
                    updated_at?: string | null
                }
                Update: {
                    id?: string
                    name?: string
                    status?: string | null
                    team_id?: string | null
                    created_by?: string | null
                    created_at?: string | null
                    updated_at?: string | null
                }
            }
            teams: {
                Row: {
                    id: string
                    name: string
                    seats: number | null
                    created_at: string | null
                }
                Insert: {
                    id?: string
                    name: string
                    seats?: number | null
                    created_at?: string | null
                }
                Update: {
                    id?: string
                    name?: string
                    seats?: number | null
                    created_at?: string | null
                }
            }
            team_members: {
                Row: {
                    id: string
                    user_id: string
                    team_id: string
                    role: string
                    created_at: string | null
                }
                Insert: {
                    id?: string
                    user_id: string
                    team_id: string
                    role: string
                    created_at?: string | null
                }
                Update: {
                    id?: string
                    user_id?: string
                    team_id?: string
                    role?: string
                    created_at?: string | null
                }
            },
            usage_events: {
                Row: {
                    id: string
                    team_id: string | null
                    project_id: string | null
                    type: string
                    quantity: number | null
                    created_at: string | null
                }
                Insert: {
                    id?: string
                    team_id?: string | null
                    project_id?: string | null
                    type: string
                    quantity?: number | null
                    created_at?: string | null
                }
                Update: {
                    id?: string
                    team_id?: string | null
                    project_id?: string | null
                    type: string
                    quantity?: number | null
                    created_at?: string | null
                }
            }
        }
        Views: {
            [_ in never]: never
        }
        Functions: {
            [_ in never]: never
        }
        Enums: {
            [_ in never]: never
        }
    }
}
