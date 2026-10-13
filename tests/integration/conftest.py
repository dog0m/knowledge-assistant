# tests/integration/conftest.py
"""全链路集成测试的公共夹具。

这些用例会启动真实的 PostgreSQL 和 Qdrant 容器，因此需要本机可用的 Docker。
没有 Docker 或没装 testcontainers 时，整个目录会被跳过，不影响普通单元测试。
"""
import os
import sys
from pathlib import Path

import pytest

# 把仓库根目录加入 sys.path，便于 `from rag import main` 这种导入方式。
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


@pytest.fixture(scope="session")
def postgres_url():
    """启动一个一次性 PostgreSQL 容器，会话结束后自动销毁。"""
    from testcontainers.postgres import PostgresContainer

    with PostgresContainer("postgres:16-alpine", driver=None) as container:
        yield {
            "host": container.get_container_host_ip(),
            "port": str(container.get_exposed_port(5432)),
            "dbname": container.dbname,
            "user": container.username,
            "password": container.password,
        }


@pytest.fixture(scope="session")
def qdrant_url():
    """启动一个一次性 Qdrant 容器，提供真实向量检索能力。"""
    from testcontainers.core.container import DockerContainer
    from testcontainers.core.waiting_utils import wait_for_logs

    container = DockerContainer("qdrant/qdrant:v1.19.1").with_exposed_ports(6333)
    container.start()
    try:
        wait_for_logs(container, "Access web UI", timeout=60)
    except Exception:
        # 日志文案随版本变化，等待失败时不致命，后续健康检查仍会兜底。
        pass
    yield f"http://{container.get_container_host_ip()}:{container.get_exposed_port(6333)}"
    container.stop()


@pytest.fixture(scope="session")
def rag_service(postgres_url, qdrant_url, tmp_path_factory):
    """在真实容器之上导入 rag.main，并把向量计算替换成确定性实现。

    Embedding 需要 Ollama，CI 里不方便起大模型，所以这里 monkeypatch 掉 embed_texts，
    但数据库、任务队列、Qdrant 写入与检索过滤都走真实组件，仍能覆盖完整链路。
    """
    os.environ["DB_HOST"] = postgres_url["host"]
    os.environ["DB_PORT"] = postgres_url["port"]
    os.environ["DB_NAME"] = postgres_url["dbname"]
    os.environ["DB_USER"] = postgres_url["user"]
    os.environ["DB_PASSWORD"] = postgres_url["password"]
    os.environ["QDRANT_URL"] = qdrant_url
    os.environ["DOCUMENT_DATA_DIR"] = str(tmp_path_factory.mktemp("documents"))
    os.environ["QDRANT_COLLECTION"] = "it_knowledge_chunks"

    # 关键：测试模块在收集阶段可能已经导入过 rag.main，而 settings 是 @lru_cache 的，
    # qdrant 客户端也在模块级创建。必须彻底清掉模块缓存（含 rag 包本身，否则
    # `from rag import main` 会命中父包上的旧属性），再用 importlib 重新导入。
    import importlib

    for name in [item for item in sys.modules if item == "rag" or item.startswith("rag.") or item in {"main", "settings", "security"}]:
        sys.modules.pop(name, None)
    rag_main = importlib.import_module("rag.main")

    # 固定 8 维向量：词命中越多，对应维度越大，便于断言"相关文档得分更高"。
    async def fake_embed(texts):
        vectors = []
        for text in texts:
            vector = [0.0] * 8
            for token in rag_main.search_tokens(text):
                vector[sum(ord(ch) for ch in token) % 8] += 1.0
            norm = sum(value * value for value in vector) ** 0.5 or 1.0
            vectors.append([value / norm for value in vector])
        return vectors

    rag_main.embed_texts = fake_embed
    rag_main.init_database()
    # 每个集合只建一次，后续测试复用。
    rag_main.ensure_collection(8)
    return rag_main
