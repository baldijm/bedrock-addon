#!/usr/bin/env python3
"""Start or stop the Bedrock child owned by the persistent production bridge."""

from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path


BRIDGE_SERVICE = "spb-production-bridge.service"
STATE_FILE = Path("/run/spb-production-bridge/bedrock.pid")
STOP_MARKER = STATE_FILE.with_name("desired-stopped")


def child_running() -> bool:
    try:
        pid = int(STATE_FILE.read_text(encoding="ascii").strip())
        os.kill(pid, 0)
    except (FileNotFoundError, ProcessLookupError, PermissionError, ValueError):
        return False
    return True


def set_running(wanted: bool, timeout: int = 75) -> None:
    if wanted:
        STOP_MARKER.unlink(missing_ok=True)
        ready_deadline = time.monotonic() + min(timeout, 10)
        while time.monotonic() < ready_deadline:
            if child_running():
                return
            time.sleep(0.1)
    else:
        STOP_MARKER.touch(mode=0o644, exist_ok=True)
    if child_running() == wanted:
        return
    signal = "SIGUSR2" if wanted else "SIGUSR1"
    subprocess.run(
        ["/bin/systemctl", "kill", "--kill-who=main", f"--signal={signal}", BRIDGE_SERVICE],
        check=True,
        timeout=10,
    )
    deadline = time.monotonic() + timeout
    while child_running() != wanted:
        if time.monotonic() >= deadline:
            state = "iniciara" if wanted else "se detuviera"
            raise RuntimeError(f"Se agotó el tiempo esperando que Bedrock {state}.")
        time.sleep(0.25)


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in {"start", "stop"}:
        raise SystemExit("Uso: bedrock-production-control.py start|stop")
    set_running(sys.argv[1] == "start")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
