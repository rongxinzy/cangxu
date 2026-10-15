import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  providerSettingsStore,
  publicSettings,
  testProvider,
  validateSettings
} from '../src/provider-settings.ts';
const INPUT = {
  provider: 'openai-compatible',
  base_url: 'http://127.0.0.1:3000/v1',
  model_id: 'synthetic-model',
  api_key: 'synthetic-private-key',
  supports_images: false,
  max_output_tokens: 2048,
  timeout_ms: 1000
};
test('private atomic configuration survives restart, omits key and preserves latest blank key', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cangxu-provider-'));
  try {
    const store = await providerSettingsStore({
      ASSISTANT_STORAGE_DIR: directory
    });
    const result = await store.update(INPUT);
    assert.equal(result.has_api_key, true);
    assert.equal('api_key' in result, false);
    assert.equal(
      (await stat(join(directory, 'default', 'provider-settings.json'))).mode &
        0o777,
      0o600
    );
    await Promise.all([
      store.update({ api_key: 'synthetic-replaced-key' }),
      store.update({ api_key: '', model_id: 'synthetic-new-model' })
    ]);
    assert.equal(store.current.api_key, 'synthetic-replaced-key');
    assert.equal(store.revision, 3);
    const recovered = await providerSettingsStore({
      ASSISTANT_STORAGE_DIR: directory,
      ASSISTANT_MODEL_ID: 'wrong-env-model'
    });
    assert.equal(recovered.current.model_id, 'synthetic-new-model');
    assert.equal(recovered.current.api_key, 'synthetic-replaced-key');
    const before = await readFile(
      join(directory, 'default', 'provider-settings.json'),
      'utf8'
    );
    await assert.rejects(
      store.update({ base_url: 'https://secret:credential@example.org' })
    );
    assert.equal(
      await readFile(
        join(directory, 'default', 'provider-settings.json'),
        'utf8'
      ),
      before
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('validation rejects credential URLs, malformed values, unknown fields and unsupported providers', () => {
  for (const input of [
    { provider: 'other' },
    { supports_images: 'true' },
    { timeout_ms: 0 },
    { max_output_tokens: 8193 },
    { api_key: 'key\nsecret' },
    { base_url: 'file:///etc/passwd' },
    { base_url: 'https://example.org/?key=secret' },
    { token: 'secret' }
  ])
    assert.throws(() => validateSettings(input, INPUT));
  assert.equal(validateSettings({ api_key: '' }, INPUT).api_key, INPUT.api_key);
  assert.equal(publicSettings(INPUT).has_api_key, true);
});
test('connection test uses unsaved values and synthetic content; failures never disclose upstream secrets', async () => {
  let reject = false;
  let recorded: Record<string, unknown> = {};
  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    recorded = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(request.headers.authorization, 'Bearer synthetic-private-key');
    response.writeHead(reject ? 401 : 200, {
      'Content-Type': 'application/json'
    });
    response.end(
      JSON.stringify(
        reject
          ? { error: 'synthetic-private-key' }
          : { choices: [{ message: { content: 'OK' } }] }
      )
    );
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, '127.0.0.1', resolve)
  );
  const address = upstream.address();
  const input = {
    ...INPUT,
    base_url: `http://127.0.0.1:${typeof address === 'object' && address?.port}/v1`
  };
  try {
    assert.deepEqual(await testProvider(input, INPUT), {
      ok: true,
      message: '连接成功'
    });
    assert.deepEqual(recorded.messages, [
      { role: 'user', content: 'Reply OK.' }
    ]);
    assert.equal(INPUT.model_id, 'synthetic-model');
    reject = true;
    await assert.rejects(
      testProvider(input, INPUT),
      (error: Error) =>
        !error.message.includes('synthetic-private-key') &&
        error.message.includes('连接测试失败')
    );
  } finally {
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});

test('runtime settings routes authenticate and hot apply only after the active generation completes', async () => {
  const { createRuntimeServer } = await import('../src/http.ts');
  const directory = await mkdtemp(join(tmpdir(), 'cangxu-hot-provider-'));
  const deployment = '11111111-1111-4111-8111-111111111111';
  const partner = '22222222-2222-4222-8222-222222222222';
  const requests: string[] = [];
  let releaseOld!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(input.model);
    if (input.model === 'old-model') await held;
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end(
      `data: ${JSON.stringify({ id: 'synthetic', model: input.model, choices: [{ index: 0, delta: { role: 'assistant', content: `Reply from ${input.model}` }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'synthetic', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
    );
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, '127.0.0.1', resolve)
  );
  const address = upstream.address();
  const env = {
    ASSISTANT_STORAGE_DIR: directory,
    ASSISTANT_DEPLOYMENT_ID: deployment,
    ASSISTANT_RUNTIME_TOKEN: 'synthetic-private-runtime-token-32-plus',
    ASSISTANT_MODEL_PROVIDER: 'openai-compatible',
    ASSISTANT_MODEL_BASE_URL: `http://127.0.0.1:${typeof address === 'object' && address?.port}/v1`,
    ASSISTANT_MODEL_API_KEY: INPUT.api_key,
    ASSISTANT_MODEL_ID: 'old-model',
    ASSISTANT_MODEL_SUPPORTS_IMAGES: 'false'
  };
  let service = await createRuntimeServer(env);
  let base = '';
  const listen = async () => {
    await new Promise<void>((resolve) =>
      service.server.listen(0, '127.0.0.1', resolve)
    );
    const address = service.server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address?.port}`;
  };
  await listen();
  const call = async (
    path: string,
    method = 'GET',
    input?: unknown,
    authenticated = true
  ) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(authenticated
          ? {
              Authorization: `Bearer ${env.ASSISTANT_RUNTIME_TOKEN}`,
              'X-Assistant-Deployment': deployment
            }
          : {})
      },
      body: input === undefined ? undefined : JSON.stringify(input)
    });
    return { status: response.status, data: await response.json() };
  };
  const eventually = async (predicate: () => Promise<boolean>) => {
    for (let i = 0; i < 100; i++) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Synthetic condition did not complete');
  };
  try {
    assert.equal(
      (await call('/v1/provider', 'GET', undefined, false)).status,
      401
    );
    assert.equal((await call('/v1/provider')).data.has_api_key, true);
    await call(`/v1/partners/${partner}/messages`, 'POST', {
      request_id: 'old-request',
      text: 'Synthetic old prompt'
    });
    await eventually(async () => requests.length === 1);
    const saved = await call('/v1/provider', 'PUT', {
      ...INPUT,
      base_url: env.ASSISTANT_MODEL_BASE_URL,
      model_id: 'new-model',
      supports_images: true,
      api_key: ''
    });
    assert.equal(saved.status, 200);
    assert.equal('api_key' in saved.data, false);
    assert.equal(
      (await call(`/v1/partners/${partner}/status`)).data.capabilities.images,
      false
    );
    releaseOld();
    await eventually(
      async () =>
        (await call(`/v1/partners/${partner}/status`)).data.capabilities
          .images === true
    );
    await call(`/v1/partners/${partner}/messages`, 'POST', {
      request_id: 'new-request',
      text: 'Synthetic new prompt'
    });
    await eventually(async () => requests.includes('new-model'));
    await eventually(
      async () =>
        !(await call(`/v1/partners/${partner}/status`)).data.is_running
    );
    assert.deepEqual(requests, ['old-model', 'new-model']);
    await service.close();
    service = await createRuntimeServer(env);
    await listen();
    assert.equal((await call('/v1/provider')).data.model_id, 'new-model');
    assert.equal(
      (await call(`/v1/partners/${partner}/messages`)).data.items.filter(
        (item: { role: string }) => item.role === 'assistant'
      ).length,
      2
    );
  } finally {
    releaseOld();
    await service.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
