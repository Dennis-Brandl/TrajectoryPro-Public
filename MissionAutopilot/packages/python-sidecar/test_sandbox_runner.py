# Copyright 2026 Dennis L. Brandl
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
test_sandbox_runner.py — End-to-end tests for sandbox_runner.py.

Spawns sandbox_runner.py as a subprocess and communicates via stdin/stdout
JSON to verify the full protocol end-to-end.

Run with:
    python -m unittest test_sandbox_runner -v
    python test_sandbox_runner.py
"""

import json
import os
import subprocess
import sys
import unittest


# Resolve path to sandbox_runner.py (same directory as this test file)
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_RUNNER = os.path.join(_THIS_DIR, "sandbox_runner.py")


def send_request(proc, request_dict):
    """Send a JSON request to the worker and read one JSON response."""
    line = json.dumps(request_dict) + "\n"
    proc.stdin.write(line)
    proc.stdin.flush()
    response_line = proc.stdout.readline()
    return json.loads(response_line)


def _spawn():
    """Spawn a fresh sandbox_runner.py subprocess."""
    return subprocess.Popen(
        [sys.executable, "-u", _RUNNER],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )


class TestSandboxRunner(unittest.TestCase):
    """Integration tests against a single long-lived sandbox_runner subprocess."""

    @classmethod
    def setUpClass(cls):
        cls.proc = _spawn()

    @classmethod
    def tearDownClass(cls):
        cls.proc.stdin.close()
        cls.proc.terminate()
        cls.proc.wait(timeout=5)

    # ------------------------------------------------------------------
    # Happy-path tests
    # ------------------------------------------------------------------

    def test_happy_path_returns_true(self):
        """Success response with correct outputs when execute() returns True."""
        source = (
            "def execute(inputs, outputs, props, action_props):\n"
            '    outputs["greeting"] = "hello " + inputs.get("name", "world")\n'
            "    return True\n"
        )
        resp = send_request(
            self.proc,
            {
                "request_id": "t-happy",
                "source_code": source,
                "inputs": {"name": "Alice"},
                "outputs": {},
            },
        )
        self.assertTrue(resp["success"])
        self.assertTrue(resp["return_value"])
        self.assertEqual(resp["outputs"]["greeting"], "hello Alice")

    def test_return_false_for_hold(self):
        """Return value False signals code-initiated hold; success is still True."""
        source = (
            "def execute(inputs, outputs, props, action_props):\n"
            "    return False\n"
        )
        resp = send_request(
            self.proc,
            {"request_id": "t-false", "source_code": source, "inputs": {}, "outputs": {}},
        )
        self.assertTrue(resp["success"])
        self.assertFalse(resp["return_value"])

    # ------------------------------------------------------------------
    # Error-path tests
    # ------------------------------------------------------------------

    def test_syntax_error(self):
        """Syntax errors in user code produce error_type SYNTAX_ERROR."""
        # Missing colon after function signature
        source = "def execute(inputs, outputs, props, action_props)\n    return True\n"
        resp = send_request(
            self.proc,
            {"request_id": "t-syntax", "source_code": source, "inputs": {}, "outputs": {}},
        )
        self.assertFalse(resp["success"])
        self.assertEqual(resp["error_type"], "SYNTAX_ERROR")
        self.assertIn("SyntaxError", resp["error"])
        self.assertTrue(len(resp["traceback"]) > 0)

    def test_runtime_error(self):
        """Runtime exceptions produce error_type RUNTIME_ERROR with details."""
        source = (
            "def execute(inputs, outputs, props, action_props):\n"
            '    raise ValueError("bad input")\n'
        )
        resp = send_request(
            self.proc,
            {"request_id": "t-runtime", "source_code": source, "inputs": {}, "outputs": {}},
        )
        self.assertFalse(resp["success"])
        self.assertEqual(resp["error_type"], "RUNTIME_ERROR")
        self.assertIn("ValueError", resp["error"])
        self.assertIn("bad input", resp["error"])
        self.assertTrue(len(resp["traceback"]) > 0)

    def test_missing_execute_function(self):
        """Code without execute() function produces RUNTIME_ERROR mentioning 'execute'."""
        source = "x = 42\n"
        resp = send_request(
            self.proc,
            {"request_id": "t-noexec", "source_code": source, "inputs": {}, "outputs": {}},
        )
        self.assertFalse(resp["success"])
        self.assertEqual(resp["error_type"], "RUNTIME_ERROR")
        self.assertIn("execute", resp["error"])

    # ------------------------------------------------------------------
    # Capture tests
    # ------------------------------------------------------------------

    def test_stdout_capture(self):
        """print() output is captured in stdout_capture, not mixed into JSON protocol."""
        source = (
            "def execute(inputs, outputs, props, action_props):\n"
            '    print("debug info")\n'
            "    return True\n"
        )
        resp = send_request(
            self.proc,
            {"request_id": "t-stdout", "source_code": source, "inputs": {}, "outputs": {}},
        )
        self.assertTrue(resp["success"])
        self.assertEqual(resp["stdout_capture"], "debug info\n")

    def test_stderr_capture(self):
        """stderr output (print(..., file=sys.stderr)) is captured in stderr_capture."""
        source = (
            "import sys\n"
            "def execute(inputs, outputs, props, action_props):\n"
            '    print("warning", file=sys.stderr)\n'
            "    return True\n"
        )
        resp = send_request(
            self.proc,
            {"request_id": "t-stderr", "source_code": source, "inputs": {}, "outputs": {}},
        )
        self.assertTrue(resp["success"])
        self.assertEqual(resp["stderr_capture"], "warning\n")

    # ------------------------------------------------------------------
    # Outputs accumulation tests
    # ------------------------------------------------------------------

    def test_outputs_mutation(self):
        """User code mutations to outputs dict are reflected in the response."""
        source = (
            "def execute(inputs, outputs, props, action_props):\n"
            '    outputs["a"] = "1"\n'
            '    outputs["b"] = "2"\n'
            "    return True\n"
        )
        resp = send_request(
            self.proc,
            {"request_id": "t-mut", "source_code": source, "inputs": {}, "outputs": {}},
        )
        self.assertTrue(resp["success"])
        self.assertEqual(resp["outputs"], {"a": "1", "b": "2"})

    def test_outputs_accumulation(self):
        """Accumulated outputs from prior states are passed through and extendable."""
        source = (
            "def execute(inputs, outputs, props, action_props):\n"
            '    outputs["new"] = outputs.get("prior", "") + "_extended"\n'
            "    return True\n"
        )
        resp = send_request(
            self.proc,
            {
                "request_id": "t-accum",
                "source_code": source,
                "inputs": {},
                "outputs": {"prior": "value"},
            },
        )
        self.assertTrue(resp["success"])
        self.assertEqual(resp["outputs"]["prior"], "value")
        self.assertEqual(resp["outputs"]["new"], "value_extended")

    def test_outputs_preserved_on_runtime_error(self):
        """Outputs mutations made before a raise survive into the error response.

        Bug: previously the RUNTIME_ERROR branch returned outputs: {}, so user
        code that set outputs['status']='1' then raised would lose that status
        — the engine had no way to know what the action achieved before failure.
        """
        source = (
            "def execute(inputs, outputs, props, action_props):\n"
            '    outputs["status"] = "1"\n'
            '    outputs["progress"] = "reached"\n'
            '    raise RuntimeError("boom")\n'
        )
        resp = send_request(
            self.proc,
            {
                "request_id": "t-mut-on-raise",
                "source_code": source,
                "inputs": {},
                "outputs": {},
            },
        )
        self.assertFalse(resp["success"])
        self.assertEqual(resp["error_type"], "RUNTIME_ERROR")
        self.assertIn("RuntimeError", resp["error"])
        self.assertIn("boom", resp["error"])
        self.assertEqual(resp["outputs"], {"status": "1", "progress": "reached"})

    # ------------------------------------------------------------------
    # Worker loop / protocol tests
    # ------------------------------------------------------------------

    def test_multiple_sequential_requests(self):
        """Worker handles multiple sequential requests without restarting."""
        source = (
            "def execute(inputs, outputs, props, action_props):\n"
            '    outputs["n"] = inputs.get("n", "?")\n'
            "    return True\n"
        )
        for i in range(3):
            resp = send_request(
                self.proc,
                {
                    "request_id": f"t-multi-{i}",
                    "source_code": source,
                    "inputs": {"n": str(i)},
                    "outputs": {},
                },
            )
            self.assertTrue(resp["success"], f"Request {i} failed")
            self.assertEqual(resp["outputs"]["n"], str(i), f"Wrong output for request {i}")

    def test_execution_time_ms(self):
        """execution_time_ms is a non-negative number."""
        source = (
            "def execute(inputs, outputs, props, action_props):\n"
            "    return True\n"
        )
        resp = send_request(
            self.proc,
            {"request_id": "t-timing", "source_code": source, "inputs": {}, "outputs": {}},
        )
        self.assertTrue(resp["success"])
        self.assertIsInstance(resp["execution_time_ms"], (int, float))
        self.assertGreaterEqual(resp["execution_time_ms"], 0)

    def test_request_id_passthrough(self):
        """Response request_id matches the sent request_id."""
        source = (
            "def execute(inputs, outputs, props, action_props):\n"
            "    return True\n"
        )
        resp = send_request(
            self.proc,
            {"request_id": "my-test-id", "source_code": source, "inputs": {}, "outputs": {}},
        )
        self.assertEqual(resp["request_id"], "my-test-id")

    def test_props_and_action_props_passed(self):
        """environment_action_properties and action_properties are accessible in user code."""
        source = (
            "def execute(inputs, outputs, props, action_props):\n"
            '    outputs["env_prop"] = str(props.get("Config", {}).get("Host", ""))\n'
            '    outputs["act_prop"] = str(action_props.get("Setting", {}).get("Value", ""))\n'
            "    return True\n"
        )
        resp = send_request(
            self.proc,
            {
                "request_id": "t-props",
                "source_code": source,
                "inputs": {},
                "outputs": {},
                "environment_action_properties": {"Config": {"Host": "my-host"}},
                "action_properties": {"Setting": {"Value": "my-value"}},
            },
        )
        self.assertTrue(resp["success"])
        self.assertEqual(resp["outputs"]["env_prop"], "my-host")
        self.assertEqual(resp["outputs"]["act_prop"], "my-value")

    def test_invalid_json_request(self):
        """Non-JSON input produces an error response with request_id null, not a crash."""
        # Write invalid JSON directly to the process stdin
        self.proc.stdin.write("this is not json\n")
        self.proc.stdin.flush()
        response_line = self.proc.stdout.readline()
        resp = json.loads(response_line)
        self.assertFalse(resp["success"])
        self.assertIsNone(resp["request_id"])
        self.assertEqual(resp["error_type"], "RUNTIME_ERROR")

    # ------------------------------------------------------------------
    # Safe encoding, bounded capture, failures keep output and mutations
    # ------------------------------------------------------------------

    def _run(self, body, props=None, request_id="t-new"):
        source = "def execute(inputs, outputs, props, action_props):\n" + "".join(
            "    " + ln + "\n" for ln in body.split("\n")
        )
        req = {"request_id": request_id, "source_code": source, "inputs": {}, "outputs": {}}
        if props is not None:
            req["environment_action_properties"] = props
        return send_request(self.proc, req)

    def test_unencodable_output_names_key_and_keeps_others(self):
        resp = self._run(
            "import datetime\n"
            "outputs['ok'] = '1'\n"
            "outputs['started'] = datetime.datetime(2026, 1, 1)\n"
            "return True"
        )
        self.assertFalse(resp["success"])
        self.assertEqual(resp["error_type"], "RUNTIME_ERROR")
        self.assertEqual(
            resp["error"],
            "outputs['started'] is a datetime, which cannot be sent as JSON — convert it to a string",
        )
        self.assertEqual(resp["outputs"], {"ok": "1"})

    def test_unencodable_nested_output_says_contains(self):
        resp = self._run(
            "import datetime\n"
            "outputs['cfg'] = {'t': datetime.datetime(2026, 1, 1)}\n"
            "return True"
        )
        self.assertFalse(resp["success"])
        self.assertTrue(resp["error"].startswith("outputs['cfg'] contains a datetime"), resp["error"])

    def test_unencodable_return_value(self):
        resp = self._run("return {1, 2}")
        self.assertFalse(resp["success"])
        self.assertEqual(resp["error"], "the return value is a set, which cannot be sent as JSON")

    def test_none_and_string_return_values_still_succeed(self):
        self.assertTrue(self._run("return None")["success"])
        self.assertTrue(self._run("return 'ok'")["success"])

    def test_non_ascii_output_succeeds(self):
        resp = self._run("outputs['name'] = 'Grüße'\nreturn True")
        self.assertTrue(resp["success"])
        self.assertEqual(resp["outputs"]["name"], "Grüße")

    def test_runtime_error_keeps_stdout_stderr_and_mutations(self):
        resp = self._run(
            "import sys\n"
            "print('before')\n"
            "print('warn', file=sys.stderr)\n"
            "set_property('SIM', 'Mode', 'fast')\n"
            "raise RuntimeError('boom')",
            props={"SIM": {"Mode": "slow"}},
        )
        self.assertFalse(resp["success"])
        self.assertIn("before", resp["stdout_capture"])
        self.assertIn("warn", resp["stderr_capture"])
        self.assertEqual(
            resp["property_mutations"],
            [{"spec_name": "SIM", "entry_name": "Mode", "value": "fast"}],
        )

    def test_unencodable_result_keeps_mutations(self):
        resp = self._run(
            "import datetime\n"
            "set_property('SIM', 'Mode', 'fast')\n"
            "outputs['t'] = datetime.datetime(2026, 1, 1)\n"
            "return True",
            props={"SIM": {"Mode": "slow"}},
        )
        self.assertFalse(resp["success"])
        self.assertEqual(
            resp["property_mutations"],
            [{"spec_name": "SIM", "entry_name": "Mode", "value": "fast"}],
        )

    def test_syntax_error_response_has_capture_fields(self):
        resp = send_request(
            self.proc,
            {"request_id": "t-syn", "source_code": "def execute(:\n", "inputs": {}, "outputs": {}},
        )
        self.assertFalse(resp["success"])
        self.assertEqual(resp["stdout_capture"], "")
        self.assertIn("stderr_capture", resp)

    def test_capture_is_bounded_while_running(self):
        resp = self._run("print('é' * 200000)\nreturn True")
        out = resp["stdout_capture"]
        self.assertLessEqual(len(out.encode("utf-8")), 64 * 1024 + 80)
        self.assertTrue(out.endswith("bytes not captured]"), out[-60:])
        self.assertTrue(out.endswith("[stdout truncated: 334465 bytes not captured]"), out[-60:])
        self.assertNotIn("�", out)

    def test_failed_run_with_unencodable_output_keeps_original_error(self):
        resp = self._run(
            "import datetime\n"
            "outputs['t'] = datetime.datetime(2026, 1, 1)\n"
            "raise RuntimeError('real reason')"
        )
        self.assertFalse(resp["success"])
        self.assertEqual(resp["error_type"], "RUNTIME_ERROR")
        self.assertTrue(resp["error"].startswith("RuntimeError: real reason"), resp["error"])
        self.assertIn("outputs['t'] is a datetime", resp["error"])
        self.assertNotIn("t", resp["outputs"])

    def test_failed_property_write_keeps_error_type_with_unencodable_output(self):
        resp = self._run(
            "import datetime\n"
            "outputs['t'] = datetime.datetime(2026, 1, 1)\n"
            "set_property('NOPE', 'x', 'y')",
            props={},
        )
        self.assertEqual(resp["error_type"], "PROPERTY_WRITE_ERROR")
        self.assertIn("outputs['t'] is a datetime", resp["error"])

    def test_non_string_output_key_fails_keeping_capture_and_mutations(self):
        resp = self._run(
            "print('hello')\n"
            "set_property('SIM', 'Mode', 'fast')\n"
            "outputs[(1, 2)] = 'x'\n"
            "outputs['ok'] = '1'\n"
            "return True",
            props={"SIM": {"Mode": "slow"}},
        )
        self.assertFalse(resp["success"])
        self.assertIn("outputs[(1, 2)] has a key that cannot be sent as JSON", resp["error"])
        self.assertIn("use a string key", resp["error"])
        self.assertEqual(resp["outputs"], {"ok": "1"})
        self.assertIn("hello", resp["stdout_capture"])
        self.assertEqual(
            resp["property_mutations"],
            [{"spec_name": "SIM", "entry_name": "Mode", "value": "fast"}],
        )

    def test_unencodable_container_without_type_says_contains_a_value(self):
        resp = self._run("outputs['cfg'] = {(1,): 1}\nreturn True")
        self.assertFalse(resp["success"])
        self.assertEqual(
            resp["error"],
            "outputs['cfg'] contains a value that cannot be sent as JSON — convert it to a string",
        )

    def test_nan_output_fails_as_float(self):
        resp = self._run("outputs['x'] = float('nan')\nreturn True")
        self.assertFalse(resp["success"])
        self.assertEqual(
            resp["error"],
            "outputs['x'] is a float, which cannot be sent as JSON — convert it to a string",
        )

    def test_sys_exit_is_a_runtime_error_keeping_capture_and_mutations(self):
        resp = self._run(
            "print('bye')\n"
            "set_property('SIM', 'Mode', 'fast')\n"
            "import sys\n"
            "sys.exit(3)",
            props={"SIM": {"Mode": "slow"}},
        )
        self.assertFalse(resp["success"])
        self.assertEqual(resp["error_type"], "RUNTIME_ERROR")
        self.assertEqual(resp["error"], "SystemExit: 3")
        self.assertIn("bye", resp["stdout_capture"])
        self.assertEqual(
            resp["property_mutations"],
            [{"spec_name": "SIM", "entry_name": "Mode", "value": "fast"}],
        )

    def test_exception_whose_str_raises_still_fails_cleanly(self):
        resp = self._run(
            "class Bad(Exception):\n"
            "    def __str__(self):\n"
            "        raise ValueError('no str')\n"
            "raise Bad()"
        )
        self.assertFalse(resp["success"])
        self.assertEqual(resp["error_type"], "RUNTIME_ERROR")
        self.assertIn("Bad", resp["error"])
        self.assertIn("<unprintable error>", resp["error"])

    def test_zz_runner_survives_and_answers_next_request(self):
        resp = self._run("return True", request_id="t-after")
        self.assertTrue(resp["success"])
        self.assertEqual(resp["request_id"], "t-after")


if __name__ == "__main__":
    unittest.main(verbosity=2)


# ------------------------------------------------------------------
# Direct-unit tests for run_user_code_with_mutations (pytest-style)
# ------------------------------------------------------------------

def test_set_property_emits_mutation_log():
    """set_property is available as a global and records a mutation."""
    source = """
def execute(inputs, outputs, props, action_props):
    set_property('SIM_MODE', 'Value', 'true')
    return True
"""
    from sandbox_runner import run_user_code_with_mutations
    return_value, _stdout, _stderr, mutations, _req = run_user_code_with_mutations(
        source, inputs={}, outputs={}, props={'SIM_MODE': {'Value': 'false'}}, action_props={}
    )
    assert return_value is True
    assert mutations == [{'spec_name': 'SIM_MODE', 'entry_name': 'Value', 'value': 'true'}]


def test_properties_global_matches_props_argument():
    """The 'properties' global is the same dict as the props argument."""
    source = """
def execute(inputs, outputs, props, action_props):
    return properties is props and action_properties is action_props
"""
    from sandbox_runner import run_user_code_with_mutations
    return_value, _stdout, _stderr, _, _req = run_user_code_with_mutations(
        source, inputs={}, outputs={}, props={'X': {'A': '1'}}, action_props={}
    )
    assert return_value is True


def test_set_property_unknown_spec_raises():
    """set_property with an unknown spec_name raises (and is tagged as PROPERTY_WRITE_ERROR via _PropertyWriteError)."""
    source = """
def execute(inputs, outputs, props, action_props):
    set_property('UNKNOWN_SPEC', 'X', '1')
    return True
"""
    from sandbox_runner import run_user_code_with_mutations
    import pytest
    with pytest.raises(RuntimeError, match='unknown property'):
        run_user_code_with_mutations(source, inputs={}, outputs={},
                                     props={}, action_props={})


def test_request_command_unhold_recorded():
    """trajectory.request_command('UNHOLD') records the requested command."""
    source = """
def execute(inputs, outputs, props, action_props):
    trajectory.request_command('UNHOLD')
    return True
"""
    from sandbox_runner import run_user_code_with_mutations
    return_value, _stdout, _stderr, _mut, requested = run_user_code_with_mutations(
        source, inputs={}, outputs={}, props={}, action_props={}
    )
    assert return_value is True
    assert requested == [{'command': 'UNHOLD', 'reason': None}]


def test_request_command_with_reason_recorded():
    """request_command preserves the optional reason string."""
    source = """
def execute(inputs, outputs, props, action_props):
    trajectory.request_command('STOP', reason='operator cancelled batch')
    return True
"""
    from sandbox_runner import run_user_code_with_mutations
    _rv, _stdout, _stderr, _mut, requested = run_user_code_with_mutations(
        source, inputs={}, outputs={}, props={}, action_props={}
    )
    assert requested == [{'command': 'STOP', 'reason': 'operator cancelled batch'}]


def test_request_command_unsupported_raises_value_error():
    """An unknown command name raises ValueError (surfaces as RUNTIME_ERROR)."""
    source = """
def execute(inputs, outputs, props, action_props):
    trajectory.request_command('REBOOT')
    return True
"""
    from sandbox_runner import run_user_code_with_mutations
    import pytest
    with pytest.raises(ValueError, match='unsupported command'):
        run_user_code_with_mutations(source, inputs={}, outputs={},
                                     props={}, action_props={})


def test_multiple_request_commands_all_recorded():
    """Multiple request_command calls in one execution are all buffered;
    the engine decides which one to honor."""
    source = """
def execute(inputs, outputs, props, action_props):
    trajectory.request_command('HOLD')
    trajectory.request_command('UNHOLD')
    return True
"""
    from sandbox_runner import run_user_code_with_mutations
    _rv, _stdout, _stderr, _mut, requested = run_user_code_with_mutations(
        source, inputs={}, outputs={}, props={}, action_props={}
    )
    assert [c['command'] for c in requested] == ['HOLD', 'UNHOLD']
