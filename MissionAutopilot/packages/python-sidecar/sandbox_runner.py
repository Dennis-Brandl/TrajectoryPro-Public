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
sandbox_runner.py — Python sidecar worker subprocess.

WARNING — THIS IS NOT A SANDBOX. Despite the (historical) file name, user code
runs via plain compile()+exec() with FULL builtins access: it can import any
module, touch the filesystem and network, and do anything the server process
can. Isolation, if required, must come from outside (the Docker container /
OS user). Never point an exposed deployment at this runner without API-key
auth on the server (see packages/server).

Reads JSON execution requests from stdin one line at a time, executes
user-written Python code via compile()+exec(), captures stdout/stderr,
and writes JSON responses to stdout. Handles multiple sequential requests
in a long-lived worker loop without restarting.

Protocol: ExecutionEngineSpec.md §2.2
"""

import sys
import json
import io
import contextlib
import traceback
import time
import types
import re

# Cap stdout/stderr capture to prevent memory issues from chatty code (~64KB).
# The cap is enforced while the code runs (BoundedWriter), not after.
MAX_OUTPUT_BYTES = 64 * 1024

# Commands user code is allowed to request via trajectory.request_command().
# Per-state validity (e.g. UNHOLD only from HELD) is enforced by the engine, not here.
_ALLOWED_REQUEST_COMMANDS = frozenset({"ABORT", "STOP", "HOLD", "UNHOLD", "PAUSE"})


class _PropertyWriteError(RuntimeError):
    """Raised by set_property() when the write target is invalid."""
    pass


class BoundedWriter(io.TextIOBase):
    """
    Text sink that keeps only the first `limit_bytes` of UTF-8 output.

    Never splits a character: a character that does not fit whole is dropped.
    Everything not kept is counted in `dropped_bytes`.
    """

    def __init__(self, limit_bytes):
        super().__init__()
        self._limit = limit_bytes
        self._chunks = []
        self._size = 0
        self._full = False
        self.dropped_bytes = 0

    def writable(self):
        return True

    def write(self, s):
        data = s.encode("utf-8", errors="replace")
        if self._full:
            self.dropped_bytes += len(data)
            return len(s)
        room = self._limit - self._size
        if len(data) <= room:
            self._chunks.append(data)
            self._size += len(data)
            return len(s)
        # Keep whole characters only; "ignore" drops a trailing partial one.
        kept = data[:room].decode("utf-8", errors="ignore").encode("utf-8")
        self._chunks.append(kept)
        self._size += len(kept)
        self.dropped_bytes += len(data) - len(kept)
        self._full = True
        return len(s)

    def text(self, stream_name):
        out = b"".join(self._chunks).decode("utf-8")
        if self.dropped_bytes > 0:
            out += f"\n[{stream_name} truncated: {self.dropped_bytes} bytes not captured]"
        return out


class RunState:
    """Per-request capture and logs, readable even if the user code raises."""

    def __init__(self):
        self.stdout = BoundedWriter(MAX_OUTPUT_BYTES)
        self.stderr = BoundedWriter(MAX_OUTPUT_BYTES)
        self.mutations = []
        self.requested_commands = []


def run_user_code(source_code, inputs, outputs, props, action_props):
    """
    Compile and execute user-written Python code.

    Steps:
      1. compile() — raises SyntaxError on structural issues
      2. exec() the compiled code to define execute() in a namespace
      3. Call execute(inputs, outputs, props, action_props)
      4. Return (return_value, stdout_text, stderr_text)

    The outputs dict is passed by reference; user code may mutate it.
    stdout/stderr are captured and capped at MAX_OUTPUT_BYTES.

    Raises:
        SyntaxError:   if source_code cannot be compiled
        RuntimeError:  if execute() is not defined or not callable
        Exception:     any exception raised by user code
    """
    # Step 1: compile first so SyntaxError is distinct from RuntimeError
    code_obj = compile(source_code, "<action_code>", "exec")

    # Step 2: set up capture buffers
    stdout_buf = BoundedWriter(MAX_OUTPUT_BYTES)
    stderr_buf = BoundedWriter(MAX_OUTPUT_BYTES)

    # Step 3: create namespace with full builtins access
    namespace = {"__builtins__": __builtins__}

    # Step 4: exec the compiled code (defines execute() in the namespace)
    with contextlib.redirect_stdout(stdout_buf), contextlib.redirect_stderr(stderr_buf):
        exec(code_obj, namespace)  # noqa: S102

    # Step 5: extract execute() function
    execute_fn = namespace.get("execute")
    if not callable(execute_fn):
        raise RuntimeError(
            "User code must define a callable 'execute' function"
        )

    # Step 6: call execute(inputs, outputs, props, action_props) with capture still active
    with contextlib.redirect_stdout(stdout_buf), contextlib.redirect_stderr(stderr_buf):
        return_value = execute_fn(inputs, outputs, props, action_props)

    # Step 7: read captured output (already capped while running)
    stdout_text = stdout_buf.text("stdout")
    stderr_text = stderr_buf.text("stderr")

    # Step 8: return tuple
    return return_value, stdout_text, stderr_text


def run_user_code_with_mutations(
    source_code, inputs, outputs, props, action_props, state=None
):
    """
    Same as run_user_code but also returns the property_mutations list
    populated by user-code calls to set_property(spec, entry, value) and
    the requested_commands list populated by user-code calls to
    trajectory.request_command(command, reason=None).

    When `state` (a RunState) is given it is used and filled, so the caller can
    read the partial capture and mutations after an exception.

    Returns: (return_value, stdout_text, stderr_text, mutations, requested_commands)

    Raises:
        SyntaxError:         if source_code cannot be compiled
        RuntimeError:        if execute() is not defined or not callable
        _PropertyWriteError: if set_property() is called with an unknown spec_name
        ValueError:          if request_command() is called with an unsupported command
        Exception:           any other exception raised by user code
    """
    # Step 1: compile first so SyntaxError is distinct from RuntimeError
    code_obj = compile(source_code, "<action_code>", "exec")

    # Step 2: set up capture buffers
    if state is None:
        state = RunState()
    stdout_buf = state.stdout
    stderr_buf = state.stderr

    # Step 3: build mutation log and set_property closure
    mutations = state.mutations

    def set_property(spec_name, entry_name, value):
        if not isinstance(spec_name, str):
            raise TypeError("spec_name must be str")
        if not isinstance(entry_name, str):
            raise TypeError("entry_name must be str")
        if not isinstance(value, str):
            raise TypeError("value must be str")
        if spec_name not in props:
            raise _PropertyWriteError(f"unknown property: {spec_name!r}")
        # Permissive: entry_name is created if missing
        props[spec_name][entry_name] = value
        mutations.append({"spec_name": spec_name, "entry_name": entry_name, "value": value})

    # Step 3a: build requested-commands log and request_command closure
    requested_commands = state.requested_commands

    def request_command(command, reason=None):
        if not isinstance(command, str):
            raise TypeError("command must be str")
        if command not in _ALLOWED_REQUEST_COMMANDS:
            raise ValueError(
                f"unsupported command: {command!r} "
                f"(allowed: {sorted(_ALLOWED_REQUEST_COMMANDS)})"
            )
        if reason is not None and not isinstance(reason, str):
            raise TypeError("reason must be str or None")
        requested_commands.append({"command": command, "reason": reason})

    # The `trajectory` namespace is the public API surface for new container
    # affordances. `set_property` stays as a bare global for backwards compat
    # with action code written before request_command existed.
    trajectory_ns = types.SimpleNamespace(request_command=request_command)

    # Step 4: create namespace — same builtins access as run_user_code, plus new globals
    namespace = {
        "__builtins__": __builtins__,
        "properties": props,
        "action_properties": action_props,
        "set_property": set_property,
        "trajectory": trajectory_ns,
    }

    # Step 5: exec the compiled code (defines execute() in the namespace)
    with contextlib.redirect_stdout(stdout_buf), contextlib.redirect_stderr(stderr_buf):
        exec(code_obj, namespace)  # noqa: S102

    # Step 6: extract execute() function
    execute_fn = namespace.get("execute")
    if not callable(execute_fn):
        raise RuntimeError(
            "User code must define a callable 'execute' function"
        )

    # Step 7: call execute(inputs, outputs, props, action_props) with capture still active
    with contextlib.redirect_stdout(stdout_buf), contextlib.redirect_stderr(stderr_buf):
        return_value = execute_fn(inputs, outputs, props, action_props)

    # Step 8: read captured output (already capped while running)
    stdout_text = stdout_buf.text("stdout")
    stderr_text = stderr_buf.text("stderr")

    # Step 9: return tuple (return_value, stdout, stderr, mutations, requested_commands)
    return return_value, stdout_text, stderr_text, mutations, requested_commands


_NOT_SERIALIZABLE_RE = re.compile(r"Object of type (\w+) is not JSON serializable")
_CONVERT_HINT = " \u2014 convert it to a string"


def _describe_unencodable(value):
    """
    Return None when json.dumps can encode `value`; otherwise (type_name, nested).
    type_name is None when the encoder names no type (circular reference,
    non-string dict key, ...).
    """
    try:
        json.dumps(value, allow_nan=False)
        return None
    except (TypeError, ValueError) as e:
        text = str(e)
        m = _NOT_SERIALIZABLE_RE.search(text)
        if m:
            type_name = m.group(1)
        elif "Out of range float" in text:
            type_name = "float"
        else:
            type_name = None
        if type_name is None:
            return None, isinstance(value, (dict, list, tuple))
        return type_name, type_name != type(value).__name__


def _phrase(subject, found, value, hint):
    type_name, nested = found
    if type_name is None:
        if nested:
            return f"{subject} contains a value that cannot be sent as JSON{hint}"
        type_name = type(value).__name__
    verb = "contains a" if nested else "is a"
    return f"{subject} {verb} {type_name}, which cannot be sent as JSON{hint}"


def encode_response(response):
    """
    Return the JSON line for `response`. If it cannot be encoded, rebuild it as
    a failure naming the first offending output (sorted key order) or the
    return value. Capture and property mutations are kept. A response that
    had already failed keeps its error_type, error and traceback; the
    encoding message is appended as a second line.
    """
    try:
        return json.dumps(response, allow_nan=False)
    except (TypeError, ValueError):
        pass

    good_outputs = {}
    message = None
    outputs = response.get("outputs")
    if isinstance(outputs, dict):
        for key in sorted(outputs, key=lambda k: (not isinstance(k, str), str(k))):
            if not isinstance(key, str):
                if message is None:
                    message = (
                        f"outputs[{key!r}] has a key that cannot be sent as JSON"
                        " \u2014 use a string key"
                    )
                continue
            found = _describe_unencodable(outputs[key])
            if found is None:
                good_outputs[key] = outputs[key]
            elif message is None:
                message = _phrase(f"outputs[{key!r}]", found, outputs[key], _CONVERT_HINT)
    if message is None:
        rv = response.get("return_value")
        found = _describe_unencodable(rv)
        if found is not None:
            message = _phrase("the return value", found, rv, "")

    already_failed = response.get("success") is False
    if already_failed:
        error_type = response.get("error_type", "RUNTIME_ERROR")
        error = str(response.get("error", ""))
        traceback_text = response.get("traceback", "")
        if message is not None:
            error = f"{error}\n{message}" if error else message
    else:
        error_type = "RUNTIME_ERROR"
        error = message if message is not None else "response could not be encoded"
        traceback_text = response.get("traceback", "")

    rebuilt = {
        "request_id": response.get("request_id"),
        "success": False,
        "error_type": error_type,
        "error": error,
        "traceback": traceback_text,
        "outputs": good_outputs if message is not None else {},
        "return_value": None,
        "execution_time_ms": response.get("execution_time_ms", 0),
        "stdout_capture": response.get("stdout_capture", ""),
        "stderr_capture": response.get("stderr_capture", ""),
        "property_mutations": response.get("property_mutations", []),
        "requested_commands": [],
    }
    try:
        return json.dumps(rebuilt, allow_nan=False)
    except (TypeError, ValueError):
        pass

    # Last resort: the pieces below are strings, so this always encodes.
    def _str(v):
        return v if isinstance(v, str) else ""

    return json.dumps(
        {
            "request_id": response.get("request_id") if isinstance(response.get("request_id"), (str, int, type(None))) else None,
            "success": False,
            "error_type": _str(error_type) or "RUNTIME_ERROR",
            "error": _str(error) or "response could not be encoded",
            "traceback": _str(traceback_text),
            "outputs": {},
            "return_value": None,
            "execution_time_ms": 0,
            "stdout_capture": _str(response.get("stdout_capture")),
            "stderr_capture": _str(response.get("stderr_capture")),
            "property_mutations": _safe_mutations(response.get("property_mutations")),
            "requested_commands": [],
        }
    )


def _safe_mutations(mutations):
    try:
        json.dumps(mutations, allow_nan=False)
        return mutations
    except (TypeError, ValueError):
        return []


def _describe_error(e, detail=None):
    """`TypeName: message`, safe even when str(e) itself raises."""
    try:
        return f"{type(e).__name__}: {e if detail is None else detail}"
    except BaseException:  # noqa: BLE001
        return f"{type(e).__name__}: <unprintable error>"


def main():
    """
    Worker main loop.

    Reads newline-delimited JSON requests from stdin and writes JSON
    responses to stdout. Processes requests sequentially; one response
    per request. Runs until stdin is closed (EOF).
    """
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        start_ms = time.time() * 1000

        # Parse JSON request
        try:
            request = json.loads(line)
        except json.JSONDecodeError as e:
            response = {
                "request_id": None,
                "success": False,
                "error_type": "RUNTIME_ERROR",
                "error": f"JSONDecodeError: {e}",
                "traceback": traceback.format_exc(),
                "outputs": {},
                "return_value": None,
                "execution_time_ms": round(time.time() * 1000 - start_ms, 3),
                "stdout_capture": "",
                "stderr_capture": "",
                "property_mutations": [],
                "requested_commands": [],
            }
            print(encode_response(response), flush=True)
            continue

        # Extract request fields
        request_id = request.get("request_id")
        source_code = request.get("source_code", "")
        inputs = request.get("inputs", {})
        # outputs starts with accumulated outputs from prior states (passed by engine)
        outputs = dict(request.get("outputs", {}))
        props = request.get("environment_action_properties", {})
        action_props = request.get("action_properties", {})

        # Execute user code
        state = RunState()
        try:
            (
                return_value,
                stdout_text,
                stderr_text,
                mutations,
                requested_commands,
            ) = run_user_code_with_mutations(
                source_code, inputs, outputs, props, action_props, state
            )
            response = {
                "request_id": request_id,
                "success": True,
                "outputs": outputs,
                "return_value": return_value,
                "execution_time_ms": round(time.time() * 1000 - start_ms, 3),
                "stdout_capture": stdout_text,
                "stderr_capture": stderr_text,
                "property_mutations": mutations,
                "requested_commands": requested_commands,
            }
        except SyntaxError as e:
            response = {
                "request_id": request_id,
                "success": False,
                "error_type": "SYNTAX_ERROR",
                "error": _describe_error(e),
                "traceback": traceback.format_exc(),
                "outputs": outputs,
                "return_value": None,
                "execution_time_ms": round(time.time() * 1000 - start_ms, 3),
                "stdout_capture": state.stdout.text("stdout"),
                "stderr_capture": state.stderr.text("stderr"),
                "property_mutations": state.mutations,
                "requested_commands": [],
            }
        except _PropertyWriteError as e:
            response = {
                "request_id": request_id,
                "success": False,
                "error_type": "PROPERTY_WRITE_ERROR",
                "error": _describe_error(e),
                "traceback": traceback.format_exc(),
                "outputs": outputs,
                "return_value": None,
                "execution_time_ms": round(time.time() * 1000 - start_ms, 3),
                "stdout_capture": state.stdout.text("stdout"),
                "stderr_capture": state.stderr.text("stderr"),
                "property_mutations": state.mutations,
                "requested_commands": [],
            }
        except Exception as e:  # noqa: BLE001
            response = {
                "request_id": request_id,
                "success": False,
                "error_type": "RUNTIME_ERROR",
                "error": _describe_error(e),
                "traceback": traceback.format_exc(),
                "outputs": outputs,
                "return_value": None,
                "execution_time_ms": round(time.time() * 1000 - start_ms, 3),
                "stdout_capture": state.stdout.text("stdout"),
                "stderr_capture": state.stderr.text("stderr"),
                "property_mutations": state.mutations,
                "requested_commands": [],
            }
        except SystemExit as e:
            response = {
                "request_id": request_id,
                "success": False,
                "error_type": "RUNTIME_ERROR",
                "error": _describe_error(e, e.code),
                "traceback": traceback.format_exc(),
                "outputs": outputs,
                "return_value": None,
                "execution_time_ms": round(time.time() * 1000 - start_ms, 3),
                "stdout_capture": state.stdout.text("stdout"),
                "stderr_capture": state.stderr.text("stderr"),
                "property_mutations": state.mutations,
                "requested_commands": [],
            }

        # flush=True is critical so the Node.js parent receives output immediately
        print(encode_response(response), flush=True)


if __name__ == "__main__":
    main()
