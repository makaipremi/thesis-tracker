"""OpenTimestamps proofs for thesis posts. Runs in CI (the `ots` client doesn't work on Windows).

    python scripts/stamp.py stamp     # stamp every post version that has no proof yet
    python scripts/stamp.py upgrade   # attach Bitcoin confirmations to pending proofs

Each version of a post gets its own proof, named by the SHA-256 of the file:
    proofs/<thread>/<post>/<sha256>.ots
Editing a post therefore adds a new proof; earlier proofs are never touched, so every
version stays provable with the file content from git history.
"""

from __future__ import annotations

import hashlib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
THESES = ROOT / "src" / "content" / "theses"
PROOFS = ROOT / "proofs"

# Tag that marks a Bitcoin block-header attestation inside an .ots file. Pending
# proofs only carry calendar attestations until `ots upgrade` adds this.
BITCOIN_TAG = bytes.fromhex("0588960d73d71901")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def proof_path(post: Path, digest: str) -> Path:
    rel = post.relative_to(THESES)  # <thread>/<post>.md
    return PROOFS / rel.parent / rel.stem / f"{digest}.ots"


def is_confirmed(proof: Path) -> bool:
    return BITCOIN_TAG in proof.read_bytes()


def posts() -> list[Path]:
    return sorted(THESES.glob("*/*.md"))


def ots(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["ots", *args], capture_output=True, text=True)


def stamp() -> int:
    stamped = 0
    for post in posts():
        digest = sha256(post)
        target = proof_path(post, digest)
        if target.exists():
            continue
        # Stamp a copy so the proof's name doesn't depend on the post's file name.
        with tempfile.TemporaryDirectory() as tmp:
            copy = Path(tmp) / digest
            shutil.copyfile(post, copy)
            result = ots("stamp", str(copy))
            if result.returncode != 0:
                print(f"FAILED {post.relative_to(ROOT)}: {result.stderr.strip()}")
                return 1
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(copy) + ".ots", target)
        stamped += 1
        print(f"stamped {post.relative_to(ROOT)} -> {target.relative_to(ROOT)}")
    print(f"{stamped} new proof(s)")
    return 0


def upgrade() -> int:
    pending = [p for p in sorted(PROOFS.rglob("*.ots")) if not is_confirmed(p)]
    upgraded = 0
    for proof in pending:
        ots("upgrade", str(proof))  # non-zero while Bitcoin hasn't confirmed yet; that's expected
        backup = proof.with_name(proof.name + ".bak")
        if backup.exists():
            backup.unlink()
        if is_confirmed(proof):
            upgraded += 1
            print(f"confirmed {proof.relative_to(ROOT)}")
    print(f"{upgraded} of {len(pending)} pending proof(s) confirmed")
    return 0


if __name__ == "__main__":
    commands = {"stamp": stamp, "upgrade": upgrade}
    if len(sys.argv) != 2 or sys.argv[1] not in commands:
        sys.exit(f"usage: {sys.argv[0]} stamp|upgrade")
    sys.exit(commands[sys.argv[1]]())
