"""Shared fixtures for chartviewer backend tests."""

import os
import tempfile
import pytest

# Point cache at a temp DB for every test session
@pytest.fixture(autouse=True, scope="session")
def tmp_db(tmp_path_factory):
    db = tmp_path_factory.mktemp("db") / "test_cache.db"
    os.environ["CHARTVIEWER_DB_PATH"] = str(db)
    import cache
    cache.DB_PATH = str(db)
    cache.init_db()
    return db
