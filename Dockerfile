# Multi-stage build for minimal production image
FROM python:3.11-slim AS base

WORKDIR /app

# Copy application files
COPY serve.py .
COPY index.html admin.html .
COPY css/ css/
COPY js/ js/
COPY data/ data/

# Create submissions directory if it doesn't exist
RUN mkdir -p data/submissions

# Expose both ports (admin and input)
EXPOSE 8080 8081

# Use exec form to handle signals correctly
CMD ["python3", "serve.py"]
