"""Bounded Linux guardian for this test's fixed browser worker and harmless probes.

The parent holds stdin open. EOF survives an outer Node process-group kill.
Subreaping adopts descendants even when Playwright creates another process group.
Only this process's direct children are inspected/killed/reaped; no global scan.
"""
import ctypes
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import time

WORK_SECONDS = 15.0
CLEANUP_SECONDS = 3.0
PROBE = r"""
import json, os, subprocess, sys, time
from pathlib import Path
def identity(pid):
    stat = Path('/proc/' + str(pid) + '/stat').read_text().rpartition(') ')[2].split()
    return {'pid': pid, 'start_ticks': stat[19]}
child = subprocess.Popen([sys.executable, '-I', '-S', '-c', 'import time; time.sleep(60)'],
    start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
mode = sys.argv[1]
print(json.dumps({'probe': mode, 'worker_pid': os.getpid(), 'descendant_pid': child.pid,
    'owned': {'guardian': identity(os.getppid()), 'worker': identity(os.getpid()),
              'descendant': identity(child.pid)}}), flush=True)
if mode == 'hold':
    time.sleep(60)
"""


def main():
    worker = None
    worker_exit_code = None
    reason = 'setup_error'
    setup_stage = 'platform'
    may_have_children = False
    children_path = Path('/proc/self/task') / str(os.getpid()) / 'children'

    def reap():
        nonlocal worker_exit_code
        while True:
            try:
                pid, status = os.waitpid(-1, os.WNOHANG)
            except ChildProcessError:
                return True
            if pid == 0:
                return False
            if worker is not None and pid == worker.pid:
                worker_exit_code = os.waitstatus_to_exitcode(status)
                worker.returncode = worker_exit_code

    def own_children():
        return [int(value) for value in children_path.read_text().split()]

    def cleanup():
        deadline = time.monotonic() + CLEANUP_SECONDS
        while True:
            no_children = reap()
            children = own_children()
            if no_children and not children:
                return True
            # A listed direct child cannot have its PID reused until we reap it.
            # Killing parents first causes their surviving children to be adopted.
            for pid in children:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            if time.monotonic() >= deadline:
                return reap() and not own_children()
            time.sleep(0.01)

    cleanup_complete = False
    try:
        if sys.platform != 'linux' or len(sys.argv) != 2:
            raise RuntimeError('UNSUPPORTED_GUARD')
        mode = sys.argv[1]
        if mode not in ('browser', 'probe-normal', 'probe-hold'):
            raise RuntimeError('INVALID_GUARD_MODE')
        setup_stage = 'subreaper'
        libc = ctypes.CDLL(None, use_errno=True)
        prctl = libc.prctl
        prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
        prctl.restype = ctypes.c_int
        if prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER, linux/prctl.h
            raise RuntimeError('SUBREAPER_UNAVAILABLE')
        setup_stage = 'owned_child_observation'
        own_children()  # Fail closed before launching if owned-child observation is unavailable.
        setup_stage = 'parent_pipe'
        os.fstat(3)
        os.set_inheritable(3, False)
        os.set_blocking(0, False)
        with selectors.DefaultSelector() as selector:
            selector.register(0, selectors.EVENT_READ)
            command = ([sys.executable, str(Path(__file__).with_name('delegated_checkout_review.py'))]
                       if mode == 'browser' else
                       [sys.executable, '-I', '-S', '-c', PROBE, mode.removeprefix('probe-')])
            # stdin and the private metadata fd are never inherited by the worker.
            setup_stage = 'worker_spawn'
            may_have_children = True
            worker = subprocess.Popen(command, stdin=subprocess.DEVNULL, close_fds=True)
            deadline = time.monotonic() + WORK_SECONDS
            while True:
                reap()
                if worker_exit_code is not None:
                    reason = 'worker_exit'
                    break
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    reason = 'deadline'
                    break
                if selector.select(min(0.02, remaining)):
                    received = os.read(0, 4096)
                    reason = 'parent_eof' if received == b'' else 'setup_error'
                    break
    except BaseException:
        # Never print worker input, credentials, browser traces or arbitrary errors.
        reason = 'setup_error'
        try:
            print(json.dumps({'passed': False, 'stage': 'process_guard',
                              'guard_stage': setup_stage if worker is None else 'worker_supervision',
                              'actual_served_browser': False}), file=sys.stderr)
        except OSError:
            pass
    finally:
        try:
            cleanup_complete = not may_have_children or cleanup()
        except BaseException:
            cleanup_complete = False
        result = {'protocol': 1, 'guardian_pid': os.getpid(),
                  'worker_pid': worker.pid if worker is not None else None,
                  'worker_exit_code': worker_exit_code, 'reason': reason,
                  'cleanup_complete': cleanup_complete}
        try:
            data = (json.dumps(result, separators=(',', ':')) + '\n').encode('ascii')
            os.set_blocking(3, False)
            while data:
                data = data[os.write(3, data):]
        except OSError:
            pass  # The parent may already have been killed; cleanup still took place.

    if not cleanup_complete or reason == 'setup_error':
        return 2
    if reason != 'worker_exit':
        return 124
    return 0 if worker_exit_code == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
