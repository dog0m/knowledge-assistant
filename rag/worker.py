"""阶段 5 异步索引 worker。

worker 复用 main.py 的解析、Embedding 和索引函数；任务状态写入 PostgreSQL，
因此 app 重启或 worker 重启后仍能看到 queued/processing/failed 状态。
"""

import asyncio
import json
from pathlib import Path

from main import db_connection, get_document, index_document, init_database, parse_document, queue_reindex_for_collection_migration, scan_prompt_injection, update_status


def claim_job():
    """用事务锁领取一个任务，避免多个 worker 同时处理同一文档。"""
    with db_connection() as conn:
        # worker 意外退出后，超过 10 分钟未更新的 processing 任务可重新入队。
        conn.execute(
            """UPDATE document_jobs SET status='queued',updated_at=NOW()
               WHERE status='processing' AND updated_at < NOW() - INTERVAL '10 minutes'"""
        )
        row = conn.execute(
            """WITH next_job AS (
                SELECT id FROM document_jobs WHERE status='queued' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1
            )
            UPDATE document_jobs SET status='processing', attempts=attempts+1, updated_at=NOW()
            WHERE id IN (SELECT id FROM next_job)
            RETURNING id, document_id"""
        ).fetchone()
        conn.commit()
        return row


def finish_job(job_id, document_id, status, error=None):
    with db_connection() as conn:
        conn.execute(
            "UPDATE document_jobs SET status=%s,error_message=%s,updated_at=NOW() WHERE id=%s",
            (status, error, job_id),
        )
        conn.commit()


async def process_job(job_id, document_id):
    document = get_document(str(document_id))
    if not document:
        finish_job(job_id, document_id, "failed", "document not found")
        return
    update_status(str(document_id), "processing", error_message=None)
    # worker 扫描解析出的真实文档文本，兼顾 PDF/DOCX，不依赖上传扩展名。
    full_text = " ".join(page.get("text", "") for page in parse_document(Path(document["stored_path"])))
    injection_flags = sorted(set(scan_prompt_injection(full_text)))
    with db_connection() as conn:
        conn.execute("UPDATE documents SET injection_flags=%s::jsonb,injection_detected=%s,updated_at=NOW() WHERE id=%s", (json.dumps(injection_flags), bool(injection_flags), document_id))
        conn.commit()
    document["injection_flags"] = injection_flags
    try:
        count = await index_document(document)
        update_status(str(document_id), "ready", chunk_count=count, error_message=None)
        finish_job(job_id, document_id, "succeeded")
    except Exception as exc:
        update_status(str(document_id), "failed", error_message=str(exc))
        finish_job(job_id, document_id, "failed", str(exc))


async def main_loop():
    init_database()
    queue_reindex_for_collection_migration()
    while True:
        job = claim_job()
        if job:
            await process_job(job[0], job[1])
        else:
            await asyncio.sleep(1)


if __name__ == "__main__":
    asyncio.run(main_loop())


