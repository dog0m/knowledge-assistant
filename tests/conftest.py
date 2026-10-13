"""Test import shim.

本地以 rag 包导入，容器内模块位于 /service 根目录，这里统一两种路径。
"""
import sys
from pathlib import Path

_SERVICE = Path("/service")
if _SERVICE.exists() and str(_SERVICE) not in sys.path:
    sys.path.insert(0, str(_SERVICE))
