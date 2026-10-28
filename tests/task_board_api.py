import concurrent.futures
import json
import unittest
from unittest.mock import patch

import importlib.util
import os
import tempfile
from pathlib import Path
from fastapi import FastAPI
from fastapi.testclient import TestClient

spec = importlib.util.spec_from_file_location("task_board_api", Path(__file__).parents[1] / "task-board/dashboard/plugin_api.py")
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)


class TasksTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.home = Path(temp.name)
        env = patch.dict(os.environ, {"HERMES_HOME": str(self.home)})
        env.start()
        self.addCleanup(env.stop)
        app = FastAPI()
        app.include_router(api.router)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def create(self, title='任务', **fields):
        result = self.client.post('/tasks', json={'title': title, **fields})
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def test_crud_persistence_and_non_reused_identity(self):
        self.assertEqual(self.client.get('/tasks').json(), {'api_version': api.API_VERSION, 'tasks': [], 'statuses': api.DEFAULT_STATUSES})
        task = self.create(ref='GH-12', note='note', url='https://github.com/example/repo/issues/12')
        self.assertEqual(task['ref'], 'GH-12')
        self.assertEqual(task['url'], 'https://github.com/example/repo/issues/12')
        self.assertEqual(task['status'], 'todo')
        self.assertEqual(task['created_at'], task['updated_at'])
        path = self.home / 'task-board/tasks.json'
        self.assertEqual(json.loads(path.read_text())['tasks'], [task])
        edited = self.client.patch('/tasks/' + task['id'], json={'title': ' edited ', 'pinned': True, 'status': 'done',
            'session_id': 'stored', 'session_profile': 'dev'}).json()
        self.assertEqual(edited['title'], 'edited')
        self.assertEqual(edited['created_at'], task['created_at'])
        self.assertGreater(edited['updated_at'], task['updated_at'])
        self.assertEqual(self.client.get('/tasks').json()['tasks'], [edited])
        self.assertEqual(self.client.delete('/tasks/' + task['id']).status_code, 200)
        self.assertEqual(self.client.get('/tasks').json()['tasks'], [])
        self.assertNotEqual(self.create()['id'], task['id'])
        for method in ('patch', 'delete'):
            self.assertEqual(getattr(self.client, method)('/tasks/missing', **({'json': {}} if method == 'patch' else {})).status_code, 404)

    def test_validation_does_not_write(self):
        for body in [{}, {'title': ''}, {'title': '  '}, {'title': 12}, {'title': 'x', 'note': None},
                     {'title': 'x', 'status': 'other'}, {'title': 'x', 'pinned': 1}, {'title': 'x', 'order': 0},
                     {'title': 'x', 'url': 'javascript:alert(1)'}, {'title': 'x', 'url': 'https://user:secret@host'}]:
            self.assertEqual(self.client.post('/tasks', json=body).status_code, 400, body)
        self.assertFalse(api._tasks_file().exists())
        task = self.create()
        self.assertEqual(self.client.patch('/tasks/' + task['id'], json={'status': []}).status_code, 400)
        self.assertEqual(self.client.post('/tasks/' + task['id'] + '/reorder', json={'direction': 'sideways'}).status_code, 400)

    def test_reorder_within_status_and_pin_group(self):
        a = self.create('A')
        b = self.create('B', status='done')
        c = self.create('C')
        result = self.client.post('/tasks/' + c['id'] + '/reorder', json={'direction': 'up'}).json()['tasks']
        self.assertEqual([t['id'] for t in result], [c['id'], b['id'], a['id']])
        result = self.client.post('/tasks/' + b['id'] + '/reorder', json={'direction': 'down'}).json()['tasks']
        self.assertEqual([t['id'] for t in result], [c['id'], b['id'], a['id']])

    def test_reorder_within_pin_group(self):
        a, b, c = self.create('a'), self.create('b', pinned=True), self.create('c')
        result = self.client.post('/tasks/' + c['id'] + '/reorder', json={'direction': 'up'}).json()['tasks']
        self.assertEqual([t['id'] for t in result], [c['id'], b['id'], a['id']])
        self.assertEqual([t['order'] for t in result], [0, 1, 2])
        result = self.client.post('/tasks/' + c['id'] + '/reorder', json={'direction': 'down'}).json()['tasks']
        self.assertEqual([t['id'] for t in result], [a['id'], b['id'], c['id']])
        self.client.delete('/tasks/' + a['id'])
        self.assertEqual([t['order'] for t in self.client.get('/tasks').json()['tasks']], [0, 1])

    def test_target_reorder_persists_and_isolates_groups(self):
        a = self.create('visible a')
        other = self.create('other', status='doing')
        hidden = self.create('hidden')
        pin = self.create('pin', pinned=True)
        b = self.create('visible b')
        c = self.create('visible c')
        def move(source, target, placement, expected):
            result = self.client.post('/tasks/' + source['id'] + '/reorder',
                                      json={'target_id': target['id'], 'placement': placement})
            self.assertEqual(result.status_code, 200)
            stored = json.loads(api._tasks_file().read_text())['tasks']
            self.assertEqual(result.json()['tasks'], stored)
            self.assertEqual(self.client.get('/tasks').json()['tasks'], stored)
            self.assertEqual([t['id'] for t in stored], [t['id'] for t in expected])
            self.assertEqual([t['order'] for t in stored], list(range(len(stored))))
            self.assertEqual(stored[1], other)
            self.assertEqual(stored[3], pin)
        move(c, a, 'before', [c, other, a, pin, hidden, b])
        move(c, b, 'after', [a, other, hidden, pin, b, c])
        move(a, b, 'after', [hidden, other, b, pin, a, c])
        move(c, b, 'before', [hidden, other, c, pin, b, a])
        before = api._tasks_file().read_bytes()
        with patch.object(api, '_tasks_write') as write:
            self.assertEqual(self.client.post('/tasks/' + a['id'] + '/reorder',
                json={'target_id': a['id'], 'placement': 'after'}).status_code, 200)
            write.assert_not_called()
        for source, body, status in [
            (a['id'], {'target_id': other['id'], 'placement': 'before'}, 400),
            (a['id'], {'target_id': pin['id'], 'placement': 'after'}, 400),
            (a['id'], {'target_id': '999', 'placement': 'before'}, 404),
            ('999', {'target_id': a['id'], 'placement': 'after'}, 404),
            (a['id'], {'target_id': [], 'placement': 'before'}, 400),
            (a['id'], {'target_id': a['id'], 'placement': []}, 400),
            (a['id'], {'target_id': a['id']}, 400),
            (a['id'], {'target_id': a['id'], 'placement': 'up'}, 400),
            (a['id'], {'target_id': a['id'], 'placement': 'before', 'direction': 'up'}, 400),
        ]:
            with patch.object(api, '_tasks_write') as write:
                self.assertEqual(self.client.post('/tasks/' + source + '/reorder', json=body).status_code, status)
                write.assert_not_called()
        with patch.object(api.os, 'replace', side_effect=OSError('disk unavailable')):
            self.assertEqual(self.client.post('/tasks/' + a['id'] + '/reorder',
                json={'target_id': c['id'], 'placement': 'before'}).status_code, 500)
        self.assertEqual(api._tasks_file().read_bytes(), before)
        second_pin = self.create('second pin', pinned=True)
        result = self.client.post('/tasks/' + second_pin['id'] + '/reorder',
            json={'target_id': pin['id'], 'placement': 'before'}).json()['tasks']
        self.assertEqual([t['id'] for t in result if t['pinned']], [second_pin['id'], pin['id']])
        self.assertTrue(all(t['pinned'] for t in result if t['id'] in (pin['id'], second_pin['id'])))

    def test_atomic_failure_and_corrupt_storage(self):
        task = self.create()
        path = api._tasks_file()
        before = path.read_bytes()
        with patch.object(api.os, 'replace', side_effect=OSError('disk unavailable')):
            result = self.client.patch('/tasks/' + task['id'], json={'title': 'lost'})
        self.assertEqual(result.status_code, 500)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(list(path.parent.glob('.tasks-*')), [])
        for raw in ['{', '[]', '{"tasks":{},"next_id":10}', '{"tasks":[{}],"next_id":11}']:
            path.write_text(raw)
            self.assertEqual(self.client.get('/tasks').status_code, 500)
            self.assertEqual(self.client.post('/tasks', json={'title': 'x'}).status_code, 500)
            self.assertEqual(path.read_text(), raw)

    def test_concurrent_creates_are_not_lost(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            rows = list(pool.map(lambda i: self.create(str(i)), range(15)))
        self.assertEqual(len({row['id'] for row in rows}), 15)
        self.assertEqual(len(self.client.get('/tasks').json()['tasks']), 15)

    def test_dev_board_has_no_task_crud_routes(self):
        import sys
        sys.path.insert(0, str(Path(__file__).parents[1] / "dev-board"))
        from dashboard import plugin_api as dev_api
        self.assertFalse(any(route.path.startswith('/tasks') for route in dev_api.router.routes))


    def test_label_crud_roundtrip_and_propagation(self):
        self.assertEqual(self.client.get('/labels').json(), {'labels': {}})
        self.assertEqual(self.client.post('/labels', json={'name': ' bug ', 'color': 'red'}).json(), {'labels': {'bug': 'red'}})
        self.client.post('/labels', json={'name': 'docs', 'color': 'blue'})
        task = self.create(labels=['bug', 'bug', ' docs '])
        self.assertEqual(task['labels'], ['bug', 'docs'])
        self.create('second', labels=['bug', 'docs'])
        edited = self.client.patch('/tasks/' + task['id'], json={'labels': ['bug']}).json()
        self.assertEqual(edited['labels'], ['bug'])
        response = self.client.patch('/labels', json={'name': 'bug', 'new_name': 'fix', 'color': 'teal'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['labels'], {'fix': 'teal', 'docs': 'blue'})
        renamed = self.client.get('/tasks').json()['tasks'][0]
        self.assertEqual(renamed['labels'], ['fix'])
        self.assertEqual(self.client.get('/tasks').json()['tasks'][1]['labels'], ['fix', 'docs'])
        self.assertEqual(renamed['created_at'], task['created_at'])
        self.assertGreater(renamed['updated_at'], edited['updated_at'])
        self.assertEqual(json.loads(api._tasks_file().read_text())['labels'], {'fix': 'teal', 'docs': 'blue'})
        self.assertEqual(self.client.delete('/labels', params={'name': 'fix'}).status_code, 200)
        self.assertEqual(self.client.get('/tasks').json()['tasks'][0]['labels'], [])
        self.assertEqual(self.client.get('/labels').json(), {'labels': {'docs': 'blue'}})
        self.assertEqual(self.client.get('/tasks').json()['tasks'][1]['labels'], ['docs'])

    def test_label_validation_and_legacy_defaults(self):
        task = self.create()
        data = json.loads(api._tasks_file().read_text())
        del data['labels']
        del data['tasks'][0]['labels']
        api._tasks_file().write_text(json.dumps(data))
        self.assertEqual(self.client.get('/tasks').json()['tasks'][0]['labels'], [])
        self.assertEqual(self.client.get('/labels').json(), {'labels': {}})
        before = api._tasks_file().read_bytes()
        for body in [{}, {'name': '', 'color': 'red'}, {'name': 'x' * 41, 'color': 'red'},
                     {'name': 1, 'color': 'red'}, {'name': 'x', 'color': 'pink'}, {'name': 'x', 'color': []},
                     {'name': 'x', 'color': 'blue', 'extra': True}]:
            self.assertEqual(self.client.post('/labels', json=body).status_code, 400, body)
        for labels in [None, 'bug', [1], [''], ['x' * 41], ['unknown']]:
            response = self.client.patch('/tasks/' + task['id'], json={'labels': labels})
            self.assertEqual(response.status_code, 400, labels)
            self.assertIn('label', response.json()['detail'])
        self.assertEqual(api._tasks_file().read_bytes(), before)
        self.client.post('/labels', json={'name': 'bug', 'color': 'red'})
        self.client.post('/labels', json={'name': 'docs', 'color': 'blue'})
        before = api._tasks_file().read_bytes()
        for method, url, body, status in [
            ('post', '/labels', {'name': 'bug', 'color': 'red'}, 400),
            ('patch', '/labels', {'name': 'bug', 'new_name': 'docs'}, 400),
            ('patch', '/labels', {'name': 'missing', 'new_name': 'fix'}, 404),
            ('patch', '/labels', {'name': 'bug', 'color': 'pink'}, 400),
        ]:
            self.assertEqual(getattr(self.client, method)(url, json=body).status_code, status)
        self.assertEqual(self.client.delete('/labels?name=missing').status_code, 404)
        self.assertEqual(api._tasks_file().read_bytes(), before)

    def test_custom_status_config_atomic_migration_and_default(self):
        task = self.create(note='keep', pinned=True, session_id='linked')
        statuses = [{**s} for s in api.DEFAULT_STATUSES]
        statuses[0] = {'id': 'backlog', 'name': '计划', 'color': 'amber', 'category': 'todo'}
        statuses.insert(2, {'id': 'review', 'name': '待审核', 'color': 'violet', 'category': 'doing'})
        before = api._tasks_file().read_bytes()
        self.assertEqual(self.client.put('/statuses', json={'statuses': statuses}).status_code, 400)
        self.assertEqual(api._tasks_file().read_bytes(), before)
        self.assertEqual(self.client.put('/statuses', json={'statuses': statuses, 'migrations': {'todo': 'backlog'}}).status_code, 200)
        self.assertEqual(self.client.get('/tasks').json()['tasks'][0], {**task, 'status': 'backlog'})
        self.assertEqual(self.client.get('/statuses').json()['statuses'], statuses)
        self.assertEqual(self.create()['status'], 'backlog')
        a = self.create(status='review')
        b = self.create(status='review')
        result = self.client.post('/tasks/' + b['id'] + '/reorder', json={'target_id': a['id'], 'placement': 'before'})
        self.assertEqual(result.status_code, 200)
        self.assertLess([t['id'] for t in result.json()['tasks']].index(b['id']), [t['id'] for t in result.json()['tasks']].index(a['id']))
        self.assertEqual(self.client.patch('/tasks/' + a['id'], json={'status': 'todo'}).status_code, 400)
        before = api._tasks_file().read_bytes()
        for bad in [statuses + [statuses[0]], statuses[1:], [{**s, 'color': 'pink'} for s in statuses], [{**s, 'name': ' '} for s in statuses]]:
            self.assertEqual(self.client.put('/statuses', json={'statuses': bad}).status_code, 400)
            self.assertEqual(api._tasks_file().read_bytes(), before)
        with patch.object(api.os, 'replace', side_effect=OSError):
            self.assertEqual(self.client.put('/statuses', json={'statuses': api.DEFAULT_STATUSES, 'migrations': {'backlog': 'todo', 'review': 'doing'}}).status_code, 500)
        self.assertEqual(api._tasks_file().read_bytes(), before)

    def test_manual_sync_local_config_singleflight_and_safe_result(self):
        from unittest.mock import Mock
        api._sync_running = False
        api._sync_last_result = None
        self.assertEqual(self.client.get('/sync').json()['available'], False)
        self.assertEqual(self.client.post('/sync').status_code, 400)
        script = self.home / 'adapter.py'
        script.write_text('')
        settings = self.home / 'task-board/settings.json'
        settings.parent.mkdir(exist_ok=True)
        settings.write_text(json.dumps({'sync_script': str(script)}))
        with patch.object(api.threading, 'Thread') as thread:
            for _ in range(2):
                self.assertTrue(self.client.post('/sync').json()['running'])
            self.assertEqual(thread.call_count, 1)
            for _ in range(3):
                self.assertTrue(self.client.get('/sync').json()['running'])
            self.assertEqual(thread.call_count, 1)
        self.assertEqual(self.client.post('/sync', json={'script': '/secret'}).status_code, 400)
        def spawn(*args, **kwargs):
            self.assertEqual(args[0], [api.sys.executable, str(script)])
            self.assertTrue(kwargs['start_new_session'])
            self.assertEqual(kwargs['stderr'], api.subprocess.DEVNULL)
            kwargs['stdout'].write(b'{"created":2,"updated":true,"secret":"credential","message":"secret","stage_exits":[0,1]}')
            return Mock(pid=123, wait=Mock(return_value=0))
        with patch.object(api.subprocess, 'Popen', side_effect=spawn), patch.object(api.os, 'killpg') as kill:
            kill.side_effect = lambda *args: self.assertTrue(api._sync_running)
            api._run_sync(str(script))
            kill.assert_called_once_with(123, api.signal.SIGKILL)
        result = self.client.get('/sync').json()
        self.assertFalse(result['running'])
        self.assertEqual(result['last_result']['created'], 2)
        self.assertEqual(result['last_result']['stage_exits'], [0, 1])
        self.assertNotIn('credential', json.dumps(result))
        self.assertNotIn('updated', result['last_result'])
        process = Mock(pid=123, wait=Mock(side_effect=[api.subprocess.TimeoutExpired('adapter', 180), -9]))
        with patch.object(api.subprocess, 'Popen', return_value=process), patch.object(api.os, 'killpg') as kill:
            api._run_sync(str(script))
            self.assertEqual(kill.call_args_list, [((123, api.signal.SIGKILL),), ((123, api.signal.SIGKILL),)])
        with patch.object(api.subprocess, 'Popen', return_value=Mock(pid=123, wait=Mock(return_value=0))), patch.object(api.os, 'killpg', side_effect=ProcessLookupError):
            api._run_sync(str(script))
        self.assertTrue(self.client.get('/sync').json()['last_result']['ok'])
        with patch.object(api.subprocess, 'Popen', return_value=Mock(pid=123, wait=Mock(side_effect=[api.subprocess.TimeoutExpired('adapter', 180), -9]))), patch.object(api.os, 'killpg', side_effect=ProcessLookupError):
            api._run_sync(str(script))
        self.assertIn('timed out', self.client.get('/sync').json()['last_result']['message'])
        with patch.object(api.subprocess, 'Popen', side_effect=OSError('credential')):
            api._run_sync(str(script))
        self.assertNotIn('credential', json.dumps(self.client.get('/sync').json()))
