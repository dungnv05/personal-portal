import { applyCors } from './auth/_helpers.js';
import { rateLimit } from './auth/_ratelimit.js';

export default async function handler(req, res) {
  if (applyCors(req, res, 'GET, OPTIONS')) {
    return;
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  if (await rateLimit(req, res, { bucket: 'config', limit: 60, windowSec: 60 })) {
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

  return res.status(200).json({
    supabaseUrl,
    supabaseAnonKey,
  });
}
