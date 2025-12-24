import os

class Config:
    # 基础安全配置
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'dev-secret-key-change-me'
    
    # 数据库配置
    basedir = os.path.abspath(os.path.dirname(__file__))
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL') or \
        'sqlite:///' + os.path.join(basedir, 'database.db')
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # 上传配置
    UPLOAD_FOLDER = os.path.join(basedir, 'uploads')
    MAX_CONTENT_LENGTH = 100 * 1024 * 1024  # Flask Limit increased to 100MB, app logic handles specific limits
    ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'}
    
    # 业务默认配置 (初始值，后续优先读取数据库配置)
    DEFAULT_MAX_UPLOAD_SIZE = 5 * 1024 * 1024  # 5MB
    DEFAULT_COMPRESS_QUALITY = 80
    DEFAULT_COMPRESS_MIN = 30
    DEFAULT_COMPRESS_MAX = 95
    DEFAULT_USER_QUOTA = 100 * 1024 * 1024  # 100MB

    # 限流配置 (Flask-Limiter)
    RATELIMIT_DEFAULT = "200 per day"
    RATELIMIT_STORAGE_URL = "memory://"
    RATELIMIT_HEADERS_ENABLED = True
    
    # Session 安全
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'
    
    # 在生产环境开启这些
    # SESSION_COOKIE_SECURE = True 

    @staticmethod
    def init_app(app):
        if not os.path.exists(Config.UPLOAD_FOLDER):
            os.makedirs(Config.UPLOAD_FOLDER)
