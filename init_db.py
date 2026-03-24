"""
Database initialization and migration script.
Handles both new databases and upgrades for existing ones.
Run this BEFORE starting the app on a production server.
"""
from app import app, db, ensure_db_compatible

with app.app_context():
    # Step 1: Ensure old database columns are compatible
    print("Checking database compatibility...")
    ensure_db_compatible(app)

    # Step 2: Create any new tables (does NOT drop or modify existing tables/data)
    db.create_all()
    print("Database tables checked.")

    print("Database ready. All existing data preserved.")
