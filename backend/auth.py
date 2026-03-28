"""JWT authentication, password hashing, FastAPI dependencies, and admin bootstrap."""

import os
from datetime import datetime, timezone, timedelta
from typing import Annotated

import bcrypt
import jwt
from jwt.exceptions import InvalidTokenError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

import cache

SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "change-me-in-production")
ALGORITHM = "HS256"
TOKEN_EXPIRE_DAYS = 30

_bearer = HTTPBearer()


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_token(user_id: int, username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=TOKEN_EXPIRE_DAYS)
    return jwt.encode(
        {"sub": str(user_id), "username": username, "exp": expire},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(_bearer)],
) -> dict:
    exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (InvalidTokenError, KeyError, ValueError):
        raise exc
    user = cache.get_user_by_id(user_id)
    if not user:
        raise exc
    return user


async def get_admin_user(
    user: Annotated[dict, Depends(get_current_user)],
) -> dict:
    if not user["is_admin"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


def bootstrap_admin(default_watchlist: list[dict]):
    """Create the admin user from ADMIN_USER/ADMIN_PASSWORD env vars if not present."""
    username = os.environ.get("ADMIN_USER", "").strip()
    password = os.environ.get("ADMIN_PASSWORD", "").strip()
    if not username or not password:
        return

    if cache.get_user_by_username(username):
        return  # already exists

    password_hash = hash_password(password)
    admin_id = cache.create_user(username, password_hash, is_admin=True)

    migrated = cache.migrate_watchlist_to_user(admin_id)
    if not migrated:
        cache.save_watchlist(admin_id, default_watchlist)
