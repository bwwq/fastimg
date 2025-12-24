from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash
from extensions import db
from flask_login import UserMixin

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), unique=True, index=True, nullable=False)
    password_hash = db.Column(db.String(256))
    role = db.Column(db.String(20), default='user')  # 'user' or 'admin'
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    is_active_user = db.Column(db.Boolean, default=True)
    quota_bytes = db.Column(db.BigInteger, nullable=True)  # null = use global default
    
    # 关系
    images = db.relationship('Image', backref='owner', lazy='dynamic')

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)
    
    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'role': self.role,
            'created_at': self.created_at.isoformat(),
            'is_active': self.is_active_user,
            'quota_bytes': self.quota_bytes  # null means use global
        }

class Image(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    filename = db.Column(db.String(128), unique=True, nullable=False) # 存储在磁盘上的唯一文件名
    original_name = db.Column(db.String(256), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    size = db.Column(db.Integer)  # Bytes
    width = db.Column(db.Integer)
    height = db.Column(db.Integer)
    mime_type = db.Column(db.String(64))
    upload_time = db.Column(db.DateTime, default=datetime.utcnow)
    
    # 统计信息关联
    stats = db.relationship('ImageStat', backref='image', uselist=False, cascade="all, delete-orphan")

    def to_dict(self):
        return {
            'id': self.id,
            'filename': self.filename,
            'original_name': self.original_name,
            'size': self.size,
            'width': self.width,
            'height': self.height,
            'mime_type': self.mime_type,
            'upload_time': self.upload_time.isoformat(),
            'views': self.stats.view_count if self.stats else 0
        }

class ImageStat(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    image_id = db.Column(db.Integer, db.ForeignKey('image.id'), unique=True)
    view_count = db.Column(db.Integer, default=0)
    first_view = db.Column(db.DateTime)
    last_view = db.Column(db.DateTime)
    # 简化处理：Referer 可以记 top N 或最近的，这里为节省空间暂存最近一次非空 referer
    last_referer = db.Column(db.String(256))

class SystemConfig(db.Model):
    key = db.Column(db.String(64), primary_key=True)
    value = db.Column(db.String(256)) # 存储为字符串，取出时转换
    description = db.Column(db.String(256))
    
    @staticmethod
    def get(key, default=None, type_func=str):
        from extensions import db
        conf = db.session.get(SystemConfig, key)
        if conf:
            try:
                if type_func == bool:
                    return conf.value.lower() == 'true'
                return type_func(conf.value)
            except (ValueError, TypeError, AttributeError):
                return default
        return default

    @staticmethod
    def set(key, value, description=None):
        from extensions import db
        conf = db.session.get(SystemConfig, key)
        if not conf:
            conf = SystemConfig(key=key)
            db.session.add(conf)
        conf.value = str(value)
        if description:
            conf.description = description
        db.session.commit()

class InviteCode(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(20), unique=True, nullable=False, index=True)
    # is_used removed, verify logic is calculated
    max_uses = db.Column(db.Integer, default=1)
    current_uses = db.Column(db.Integer, default=0)
    expires_at = db.Column(db.DateTime, nullable=True)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    used_by_id = db.Column(db.Integer, db.ForeignKey('user.id')) # Last user or one of them (simplification)
    
    # For multiple users usage tracking, ideally we need ManyToMany. 
    # But for MVP, we just track 'last used by' or remove strict foreign key linking to a single user if we allow multi-use.
    # Let's keep used_by_id as 'created_by' or 'last_used_by', but for multi-use it's less relevant.
    # Let's drop used_by_id strict dependency for validity check.
    
    @property
    def is_valid(self):
        if self.current_uses >= self.max_uses:
            return False
        if self.expires_at and datetime.utcnow() > self.expires_at:
            return False
        return True

    def to_dict(self):
        return {
            'id': self.id,
            'code': self.code,
            'max_uses': self.max_uses,
            'current_uses': self.current_uses,
            'expires_at': self.expires_at.isoformat() if self.expires_at else None,
            'valid': self.is_valid,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
