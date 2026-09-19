#!/usr/bin/env python3
"""Validate schema-v2 citation structure, never semantic truth. Run from project root."""
import argparse
import json
import re
from pathlib import Path

SAFE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]*\Z")
FIELDS = ('evidence_id stance title source locator pub_date access_date period_or_version '
          'excerpt_type excerpt claim qualifications coverage provenance').split()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f'duplicate JSON key: {key}')
        result[key] = value
    return result


def check(root, run_id):
    errors, warnings = [], []
    if not SAFE.fullmatch(run_id):
        return ['Invalid run ID'], []
    report_path = root / 'reports' / f'{run_id}.md'
    folder = root / 'findings' / run_id
    try:
        report = report_path.read_text(encoding='utf-8')
    except (OSError, UnicodeError) as exc:
        return [f'Cannot read report: {exc}'], []
    headers = list(re.finditer(r'^## Sources\s*$', report, re.M))
    if len(headers) != 1:
        return ['Exactly one final ## Sources section required'], []
    header = headers[0]
    body, sources = report[:header.start()], report[header.end():]
    entries = {}
    for line in sources.splitlines():
        if not line.strip():
            continue
        match = re.fullmatch(r'\[([1-9]\d*)\] ([A-Za-z0-9][A-Za-z0-9_-]*-e[1-9]\d*) — (.+) — (.+) — accessed (.+)', line)
        if not match:
            errors.append(f'Malformed Sources line (Sources must be final): {line[:100]}')
            continue
        number, eid, title, source, date = match.groups()
        if number in entries:
            errors.append(f'Duplicate citation number: {number}')
        entries[number] = (eid, source, date)
    used = set(re.findall(r'\[([1-9]\d*)\](?!\()', body))
    for number in sorted(used - entries.keys()):
        errors.append(f'Orphan citation: [{number}]')
    for number in sorted(entries.keys() - used):
        warnings.append(f'Unused source: [{number}]')
    records = {}
    if not folder.is_dir():
        errors.append('Findings directory missing')
    for path in sorted(folder.glob('*.json')):
        try:
            bundle = json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique_object)
            if not isinstance(bundle, dict):
                raise ValueError('bundle must be an object')
            task = bundle.get('task_id')
            if not isinstance(task, str) or not SAFE.fullmatch(task) or task != path.stem:
                raise ValueError('task_id must match filename and safe ID syntax')
            if bundle.get('schema_version') != 2 or bundle.get('run_id') != run_id:
                raise ValueError('schema/run mismatch; legacy records need explicit review')
            if not isinstance(bundle.get('scope_key'), str) or not bundle['scope_key'].strip():
                raise ValueError('missing scope_key')
            status = bundle.get('status')
            if status not in ('complete', 'partial', 'failed'):
                raise ValueError('invalid status')
            memo = path.with_suffix('.md').read_text(encoding='utf-8').rstrip()
            if not memo.endswith('\nstatus: ' + status):
                raise ValueError('memo and bundle completion status mismatch')
            evidence = bundle.get('evidence')
            if not isinstance(evidence, list):
                raise ValueError('evidence must be an array')
            for record in evidence:
                if not isinstance(record, dict) or any(not isinstance(record.get(k), str) or not record[k].strip() for k in FIELDS):
                    raise ValueError('evidence record missing required string field')
                eid = record['evidence_id']
                if not re.fullmatch(re.escape(task) + r'-e[1-9]\d*', eid):
                    raise ValueError(f'invalid evidence ID: {eid}')
                if eid in records:
                    raise ValueError(f'duplicate evidence ID: {eid}')
                for key in ('source', 'excerpt', 'claim'):
                    if record[key].strip().lower() == 'unavailable':
                        raise ValueError(f'{eid}: {key} cannot be unavailable for cited evidence')
                enums = {'stance': ('supports', 'contradicts', 'contextualizes'),
                         'excerpt_type': ('verbatim', 'extraction'),
                         'coverage': ('full-text', 'abstract', 'partial', 'tool-extraction')}
                if any(record[k] not in options for k, options in enums.items()):
                    raise ValueError(f'{eid}: invalid record enum')
                records[eid] = (record, status)
        except (OSError, UnicodeError, ValueError) as exc:
            errors.append(f'{path.name}: {exc}')
    for number, (eid, source, date) in entries.items():
        if eid not in records:
            errors.append(f'[{number}]: no valid structured evidence record for {eid}')
            continue
        record, status = records[eid]
        if status != 'complete':
            errors.append(f'[{number}]: evidence belongs to {status} task; review and complete first')
        if source != record['source'] or date != record['access_date']:
            errors.append(f'[{number}]: source/access date differs from evidence record')
    if not entries:
        warnings.append('No source citations: this does not establish that factual claims are supported')
    return errors, warnings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run', help='runs/<run_id> or run_id')
    args = parser.parse_args()
    errors, warnings = check(Path.cwd(), Path(args.run).name)
    for message in warnings:
        print('WARN: ' + message)
    for message in errors:
        print('FAIL: ' + message)
    if not errors:
        print('OK: structural links only; semantics, freshness and research sufficiency not verified')
    return bool(errors)


if __name__ == '__main__':
    raise SystemExit(main())
