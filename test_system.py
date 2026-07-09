#!/usr/bin/env python
"""System validation test - ensures all components are working."""

import sys
import sqlite3

def test_imports():
    """Test all module imports."""
    print("\n[TEST] Module imports...")
    
    try:
        from database import Database, get_database
        print("  OK: database.py imported")
    except Exception as e:
        print(f"  FAIL: database.py - {e}")
        return False
    
    try:
        from scraper import scrape_all_sites, GOVERNMENT_SITES
        print(f"  OK: scraper.py imported ({len(GOVERNMENT_SITES)} sites)")
    except Exception as e:
        print(f"  FAIL: scraper.py - {e}")
        return False
    
    try:
        from ai_processor import GeminiProcessor
        print("  OK: ai_processor.py imported")
    except Exception as e:
        print(f"  FAIL: ai_processor.py - {e}")
        return False
    
    try:
        from main import GovernmentExamUpdateAgent
        print("  OK: main.py imported")
    except Exception as e:
        print(f"  FAIL: main.py - {e}")
        return False
    
    try:
        from api import app
        print("  OK: api.py imported (FastAPI)")
    except Exception as e:
        print(f"  FAIL: api.py - {e}")
        return False
    
    return True


def test_database():
    """Test database initialization and schema."""
    print("\n[TEST] Database schema...")
    
    try:
        from database import get_database
        
        # Create in-memory database
        db = get_database(':memory:')
        print("  OK: Database initialized (in-memory)")
        
        # Check tables
        conn = db._connect()
        cursor = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='notifications'"
        )
        if cursor.fetchone():
            print("  OK: notifications table created")
        else:
            print("  FAIL: notifications table not found")
            return False
        
        # Check columns
        cursor = conn.execute("PRAGMA table_info(notifications)")
        columns = {row[1] for row in cursor.fetchall()}
        required_columns = {
            'exam_name', 'update_type', 'old_value', 'new_value', 'summary',
            'source_url', 'site_name', 'raw_text', 'content_hash', 'created_at', 'telegram_sent'
        }
        if required_columns.issubset(columns):
            print(f"  OK: All required columns present ({len(required_columns)} columns)")
        else:
            missing = required_columns - columns
            print(f"  FAIL: Missing columns - {missing}")
            return False
        
        # Check indexes
        cursor = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='notifications'"
        )
        indexes = {row[0] for row in cursor.fetchall()}
        required_indexes = {
            'idx_notifications_created_at',
            'idx_notifications_site_name',
            'idx_notifications_exam_name',
            'idx_notifications_idempotency'
        }
        if required_indexes.issubset(indexes):
            print(f"  OK: All required indexes present ({len(required_indexes)} indexes)")
        else:
            missing = required_indexes - indexes
            print(f"  FAIL: Missing indexes - {missing}")
            return False
        
        # Check UNIQUE constraint on content_hash
        cursor = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='notifications'")
        schema = cursor.fetchone()[0]
        if 'content_hash TEXT NOT NULL UNIQUE' in schema:
            print("  OK: UNIQUE constraint on content_hash confirmed")
        else:
            print("  FAIL: UNIQUE constraint on content_hash not found")
            return False
        
        # Don't close in-memory connections - they're shared
        if db.db_path != ':memory:':
            conn.close()
        return True
    
    except Exception as e:
        print(f"  FAIL: Database test - {e}")
        return False


def test_idempotency():
    """Test idempotent insertion."""
    print("\n[TEST] Idempotency...")
    
    try:
        from database import get_database
        from datetime import datetime, timezone
        
        db = get_database(':memory:')
        
        # First insert
        payload1 = {
            'exam_name': 'Test Exam',
            'update_type': 'Admit Card Out',
            'old_value': '',
            'new_value': '2026-08-01',
            'summary': 'Admit card released',
            'source_url': 'https://example.gov.in/',
            'site_name': 'Test Site',
            'raw_text': 'Raw content here',
            'content_hash': 'abc123def456',
            'created_at': datetime.now(timezone.utc).isoformat(),
        }
        
        inserted1 = db.insert_notification(payload1)
        if inserted1:
            print("  OK: First notification inserted (returned True)")
        else:
            print("  FAIL: First insert failed")
            return False
        
        # Try to insert same (duplicate)
        inserted2 = db.insert_notification(payload1)
        if not inserted2:
            print("  OK: Duplicate skipped (returned False)")
        else:
            print("  FAIL: Duplicate was not skipped (should return False)")
            return False
        
        # Verify count is still 1
        conn = db._connect()
        cursor = conn.execute("SELECT COUNT(*) FROM notifications")
        count = cursor.fetchone()[0]
        
        # Don't close in-memory connections - they're shared
        if db.db_path != ':memory:':
            conn.close()
        
        if count == 1:
            print(f"  OK: Database contains exactly 1 record (idempotency confirmed)")
            return True
        else:
            print(f"  FAIL: Database contains {count} records (expected 1)")
            return False
    
    except Exception as e:
        print(f"  FAIL: Idempotency test - {e}")
        return False


def test_scraper():
    """Test scraper imports and site configuration."""
    print("\n[TEST] Scraper configuration...")
    
    try:
        from scraper import GOVERNMENT_SITES, SiteTarget
        
        if len(GOVERNMENT_SITES) >= 3:
            print(f"  OK: {len(GOVERNMENT_SITES)} government sites configured:")
            for site in GOVERNMENT_SITES:
                if site.url.startswith('https://'):
                    print(f"      {site.name} -> {site.url}")
                else:
                    print(f"      FAIL: {site.name} has invalid URL")
                    return False
            return True
        else:
            print(f"  FAIL: Only {len(GOVERNMENT_SITES)} sites found (expected >= 3)")
            return False
    
    except Exception as e:
        print(f"  FAIL: Scraper test - {e}")
        return False


def test_gemini():
    """Test Gemini processor initialization."""
    print("\n[TEST] Gemini processor...")
    
    try:
        from ai_processor import GeminiProcessor
        
        processor = GeminiProcessor(api_key="test_key_123")
        print(f"  OK: GeminiProcessor initialized")
        print(f"      Model: {processor.model_name}")
        
        # Test content hash generation
        test_payload = {
            'exam_name': 'Test Exam',
            'update_type': 'Admit Card Out',
            'old_value': '',
            'new_value': '2026-08-01',
            'summary': 'Admit card released',
        }
        hash1 = GeminiProcessor._build_content_hash('TestSite', 'https://example.com', test_payload)
        hash2 = GeminiProcessor._build_content_hash('TestSite', 'https://example.com', test_payload)
        
        if hash1 == hash2:
            print(f"  OK: Content hash is deterministic (SHA256)")
            print(f"      Hash: {hash1[:32]}...")
            return True
        else:
            print(f"  FAIL: Content hash is not deterministic")
            return False
    
    except Exception as e:
        print(f"  FAIL: Gemini test - {e}")
        return False


def test_fastapi():
    """Test FastAPI integration."""
    print("\n[TEST] FastAPI integration...")
    
    try:
        from api import app, database
        
        print(f"  OK: FastAPI app initialized")
        print(f"      Database connected to app")
        
        # Check endpoints exist
        routes = [route.path for route in app.routes]
        required_routes = ['/api/updates', '/api/stats', '/health', '/api/track-url', '/api/watchlist']
        
        for route in required_routes:
            if route in routes:
                print(f"      Endpoint {route} exists")
            else:
                print(f"      FAIL: Endpoint {route} missing")
                return False
        
        return True
    
    except Exception as e:
        print(f"  FAIL: FastAPI test - {e}")
        return False


def main():
    """Run all tests."""
    print("=" * 60)
    print("GOVERNMENT EXAM ALERT SYSTEM - VALIDATION TEST")
    print("=" * 60)
    
    tests = [
        ("Module Imports", test_imports),
        ("Database Schema", test_database),
        ("Idempotency", test_idempotency),
        ("Scraper Config", test_scraper),
        ("Gemini Processor", test_gemini),
        ("FastAPI Integration", test_fastapi),
    ]
    
    results = []
    for name, test_func in tests:
        try:
            result = test_func()
            results.append((name, result))
        except Exception as e:
            print(f"\n[ERROR] {name} test crashed: {e}")
            results.append((name, False))
    
    # Summary
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "PASS" if result else "FAIL"
        print(f"[{status}] {name}")
    
    print("=" * 60)
    print(f"\n{passed}/{total} tests passed")
    
    if passed == total:
        print("\nAll validations passed! System is ready to use.")
        print("\nNext steps:")
        print("  1. Set GEMINI_API_KEY in .env")
        print("  2. Run: python main.py --once")
        print("  3. Start API: uvicorn api:app --port 8000")
        print("  4. Start frontend: cd frontend && npm run dev")
        return 0
    else:
        print(f"\n{total - passed} test(s) failed. Please review above.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
