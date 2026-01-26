// Simple in-memory rate limiter for edge functions
// Uses IP-based throttling with a sliding window

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory store (will reset when function cold starts, which is acceptable)
const rateLimitStore = new Map<string, RateLimitEntry>();

interface RateLimitOptions {
  limit: number;      // Max requests allowed
  windowMs: number;   // Time window in milliseconds
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
}

export function rateLimit(
  req: Request,
  options: RateLimitOptions = { limit: 10, windowMs: 60000 }
): RateLimitResult {
  const { limit, windowMs } = options;
  const now = Date.now();
  
  // Get client IP from headers (Supabase Edge Functions provide this)
  const clientIP = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() 
    || req.headers.get("x-real-ip") 
    || "unknown";
  
  // Clean up expired entries periodically
  if (Math.random() < 0.1) { // 10% chance to clean up on each request
    for (const [key, entry] of rateLimitStore.entries()) {
      if (now > entry.resetTime) {
        rateLimitStore.delete(key);
      }
    }
  }
  
  const entry = rateLimitStore.get(clientIP);
  
  if (!entry || now > entry.resetTime) {
    // Create new entry
    const newEntry: RateLimitEntry = {
      count: 1,
      resetTime: now + windowMs,
    };
    rateLimitStore.set(clientIP, newEntry);
    
    return {
      allowed: true,
      remaining: limit - 1,
      resetTime: newEntry.resetTime,
    };
  }
  
  // Increment existing entry
  entry.count++;
  
  if (entry.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: entry.resetTime,
    };
  }
  
  return {
    allowed: true,
    remaining: limit - entry.count,
    resetTime: entry.resetTime,
  };
}
