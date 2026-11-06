#!/usr/bin/env python3
"""Poll a trusted Git branch and deploy an already provisioned Compose stack."""

import argparse
import fcntl
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from datetime import datetime, timezone


class DeploymentError(Exception):
    pass


class Deployer:
    def __init__(self, args, logger):
        self.repo = args.repo.resolve()
        self.state = args.state_dir.resolve()
        self.backups = (args.backup_dir or self.state / "backups").resolve()
        if self.state.is_relative_to(self.repo) or self.backups.is_relative_to(self.repo):
            raise DeploymentError("State and backup directories must be outside the checkout.")
        self.branch = args.branch
        self.health_timeout = args.health_timeout
        self.logger = logger
        self.compose = ["docker", "compose", "--project-directory", str(self.repo)]
        for file in args.compose_file or ["docker-compose.prod.yml"]:
            self.compose.extend(["-f", str(self.repo / file)])
        self.compose.extend(["--env-file", str(self.repo / args.env_file)])

    def run(self, command, *, capture=False, stdout=None, stdin=None):
        env = os.environ.copy()
        env["GIT_TERMINAL_PROMPT"] = "0"
        env.setdefault("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o ConnectTimeout=15")
        result = subprocess.run(
            command,
            cwd=self.repo,
            env=env,
            stdin=stdin,
            stdout=stdout if stdout is not None else subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        output = (result.stdout or b"").decode("utf-8", errors="replace")
        errors = result.stderr.decode("utf-8", errors="replace")
        if not capture or result.returncode:
            for line in (output + errors).splitlines():
                self.logger.info("%s", line)
        if result.returncode:
            raise DeploymentError(
                f"{command[0]} {command[1]} failed (exit {result.returncode})"
            )
        return output.strip()

    def git(self, *args):
        return self.run(["git", *args], capture=True)

    def require_clean_checkout(self):
        if self.git("status", "--porcelain", "--untracked-files=all"):
            raise DeploymentError(
                "Checkout has local changes or untracked files; refusing to deploy."
            )
        if self.git("symbolic-ref", "--short", "HEAD") != self.branch:
            raise DeploymentError(f"Checkout must be on branch {self.branch}.")

    def backup(self, target):
        self.backups.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.backups.chmod(0o700)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        fd, temporary = tempfile.mkstemp(
            prefix=f"{timestamp}-{target[:12]}-", suffix=".partial", dir=self.backups
        )
        temporary = Path(temporary)
        try:
            self.logger.info("Backing up Postgres before restarting the API")
            with os.fdopen(fd, "wb") as dump:
                self.run(
                    self.compose
                    + ["exec", "-T", "db", "pg_dump", "-U", "sharkulator", "-Fc", "sharkulator"],
                    stdout=dump,
                )
                dump.flush()
                os.fsync(dump.fileno())
            if temporary.stat().st_size == 0:
                raise DeploymentError("Database backup is empty.")
            with temporary.open("rb") as dump:
                self.run(
                    self.compose + ["exec", "-T", "db", "pg_restore", "--list"],
                    stdin=dump,
                    capture=True,
                )
            destination = temporary.with_suffix(".dump")
            os.replace(temporary, destination)
            self.logger.info("Database backup verified: %s", destination)
        finally:
            temporary.unlink(missing_ok=True)

    def record_success(self, target):
        fd, temporary = tempfile.mkstemp(prefix="deployed-", dir=self.state)
        try:
            with os.fdopen(fd, "w") as marker:
                marker.write(target + "\n")
                marker.flush()
                os.fsync(marker.fileno())
            os.replace(temporary, self.state / "deployed-commit")
        finally:
            Path(temporary).unlink(missing_ok=True)

    def deploy(self):
        # State must not accidentally suppress deployments for another checkout.
        binding = self.state / "checkout"
        if binding.exists() and binding.read_text().strip() != str(self.repo):
            raise DeploymentError("State directory belongs to another checkout.")
        binding.write_text(str(self.repo) + "\n")
        self.require_clean_checkout()
        self.logger.info("Fetching origin/%s", self.branch)
        self.git("check-ref-format", f"refs/heads/{self.branch}")
        self.git("fetch", "--no-tags", "origin", f"refs/heads/{self.branch}")
        target = self.git("rev-parse", "--verify", "FETCH_HEAD^{commit}")
        # Do this even if the marker matches: never accept local-only commits.
        try:
            self.git("merge-base", "--is-ancestor", "HEAD", target)
        except DeploymentError as error:
            raise DeploymentError(
                f"Checkout cannot fast-forward to origin/{self.branch}; refusing local-only history."
            ) from error
        marker = self.state / "deployed-commit"
        if marker.exists() and marker.read_text().strip() == target:
            self.logger.info("Already deployed %s; nothing to do", target)
            return
        # Check again after the fetch, before touching the working tree.
        self.require_clean_checkout()
        self.logger.info("Fast-forwarding checkout to %s", target)
        self.git("merge", "--ff-only", target)
        self.logger.info("Building API and web images (running containers stay up)")
        self.run(self.compose + ["build", "api", "web"])
        self.require_clean_checkout()
        if self.git("rev-parse", "HEAD") != target:
            raise DeploymentError("Checkout HEAD changed during the build; refusing to deploy.")
        self.backup(target)
        self.logger.info("Deploying API and web; waiting for health checks")
        self.run(
            self.compose
            + [
                "up", "-d", "--no-deps", "--no-build", "--wait",
                "--wait-timeout", str(self.health_timeout), "api", "web",
            ]
        )
        # --wait accepts 'running' for services without a healthcheck. Require
        # explicit healthy status for both services before advancing the marker.
        for service in ("api", "web"):
            container = self.run(
                self.compose + ["ps", "--all", "--quiet", service], capture=True
            )
            if not container or len(container.splitlines()) != 1:
                raise DeploymentError(f"Expected exactly one {service} container.")
            health = self.run(
                ["docker", "inspect", "--format", "{{.State.Health.Status}}", container],
                capture=True,
            )
            if health != "healthy":
                raise DeploymentError(f"{service} did not report healthy.")
        self.record_success(target)
        self.logger.info("Successfully deployed %s", target)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--backup-dir", type=Path)
    parser.add_argument("--branch", default="master")
    parser.add_argument("--compose-file", action="append")
    parser.add_argument("--env-file", default=".env.production")
    parser.add_argument("--health-timeout", type=int, default=180)
    args = parser.parse_args(argv)
    if args.health_timeout <= 0:
        parser.error("--health-timeout must be positive")
    return args


def main(argv=None):
    args = parse_args(argv)
    # Keep the process umask: Git and Docker builds inherit it, and an owner-only umask
    # makes checked-out files unreadable to nginx inside the web image.
    state = args.state_dir.resolve()
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    state.chmod(0o700)
    # flock is available on macOS/Linux through Python even without a flock CLI.
    # The OS releases the lock on exit/crash; never unlink the shared lock file.
    with (state / "deploy.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Another deployment is running; skipping this poll.", file=sys.stderr)
            return 0
        logger = logging.getLogger("sharkulator.deploy")
        logger.setLevel(logging.INFO)
        formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
        log_file = state / "deploy.log"
        handlers = [
            RotatingFileHandler(log_file, maxBytes=5_000_000, backupCount=3),
            logging.StreamHandler(),
        ]
        log_file.chmod(0o600)
        for handler in handlers:
            handler.setFormatter(formatter)
            logger.addHandler(handler)
        try:
            Deployer(args, logger).deploy()
            return 0
        except (DeploymentError, OSError, subprocess.SubprocessError) as error:
            logger.error("Deployment failed: %s. Successful-commit marker unchanged.", error)
            return 1
        finally:
            for handler in handlers:
                logger.removeHandler(handler)
                handler.close()


if __name__ == "__main__":
    sys.exit(main())
