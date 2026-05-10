import os
from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext

try:
    from .database import db
except ImportError:
    from database import db

_raw_secret = os.getenv("JWT_SECRET_KEY")
if not _raw_secret:
    raise ValueError(
        "JWT_SECRET_KEY environment variable is not set. "
        "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
    )
SECRET_KEY        = _raw_secret
ALGORITHM         = "HS256"
TOKEN_EXPIRE_MINS = 60 * 24  # 24 hours

pwd_context   = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    payload = data.copy()
    expire  = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=TOKEN_EXPIRE_MINS))
    payload["exp"] = expire
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _decode_and_load_user(token: str) -> tuple[dict, dict]:
    """Decode JWT and load live user from DB. Returns (payload, user_doc)."""
    cred_err = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload  = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            raise cred_err
    except JWTError:
        raise cred_err

    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    user = db["users"].find_one({"username": username}, {"_id": 0, "password_hash": 0})
    if not user:
        raise cred_err

    # Token version check — invalidates old tokens on password change
    token_version = payload.get("tv")
    if token_version != user.get("token_version", 0):
        raise cred_err

    return payload, user


def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    payload, user = _decode_and_load_user(token)

    # Enforce server-side: block all routes until password is changed
    if payload.get("force_password_change"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Password change required before accessing this resource",
        )

    return {"username": user["username"], "role": user.get("role", "user")}


def get_current_user_allow_force_change(token: str = Depends(oauth2_scheme)) -> dict:
    """Used only by the change-password endpoint — permits force_password_change tokens."""
    _payload, user = _decode_and_load_user(token)
    return {"username": user["username"], "role": user.get("role", "user")}


def get_current_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


def check_portfolio_access(portfolio_id: str, current_user: dict) -> None:
    if current_user.get("role") == "admin":
        return

    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    meta = db["portfolio_metadata"].find_one({"portfolio_id": portfolio_id})
    if meta is None:
        raise HTTPException(status_code=403, detail="Access denied")
    if meta.get("owner_username") != current_user["username"]:
        raise HTTPException(status_code=403, detail="Access denied")
