import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from dashboard import plugin_api as api
import test_plugin_api as fixtures


def github(number=1, **changes):
    row = dict(number=number, title=f'Review {number}', html_url=f'https://github.com/team/repo/pull/{number}',
               state='open', draft=False, merged_at=None,
               head={'ref': 'feat/exact', 'repo': {'full_name': 'team/repo'}}, base={'ref': 'main'})
    row.update(changes)
    return row


def gitlab(number=1, **changes):
    row = dict(iid=number, title=f'Review {number}', web_url=f'https://git.example/team/sub/repo/-/merge_requests/{number}',
               state='opened', draft=False, source_branch='feat/exact', source_project_id=42, target_branch='main')
    row.update(changes)
    return row


def response(body, headers=''):
    return subprocess.CompletedProcess([], 0, 'HTTP/2.0 200 OK\r\n' + headers + '\r\n\r\n' + json.dumps(body), '')


class ReviewLinksTests(unittest.TestCase):
    setUp = fixtures.PluginApiTests.setUp
    repo = fixtures.PluginApiTests.repo

    def source(self, name='service-1234', remote='https://github.com/team/repo.git'):
        repo = self.repo(name)
        subprocess.run(['git', 'checkout', '-qb', 'feat/exact'], cwd=repo, check=True)
        subprocess.run(['git', 'remote', 'add', 'origin', remote], cwd=repo, check=True)
        return repo

    def get(self, repo, **params):
        return self.client.get('/reviews', params={'dir': str(repo), **params})

    def post(self, repo, url='https://reviews.example/123', action='add'):
        return self.client.post('/review_links', params={'dir': str(repo), 'url': url, 'action': action})

    def test_remote_formats_and_provider_mapping(self):
        for raw, expected in [
            ('https://user:secret@github.com/team/repo.git', ('github.com', 'team/repo')),
            ('ssh://git@git.example:2222/team/sub/repo.git', ('git.example', 'team/sub/repo')),
            ('git@git.example:team/sub/repo.git', ('git.example', 'team/sub/repo')),
            ('https://git.example:8443/team/repo.git', ('git.example:8443', 'team/repo')),
            ('https://github.com/team/repo.git/', ('github.com', 'team/repo')),
        ]:
            self.assertEqual(api._review_remote(raw), expected)
        for raw in ['/local/repo', 'file:///local/repo', 'ssh://git@host/../repo', 'https://host/a/%0asecret', 'https://host:bad/a/b']:
            self.assertIsNone(api._review_remote(raw))
        with patch.dict(os.environ, {'DEV_BOARD_REVIEW_HOSTS': '{"git.example":"gitlab", "hub.example":"github"}'}):
            self.assertEqual(api._review_hosts(), {'github.com': 'github', 'git.example': 'gitlab', 'hub.example': 'github'})
        for raw in ['[]', '{"host":"unknown"}', '{"https://host":"gitlab"}', '{']:
            with patch.dict(os.environ, {'DEV_BOARD_REVIEW_HOSTS': raw}), self.assertRaises(api.HTTPException):
                api._review_hosts()

    def test_live_settings_updates_precedence_and_safe_errors(self):
        settings = self.home / 'dev-board/settings.json'
        settings.parent.mkdir(parents=True)
        repo = self.source(remote='https://git.example/team/repo.git')
        with patch.dict(os.environ, {'DEV_BOARD_REVIEW_HOSTS': '{}'}), patch.object(api, '_query_reviews', return_value={'status': 'empty', 'reviews': []}) as query:
            self.assertEqual(self.get(repo).json()['status'], 'unsupported')
            settings.write_text(json.dumps({'review_hosts': {'git.example': 'gitlab'}}))
            self.assertEqual(self.get(repo).json()['status'], 'empty')
            self.assertEqual(query.call_args.args[0], 'gitlab')
            settings.write_text(json.dumps({'review_hosts': {'git.example': 'github'}}))
            self.get(repo)
            self.assertEqual(query.call_args.args[0], 'github')
            with patch.dict(os.environ, {'DEV_BOARD_REVIEW_HOSTS': '{"git.example":"gitlab"}'}):
                self.assertEqual(api._review_hosts()['git.example'], 'gitlab')
            self.assertEqual(api._review_hosts()['github.com'], 'github')
            for raw in ['[]', '{', '{"secret":"TOPSECRET"}', '{"review_hosts":[]}', '{"review_hosts":{"host":"invalid"}}']:
                settings.write_text(raw)
                result = self.get(repo)
                self.assertEqual(result.status_code, 500)
                self.assertIn('settings.json', result.text)
                self.assertNotIn('TOPSECRET', result.text)

    def test_source_remote_precedence_exact_branch_no_task_guess_and_no_credentials(self):
        repo = self.source(remote='https://alice:TOPSECRET@github.com/team/repo.git')
        self.assertEqual(api._review_source(repo), ('github.com', 'team/repo', 'feat/exact'))
        with patch.object(api, '_query_reviews', return_value={'status': 'empty', 'reviews': [], 'message': ''}) as query:
            result = self.get(repo, force=True)
            self.assertEqual(result.json()['repository'], 'github.com/team/repo')
            query.assert_called_once_with('github', 'github.com', 'team/repo', 'feat/exact')
            self.assertNotIn('TOPSECRET', result.text + repr(api._review_cache))
        subprocess.run(['git', 'remote', 'add', 'publish', 'git@git.example:team/other.git'], cwd=repo, check=True)
        for key in ['branch.feat/exact.remote', 'remote.pushDefault', 'branch.feat/exact.pushRemote']:
            subprocess.run(['git', 'config', key, 'publish'], cwd=repo, check=True)
            self.assertEqual(api._review_source(repo), ('git.example', 'team/other', 'feat/exact'))
            subprocess.run(['git', 'config', '--unset', key], cwd=repo, check=True)
        subprocess.run(['git', 'config', 'remote.origin.pushurl', 'git@github.com:publisher/repo.git'], cwd=repo, check=True)
        self.assertEqual(api._review_source(repo), ('github.com', 'publisher/repo', 'feat/exact'))
        subprocess.run(['git', 'config', 'branch.feat/exact.remote', 'origin'], cwd=repo, check=True)
        subprocess.run(['git', 'config', 'remote.pushDefault', 'origin'], cwd=repo, check=True)
        subprocess.run(['git', 'config', 'branch.feat/exact.pushRemote', 'publish'], cwd=repo, check=True)
        self.assertEqual(api._review_source(repo), ('git.example', 'team/other', 'feat/exact'))
        subprocess.run(['git', 'checkout', '--detach', '-q'], cwd=repo, check=True)
        self.assertEqual(self.get(repo).status_code, 409)

    def test_github_exact_results_states_drafts_sort_dedupe_and_commands(self):
        rows = [github(2, state='closed'), github(1, draft=True), github(3, state='closed', merged_at='2026-01-01'),
                github(1, draft=True), github(9, head={'ref': 'feat/exact', 'repo': {'full_name': 'other/repo'}}),
                github(10, head={'ref': 'feat/exact-extra', 'repo': {'full_name': 'team/repo'}})]
        with patch.object(api.subprocess, 'run', return_value=response(rows)) as run:
            result = api._query_reviews('github', 'github.com', 'team/repo', 'feat/exact')
        self.assertEqual(result['status'], 'ok')
        self.assertEqual([(r['number'], r['state'], r['draft']) for r in result['reviews']], [(3, 'merged', False), (2, 'closed', False), (1, 'open', True)])
        self.assertEqual(set(result['reviews'][0]), {'provider', 'number', 'title', 'url', 'state', 'draft', 'target_branch'})
        args, options = run.call_args
        self.assertEqual(args[0][:8], ['gh', 'api', '--hostname', 'github.com', '--method', 'GET', '--include', args[0][-1]])
        endpoint = urlsplit(args[0][-1])
        self.assertEqual(endpoint.path, 'repos/team/repo/pulls')
        self.assertEqual(parse_qs(endpoint.query), {'head': ['team:feat/exact'], 'state': ['all'], 'per_page': ['100'], 'page': ['1']})
        self.assertNotIn('shell', options)
        self.assertLessEqual(options['timeout'], 15)
        self.assertEqual(options['stdin'], subprocess.DEVNULL)

    def test_gitlab_nested_project_exact_source_and_pagination(self):
        replies = [response({'id': 42}), response([gitlab(1, draft=True), gitlab(9, source_project_id=99)], 'X-Next-Page: 2'),
                   response([gitlab(2, state='merged'), gitlab(3, state='closed')], 'X-Next-Page: ')]
        with patch.object(api.subprocess, 'run', side_effect=replies) as run:
            result = api._query_reviews('gitlab', 'git.example', 'team/sub/repo', 'feat/exact')
        self.assertEqual([r['number'] for r in result['reviews']], [3, 2, 1])
        commands = [call.args[0] for call in run.call_args_list]
        self.assertEqual(commands[0], ['glab', 'api', '--hostname', 'git.example', '--method', 'GET', '--include', 'projects/team%2Fsub%2Frepo'])
        endpoint = urlsplit(commands[2][-1])
        self.assertEqual(endpoint.path, 'projects/team%2Fsub%2Frepo/merge_requests')
        self.assertEqual(parse_qs(endpoint.query)['source_branch'], ['feat/exact'])
        self.assertEqual(parse_qs(endpoint.query)['page'], ['2'])
        self.assertEqual(parse_qs(endpoint.query)['state'], ['all'])
        self.assertEqual(parse_qs(endpoint.query)['scope'], ['all'])

    def test_pagination_headers_and_conservative_limit(self):
        with patch.object(api.subprocess, 'run', side_effect=[response([github(1)], 'Link: <ignored>; rel="next"'), response([github(2)])]) as run:
            result = api._query_reviews('github', 'github.com', 'team/repo', 'feat/exact')
            self.assertEqual(run.call_count, 2)
            self.assertEqual(result['status'], 'ok')
        with patch.object(api.subprocess, 'run', return_value=response([github()] * 100)) as run:
            result = api._query_reviews('github', 'github.com', 'team/repo', 'feat/exact')
            self.assertEqual(run.call_count, api._REVIEW_MAX_PAGES)
            self.assertEqual(result['status'], 'partial')
            self.assertIn('incomplete', result['message'])

    def test_empty_unavailable_error_timeout_and_malformed_are_distinct(self):
        cases = [(response([]), 'empty'), (FileNotFoundError('secret'), 'unavailable'),
                 (subprocess.TimeoutExpired('gh', 15), 'timeout'),
                 (subprocess.CompletedProcess([], 1, '', 'TOPSECRET https://user:secret@host'), 'error'),
                 (subprocess.CompletedProcess([], 0, 'invalid JSON TOPSECRET', ''), 'error'),
                 (response({}), 'error'), (response([{}]), 'error'),
                 (response([github(html_url='https://user:secret@host/review')]), 'error')]
        for reply, expected in cases:
            with self.subTest(status=expected), patch.object(api.subprocess, 'run', **({'side_effect': reply} if isinstance(reply, Exception) else {'return_value': reply})):
                result = api._query_reviews('github', 'github.com', 'team/repo', 'feat/exact')
                self.assertEqual(result['status'], expected)
                self.assertNotIn('secret', json.dumps(result))
                self.assertNotIn('TOPSECRET', json.dumps(result))
        with patch.object(api.time, 'monotonic', side_effect=[0, 16]), patch.object(api.subprocess, 'run') as run:
            self.assertEqual(api._query_reviews('github', 'github.com', 'team/repo', 'feat/exact')['status'], 'timeout')
            run.assert_not_called()

    def test_cache_expiry_force_and_bound_separate_from_board(self):
        repo = self.source()
        api._review_cache.clear()
        reply = {'status': 'empty', 'reviews': [], 'message': ''}
        with patch.object(api, '_query_reviews', return_value=reply) as query, patch.object(api.time, 'monotonic', return_value=100):
            self.get(repo)
            self.get(repo)
            self.assertEqual(query.call_count, 1)
            self.get(repo, force=True)
            self.assertEqual(query.call_count, 2)
            with patch.object(api.time, 'monotonic', return_value=161):
                self.get(repo)
            self.assertEqual(query.call_count, 3)
            self.client.get('/board')
            self.assertEqual(query.call_count, 3)
            for i in range(270):
                api._review_cache[('fixture', i)] = (100, reply)
            self.get(repo, force=True)
            self.assertLessEqual(len(api._review_cache), 256)

    def test_unknown_host_only_manual_and_scope_by_repository_and_branch(self):
        repo = self.source(remote='git@unknown.example:team/repo.git')
        other = self.source('other-1234', 'git@unknown.example:other/repo.git')
        duplicate = self.source('copy-9999', 'https://unknown.example/team/repo.git')
        with patch.object(api, '_query_reviews') as query:
            self.assertEqual(self.get(repo, force=True).json()['status'], 'unsupported')
            self.assertEqual(self.post(repo).status_code, 200)
            self.assertEqual(self.post(repo).status_code, 200)
            self.assertEqual(len(self.get(repo).json()['manual']), 1)
            self.assertEqual(self.get(duplicate).json()['manual'], ['https://reviews.example/123'])
            self.assertEqual(self.get(other).json()['manual'], [])
            subprocess.run(['git', 'checkout', '-qb', 'other-branch'], cwd=duplicate, check=True)
            self.assertEqual(self.get(duplicate).json()['manual'], [])
            self.assertEqual(self.post(repo, action='remove').status_code, 200)
            self.assertEqual(self.get(repo).json()['manual'], [])
            query.assert_not_called()
        data = self.home / 'cache/dev-board/review-links.json'
        self.assertEqual(json.loads(data.read_text()), {})
        self.assertEqual(self.client.get('/review_links').status_code, 405)

    def test_manual_validation_atomic_failure_and_corrupt_store(self):
        repo = self.source()
        for url in ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:secret@host/x', 'https://host:bad/a', 'https://host/a\n', 'https://host\\@evil/a']:
            self.assertEqual(self.post(repo, url).status_code, 400)
        self.assertEqual(self.post(repo, action='fetch').status_code, 400)
        self.assertEqual(self.post(repo).status_code, 200)
        path = self.home / 'cache/dev-board/review-links.json'
        before = path.read_bytes()
        with patch.object(api.os, 'replace', side_effect=OSError('no space')):
            self.assertEqual(self.post(repo, 'http://host/second').status_code, 500)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(list(path.parent.glob('.review-links-*')), [])
        path.write_text('{broken')
        self.assertEqual(self.post(repo).status_code, 500)
        self.assertEqual(path.read_text(), '{broken')

    def test_thread_safe_persistence_and_no_manual_url_fetch(self):
        repo = self.source(remote='git@unknown.example:team/repo.git')
        with patch.object(api, '_query_reviews') as query:
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                responses = list(pool.map(lambda i: api.update_review_link(str(repo), f'https://host/{i}', 'add'), range(16)))
            self.assertTrue(all(r['ok'] for r in responses))
            self.assertEqual(len(self.get(repo).json()['manual']), 16)
            query.assert_not_called()
        data = json.loads((self.home / 'cache/dev-board/review-links.json').read_text())
        self.assertEqual(len(next(iter(data.values()))), 16)

    def test_discovered_worktree_and_symlink_boundary_for_get_and_post(self):
        repo = self.source()
        outside = self.root / 'outside-1234'
        outside.mkdir()
        (outside / '.git').mkdir()
        alias = self.worktrees / 'alias-1234'
        alias.symlink_to(outside, target_is_directory=True)
        nested = repo / 'nested-1234'
        nested.mkdir()
        (nested / '.git').mkdir()
        unsuffixed = self.source('unsuffixed')
        for path in [outside, alias, nested, unsuffixed, self.worktrees]:
            self.assertIn(self.get(path).status_code, [403, 404])
            self.assertIn(self.post(path).status_code, [403, 404])
        gitdir = repo / '.git'
        moved = self.root / 'git-data'
        gitdir.rename(moved)
        gitdir.symlink_to(moved, target_is_directory=True)
        self.assertEqual(self.get(repo).status_code, 403)


if __name__ == '__main__':
    unittest.main()
