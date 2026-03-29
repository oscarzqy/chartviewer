FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Store the SQLite DB on a mounted volume so it persists across deploys
ENV CHARTVIEWER_DB_PATH=/data/ohlc_cache.db

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
