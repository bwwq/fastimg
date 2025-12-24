"""
Database initialization and migration script.
Handles both new databases and upgrades for existing ones.
"""
from app import app, db
from sqlalchemy import text, inspect

def migrate_database():
    """Add missing columns for database compatibility with older versions."""
    
    inspector = inspect(db.engine)
    
    # Define migrations: (table_name, column_name, column_definition)
    migrations = [
        ('user', 'quota_bytes', 'BIGINT'),
    ]
    
    for table, column, col_type in migrations:
        if table in inspector.get_table_names():
            columns = [c['name'] for c in inspector.get_columns(table)]
            if column not in columns:
                try:
                    db.session.execute(text(f'ALTER TABLE {table} ADD COLUMN {column} {col_type}'))
                    db.session.commit()
                    print(f"  + Added column: {table}.{column}")
                except Exception as e:
                    print(f"  ! Failed to add {table}.{column}: {e}")
                    db.session.rollback()

with app.app_context():
    # Create tables if not exist
    db.create_all()
    print("Database tables checked.")
    
    # Run migrations for existing databases
    print("Checking for migrations...")
    migrate_database()
    
    print("Database ready.")
