---
name: image-tools
description: >
  Process and analyze images. Use when user sends an image and you need to analyze it
  more deeply. Steps: identify image format, extract metadata, or run OCR if needed.

---

## Image Processing

When a user sends you an image and asks about its content:

1. The image is already available to you. Describe what you see naturally.

2. If you need OCR (text from image), use `bash` with tesseract:
   ```
   tesseract "image_path.jpg" /tmp/ocr_output
   ```
   Then `read` the output file.

3. For image format info or metadata, use:
   ```
   bash: file "image_path.jpg"
   bash: identify "image_path.jpg"  (requires ImageMagick)
   ```

4. To resize or convert images before sending:
   ```
   bash: convert "input.jpg" -resize 50% "output.jpg"
   ```

5. Reply to the user naturally in WeChat style after processing.
