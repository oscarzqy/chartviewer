"""Shared fixtures for chartviewer backend tests."""

import os
import tempfile
import pytest

# These MUST be set before any app module is imported.
# CHARTVIEWER_DB_PATH in particular must be set before test_api.py does
# `from main import app`, which triggers cache.init_db() + bootstrap_admin()
# at import time — without this, they'd run against the production DB.
_TEST_DB = os.path.join(tempfile.gettempdir(), "chartviewer_test_session.db")
os.environ["CHARTVIEWER_DB_PATH"] = _TEST_DB
os.environ.setdefault("ADMIN_USER", "testadmin")
os.environ.setdefault("ADMIN_PASSWORD", "testpass")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key")


@pytest.fixture(autouse=True, scope="session")
def tmp_db():
    if os.path.exists(_TEST_DB):
        os.remove(_TEST_DB)
    import cache
    cache.DB_PATH = _TEST_DB
    cache.init_db()
    import auth
    from main import DEFAULT_WATCHLIST
    auth.bootstrap_admin(DEFAULT_WATCHLIST)
    yield
    if os.path.exists(_TEST_DB):
        os.remove(_TEST_DB)


@pytest.fixture(scope="session")
def admin_token(tmp_db):
    import cache, auth
    user = cache.get_user_by_username("testadmin")
    return auth.create_token(user["id"], user["username"])
