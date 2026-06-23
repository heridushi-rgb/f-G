import { createClient } from '@supabase/supabase-js'

// Replace these with your Supabase project URL and anon key
// Found in: Supabase Dashboard → Project Settings → API
const SUPABASE_URL = 'https://YOUR_PROJECT_REF.supabase.co'
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY'

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
