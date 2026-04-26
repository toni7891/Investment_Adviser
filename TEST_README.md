# Investment Adviser — Test Guide

## Quick Start

Install test dependencies and run the suite:

```bash
# Option 1: Install into current environment
pip install -r backend/requirements-test.txt

# Option 2: Use virtual environment (recommended)
python -m venv .venv
.\.venv\Scripts\activate  # Windows
source .venv/bin/activate  # Linux/Mac
pip install -r backend/requirements-test.txt
```

Run tests:

```bash
# Run all tests
python run_tests.py

# Run only unit tests (fast)
python run_tests.py --unit

# Run only integration tests
python run_tests.py --integration

# Run only API tests
python run_tests.py --api

# Fast mode (skip slow tests)
python run_tests.py --fast

# Generate coverage report
python run_tests.py --coverage
# Open coverage_html/index.html in browser

# Verbose mode
python run_tests.py --verbose

# Stop at first failure, show local variables
python run_tests.py --xvs
```

Or use pytest directly:
```bash
pytest tests/ -v --tb=short
pytest tests/unit -v
pytest tests/integration/test_api.py -v
```

---

## Test Structure

```
tests/
├── __init__.py               # Package marker
├── conftest.py               # Shared fixtures and configuration
├── unit/                     # Fast, isolated unit tests
│   ├── __init__.py
│   ├── test_utils.py         # routes.py utilities (cleaning, formatting, etc.)
│   ├── test_models.py        # models/model.py functions
│   ├── test_database.py      # database.py helpers
│   └── test_search.py        # search.py caching and web search
└── integration/              # Full stack tests
    ├── __init__.py
    └── test_api.py           # FastAPI endpoint tests (client requests)
```

---

## Test Coverage by Feature

### 1. Utility Functions (`tests/unit/test_utils.py`)
- `_clean_text()` — None/NaN/whitespace handling
- `_last_non_empty_value()` — row value extraction
- `_normalize_header()` — column name normalization
- `_to_float()` — safe float conversion
- `_safe_collection_name()` — sanitization security
- `_format_portfolio_summary()` — AI context building
- `_parse_portfolio_upload()` — Excel parsing
- `should_trigger_search()` — search heuristic triggers
- Edge cases (empty data, missing fields, many positions)

### 2. Models (`tests/unit/test_models.py`)
- `PortfolioSummary` Pydantic validation
- `fetch_portfolio()` — collection fetching with defaults
- `add_ticker_to_portfolio()` — upsert weighted average
- `remove_ticker_from_portfolio()` — deletion
- `ensure_cash_document()` — CASH position creation/updates
- Collection name sanitization integration across all handlers

### 3. Database (`tests/unit/test_database.py`)
- `get_collection()` — db availability checks
- `list_collections()` — filtering system namespaces
- `close_connection()` — graceful shutdown
- `get_db()` — accessor function

### 4. Search (`tests/unit/test_search.py`)
- Cache TTL behavior (hit/miss/eviction)
- Case-insensitive query normalization
- Different max_results separate caching
- DDGS error handling (exceptions, empty results)
- Result filtering (incomplete snippets skipped)
- Timeout behavior (partial results)

### 5. API Endpoints (`tests/integration/test_api.py`)
- `GET /api/portfolios/list` — listing portfolios
- `GET /api/portfolios/{id}` — detailed portfolio with P&L
- `POST /api/portfolios/upload` — Excel file upload
- `POST /api/portfolios/{id}/positions` — add/update positions
- `DELETE /api/portfolios/{id}/positions/{ticker}` — remove holdings
- `POST /api/portfolios/{id}/cash/deposit` — add cash
- `POST /api/portfolios/{id}/cash/withdraw` — withdraw cash
- `POST /api/chat` — AI chat with/without portfolio context
- `GET /api/portfolios/` — default portfolio alias
- `DELETE /api/portfolios/{id}` — delete whole portfolio
- Collection name sanitization security (dot/dollar/null-byte)
- Error responses (400, 404, 502, 503)

---

## Mocking Strategy

Tests use aggressive mocking to run fast without external dependencies:

| Dependency | Mock Used | Behavior |
|------------|-----------|----------|
| MongoDB | `mongomock` | In-memory MongoDB-compatible mock |
| yfinance | `patch('backend.routes.yf.download')` | Returns predictable 2-day price data |
| httpx (AI backend) | `patch('httpx.AsyncClient')` | Returns mocked OpenAI-format chat response |
| LLM Server | Not needed | AI backend never called |

**Sample Market Data in Tests:**
```python
# _mock_download returns:
AMD: Close [150.0, 155.0]  → +3.33%
AAPL: Close [170.0, 172.0] → +1.18%
GOOGL: Close [140.0, 142.0] → +1.43%
```

---

## Fixtures Reference (`conftest.py`)

### MongoDB Fixtures
- `mock_mongo_db` — Clean mongomock database instance (function-scoped)
- `mock_portfolio_collection` — Pre-populated "4RCH3R" with 4 holdings + CASH
- `mock_empty_portfolio` — Empty collection for edge case tests

### External Service Fixtures
- `mock_yfinance` (autouse=True) — Auto-applied to all tests; patches `yf.download`
- `mock_httpx_client` — Replaces all `httpx.AsyncClient` calls with mock

### Data Fixtures
- `sample_portfolio_data` — Standard CASH position dict
- `sample_position_data` — AMD stock dict
- `sample_excel_bytes` — Valid minimal Excel file as bytes

### Test Client
- `client` — FastAPI `TestClient` with all mocks applied; isolation per function

---

## Running Specific Tests

```bash
# Test a single file
pytest tests/unit/test_utils.py -v

# Test a single class
pytest tests/unit/test_utils.py::TestCleanText -v

# Test a single function
pytest tests/unit/test_utils.py::TestCleanText::test_clean_normal_string -v

# Run with pdb debugger on failure
pytest --pdb tests/integration/test_api.py::TestChatEndpoint::test_chat_with_portfolio_context

# Show print() statements
pytest -s tests/unit/test_search.py

# Only tests matching "chat"
pytest -k chat -v

# Tests NOT matching slow
pytest -m "not slow" -v
```

---

## Adding New Tests

1. **Unit test** → add to appropriate file in `tests/unit/`
2. **API test** → add to `tests/integration/test_api.py` in correct class
3. **New fixture?** → Add to `conftest.py`
4. **New mock?** → Add to `conftest.py` or patch inline

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| ImportError: No module named 'backend' | Ensure running from project root; `sys.path` set in `conftest.py` |
| MongoDB connection errors | Mock should be active; check fixture usage |
| yfinance not mocked | `mock_yfinance` is `autouse=True` — should auto-apply |
| httpx calls hitting real network | Ensure `mock_httpx_client` fixture used by test |
| Port 8000 already in use | Tests use `TestClient` without network; no conflict |
| Unicode errors in Windows console | All emoji removed from backend code |

---

## Test Execution Times

- **Unit tests**: ~1-2 seconds (40+ tests)
- **Integration tests**: ~3-5 seconds (20+ endpoint tests)
- **Full suite**: ~5-8 seconds (with coverage: ~10-12 seconds)

All tests run in-memory, no actual network/database calls.

---

## Continuous Integration

For CI/CD (GitHub Actions, GitLab CI, etc.), add:

```yaml
- name: Install dependencies
  run: |
    pip install -r backend/requirements.txt
    pip install -r backend/requirements-test.txt

- name: Run tests
  run: |
    pytest tests/ --cov=backend --cov-report=xml

- name: Upload coverage
  uses: codecov/codecov-action@v3
```

---

**Test suite created:** APR-26-2026  
**Total test count:** ~60+ tests covering all major features  
**Estimated coverage:** >80% of critical paths
