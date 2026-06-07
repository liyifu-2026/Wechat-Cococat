---
name: pdf-tools
description: >
  Handle PDF files. Use when user sends a PDF file path or asks about PDF content.
  Steps: use bash with pdftotext to extract text from PDF, then read the output file,
  then summarize and reply in WeChat style.

---

## PDF Processing

When a user provides a PDF file path or asks you to extract content from a PDF:

1. Use `bash` to convert the PDF to text:
   ```
   pdftotext -layout "filepath.pdf" /tmp/output.txt
   ```
   If pdftotext is not installed, install it first:
   ```
   bash: choco install pdftotext  (Windows)
   bash: apt-get install poppler-utils  (Linux)
   ```

2. Use `read` to read the generated text file.

3. Summarize the key points from the PDF and reply to the user casually in WeChat style.
   Keep it brief - just the most important information.

4. If the user asks about specific parts, use `grep` to find relevant sections.
