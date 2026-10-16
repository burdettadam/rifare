#!/usr/bin/env python3
"""Native unittest result adapter; no custom assertions, approvals or test selector."""
from __future__ import annotations
import argparse
from contextlib import redirect_stdout
import sys
import unittest
from pathlib import Path
import xml.etree.ElementTree as ET


class RecordingResult(unittest.TextTestResult):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.records = []
        self.current = {}

    def startTest(self, test):
        record = {'id': test.id(), 'status': 'incomplete'}
        self.records.append(record)
        self.current[id(test)] = record
        super().startTest(test)

    def mark(self, test, status):
        record = self.current.get(id(test))
        if record is None:
            record = {'id': test.id(), 'status': status}
            self.records.append(record)
        record['status'] = status

    def addSuccess(self, test):
        if self.current[id(test)]['status'] == 'incomplete': self.mark(test, 'passed')
        super().addSuccess(test)

    def addFailure(self, test, err):
        self.mark(test, 'failure'); super().addFailure(test, err)

    def addError(self, test, err):
        self.mark(test, 'error'); super().addError(test, err)

    def addSkip(self, test, reason):
        self.mark(test, 'skipped'); super().addSkip(test, reason)

    def addExpectedFailure(self, test, err):
        self.mark(test, 'skipped'); super().addExpectedFailure(test, err)

    def addUnexpectedSuccess(self, test):
        self.mark(test, 'failure'); super().addUnexpectedSuccess(test)

    def addSubTest(self, test, subtest, err):
        if err is not None: self.mark(test, 'failure')
        super().addSubTest(test, subtest, err)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    sys.path.insert(0, str(root / 'tests'))
    with redirect_stdout(sys.stderr):
        suite = unittest.TestLoader().discover(str(root / 'tests'))
        expected = suite.countTestCases()
        result = unittest.TextTestRunner(verbosity=2, resultclass=RecordingResult,
                                        stream=sys.stderr).run(suite)
    xml = ET.Element('testsuite', {'tests': str(len(result.records))})
    for item in result.records:
        node = ET.SubElement(xml, 'testcase', {'name': item['id']})
        status = item['status']
        if status != 'passed': ET.SubElement(node, status if status in ('error','failure','skipped') else 'error')
    print(ET.tostring(xml, encoding='unicode'))
    passed = (expected > 0 and result.testsRun == expected and len(result.records) == expected
              and result.wasSuccessful() and all(x['status'] == 'passed' for x in result.records))
    return 0 if passed else 1


if __name__ == '__main__': raise SystemExit(main())
