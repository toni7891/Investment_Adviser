"""
Web search module using DuckDuckGo (via ddgs package).
Provides: web_search_cached(query, max_results=5) -> str
"""

from ddgs import DDGS
import time
import logging

# Simple in-memory cache: (query_lower, max_results) -> (timestamp, result)
_CACHE = {}
_CACHE_TTL = 300  # 5 minutes

logging.basicConfig(level=logging.INFO)


def web_search_cached(query: str, max_results: int = 5) -> str:
    """Cached wrapper with TTL eviction."""
    key = (query.lower().strip(), max_results)
    now = time.time()
    if key in _CACHE:
        ts, result = _CACHE[key]
        if now - ts < _CACHE_TTL:
            return result
    result = _web_search_raw(query, max_results)
    _CACHE[key] = (now, result)
    return result


def web_search_structured(query: str, max_results: int = 5) -> list:
    """Return search results as a list of {title, url, snippet} dicts (cached)."""
    key = (query.lower().strip() + ":structured", max_results)
    now = time.time()
    if key in _CACHE:
        ts, result = _CACHE[key]
        if now - ts < _CACHE_TTL:
            return result

    results = []
    try:
        with DDGS(timeout=10.0) as ddgs:
            for r in ddgs.text(query, max_results=max_results):
                title = r.get("title", "").strip()
                href  = r.get("href",  "").strip()
                body  = r.get("body",  "").strip()
                if title and href:
                    results.append({"title": title, "url": href, "snippet": body})
    except Exception as e:
        logging.warning(f"Structured web search failed for '{query}': {e}")

    _CACHE[key] = (now, results)
    return results


def _web_search_raw(query: str, max_results: int = 5, timeout: float = 10.0) -> str:
    """
    Raw DuckDuckGo search - returns formatted snippets or "" on failure.
    Uses ddgs v2+ API: DDGS(timeout=...) as context manager.
    """
    start = time.time()
    results = []

    try:
        # ddgs v2+: DDGS constructor takes timeout
        with DDGS(timeout=timeout) as ddgs:
            # .text() expects positional 'query' argument
            for r in ddgs.text(query, max_results=max_results):
                title = r.get("title", "").strip()
                href = r.get("href", "").strip()
                body = r.get("body", "").strip()

                if title and href and body:
                    results.append(f"• {title}\n  URL: {href}\n  {body}")

                if time.time() - start > timeout:
                    break
    except Exception as e:
        logging.warning(f"Web search failed for '{query}': {e}")
        return ""

    if not results:
        return ""

    return "\n\n".join(results)


# --- Quick manual test ---
if __name__ == "__main__":
    print("Testing web search for 'AMD stock price today'...")
    print(web_search_cached("AMD stock price today", max_results=3))
