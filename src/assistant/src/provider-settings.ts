import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export type ProviderSettings = {
  provider: string;
  base_url: string;
  model_id: string;
  api_key: string;
  supports_images: boolean;
  max_output_tokens: number;
  timeout_ms: number;
};
export class ProviderSettingsError extends Error {}
export function publicSettings(value: ProviderSettings) {
  const { api_key, ...visible } = value;
  return { ...visible, has_api_key: Boolean(api_key) };
}
export function validateSettings(
  input: Record<string, unknown>,
  previous: ProviderSettings
): ProviderSettings {
  const allowed = [
    'provider',
    'base_url',
    'model_id',
    'api_key',
    'supports_images',
    'max_output_tokens',
    'timeout_ms'
  ];
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new ProviderSettingsError('配置包含未知字段');
  const result = { ...previous, ...input } as ProviderSettings;
  if (result.provider !== 'openai-compatible')
    throw new ProviderSettingsError('目前仅支持 OpenAI 兼容供应商');
  for (const field of ['base_url', 'model_id', 'api_key'] as const) {
    if (
      typeof result[field] !== 'string' ||
      result[field].length > (field === 'api_key' ? 4096 : 2048)
    )
      throw new ProviderSettingsError('供应商配置格式无效');
    result[field] = result[field].trim();
  }
  result.api_key ||= previous.api_key;
  let url: URL;
  try {
    url = new URL(result.base_url);
  } catch {
    throw new ProviderSettingsError('请输入有效的接口地址');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new ProviderSettingsError(
      '接口地址必须是无凭据的 HTTP 或 HTTPS 地址'
    );
  result.base_url = result.base_url.replace(/\/+$/, '');
  if (
    !result.model_id ||
    /[\r\n]/.test(result.model_id) ||
    !result.api_key ||
    /[\r\n]/.test(result.api_key)
  )
    throw new ProviderSettingsError('请填写模型名称和 API Key');
  if (
    typeof result.supports_images !== 'boolean' ||
    !Number.isSafeInteger(result.max_output_tokens) ||
    result.max_output_tokens < 1 ||
    result.max_output_tokens > 8192 ||
    !Number.isSafeInteger(result.timeout_ms) ||
    result.timeout_ms < 1000 ||
    result.timeout_ms > 900000
  )
    throw new ProviderSettingsError('图片能力、输出上限或超时时间无效');
  return result;
}
export function providerEnvironment(
  settings: ProviderSettings
): NodeJS.ProcessEnv {
  return {
    ASSISTANT_MODEL_PROVIDER: settings.provider,
    ASSISTANT_MODEL_BASE_URL: settings.base_url,
    ASSISTANT_MODEL_ID: settings.model_id,
    ASSISTANT_MODEL_API_KEY: settings.api_key,
    ASSISTANT_MODEL_SUPPORTS_IMAGES: String(settings.supports_images),
    ASSISTANT_MODEL_MAX_OUTPUT_TOKENS: String(settings.max_output_tokens),
    ASSISTANT_MODEL_TIMEOUT_MS: String(settings.timeout_ms)
  };
}
export async function providerSettingsStore(env: NodeJS.ProcessEnv) {
  const file = join(
    resolve(env.ASSISTANT_STORAGE_DIR ?? '.state'),
    env.ASSISTANT_DEPLOYMENT_ID ?? 'default',
    'provider-settings.json'
  );
  let current: ProviderSettings = {
    provider: env.ASSISTANT_MODEL_PROVIDER ?? 'fixture',
    base_url: env.ASSISTANT_MODEL_BASE_URL ?? '',
    model_id: env.ASSISTANT_MODEL_ID ?? '',
    api_key: env.ASSISTANT_MODEL_API_KEY ?? '',
    supports_images: env.ASSISTANT_MODEL_SUPPORTS_IMAGES !== 'false',
    max_output_tokens: Number(env.ASSISTANT_MODEL_MAX_OUTPUT_TOKENS ?? 2048),
    timeout_ms: Number(env.ASSISTANT_MODEL_TIMEOUT_MS ?? 180000)
  };
  try {
    current = validateSettings(
      JSON.parse(await readFile(file, 'utf8')),
      current
    );
    await chmod(file, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error('Saved assistant provider settings are invalid');
  }
  let revision = 0;
  // Serialize updates so a blank key always preserves the last committed key.
  let writes: Promise<unknown> = Promise.resolve();
  return {
    get current() {
      return current;
    },
    get revision() {
      return revision;
    },
    async update(input: Record<string, unknown>) {
      const update = writes.then(async () => {
        const next = validateSettings(input, current);
        await mkdir(dirname(file), { recursive: true, mode: 0o700 });
        const temporary = `${file}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(next), {
          mode: 0o600,
          flag: 'wx'
        });
        await rename(temporary, file);
        current = next;
        revision += 1;
        return publicSettings(current);
      });
      writes = update.catch(() => undefined);
      return update;
    }
  };
}
export async function testProvider(
  input: Record<string, unknown>,
  previous: ProviderSettings
) {
  const settings = validateSettings(input, previous);
  try {
    const response = await fetch(`${settings.base_url}/chat/completions`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${settings.api_key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: settings.model_id,
        messages: [{ role: 'user', content: 'Reply OK.' }],
        max_tokens: 128,
        stream: false
      }),
      signal: AbortSignal.timeout(Math.min(settings.timeout_ms, 30000))
    });
    if (!response.ok) throw new Error();
    // Bound the provider response and never propagate provider messages or headers.
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.body!) {
      bytes += chunk.length;
      if (bytes > 65536) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error();
      }
      chunks.push(chunk);
    }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (
      !Array.isArray(result.choices) ||
      !result.choices.some(
        (choice: {
          message?: { content?: unknown; reasoning_content?: unknown };
        }) =>
          [choice.message?.content, choice.message?.reasoning_content].some(
            (value) => typeof value === 'string' && value.length > 0
          )
      )
    )
      throw new Error();
    return { ok: true, message: '连接成功' };
  } catch {
    throw new ProviderSettingsError(
      '连接测试失败，请检查接口地址、模型名称和 API Key'
    );
  }
}
