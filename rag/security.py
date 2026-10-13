"""Prompt-injection scanning and evidence boundary helpers.

The scanner marks suspicious content for audit; it never treats a document as
instructions. Model prompts receive source text inside explicit untrusted tags.
"""
import re
from typing import Any

PATTERNS = {
    "ignore_instructions": re.compile(r"ignore\s+(all\s+)?(previous|prior|above)\s+instructions?|忽略(之前|以上|所有).{0,12}(指令|规则)|无视(之前|以上).{0,12}指令", re.I),
    "reveal_prompt_or_secret": re.compile(r"reveal\s+(the\s+)?(system\s+prompt|prompt|secret|api\s*key|password)|输出.{0,12}(系统提示|密钥|密码)|泄露.{0,12}(提示词|密钥|密码)", re.I),
    "role_override": re.compile(r"you\s+are\s+now\s+(an?\s+)?(admin|developer|system)|developer\s+mode|扮演(管理员|系统)|进入开发者模式", re.I),
    "access_bypass": re.compile(r"bypass\s+(access|permission|security)|ignore\s+access\s+control|绕过(权限|访问控制|安全策略)|越权读取", re.I),
    "tool_or_data_exfiltration": re.compile(r"dump\s+(all\s+)?(documents|database|environment)|print\s+all\s+users|导出全部(文档|用户|数据库)|读取所有用户", re.I),
}


def scan_prompt_injection(text: str) -> list[str]:
    """Return stable rule identifiers, never echoing matched document text."""
    return [name for name, pattern in PATTERNS.items() if pattern.search(text or "")]


def mark_untrusted_sources(sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Annotate retrieval results so prompt construction can delimit source data."""
    marked = []
    for source in sources:
        item = dict(source)
        flags = item.get("injection_flags") or scan_prompt_injection(str(item.get("text", "")))
        item["injection_flags"] = flags
        item["untrusted_content"] = True
        marked.append(item)
    return marked


def format_untrusted_context(sources: list[dict[str, Any]]) -> str:
    """Wrap every retrieved passage as quoted data, not executable instructions."""
    sections = []
    for index, source in enumerate(sources, start=1):
        flags = ",".join(source.get("injection_flags") or []) or "none"
        sections.append(
            f"<UNTRUSTED_SOURCE index=\"{index}\" file=\"{source.get('filename', '')}\" "
            f"page=\"{source.get('page') or ''}\" injection_flags=\"{flags}\">\n"
            f"{source.get('text', '')}\n</UNTRUSTED_SOURCE>"
        )
    return "\n\n".join(sections)
