"""Centralized RAG configuration loaded once at startup."""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    document_data_dir: str = "/data/documents"
    qdrant_url: str = "http://qdrant:6333"
    qdrant_collection: str = "knowledge_chunks"
    ollama_base_url: str = "http://ollama:11434"
    ollama_embed_model: str = "bge-m3"
    ollama_model: str = "llama3.2:3b"
    model_provider: str = "ollama"
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"
    openai_api_key: str = ""
    rag_chunk_size: int = 900
    rag_chunk_overlap: int = 120
    rag_max_retries: int = 3
    rag_min_score: float = 0.25
    rag_chunk_strategy: str = "fixed"
    rag_retrieval_mode: str = "hybrid"
    rag_rerank_limit: int = 20
    agent_max_tool_calls: int = 3
    rag_evaluation_file: str = "/service/eval_set.json"
    eval_reports_dir: str = "/service/evals/reports"
    rag_max_upload_bytes: int = 50 * 1024 * 1024
    internal_api_key: str = ""
    rerank_model: str = "BAAI/bge-reranker-base"
    enable_cross_encoder: bool = False
    rerank_candidate_limit: int = 30
    injection_warning_threshold: int = 1

@lru_cache
def get_settings() -> Settings:
    return Settings()




