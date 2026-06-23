import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://yszkxozafnmxiogyscla.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable__kltuVgXmChok0gP4xjy1w_iwaEWJrB'

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
