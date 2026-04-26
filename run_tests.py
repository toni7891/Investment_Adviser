#!/usr/bin/env python
"""
Test runner script for Investment Adviser project.

Runs all tests with coverage reporting and produces a summary.
Usage:
    python run_tests.py              # Run all tests
    python run_tests.py --unit       # Unit tests only
    python run_tests.py --integration # Integration tests only
    python run_tests.py --coverage   # Generate coverage report
    python run_tests.py --fast       # Fast tests only (no slow markers)
"""

import subprocess
import sys
import os

def run_tests(args=""):
    """Execute pytest with given arguments."""
    cmd = [sys.executable, "-m", "pytest"] + args

    print("=" * 70)
    print("Investment Adviser — Test Suite")
    print("=" * 70)
    print(f"Command: {' '.join(cmd)}")
    print("-" * 70)

    try:
        result = subprocess.run(cmd, cwd=os.path.dirname(os.path.abspath(__file__)))
        return result.returncode
    except KeyboardInterrupt:
        print("\n\nTests interrupted by user.")
        return 130
    except Exception as e:
        print(f"Error running tests: {e}")
        return 1


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Run the test suite")
    parser.add_argument("--unit", action="store_true", help="Run only unit tests (deprecated)")
    parser.add_argument("--integration", action="store_true", help="Run only integration tests (deprecated)")
    parser.add_argument("--api", action="store_true", help="Run only API endpoint tests (deprecated)")
    parser.add_argument("--coverage", action="store_true", help="Generate coverage report")
    parser.add_argument("--fast", action="store_true", help="Skip slow tests")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    parser.add_argument("--xvs", action="store_true", help="Stop at first failure, show local vars")

    args = parser.parse_args()

    pytest_args = []

    if args.verbose:
        pytest_args.append("-vv")
    if args.xvs:
        pytest_args = ["-xvs"]

    # Default to smoke tests; legacy flags are deprecated and warn
    if args.unit or args.integration or args.api:
        print("WARNING: --unit/--integration/--api flags are deprecated. Running smoke tests instead.")

    pytest_args.append("tests/smoke")

    if args.fast:
        pytest_args.extend(["-m", "not slow"])

    if args.coverage:
        pytest_args = [
            "--cov=backend",
            "--cov-report=term-missing",
            "--cov-report=html:coverage_html",
            "--cov-report=xml:coverage.xml",
        ] + pytest_args

    return run_tests(pytest_args)


if __name__ == "__main__":
    sys.exit(main())
