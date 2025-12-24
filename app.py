import os
import datetime
import uuid
from flask import Flask, request, jsonify, send_from_directory, render_template, abort
from flask_login import login_user, logout_user, login_required, current_user
from config import Config
from extensions import db, login_manager, limiter, migrate
from models import User, Image, ImageStat, SystemConfig, InviteCode
from utils import process_and_save_image

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

    @login_manager.user_loader
    def load_user(user_id):
        return db.session.get(User, int(user_id))

    # Context Processor (inject config to templates if needed, or global vars)
    
    # ---------------- API Routes ----------------

    @app.route('/')
    def index():
        return app.send_static_file('index.html')

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
            if invite.expires_at and datetime.datetime.utcnow() > invite.expires_at:
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
        
        # Check if first user -> admin
        if User.query.count() == 0:
            user.role = 'admin'
            
        db.session.add(user)
        db.session.flush()
        
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
            if not user.is_active_user:
                 return jsonify({'error': 'Account disabled'}), 403
            login_user(user)
            return jsonify(user.to_dict())
        return jsonify({'error': 'Invalid credentials'}), 401
    
    # ... (omit unchanged) ...

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
        
        # User quota: individual > global
        if current_user.quota_bytes is not None:
            quota_bytes = current_user.quota_bytes
        else:
            quota_str = SystemConfig.get('user_quota')
            try:
                quota_mb = int(quota_str) if quota_str and quota_str != 'None' else 500
            except (ValueError, TypeError):
                quota_mb = 500
            quota_bytes = quota_mb * 1024 * 1024
            
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
        
        users = User.query.order_by(User.created_at.desc()).all()
        result = []
        for u in users:
            # Get user stats
            from sqlalchemy import func
            used_bytes = db.session.query(func.sum(Image.size)).filter_by(user_id=u.id).scalar() or 0
            img_count = Image.query.filter_by(user_id=u.id).count()
            
            user_data = u.to_dict()
            user_data['used_bytes'] = used_bytes
            user_data['image_count'] = img_count
            result.append(user_data)
        
        return jsonify(result)

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
                except:
                    pass
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
            
            expires_at = datetime.datetime.utcnow() + datetime.timedelta(days=days)
            
            created = []
            for _ in range(count):
                code_str = uuid.uuid4().hex[:16]
                code = InviteCode(
                    code=code_str,
                    max_uses=limit,
                    current_uses=0,
                    expires_at=expires_at,
                    created_at=datetime.datetime.utcnow()
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
    def public_config():
        """Public endpoint for non-sensitive config like quality limit"""
        return jsonify({
            'compress_quality': SystemConfig.get('compress_quality', '80')
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
        
        # Check quota before processing
        from sqlalchemy import func
        used_bytes = db.session.query(func.sum(Image.size)).filter_by(user_id=current_user.id).scalar() or 0
        
        if current_user.quota_bytes is not None:
            quota_bytes = current_user.quota_bytes
        else:
            quota_str = SystemConfig.get('user_quota')
            try:
                quota_mb = int(quota_str) if quota_str and quota_str != 'None' else 500
            except (ValueError, TypeError):
                quota_mb = 500
            quota_bytes = quota_mb * 1024 * 1024
        
        # 0 means unlimited
        if quota_bytes > 0 and used_bytes >= quota_bytes:
            return jsonify({'error': '存储配额已用尽'}), 400
            
        try:
            # Process and Save to Disk
            meta = process_and_save_image(file, current_user.id, user_quality=user_quality, passthrough=passthrough)
            
            # Save to DB
            image = Image(
                filename=meta['filename'],
                original_name=meta['original_name'],
                size=meta['size'],
                width=meta['width'],
                height=meta['height'],
                mime_type=meta['mime_type'],
                user_id=current_user.id
            )
            # Create Stat
            image.stats = ImageStat()
            
            db.session.add(image)
            db.session.commit()
            
            return jsonify(image.to_dict()), 201
        except ValueError as e:
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
        
        query = Image.query
        
        # Admin can view other users' images if user_id is provided
        target_user_id = request.args.get('user_id', type=int)

        if current_user.is_authenticated:
            if current_user.role == 'admin' and target_user_id:
                query = query.filter_by(user_id=target_user_id)
            else:
                query = query.filter_by(user_id=current_user.id)
        else:
            return jsonify({'error': 'Login required'}), 401
        
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
        
        return jsonify({
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
        except:
            pass # Continue to delete DB record
            
        db.session.delete(image)
        db.session.commit()
        return jsonify({'message': 'Deleted'})

    @app.route('/i/<path:filename>')
    def serve_image(filename):
        # Update view count with batched commit (every 10 views)
        try:
            img = Image.query.filter_by(filename=filename).first()
            if img and img.stats:
                img.stats.view_count += 1
                img.stats.last_view = datetime.datetime.utcnow()
                # Commit every 10 views to reduce DB pressure
                if img.stats.view_count % 10 == 0:
                    db.session.commit()
        except:
            pass
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

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(debug=True, port=5000)
