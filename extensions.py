from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_migrate import Migrate

db = SQLAlchemy()
login_manager = LoginManager()
migrate = Migrate()

# 使用 get_remote_address 作为默认的 key_func
# 注意：如果有反向代理，需要自行处理 header，或者在 utils 中重写获取真实 IP 的逻辑
limiter = Limiter(key_func=get_remote_address)

@login_manager.user_loader
def load_user(user_id):
    from models import User
    return User.query.get(int(user_id))

login_manager.login_view = 'api_login'  # 前后端分离其实不需要这个，但为了完整性先留着
