import os
from werkzeug.middleware.proxy_fix import ProxyFix
import datetime
import uuid
from flask import Flask, request, jsonify, send_from_directory, render_template, abort
from flask_login import login_user, logout_user, login_required, current_user
from flask_wtf.csrf import CSRFProtect, generate_csrf, CSRFError
from config import Config
from extensions import db, login_manager, limiter, migrate
from models import User, Image, ImageStat, SystemConfig, InviteCode, Folder
from utils import process_and_save_image

csrf = CSRFProtect()

def _ensure_db_compatible(app):
    """确保旧数据库兼容新 schema，只 ADD 列不删除任何数据。"""
    import sqlite3
    db_path = app.config.get('SQLALCHEMY_DATABASE_URI', '')
    if not db_path.startswith('sqlite:///'):
        return

    db_file = db_path.replace('sqlite:///', '')
    if not os.path.exists(db_file):
        return

    conn = sqlite3.connect(db_file)
    cursor = conn.cursor()

    def has_column(table, column):
        cursor.execute(f"PRAGMA table_info({table})")
        return column in [row[1] for row in cursor.fetchall()]

    def has_table(table):
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,))
        return cursor.fetchone() is not None

    try:
        if not has_table('folder'):
            cursor.execute("""
                CREATE TABLE folder (
                    id INTEGER NOT NULL PRIMARY KEY,
                    name VARCHAR(256) NOT NULL,
                    parent_id INTEGER REFERENCES folder(id),
                    user_id INTEGER NOT NULL REFERENCES user(id),
                    created_at DATETIME
                )
            """)

        if has_table('image'):
            if not has_column('image', 'folder_id'):
                cursor.execute("ALTER TABLE image ADD COLUMN folder_id INTEGER REFERENCES folder(id)")

        if has_table('user'):
            if not has_column('user', 'is_active_user'):
                cursor.execute("ALTER TABLE user ADD COLUMN is_active_user BOOLEAN DEFAULT 1")
            if not has_column('user', 'quota_bytes'):
                cursor.execute("ALTER TABLE user ADD COLUMN quota_bytes BIGINT")

        if has_table('invite_code'):
            if not has_column('invite_code', 'max_uses'):
                cursor.execute("ALTER TABLE invite_code ADD COLUMN max_uses INTEGER DEFAULT 1")
            if not has_column('invite_code', 'current_uses'):
                cursor.execute("ALTER TABLE invite_code ADD COLUMN current_uses INTEGER DEFAULT 0")
                if has_column('invite_code', 'is_used'):
                    cursor.execute("UPDATE invite_code SET current_uses = 1 WHERE is_used = 1")
            if not has_column('invite_code', 'expires_at'):
                cursor.execute("ALTER TABLE invite_code ADD COLUMN expires_at DATETIME")
            if not has_column('invite_code', 'created_at'):
                cursor.execute("ALTER TABLE invite_code ADD COLUMN created_at DATETIME")
            if not has_column('invite_code', 'used_by_id'):
                cursor.execute("ALTER TABLE invite_code ADD COLUMN used_by_id INTEGER REFERENCES user(id)")

        if has_table('image_stat'):
            if not has_column('image_stat', 'last_referer'):
                cursor.execute("ALTER TABLE image_stat ADD COLUMN last_referer VARCHAR(256)")

        conn.commit()
    except Exception as e:
        app.logger.warning(f"DB compat check: {e}")
        conn.rollback()
    finally:
        conn.close()

def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    # Init extensions
    if not os.path.exists(app.config['UPLOAD_FOLDER']):
        os.makedirs(app.config['UPLOAD_FOLDER'])
    db.init_app(app)
    login_manager.init_app(app)
    limiter.init_app(app)
    migrate.init_app(app, db)
    csrf.init_app(app)

    # ProxyFix: 让 Flask 在反向代理后正确获取真实客户端 IP
    # x_for=1 表示信任一层 X-Forwarded-For
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    # Ensure database compatibility with older versions (only ADD columns, never drop)
    with app.app_context():
        _ensure_db_compatible(app)

    @app.errorhandler(CSRFError)
    def handle_csrf_error(e):
        return jsonify({'error': 'CSRF token missing or incorrect'}), 400


    # Context Processor (inject config to templates if needed, or global vars)
    
    # ---------------- API Routes ----------------

    @app.route('/')
    @limiter.exempt
    def index():
        return app.send_static_file('index.html')

    @app.route('/api/csrf-token')
    def get_csrf_token():
        """Get CSRF token for frontend requests."""
        return jsonify({'csrf_token': generate_csrf()})

    @app.route('/api/auth/register', methods=['POST'])
    @limiter.limit("5 per minute")
    def register():
        data = request.get_json()
        if not data or not data.get('username') or not data.get('password'):
            return jsonify({'error': 'Missing username or password'}), 400
        
        # Invite Code Check
        enable_invite = SystemConfig.get('ENABLE_INVITE_CODE', 'false') == 'true'
        # If first user, skip invite check (to allow creating admin)
        if enable_invite and User.query.count() > 0:
            code_str = data.get('invite_code')
            if not code_str:
                return jsonify({'error': 'Invite code required'}), 400
            
            # Atomic Check and Update to prevent race condition
            # We check validity and increment in one go if possible, or at least lock row
            # Since SQLite locking is tricky, we use a conditional update statement
            
            # First, basic validation
            invite = InviteCode.query.filter_by(code=code_str).first()
            if not invite:
                 return jsonify({'error': 'Invalid invite code'}), 400
            
            # Check expiry explicitly
            if invite.expires_at and datetime.datetime.now(datetime.timezone.utc) > invite.expires_at:
                return jsonify({'error': 'Invite code expired'}), 400

            # Atomic increment
            stmt = InviteCode.__table__.update().\
                where(InviteCode.code == code_str).\
                where(InviteCode.current_uses < InviteCode.max_uses).\
                values(current_uses=InviteCode.current_uses + 1)
            
            result = db.session.execute(stmt)
            if result.rowcount == 0:
                 return jsonify({'error': 'Invite code invalid or exhausted'}), 400
            
            # Note: We don't track used_by_id strictly to avoid circular dependency before user creation

        if User.query.filter_by(username=data['username']).first():
            return jsonify({'error': 'Username already exists'}), 400
            
        user = User(username=data['username'])
        user.set_password(data['password'])
        
        db.session.add(user)
        db.session.flush()
        
        # Check if first user -> admin (after flush, user is in DB)
        if User.query.count() == 1:
            user.role = 'admin'
        
        # Update invite last user
        if enable_invite and User.query.count() > 1 and invite:
             invite.used_by_id = user.id
             
        db.session.commit()
        return jsonify(user.to_dict()), 201

    @app.route('/api/auth/login', methods=['POST'])
    @limiter.limit("10 per minute")
    def login():
        data = request.get_json()
        user = User.query.filter_by(username=data.get('username')).first()
        if user and user.check_password(data.get('password')):
            if user.is_active_user is False:
                 return jsonify({'error': 'Account disabled'}), 403
            login_user(user)
            return jsonify(user.to_dict())
        return jsonify({'error': 'Invalid credentials'}), 401
    

    @app.route('/api/auth/me')
    def me():
        if current_user.is_authenticated:
            return jsonify(current_user.to_dict())
        return jsonify({'error': 'Unauthorized'}), 401

    @app.route('/api/auth/stats')
    @login_required
    def user_stats():
        # Calc used space (sum of image sizes)
        # Using db.session.query for aggregation
        from sqlalchemy import func
        used_bytes = db.session.query(func.sum(Image.size)).filter_by(user_id=current_user.id).scalar() or 0
        count = Image.query.filter_by(user_id=current_user.id).count()
        
        # User quota
        if current_user.role != 'admin':
            quota_bytes = current_user.get_quota_bytes()
        else:
            quota_bytes = 0  # Unlimited
            
        return jsonify({
            'used_bytes': used_bytes,
            'image_count': count,
            'quota_bytes': quota_bytes
        })

    @app.route('/api/auth/password', methods=['PUT'])
    @login_required
    def change_password():
        data = request.get_json()
        old_pass = data.get('old_password')
        new_pass = data.get('new_password')
        
        if not old_pass or not new_pass:
            return jsonify({'error': 'Missing fields'}), 400
            
        if not current_user.check_password(old_pass):
            return jsonify({'error': 'Incorrect old password'}), 400
            
        current_user.set_password(new_pass)
        db.session.commit()
        return jsonify({'message': 'Password updated'})

    @app.route('/api/auth/logout', methods=['POST'])
    @login_required
    def logout():
        logout_user()
        return jsonify({'message': 'Logged out'})

    @app.route('/api/admin/users', methods=['GET'])
    @login_required
    def admin_users():
        if current_user.role != 'admin':
            abort(403)
        
        from sqlalchemy import func
        
        # Optimize: Single query with Left Join & Group By to avoid N+1 problem
        # Select User, Sum(Image.size), Count(Image.id)
        query = db.session.query(
            User,
            func.sum(Image.size).label('total_size'),
            func.count(Image.id).label('img_count')
        ).outerjoin(Image, User.id == Image.user_id)\
         .group_by(User.id)\
         .order_by(User.created_at.desc())
         
        results = query.all()
        
        response_data = []
        for user, total_size, img_count in results:
            user_data = user.to_dict()
            # Handle None result from sum (if no images)
            user_data['used_bytes'] = total_size or 0
            user_data['image_count'] = img_count or 0
            response_data.append(user_data)
        
        return jsonify(response_data)

    @app.route('/api/admin/users/<int:user_id>', methods=['PUT', 'DELETE'])
    @login_required
    def admin_user_action(user_id):
        if current_user.role != 'admin':
            abort(403)
        
        user = User.query.get_or_404(user_id)
        
        # Prevent self-modification of role/deletion
        if user.id == current_user.id:
            return jsonify({'error': 'Cannot modify yourself'}), 400
        
        if request.method == 'PUT':
            data = request.get_json()
            if 'role' in data:
                user.role = data['role']
            if 'is_active' in data:
                user.is_active_user = data['is_active']
            db.session.commit()
            return jsonify(user.to_dict())
        
        if request.method == 'DELETE':
            # Delete user's images first
            for img in user.images:
                try:
                    os.remove(os.path.join(app.config['UPLOAD_FOLDER'], img.filename))
                except OSError as e:
                    app.logger.warning(f"Failed to delete file {img.filename}: {e}")
                db.session.delete(img)
            db.session.delete(user)
            db.session.commit()
            return jsonify({'message': 'User deleted'})

    @app.route('/api/admin/users/<int:user_id>/password', methods=['PUT'])
    @login_required
    def admin_reset_user_password(user_id):
        if current_user.role != 'admin':
            return jsonify({'error': 'Unauthorized'}), 403
            
        target_user = db.session.get(User, user_id)
        if not target_user:
            return jsonify({'error': 'User not found'}), 404
            
        data = request.get_json()
        new_password = data.get('password')
        
        if not new_password or len(new_password) < 6:
             return jsonify({'error': 'Password too short'}), 400
             
        target_user.set_password(new_password)
        db.session.commit()
        return jsonify({'message': 'Password updated'})

    @app.route('/api/admin/users/<int:user_id>/quota', methods=['PUT'])
    @login_required
    def admin_set_user_quota(user_id):
        if current_user.role != 'admin':
            return jsonify({'error': 'Unauthorized'}), 403
            
        target_user = db.session.get(User, user_id)
        if not target_user:
            return jsonify({'error': 'User not found'}), 404
            
        data = request.get_json()
        quota_mb = data.get('quota_mb')  # in MB, null means use global
        
        if quota_mb is None or quota_mb == '':
            target_user.quota_bytes = None  # Reset to global default
        else:
            try:
                target_user.quota_bytes = int(float(quota_mb) * 1024 * 1024)
            except (ValueError, TypeError):
                return jsonify({'error': 'Invalid quota value'}), 400
        
        db.session.commit()
        return jsonify({'message': 'Quota updated', 'quota_bytes': target_user.quota_bytes})

    @app.route('/api/admin/invites', methods=['GET', 'POST', 'DELETE'])
    @login_required
    def admin_invites():
        if current_user.role != 'admin':
            abort(403)
            
        if request.method == 'GET':
            codes = InviteCode.query.order_by(InviteCode.created_at.desc()).all()
            return jsonify([c.to_dict() for c in codes])
            
        if request.method == 'POST':
            # Generate new code
            req = request.get_json()
            count = int(req.get('count', 1))
            days = int(req.get('days', 7)) # valid days
            limit = int(req.get('limit', 1)) # max uses
            
            expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=days)
            
            created = []
            for _ in range(count):
                code_str = uuid.uuid4().hex[:16]
                code = InviteCode(
                    code=code_str,
                    max_uses=limit,
                    current_uses=0,
                    expires_at=expires_at,
                    created_at=datetime.datetime.now(datetime.timezone.utc)
                )
                db.session.add(code)
                created.append(code_str)
            db.session.commit()
            app.logger.info(f"Created {count} invite codes")
            return jsonify({'codes': created}), 201
            
        if request.method == 'DELETE':
            code_id = request.args.get('id')
            InviteCode.query.filter_by(id=code_id).delete()
            db.session.commit()
            return jsonify({'message': 'Deleted'})

    @app.route('/api/public/config')
    @limiter.exempt
    def public_config():
        """Public endpoint for non-sensitive config like quality limit"""
        return jsonify({
            'compress_quality': SystemConfig.get('compress_quality', '80'),
            'max_upload_size': SystemConfig.get('MAX_UPLOAD_SIZE', '5')
        })

    @app.route('/api/upload', methods=['POST'])
    @login_required 
    def upload():
        if 'file' not in request.files:
            return jsonify({'error': 'No file part'}), 400
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No selected file'}), 400
        
        # Get user-specified quality (from form data)
        user_quality = request.form.get('quality', type=int)
        # Passthrough mode: skip all processing, preserve original bytes (for Tavern cards etc.)
        passthrough = request.form.get('passthrough', 'false').lower() == 'true'
        
        # Check quota before processing (Admin is always unlimited)
        if current_user.role != 'admin':
            from sqlalchemy import func
            used_bytes = db.session.query(func.sum(Image.size)).filter_by(user_id=current_user.id).scalar() or 0
            
            quota_bytes = current_user.get_quota_bytes()
            
            # 0 means unlimited
            if quota_bytes > 0 and used_bytes >= quota_bytes:
                return jsonify({'error': '存储配额已用尽'}), 400
            
        try:
            # Process and Save to Disk
            meta = process_and_save_image(file, current_user.id, user_quality=user_quality, passthrough=passthrough)
            
            # Folder path resolution
            folder_id = request.form.get('folder_id', type=int)
            path_str = request.form.get('path', '').strip('/')
            if path_str:
                parts = [p for p in path_str.split('/') if p]
                current_parent_id = folder_id
                for part in parts:
                    folder = db.session.query(Folder).filter_by(user_id=current_user.id, name=part, parent_id=current_parent_id).first()
                    if not folder:
                        folder = Folder(name=part, user_id=current_user.id, parent_id=current_parent_id)
                        db.session.add(folder)
                        db.session.flush() # To get folder.id immediately
                    current_parent_id = folder.id
                folder_id = current_parent_id
            
            # Save to DB
            image = Image(
                filename=meta['filename'],
                original_name=meta['original_name'],
                size=meta['size'],
                width=meta['width'],
                height=meta['height'],
                mime_type=meta['mime_type'],
                user_id=current_user.id,
                folder_id=folder_id
            )
            # Create Stat
            image.stats = ImageStat()
            
            db.session.add(image)
            db.session.commit()
            
            return jsonify(image.to_dict()), 201
        except ValueError as e:
            db.session.rollback()
            app.logger.warning(f"Upload rejected: {e}")
            return jsonify({'error': str(e)}), 400
        except Exception as e:
            # Log error
            app.logger.error(f"Upload failed: {e}")
            return jsonify({'error': 'Upload failed'}), 500

    @app.route('/api/images', methods=['GET'])
    def get_images():
        page = request.args.get('page', 1, type=int)
        per_page = 20
        sort_by = request.args.get('sort', 'time')  # time, size, name
        order = request.args.get('order', 'desc')  # asc, desc
        req_folder_id = request.args.get('folder_id', type=int)
        
        query = Image.query
        
        # Admin can view other users' images if user_id is provided
        target_user_id = request.args.get('user_id', type=int)

        if current_user.is_authenticated:
            actual_user_id = target_user_id if (current_user.role == 'admin' and target_user_id) else current_user.id
            query = query.filter_by(user_id=actual_user_id)
        else:
            return jsonify({'error': 'Login required'}), 401
            
        query = query.filter_by(folder_id=req_folder_id)
        
        # Determine sort column
        if sort_by == 'size':
            sort_col = Image.size
        elif sort_by == 'name':
            sort_col = Image.original_name
        else:  # default to time
            sort_col = Image.upload_time
        
        # Apply order
        if order == 'asc':
            query = query.order_by(sort_col.asc())
        else:
            query = query.order_by(sort_col.desc())
            
        pag = query.paginate(page=page, per_page=per_page)
        
        # Determine folders in current directory
        folders = db.session.query(Folder).filter_by(user_id=actual_user_id, parent_id=req_folder_id).order_by(Folder.name.asc()).all()
        
        # Determine breadcrumbs
        breadcrumbs = [{'id': None, 'name': '首页'}]
        curr = req_folder_id
        path_nodes = []
        while curr:
            f = db.session.get(Folder, curr)
            if not f or f.user_id != actual_user_id:
                break
            path_nodes.insert(0, {'id': f.id, 'name': f.name})
            curr = f.parent_id
        breadcrumbs.extend(path_nodes)
        
        return jsonify({
            'current_folder': db.session.get(Folder, req_folder_id).to_dict() if req_folder_id else None,
            'breadcrumbs': breadcrumbs,
            'folders': [f.to_dict() for f in folders],
            'images': [i.to_dict() for i in pag.items],
            'total': pag.total,
            'pages': pag.pages,
            'current_page': page
        })

    @app.route('/api/images/<int:image_id>', methods=['DELETE'])
    @login_required
    def delete_image(image_id):
        image = Image.query.get_or_404(image_id)
        if image.user_id != current_user.id and current_user.role != 'admin':
            abort(403)
            
        try:
            # Remove file
            path = os.path.join(app.config['UPLOAD_FOLDER'], image.filename)
            if os.path.exists(path):
                os.remove(path)
        except OSError as e:
            app.logger.warning(f"Failed to delete file {image.filename}: {e}")
            
        db.session.delete(image)
        db.session.commit()
        return jsonify({'message': 'Deleted'})

    @app.route('/i/<path:filename>')
    @limiter.exempt
    def serve_image(filename):
        # 单图片每日访问上限检查
        per_image_limit = SystemConfig.get('rate_limit_per_image', 0, type_func=int)

        try:
            img = Image.query.filter_by(filename=filename).first()
            if img and img.stats:
                # 检查是否超过单图片每日限制
                if per_image_limit > 0:
                    today = datetime.datetime.now(datetime.timezone.utc).date()
                    last_view_date = img.stats.last_view.date() if img.stats.last_view else None
                    if last_view_date == today and img.stats.view_count >= per_image_limit:
                        return jsonify({'error': '该图片今日访问次数已达上限'}), 429

                img.stats.view_count += 1
                img.stats.last_view = datetime.datetime.now(datetime.timezone.utc)
                db.session.commit()
        except Exception as e:
            app.logger.debug(f"Failed to update view count: {e}")
        return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

    @app.route('/api/admin/config', methods=['GET', 'POST'])
    @login_required
    def admin_config():
        if current_user.role != 'admin':
            abort(403)
            
        if request.method == 'GET':
            configs = SystemConfig.query.all()
            return jsonify({c.key: c.value for c in configs})
            
        if request.method == 'POST':
            data = request.get_json()
            for key, value in data.items():
                SystemConfig.set(key, value)
            return jsonify({'message': 'Config saved'})

    return app

# Expose app for WSGI servers (Gunicorn)
app = create_app()

# For external scripts (init_db.py)
ensure_db_compatible = _ensure_db_compatible

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(debug=True, port=5000)
