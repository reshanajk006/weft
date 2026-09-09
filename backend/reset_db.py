"""Clear the local WEFT SQLite database without changing startup behavior.

Usage (from backend/):
    python reset_db.py
"""

from __future__ import annotations

from app.db.database import get_session_factory, init_db
from app.services.system_reset import reset_all_data


def main() -> None:
    init_db()
    session = get_session_factory()()
    try:
        counts = reset_all_data(session)
        session.commit()
        print("WEFT database cleared.")
        for name, count in counts.items():
            print(f"  {name}: {count} rows")
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


if __name__ == "__main__":
    main()
