"""WEFT backend settings loaded from environment variables."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    """Runtime settings for the WEFT backend."""

    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = Field(default="sqlite:///./weft.db")
    cors_origins: str = Field(
        default="http://localhost:3000,http://localhost:5173,http://localhost:5174,http://localhost:5175"
    )
    allow_dev_reset: bool = Field(default=True)
    admin_key: str = Field(default="")
    api_key: str = Field(default="")
    trace_upload_dir: str = Field(default="./data/traces")
    report_storage_dir: str = Field(default="./storage/reports")
    max_trace_file_size_mb: int = Field(default=20, ge=1)
    log_level: str = Field(default="INFO")
    thresholds_path: str = Field(default="")
    app_name: str = Field(default="weft-backend")
    app_version: str = Field(default="1.0.0")

    @property
    def sqlalchemy_database_url(self) -> str:
        url = self.database_url.strip()
        if url.startswith("sqlite:///") and not url.startswith("sqlite:///:memory:"):
            raw_path = url[len("sqlite:///"):]
            path = Path(raw_path)
            if not path.is_absolute():
                path = (BACKEND_DIR / raw_path).resolve()
            return f"sqlite:///{path.as_posix()}"
        return url

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def upload_dir(self) -> Path:
        path = Path(self.trace_upload_dir)
        if not path.is_absolute():
            path = BACKEND_DIR / path
        return path.resolve()

    @property
    def reports_dir(self) -> Path:
        path = Path(self.report_storage_dir)
        if not path.is_absolute():
            path = BACKEND_DIR / path
        return path.resolve()

    @property
    def thresholds_file(self) -> Path:
        if self.thresholds_path:
            return Path(self.thresholds_path).resolve()
        return (BACKEND_DIR / "config" / "thresholds.yaml").resolve()

    @property
    def max_trace_file_size_bytes(self) -> int:
        return self.max_trace_file_size_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()


def reset_settings() -> None:
    get_settings.cache_clear()
