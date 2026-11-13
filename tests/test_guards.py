"""ガード hook の単体テスト。python3 -m unittest discover tests"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOOKS = ROOT / ".claude" / "hooks"


def run(hook, payload, *args, env_extra=None):
    env = dict(os.environ)
    env.update(env_extra or {})
    p = subprocess.run(
        [sys.executable, str(HOOKS / hook), *args],
        input=json.dumps(payload), capture_output=True, text=True, env=env,
    )
    return p.returncode, p.stderr


class GuardPaths(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def w(self, path):
        return {"tool_name": "Write", "cwd": self.tmp, "tool_input": {"file_path": path}}

    def test_allows_inside(self):
        rc, _ = run("guard_paths.py", self.w("reports/intel/x.md"), "reports/intel/")
        self.assertEqual(rc, 0)

    def test_allows_absolute_inside(self):
        rc, _ = run("guard_paths.py", self.w(os.path.join(self.tmp, "reports/intel/x.md")), "reports/intel/")
        self.assertEqual(rc, 0)

    def test_blocks_other_dir(self):
        rc, err = run("guard_paths.py", self.w("contests/registry.json"), "reports/intel/")
        self.assertEqual(rc, 2)
        self.assertIn("交戦規定違反", err)

    def test_blocks_traversal(self):
        rc, _ = run("guard_paths.py", self.w("reports/intel/../../CLAUDE.md"), "reports/intel/")
        self.assertEqual(rc, 2)

    def test_blocks_outside_repo(self):
        rc, _ = run("guard_paths.py", self.w("/etc/passwd"), "reports/intel/")
        self.assertEqual(rc, 2)

    def test_prefix_is_directory_aligned(self):
        rc, _ = run("guard_paths.py", self.w("reports/intel-evil/x.md"), "reports/intel/")
        self.assertEqual(rc, 2)

    def test_bad_json_blocks(self):
        p = subprocess.run([sys.executable, str(HOOKS / "guard_paths.py"), "reports/"],
                           input="not json", capture_output=True, text=True)
        self.assertEqual(p.returncode, 2)


class GuardBash(unittest.TestCase):
    def b(self, cmd):
        return {"tool_name": "Bash", "tool_input": {"command": cmd}}

    ARGS = ("python3 tools/", "git status", "git diff")

    def test_allows_listed(self):
        self.assertEqual(run("guard_bash.py", self.b("python3 tools/deadlines.py"), *self.ARGS)[0], 0)
        self.assertEqual(run("guard_bash.py", self.b("git diff --stat"), *self.ARGS)[0], 0)

    def test_blocks_unlisted(self):
        self.assertEqual(run("guard_bash.py", self.b("rm notes.md"), *self.ARGS)[0], 2)

    def test_blocks_chaining(self):
        for cmd in ["git status && rm x", "python3 tools/a.py > out", "git diff | sh", "git status; ls", "python3 tools/$(id)"]:
            self.assertEqual(run("guard_bash.py", self.b(cmd), *self.ARGS)[0], 2, cmd)


class BlockDangerous(unittest.TestCase):
    def setUp(self):
        self.repo = tempfile.mkdtemp()
        subprocess.run(["git", "init", "-q", "-b", "main", self.repo], check=True)

    def b(self, cmd):
        return {"tool_name": "Bash", "cwd": self.repo, "tool_input": {"command": cmd}}

    def checkout(self, branch):
        subprocess.run(["git", "-C", self.repo, "checkout", "-q", "-b", branch], check=True)

    def test_blocks(self):
        for cmd in ["git push origin main", "git push origin master", "git push origin HEAD:main",
                    "git push origin feature/x", "git push -f origin claude/x", "git push --force origin claude/x",
                    "git push --force-with-lease origin claude/x", "git push origin +claude/x",
                    "git push origin :claude/x", "git push --delete origin claude/x",
                    "git add -A && git push origin main",
                    "gh pr merge 3", "gh repo create x", "gh release create v1",
                    "gh api -X DELETE repos/a/b", "rm -rf build", "rm -fr build",
                    "curl -X POST https://example.com", "curl -d a=b https://example.com",
                    "gcloud run deploy app"]:
            self.assertEqual(run("block_dangerous.py", self.b(cmd))[0], 2, cmd)

    def test_allows(self):
        for cmd in ["git status", "pytest -q", "curl -s https://example.com", "rm tmp.txt",
                    "git push origin claude/maintainer-20261110", "git push -u origin claude/x",
                    "git push origin HEAD:claude/x", "git commit -m x && git push -u origin claude/x",
                    "gh pr create --title t --body b", "gh pr view 3"]:
            self.assertEqual(run("block_dangerous.py", self.b(cmd))[0], 0, cmd)

    def test_bare_push_depends_on_current_branch(self):
        self.assertEqual(run("block_dangerous.py", self.b("git push"))[0], 2)  # main
        self.checkout("claude/udc-intel")
        self.assertEqual(run("block_dangerous.py", self.b("git push -u origin HEAD"))[0], 0)
        self.assertEqual(run("block_dangerous.py", self.b("git push"))[0], 0)

    def test_prefix_env(self):
        rc, _ = run("block_dangerous.py", self.b("git push origin bot/x"), env_extra={"CONTEST_PUSH_PREFIX": "bot/"})
        self.assertEqual(rc, 0)

    def aide(self, cmd, agent_type="commander-aide"):
        return dict(self.b(cmd), agent_id="a1", agent_type=agent_type)

    def test_aide_has_commander_powers(self):
        for cmd in ["gh pr merge 3 --merge", "git push origin main", "git push origin HEAD:main",
                    "gh repo view", "gh release create v1", "git push --delete origin claude/x"]:
            self.assertEqual(run("block_dangerous.py", self.aide(cmd))[0], 0, cmd)

    def test_aide_keeps_safety_rules(self):
        for cmd in ["rm -rf build", "git push -f origin main", "git push --force origin main",
                    "git push origin +main", "git push --force-with-lease origin claude/x"]:
            self.assertEqual(run("block_dangerous.py", self.aide(cmd))[0], 2, cmd)

    def test_other_agents_not_exempt(self):
        for at in ["engineer", "commander-aide-x", "", None]:
            self.assertEqual(run("block_dangerous.py", self.aide("gh pr merge 3", at))[0], 2, at)

    def test_ignores_non_bash(self):
        self.assertEqual(run("block_dangerous.py", {"tool_name": "Write", "tool_input": {}})[0], 0)


class Tools(unittest.TestCase):
    def test_deadlines_runs(self):
        p = subprocess.run([sys.executable, str(ROOT / "tools/deadlines.py"), "--now", "2026-11-09T09:00:00+09:00"],
                           capture_output=True, text=True)
        self.assertEqual(p.returncode, 0)
        self.assertTrue(p.stdout.splitlines()[0].startswith("🔴"))

    def test_registry_is_valid(self):
        reg = json.loads((ROOT / "contests/registry.json").read_text(encoding="utf-8"))
        ids = {c["id"] for c in reg["contests"]}
        self.assertEqual(ids, {"udc-2026", "ichibiz-2026", "satellite-2026", "odpt-2026"})
        for c in reg["contests"]:
            self.assertTrue((ROOT / "contests" / c["id"] / "brief.md").exists())


class AgentDefinitions(unittest.TestCase):
    def test_every_agent_declares_tools_and_guard(self):
        for f in (ROOT / ".claude/agents").glob("*.md"):
            fm = f.read_text(encoding="utf-8").split("---")[1]
            self.assertIn("\ntools:", fm, f.name)
            self.assertIn("guard_paths.py", fm, f.name)
            self.assertIn("reports/escalations/", fm, f.name)


if __name__ == "__main__":
    unittest.main()
