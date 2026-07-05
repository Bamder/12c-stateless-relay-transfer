from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

import httpx

from .admin_keys import is_placeholder_key

ServiceName = Literal["registry", "relay"]
LAUNCH_LOG_NAME = ".console-launch.log"
CREATE_BREAKAWAY_FROM_JOB = 0x01000000


@dataclass(frozen=True)
class ServiceLaunchConfig:
    registry_dir: Path
    relay_dir: Path
    registry_config: Path
    relay_config: Path
    registry_health_url: str
    relay_health_url: str
    registry_admin_api_key: str = ""
    relay_admin_api_key: str = ""
    python_executable: str | None = None


class ProcessManager:
    def __init__(self, config: ServiceLaunchConfig) -> None:
        self._config = config
        self._registry_proc: subprocess.Popen[bytes] | None = None
        self._relay_proc: subprocess.Popen[bytes] | None = None

    async def close(self) -> None:
        for name in ("registry", "relay"):
            proc = getattr(self, f"_{name}_proc")
            if proc is not None and proc.poll() is None:
                await self.stop(name)

    async def status(self) -> dict[str, object]:
        registry_health, relay_health = await asyncio.gather(
            self._health_ok(self._config.registry_health_url),
            self._health_ok(self._config.relay_health_url),
        )
        registry_port_pid, relay_port_pid = await asyncio.gather(
            asyncio.to_thread(self._find_pid_on_port, self._port_for("registry")),
            asyncio.to_thread(self._find_pid_on_port, self._port_for("relay")),
        )
        return {
            "registry": self._service_status(
                "registry",
                registry_health,
                self._registry_proc,
                registry_port_pid,
            ),
            "relay": self._service_status(
                "relay",
                relay_health,
                self._relay_proc,
                relay_port_pid,
            ),
            "scannedAt": time.time(),
        }

    async def start(self, service: ServiceName, *, detached: bool = False) -> dict[str, object]:
        health_url = (
            self._config.registry_health_url
            if service == "registry"
            else self._config.relay_health_url
        )
        if await self._health_ok(health_url):
            return {"result": "already_running", "service": service}

        proc_attr = "_registry_proc" if service == "registry" else "_relay_proc"
        existing = getattr(self, proc_attr)
        if existing is not None and existing.poll() is None:
            ready = await self._wait_for_health(health_url)
            if ready:
                return {
                    "result": "already_running",
                    "service": service,
                    "pid": existing.pid,
                }

        service_dir, config_path, module = self._service_paths(service)
        if not service_dir.is_dir():
            raise FileNotFoundError(f"{service} directory not found: {service_dir}")

        await asyncio.to_thread(self._ensure_dependencies, service_dir)
        child_env = await asyncio.to_thread(
            self._prepare_service_runtime,
            service,
            config_path,
        )

        python = self._resolve_python(service_dir)
        cmd = [python, "-m", module, "--config", str(config_path)]
        proc, log_path = self._spawn(cmd, service_dir, child_env, detached=detached)
        if not detached:
            setattr(self, proc_attr, proc)

        ready = await self._wait_for_health(health_url)
        if not ready:
            log_excerpt = self._read_launch_log(log_path)
            if proc.poll() is not None:
                detail = log_excerpt or f"exit code {proc.returncode}"
                if not detached:
                    setattr(self, proc_attr, None)
                raise RuntimeError(
                    f"{service} exited before becoming healthy: {detail}",
                )
            detail = log_excerpt or "no log output"
            if not detached:
                setattr(self, proc_attr, None)
            raise RuntimeError(
                f"{service} started (pid {proc.pid}) but health check timed out: {detail}",
            )

        result: dict[str, object] = {
            "result": "started",
            "service": service,
            "pid": proc.pid,
        }
        if detached:
            result["detached"] = True
        return result

    async def stop(self, service: ServiceName) -> dict[str, object]:
        health_url = (
            self._config.registry_health_url
            if service == "registry"
            else self._config.relay_health_url
        )
        proc_attr = "_registry_proc" if service == "registry" else "_relay_proc"
        proc = getattr(self, proc_attr)

        if not await self._health_ok(health_url):
            if proc is not None and proc.poll() is None:
                await self._terminate_proc(proc)
            setattr(self, proc_attr, None)
            return {"result": "already_stopped", "service": service}

        pid: int | None = None
        if proc is not None and proc.poll() is None:
            pid = proc.pid
            await self._terminate_proc(proc)
            setattr(self, proc_attr, None)
        else:
            port = self._port_for(service)
            pid = await asyncio.to_thread(self._find_pid_on_port, port)
            if pid is None:
                return {"result": "already_stopped", "service": service}
            await asyncio.to_thread(self._kill_pid, pid)

        if not await self._wait_for_health_down(health_url):
            raise RuntimeError(
                f"{service} stop requested but still responding to health check",
            )

        return {"result": "stopped", "service": service, "pid": pid}

    def _service_paths(
        self,
        service: ServiceName,
    ) -> tuple[Path, Path, str]:
        if service == "registry":
            return (
                self._config.registry_dir,
                self._config.registry_config,
                "registry_server",
            )
        return (
            self._config.relay_dir,
            self._config.relay_config,
            "relay_server",
        )

    def _service_status(
        self,
        service: ServiceName,
        healthy: bool,
        proc: subprocess.Popen[bytes] | None,
        port_pid: int | None,
    ) -> dict[str, object]:
        managed = proc is not None and proc.poll() is None
        if managed:
            return {
                "service": service,
                "running": healthy,
                "managed": True,
                "external": False,
                "pid": proc.pid,
            }

        external = healthy and port_pid is not None
        return {
            "service": service,
            "running": healthy,
            "managed": False,
            "external": external,
            "pid": port_pid if external else None,
        }

    def _ensure_dependencies(self, service_dir: Path) -> None:
        requirements = service_dir / "requirements.txt"
        if not requirements.is_file():
            return
        python = self._resolve_python(service_dir)
        pip = self._resolve_pip(python)
        subprocess.run(
            [*pip, "install", "-r", str(requirements), "-q"],
            cwd=str(service_dir),
            capture_output=True,
            check=False,
        )

    def _resolve_python(self, service_dir: Path) -> str:
        if sys.platform == "win32":
            venv_python = service_dir / ".venv" / "Scripts" / "python.exe"
        else:
            venv_python = service_dir / ".venv" / "bin" / "python"
        if venv_python.is_file():
            return str(venv_python)
        if self._config.python_executable:
            return self._config.python_executable
        return sys.executable

    def _resolve_pip(self, python: str) -> list[str]:
        pip_path = Path(python).parent / ("pip.exe" if sys.platform == "win32" else "pip")
        if pip_path.is_file():
            return [str(pip_path)]
        return [python, "-m", "pip"]

    def _prepare_service_runtime(
        self,
        service: ServiceName,
        config_path: Path,
    ) -> dict[str, str]:
        service_dir = config_path.parent
        example_name = (
            "registry_server.config.example.json"
            if service == "registry"
            else "relay_server.config.example.json"
        )
        example_path = service_dir / example_name
        if not config_path.is_file():
            if not example_path.is_file():
                raise FileNotFoundError(
                    f"{service} config not found: {config_path}",
                )
            shutil.copy(example_path, config_path)

        with config_path.open(encoding="utf-8") as handle:
            data = json.load(handle)
        if not isinstance(data, dict):
            raise ValueError(f"{config_path} root must be a JSON object")

        base_dir = config_path.parent

        def resolve_path(value: object) -> Path | None:
            if not isinstance(value, str) or not value:
                return None
            path = Path(value)
            return path if path.is_absolute() else (base_dir / path).resolve()

        dirs: set[Path] = set()
        if service == "registry":
            db_path = resolve_path(data.get("databasePath", "./data/registry.db"))
            if db_path is not None:
                dirs.add(db_path.parent)
        else:
            for key in ("databasePath", "dataDir", "secretsDir"):
                path = resolve_path(data.get(key))
                if path is None:
                    continue
                dirs.add(path if key == "dataDir" else path.parent)
            for key in (
                "relayRsaKeyPath",
                "registryApiKeyStorePath",
                "blockAuthKeyStorePath",
            ):
                path = resolve_path(data.get(key))
                if path is not None:
                    dirs.add(path.parent)

        for directory in dirs:
            directory.mkdir(parents=True, exist_ok=True)

        child_env: dict[str, str] = {}
        if service == "registry" and not is_placeholder_key(
            self._config.registry_admin_api_key,
        ):
            child_env["REGISTRY_ADMIN_API_KEY"] = (
                self._config.registry_admin_api_key.strip()
            )
        if service == "relay" and not is_placeholder_key(self._config.relay_admin_api_key):
            child_env["RELAY_ADMIN_API_KEY"] = self._config.relay_admin_api_key.strip()
        return child_env

    def _spawn(
        self,
        cmd: list[str],
        cwd: Path,
        child_env: dict[str, str] | None = None,
        *,
        detached: bool = False,
    ) -> tuple[subprocess.Popen[bytes], Path]:
        log_path = cwd / LAUNCH_LOG_NAME
        log_handle = log_path.open("wb")
        env = os.environ.copy()
        if child_env:
            env.update(child_env)
        kwargs: dict[str, object] = {
            "cwd": str(cwd),
            "stdout": log_handle,
            "stderr": subprocess.STDOUT,
            "env": env,
        }
        if detached:
            if sys.platform == "win32":
                kwargs["creationflags"] = (
                    subprocess.CREATE_NO_WINDOW
                    | subprocess.DETACHED_PROCESS
                    | subprocess.CREATE_NEW_PROCESS_GROUP
                    | CREATE_BREAKAWAY_FROM_JOB
                )
            else:
                kwargs["start_new_session"] = True
        elif sys.platform == "win32":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
        else:
            kwargs["start_new_session"] = True
        try:
            proc = subprocess.Popen(cmd, **kwargs)
        finally:
            log_handle.close()
        return proc, log_path

    def _read_launch_log(self, log_path: Path, max_chars: int = 2000) -> str:
        if not log_path.is_file():
            return ""
        text = log_path.read_text(encoding="utf-8", errors="replace")
        return text[-max_chars:].strip()

    async def _health_ok(self, url: str) -> bool:
        try:
            async with httpx.AsyncClient(timeout=2.0, trust_env=False) as client:
                response = await client.get(url)
                if response.status_code != 200:
                    return False
                payload = response.json()
                if isinstance(payload, dict):
                    return (
                        payload.get("status") == "ok"
                        and payload.get("dbReady", True) is True
                    )
                return True
        except Exception:
            return False

    async def _wait_for_health(
        self,
        url: str,
        *,
        attempts: int = 40,
        interval: float = 0.5,
    ) -> bool:
        for _ in range(attempts):
            if await self._health_ok(url):
                return True
            await asyncio.sleep(interval)
        return False

    async def _wait_for_health_down(
        self,
        url: str,
        *,
        attempts: int = 20,
        interval: float = 0.25,
    ) -> bool:
        for _ in range(attempts):
            if not await self._health_ok(url):
                return True
            await asyncio.sleep(interval)
        return False

    async def _terminate_proc(self, proc: subprocess.Popen[bytes]) -> None:
        proc.terminate()
        try:
            await asyncio.to_thread(proc.wait, timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            await asyncio.to_thread(proc.wait)

    def _port_for(self, service: ServiceName) -> int:
        url = (
            self._config.registry_health_url
            if service == "registry"
            else self._config.relay_health_url
        )
        parsed = urlparse(url)
        if parsed.port is not None:
            return parsed.port
        return 443 if parsed.scheme == "https" else 80

    def _find_pid_on_port(self, port: int) -> int | None:
        if sys.platform == "win32":
            result = subprocess.run(
                ["netstat", "-ano"],
                capture_output=True,
                text=True,
                check=False,
            )
            suffix = f":{port}"
            for line in result.stdout.splitlines():
                if "LISTENING" not in line:
                    continue
                parts = line.split()
                if len(parts) < 5:
                    continue
                if parts[1].endswith(suffix):
                    return int(parts[-1])
            return None

        for command in (
            ["lsof", "-ti", f":{port}"],
            ["fuser", "-n", "tcp", str(port)],
        ):
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                check=False,
            )
            if result.returncode != 0 or not result.stdout.strip():
                continue
            first = result.stdout.strip().split()[0]
            if first.isdigit():
                return int(first)
        return None

    def _kill_pid(self, pid: int) -> None:
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                capture_output=True,
                check=False,
            )
            return
        subprocess.run(["kill", "-TERM", str(pid)], capture_output=True, check=False)
