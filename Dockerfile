FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends poppler-utils \
    && rm -rf /var/lib/apt/lists/*

COPY . .

ENV HOST=0.0.0.0
ENV PORT=10000

CMD ["python3", "backend/server.py"]
