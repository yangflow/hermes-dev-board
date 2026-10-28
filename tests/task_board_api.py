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
        self.assertEqual(self.client.get('/tasks').json(), {'tasks': []})
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
