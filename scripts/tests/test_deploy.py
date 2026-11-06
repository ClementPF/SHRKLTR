import fcntl
import importlib.util
import logging
import os
from pathlib import Path
import plistlib
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch


spec = importlib.util.spec_from_file_location(
    "deploy", Path(__file__).resolve().parents[1] / "deploy.py"
)
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

TARGET = "a" * 40
PREVIOUS = "b" * 40


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.state = self.root / "state"
        self.state.mkdir()
        self.argv = ["--repo", str(self.repo), "--state-dir", str(self.state)]
        self.logger = Mock(spec=logging.Logger)
        self.deployer = deploy.Deployer(deploy.parse_args(self.argv), self.logger)
        self.marker = self.state / "deployed-commit"
        self.marker.write_text(PREVIOUS + "\n")
        self.calls = []
        self.dirty = False
        self.branch = "master"
        self.health = "healthy"
        self.failure = None
        self.dump = b"PGDMP-test-backup"
        self.expected_marker = PREVIOUS
        self.runner = patch.object(self.deployer, "run", side_effect=self.run_command)
        self.runner.start()
        self.addCleanup(self.runner.stop)

    def run_command(self, command, **kwargs):
        self.calls.append(command)
        if self.failure and self.failure in command:
            raise deploy.DeploymentError("simulated command failure")
        if command[0] == "git":
            if command[1] == "status":
                return "?? local-file" if self.dirty else ""
            if command[1] == "symbolic-ref":
                return self.branch
            if command[1] == "rev-parse":
                return TARGET
        if "pg_dump" in command:
            kwargs["stdout"].write(self.dump)
        if "pg_restore" in command:
            self.assertEqual(kwargs["stdin"].read(), self.dump)
        if "ps" in command:
            return "container-" + command[-1]
        if command[:2] == ["docker", "inspect"]:
            # The success marker must still be old while health is checked.
            if self.expected_marker is None:
                self.assertFalse(self.marker.exists())
            else:
                self.assertEqual(self.marker.read_text().strip(), self.expected_marker)
            return self.health
        return ""

    def index(self, token):
        return next(i for i, command in enumerate(self.calls) if token in command)

    def test_success_orders_backup_before_restart_and_marker_after_health(self):
        self.deployer.deploy()
        self.assertEqual(self.marker.read_text().strip(), TARGET)
        self.assertLess(self.index("build"), self.index("pg_dump"))
        self.assertLess(self.index("pg_dump"), self.index("pg_restore"))
        self.assertLess(self.index("pg_restore"), self.index("up"))
        self.assertLess(self.index("up"), self.index("inspect"))
        self.assertEqual(len(list((self.state / "backups").glob("*.dump"))), 1)
        up = self.calls[self.index("up")]
        for flag in ("--no-deps", "--no-build", "--wait"):
            self.assertIn(flag, up)
        self.assertNotIn("down", [arg for command in self.calls for arg in command])

    def test_successful_commit_skips_build_and_backup(self):
        self.marker.write_text(TARGET + "\n")
        self.deployer.deploy()
        self.assertFalse(any("build" in command for command in self.calls))
        self.assertFalse((self.state / "backups").exists())

    def test_no_marker_triggers_initial_deployment(self):
        self.marker.unlink()
        self.expected_marker = None
        self.deployer.deploy()
        self.assertTrue(any("up" in command for command in self.calls))
        self.assertEqual(self.marker.read_text().strip(), TARGET)

    def test_local_changes_are_refused_before_fetch(self):
        self.dirty = True
        with self.assertRaisesRegex(deploy.DeploymentError, "local changes"):
            self.deployer.deploy()
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.marker.read_text().strip(), PREVIOUS)

    def test_wrong_branch_is_refused(self):
        self.branch = "development"
        with self.assertRaisesRegex(deploy.DeploymentError, "branch master"):
            self.deployer.deploy()
        self.assertFalse(any("fetch" in command for command in self.calls))

    def test_diverged_history_is_refused_even_when_marker_matches(self):
        self.marker.write_text(TARGET + "\n")
        self.failure = "merge-base"
        with self.assertRaises(deploy.DeploymentError):
            self.deployer.deploy()
        self.assertFalse(any("merge" in command for command in self.calls))

    def test_failure_keeps_marker_and_next_poll_retries(self):
        for stage in ("fetch", "merge", "build", "pg_dump", "pg_restore", "up", "inspect"):
            with self.subTest(stage=stage):
                self.failure = stage
                with self.assertRaises(deploy.DeploymentError):
                    self.deployer.deploy()
                self.assertEqual(self.marker.read_text().strip(), PREVIOUS)
                self.assertFalse(list((self.state / "backups").glob("*.partial")))
        self.failure = None
        self.deployer.deploy()
        self.assertEqual(self.marker.read_text().strip(), TARGET)

    def test_build_failure_does_not_back_up_or_restart(self):
        self.failure = "build"
        with self.assertRaises(deploy.DeploymentError):
            self.deployer.deploy()
        self.assertFalse(any("pg_dump" in command or "up" in command for command in self.calls))

    def test_build_timeout_kills_group_logs_output_and_retries(self):
        process = Mock(pid=12345, returncode=-9)
        process.communicate.side_effect = [
            subprocess.TimeoutExpired("docker compose build", 900),
            (b"partial build output\n", b"credential helper stalled\n"),
        ]

        def run(command, **kwargs):
            if "build" in command:
                self.calls.append(command)
                return deploy.Deployer.run(self.deployer, command, **kwargs)
            return self.run_command(command, **kwargs)

        self.deployer.run.side_effect = run
        with patch.object(deploy.subprocess, "Popen", return_value=process) as popen:
            with patch.object(deploy.os, "killpg") as killpg:
                with self.assertRaisesRegex(deploy.DeploymentError, "timed out after 900"):
                    self.deployer.deploy()
        self.assertTrue(popen.call_args.kwargs["start_new_session"])
        process.communicate.assert_any_call(timeout=900)
        killpg.assert_called_once_with(12345, deploy.signal.SIGKILL)
        self.assertEqual(process.communicate.call_count, 2)
        messages = [
            call.args[0] % call.args[1:] for call in self.logger.info.call_args_list
        ]
        self.assertIn("partial build output", messages)
        self.assertIn("credential helper stalled", messages)
        self.assertEqual(self.marker.read_text().strip(), PREVIOUS)
        self.assertFalse(any("pg_dump" in command or "up" in command for command in self.calls))
        self.deployer.run.side_effect = self.run_command
        self.deployer.deploy()
        self.assertEqual(self.marker.read_text().strip(), TARGET)

    def test_timeout_handles_process_group_already_exited(self):
        process = Mock(pid=12345, returncode=0)
        process.communicate.side_effect = [
            subprocess.TimeoutExpired("build", 1), (b"", b""),
        ]
        with patch.object(deploy.subprocess, "Popen", return_value=process):
            with patch.object(deploy.os, "killpg", side_effect=ProcessLookupError):
                with self.assertRaisesRegex(deploy.DeploymentError, "timed out"):
                    deploy.Deployer.run(self.deployer, ["docker", "compose"], timeout=1)

    def test_real_timeout_kills_child_holding_output_pipes_open(self):
        # Both processes would hold the pipes open for 10 seconds if only the
        # parent were killed. No Docker or production resources are involved.
        child = "import time; print('child ready', flush=True); time.sleep(10)"
        parent = (
            "import subprocess, sys, time; "
            f"subprocess.Popen([sys.executable, '-c', {child!r}]); "
            "time.sleep(10)"
        )
        started = time.monotonic()
        with self.assertRaisesRegex(deploy.DeploymentError, "timed out"):
            deploy.Deployer.run(
                self.deployer, [sys.executable, "-c", parent], timeout=1
            )
        self.assertLess(time.monotonic() - started, 5)
        messages = [call.args[1] for call in self.logger.info.call_args_list]
        self.assertIn("child ready", messages)

    def test_build_timeout_configuration(self):
        self.assertEqual(self.deployer.build_timeout, 900)
        args = deploy.parse_args(self.argv + ["--build-timeout", "1200"])
        self.assertEqual(deploy.Deployer(args, self.logger).build_timeout, 1200)
        for value in ("0", "-1", "invalid"):
            with self.subTest(value=value), patch("sys.stderr"):
                with self.assertRaises(SystemExit):
                    deploy.parse_args(self.argv + ["--build-timeout", value])

    def test_timed_command_success_and_failure(self):
        for code in (0, 1):
            process = Mock(returncode=code)
            process.communicate.return_value = (b"build output\n", b"build error\n")
            with self.subTest(code=code):
                with patch.object(deploy.subprocess, "Popen", return_value=process):
                    if code:
                        with self.assertRaisesRegex(deploy.DeploymentError, "exit 1"):
                            deploy.Deployer.run(
                                self.deployer, ["docker", "compose"], timeout=10
                            )
                    else:
                        self.assertEqual(
                            deploy.Deployer.run(
                                self.deployer, ["docker", "compose"], timeout=10
                            ),
                            "build output",
                        )

    def test_invalid_or_failed_backup_prevents_restart(self):
        for failure in ("pg_dump", "pg_restore"):
            with self.subTest(failure=failure):
                self.calls.clear()
                self.failure = failure
                with self.assertRaises(deploy.DeploymentError):
                    self.deployer.deploy()
                self.assertFalse(any("up" in command for command in self.calls))
        self.failure = None
        self.dump = b""
        with self.assertRaisesRegex(deploy.DeploymentError, "empty"):
            self.deployer.deploy()
        self.assertFalse(any("up" in command for command in self.calls))

    def test_unhealthy_container_cannot_advance_marker(self):
        self.health = "unhealthy"
        with self.assertRaisesRegex(deploy.DeploymentError, "healthy"):
            self.deployer.deploy()
        self.assertEqual(self.marker.read_text().strip(), PREVIOUS)

    def test_backups_are_preserved_across_retries(self):
        self.failure = "up"
        for _ in range(2):
            with self.assertRaises(deploy.DeploymentError):
                self.deployer.deploy()
        self.assertEqual(len(list((self.state / "backups").glob("*.dump"))), 2)

    def test_compose_overrides_and_backup_directory(self):
        args = deploy.parse_args(
            self.argv
            + [
                "--compose-file", "docker-compose.prod.yml",
                "--compose-file", "docker-compose.lan.yml",
                "--backup-dir", str(self.root / "external-backups"),
            ]
        )
        configured = deploy.Deployer(args, self.logger)
        self.assertEqual(configured.compose.count("-f"), 2)
        self.assertIn(str(self.repo / "docker-compose.lan.yml"), configured.compose)
        self.assertEqual(configured.backups, self.root / "external-backups")

    def test_state_cannot_be_reused_for_another_checkout(self):
        (self.state / "checkout").write_text("/another/checkout\n")
        with self.assertRaisesRegex(deploy.DeploymentError, "another checkout"):
            self.deployer.deploy()
        self.assertFalse(self.calls)

    def test_state_and_backups_cannot_live_inside_checkout(self):
        for option in ("--state-dir", "--backup-dir"):
            with self.subTest(option=option):
                args = deploy.parse_args(self.argv + [option, str(self.repo / "state")])
                with self.assertRaisesRegex(deploy.DeploymentError, "outside"):
                    deploy.Deployer(args, self.logger)

    def test_changes_during_build_prevent_backup_and_restart(self):
        def run(command, **kwargs):
            result = self.run_command(command, **kwargs)
            if "build" in command:
                self.dirty = True
            return result

        self.deployer.run.side_effect = run
        with self.assertRaisesRegex(deploy.DeploymentError, "local changes"):
            self.deployer.deploy()
        self.assertFalse(any("pg_dump" in command or "up" in command for command in self.calls))

    def test_os_lock_skips_overlapping_deployments_and_releases_on_exit(self):
        with (self.state / "deploy.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch.object(deploy.Deployer, "deploy") as run:
                self.assertEqual(deploy.main(self.argv), 0)
                run.assert_not_called()
        with patch.object(deploy.Deployer, "deploy") as run:
            self.assertEqual(deploy.main(self.argv), 0)
            run.assert_called_once()

    def test_failure_is_logged_and_returns_nonzero(self):
        with patch.object(
            deploy.Deployer, "deploy", side_effect=deploy.DeploymentError("build failed")
        ):
            self.assertEqual(deploy.main(self.argv), 1)
        log = (self.state / "deploy.log").read_text()
        self.assertIn("Deployment failed: build failed", log)
        self.assertIn("marker unchanged", log)
        self.assertEqual(self.marker.read_text().strip(), PREVIOUS)
        with patch.object(deploy.Deployer, "deploy") as run:
            self.assertEqual(deploy.main(self.argv), 0)
            run.assert_called_once()

    def test_main_keeps_process_umask_and_state_stays_private(self):
        previous = os.umask(0o022)
        self.addCleanup(os.umask, previous)
        with patch.object(deploy.Deployer, "deploy"):
            self.assertEqual(deploy.main(self.argv), 0)
        current = os.umask(0o022)
        self.assertEqual(current, 0o022)
        self.assertEqual(stat.S_IMODE(self.state.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((self.state / "deploy.log").stat().st_mode), 0o600)

    def test_backups_are_private(self):
        self.deployer.deploy()
        backups = self.state / "backups"
        self.assertEqual(stat.S_IMODE(backups.stat().st_mode), 0o700)
        for dump in backups.glob("*.dump"):
            self.assertEqual(stat.S_IMODE(dump.stat().st_mode), 0o600)

    def test_command_failure_logs_output(self):
        with patch("subprocess.run") as run:
            run.return_value = subprocess.CompletedProcess(
                ["docker", "compose"], 1, b"build output\n", b"build error\n"
            )
            with self.assertRaises(deploy.DeploymentError):
                deploy.Deployer.run(self.deployer, ["docker", "compose", "build"])
        messages = [call.args[1] for call in self.logger.info.call_args_list]
        self.assertIn("build output", messages)
        self.assertIn("build error", messages)

    def test_real_git_refuses_untracked_and_staged_files_but_allows_ignored_env(self):
        subprocess.run(
            ["git", "init", "--quiet", "--initial-branch=master", str(self.repo)], check=True
        )
        (self.repo / ".git/info/exclude").write_text(".env.production\n")
        (self.repo / ".env.production").write_text("TEST_VALUE=not-a-secret\n")
        self.runner.stop()
        # This exercises Git for real, but never contacts a remote or runs Docker.
        self.deployer.require_clean_checkout()
        file = self.repo / "local.txt"
        file.write_text("local work\n")
        with self.assertRaisesRegex(deploy.DeploymentError, "local changes"):
            self.deployer.require_clean_checkout()
        subprocess.run(["git", "-C", str(self.repo), "add", "local.txt"], check=True)
        with self.assertRaisesRegex(deploy.DeploymentError, "local changes"):
            self.deployer.require_clean_checkout()

    def test_documented_launchd_schedule_is_valid(self):
        documentation = (Path(__file__).resolve().parents[2] / "SELF-HOSTING.md").read_text()
        xml = documentation.split("```xml\n", 1)[1].split("\n```", 1)[0]
        agent = plistlib.loads(xml.encode())
        self.assertEqual(agent["StartInterval"], 60)
        self.assertTrue(agent["RunAtLoad"])
        self.assertIn("--repo", agent["ProgramArguments"])
        self.assertIn("--state-dir", agent["ProgramArguments"])
        self.assertIn("Docker.app", agent["EnvironmentVariables"]["PATH"])
        self.assertEqual(
            agent["EnvironmentVariables"]["DOCKER_CONFIG"],
            "/Users/YOU/.config/sharkulator-deploy-docker",
        )
        self.assertEqual(
            agent["EnvironmentVariables"]["DOCKER_HOST"],
            "unix:///Users/YOU/.docker/run/docker.sock",
        )


if __name__ == "__main__":
    unittest.main()
