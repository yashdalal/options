<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Fail visibly — never paper over bad data

This app supports trading decisions. Prefer a hard failure or an explicit empty/unavailable state over a “helpful” fallback that could show stale, approximate, or silently degraded numbers.

Do **not**:

- Serve expired cache entries when a live fetch fails
- Chain alternate endpoints / data sources just to avoid surfacing an error
- Substitute a related field (e.g. previous close for LTP, last good premium for missing bid) when the intended value is missing, unless the product explicitly documents that substitution
- Swallow provider errors and continue as if the metric is simply “unknown” without an error the UI or logs can show

Do:

- Throw or return a clear error when required market data cannot be loaded
- Show unavailable / error in the UI so the operator notices
- Keep in-TTL cache for performance only — never as a silent recovery path after failure
- Keep independent features isolated (e.g. option screening can succeed while 1M/3M ranges fail with a visible error)
