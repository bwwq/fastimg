import os
import uuid
import imghdr
from PIL import Image, ImageDraw, ImageFont, ImageOps
# Prevent DecompressionBombError for large images, but set a reasonable limit (e.g. 100M pixels)
Image.MAX_IMAGE_PIXELS = 100_000_000
from werkzeug.utils import secure_filename
from flask import current_app
from models import SystemConfig

def validate_image_header(stream):
    header = stream.read(512)
    stream.seek(0)
    format = None
    
    if header.startswith(b'\xff\xd8\xff'):
        format = 'jpeg'
    elif header.startswith(b'\x89PNG\r\n\x1a\n'):
        format = 'png'
    elif header.startswith(b'GIF87a') or header.startswith(b'GIF89a'):
        format = 'gif'
    elif header.startswith(b'RIFF') and b'WEBP' in header:
        format = 'webp'
        
    return format

def add_watermark(image):
    """Add text watermark to image if configured"""
    text = SystemConfig.get('WATERMARK_TEXT')
    if not text:
        return image
        
    # Create watermark layer
    txt_layer = Image.new('RGBA', image.size, (255,255,255,0))
    d = ImageDraw.Draw(txt_layer)
    
    # Calculate font size (5% of height)
    font_size = max(20, int(image.height * 0.05))
    try:
        # Use default font or custom if available
        font = ImageFont.truetype("arial.ttf", font_size)
    except IOError:
        font = ImageFont.load_default()

    # Calculate text position (bottom right with padding)
    try:
        bbox = d.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
    except AttributeError:
        # Fallback for older Pillow
        text_w, text_h = d.textsize(text, font=font)
        
    x = image.width - text_w - 20
    y = image.height - text_h - 20
    
    # Draw text
    opacity = int(SystemConfig.get('WATERMARK_OPACITY', 128))
    d.text((x, y), text, font=font, fill=(255, 255, 255, opacity))
    
    # Composite
    if image.mode != 'RGBA':
        image = image.convert('RGBA')
    return Image.alpha_composite(image, txt_layer).convert('RGB')

def process_and_save_image(file_storage, user_id, user_quality=None):
    # 1. Validate Header
    fmt = validate_image_header(file_storage.stream)
    if not fmt:
        raise ValueError("Invalid image definition")
        
    filename = secure_filename(file_storage.filename)
    # 扩展名检查
    ext = os.path.splitext(filename)[1].lower().lstrip('.')
    # Split with comma and strip spaces
    allowed_exts_str = SystemConfig.get('ALLOWED_EXTS')
    if not allowed_exts_str:
        allowed_exts_str = 'jpg,jpeg,png,gif,webp'
    allowed_exts = [x.strip() for x in allowed_exts_str.split(',')]
    
    if ext not in allowed_exts and fmt not in allowed_exts:
         raise ValueError(f"File type not allowed: {ext}")

    # Check Size (0 = Unlimited)
    max_mb_str = SystemConfig.get('MAX_UPLOAD_SIZE')
    try:
        max_mb = float(max_mb_str) if max_mb_str and max_mb_str != 'None' else 0
    except (ValueError, TypeError):
        max_mb = 0  # Default to unlimited if invalid
        
    if max_mb > 0:
        # Seek end to get size if content_length missing
        file_storage.stream.seek(0, os.SEEK_END)
        size = file_storage.stream.tell()
        file_storage.stream.seek(0)
        
        if size > max_mb * 1024 * 1024:
             raise ValueError(f"File too large. Max {max_mb}MB")
    else:
        # Reset stream position just in case
        file_storage.stream.seek(0)

    # 2. Open Image
    try:
        img = Image.open(file_storage.stream)
        # Fix orientation (EXIF) - also removes EXIF by default when saving new
        img = ImageOps.exif_transpose(img) 
    except Exception:
        raise ValueError("Broken image file")

    # 3. Process (WebP Convert config)
    original_fmt = img.format or (fmt.upper() if fmt else 'JPEG')
    target_fmt = original_fmt
    
    enable_webp = SystemConfig.get('ENABLE_WEBP_CONVERT', 'false') == 'true'
    if enable_webp and fmt in ['jpeg', 'png']:
        target_fmt = 'WEBP'
        ext = 'webp'
    
    # 4. Watermark (Skip for GIF)
    if fmt != 'gif':
        img = add_watermark(img)

    # 5. Save
    # Unique filename
    unique_name = f"{uuid.uuid4().hex}.{ext}"
    save_path = os.path.join(current_app.config['UPLOAD_FOLDER'], unique_name)
    
    # Compress Quality: admin limit from config, user can choose up to that limit
    admin_quality_str = SystemConfig.get('compress_quality')
    try:
        admin_quality = int(admin_quality_str) if admin_quality_str else 80
    except (ValueError, TypeError):
        admin_quality = 80
    
    # Use user quality if provided, but cap at admin limit
    if user_quality is not None:
        quality = min(max(int(user_quality), 10), admin_quality)
    else:
        quality = admin_quality
    
    if fmt == 'gif':
        # Save GIF frames
        img.save(save_path, save_all=True, optimize=True)
    else:
        # Save static
        if img.mode == 'RGBA' and target_fmt == 'JPEG':
            img = img.convert('RGB')
        img.save(save_path, format=target_fmt, quality=quality, optimize=True)

    # Get Stats
    file_size = os.path.getsize(save_path)
    width, height = img.size
    
    return {
        'filename': unique_name,
        'original_name': filename,
        'size': file_size,
        'width': width,
        'height': height,
        'mime_type': f"image/{ext}"
    }
