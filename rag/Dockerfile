FROM python:3.12-slim

WORKDIR /service

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py ./
COPY settings.py ./
COPY security.py ./
COPY worker.py ./
COPY eval_set.json ./
COPY prompt_injection_eval.json ./

ENV PYTHONUNBUFFERED=1
EXPOSE 8090

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8090"]



