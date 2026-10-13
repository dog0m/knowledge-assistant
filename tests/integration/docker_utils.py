# tests/integration/docker_utils.py
"""集成测试的 Docker 可用性探测。

不要只检查 `docker` 命令是否存在：在容器里跑测试时可能没有 CLI，
但只要挂载了 Docker socket（DOCKER_HOST 指向它）依然可以启动容器。
因此这里直接尝试构造 Testcontainers 客户端并 ping 守护进程。
"""
import importlib.util


def docker_available() -> bool:
    """装了 testcontainers 且能连上 Docker 守护进程时返回 True。"""
    if importlib.util.find_spec("testcontainers") is None:
        return False
    try:
        from testcontainers.core.docker_client import DockerClient

        # ping() 是到守护进程的真实往返，比检查可执行文件更可靠。
        DockerClient().client.ping()
        return True
    except Exception:
        return False
