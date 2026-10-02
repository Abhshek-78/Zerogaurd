local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local req_id = ARGV[4]

local clear_before = now - window

-- 1. Prune requests older than current window
redis.call('ZREMRANGEBYSCORE', key, 0, clear_before)

-- 2. Fetch current request count within sliding window
local current_requests = redis.call('ZCARD', key)

-- 3. Check if rate limit exceeded
if current_requests < limit then
    -- Add current request to sorted set
    redis.call('ZADD', key, now, req_id)
    -- Set TTL slightly longer than window (in seconds) so key persists through window
    local ttl_seconds = math.ceil(window / 1000) + 2
    redis.call('EXPIRE', key, ttl_seconds)
    
    return {1, limit - current_requests - 1} -- Allowed (1), Remaining quota
else
    return {0, 0} -- Blocked (0), Remaining quota (0)
end