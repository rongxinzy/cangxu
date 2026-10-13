import {
  Alert,
  Button,
  Group,
  Modal,
  NumberInput,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput
} from '@mantine/core';
import { useEffect, useState } from 'react';
import { useApi } from '../../contexts/ApiContext';
import { ASSISTANT_API, apiError } from './assistant-api';

type ProviderConfig = {
  provider: string;
  base_url: string;
  model_id: string;
  has_api_key: boolean;
  supports_images: boolean;
  max_output_tokens: number;
  timeout_ms: number;
};

export default function ProviderSettings({
  opened,
  onClose
}: { opened: boolean; onClose: () => void }) {
  const api = useApi();
  const [config, setConfig] = useState<ProviderConfig | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'load' | 'save' | 'test' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!opened) return;
    let active = true;
    setConfig(null);
    setKey('');
    setError('');
    setNotice('');
    setBusy('load');
    api
      .get<ProviderConfig>(`${ASSISTANT_API}provider/`, { timeout: 15000 })
      .then(({ data }) => {
        if (active) setConfig(data);
      })
      .catch((err) => {
        if (active) setError(apiError(err));
      })
      .finally(() => {
        if (active) setBusy(null);
      });
    return () => {
      active = false;
    };
  }, [api, opened]);
  function change<K extends keyof ProviderConfig>(
    name: K,
    value: ProviderConfig[K]
  ) {
    setConfig((current) => (current ? { ...current, [name]: value } : current));
    setNotice('');
  }
  async function submit(action: 'save' | 'test') {
    if (!config || busy) return;
    setBusy(action);
    setError('');
    setNotice('');
    const { has_api_key, ...fields } = config;
    const payload = { ...fields, api_key: key };
    try {
      if (action === 'test') {
        await api.post(`${ASSISTANT_API}provider/test/`, payload, {
          timeout: 45000
        });
        setNotice('连接成功，模型已返回测试回复。测试未保存配置。');
      } else {
        const { data } = await api.put<ProviderConfig>(
          `${ASSISTANT_API}provider/`,
          payload,
          { timeout: 15000 }
        );
        setConfig(data);
        setKey('');
        setNotice('已保存，后续任务使用新配置；正在执行的任务继续完成。');
      }
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(null);
    }
  }
  const valid =
    !!config?.base_url.trim() &&
    !!config?.model_id.trim() &&
    (!!key.trim() || !!config?.has_api_key);
  return (
    <Modal
      className='partner-dialog'
      opened={opened}
      onClose={busy ? () => {} : onClose}
      title='模型供应商'
      centered
      size='lg'
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
    >
      <Stack gap='md'>
        <Text size='sm' c='dimmed'>
          此配置用于全部工作伙伴。API Key 仅保存在服务器，留空保留已有密钥。
        </Text>
        {error && (
          <Alert color='red' role='alert'>
            {error}
          </Alert>
        )}
        {notice && (
          <Alert color='green'>
            <output>{notice}</output>
          </Alert>
        )}
        {busy === 'load' && <output>正在读取配置…</output>}
        {config && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit('save');
            }}
          >
            <Stack gap='md'>
              <Select
                label='供应商类型'
                data={[
                  {
                    value: 'openai-compatible',
                    label: 'OpenAI 兼容接口（含自部署服务）'
                  }
                ]}
                value={config.provider}
                onChange={(value) =>
                  change('provider', value || 'openai-compatible')
                }
                allowDeselect={false}
              />
              <TextInput
                label='接口地址'
                description='填写 API 基础地址，通常以 /v1 结尾'
                placeholder='https://example.com/v1'
                value={config.base_url}
                onChange={(event) => change('base_url', event.target.value)}
                required
              />
              <TextInput
                label='模型名称'
                placeholder='供应商提供的模型 ID'
                value={config.model_id}
                onChange={(event) => change('model_id', event.target.value)}
                required
              />
              <PasswordInput
                label='API Key'
                description={
                  config.has_api_key
                    ? '已配置密钥；填写新值即可替换'
                    : '尚未配置密钥'
                }
                placeholder={
                  config.has_api_key ? '留空保留已有密钥' : '输入 API Key'
                }
                value={key}
                onChange={(event) => {
                  setKey(event.target.value);
                  setNotice('');
                }}
                autoComplete='new-password'
              />
              <Switch
                label='模型支持图片输入'
                description='仅在供应商确认支持视觉能力时开启'
                checked={config.supports_images}
                onChange={(event) =>
                  change('supports_images', event.currentTarget.checked)
                }
              />
              <NumberInput
                label='最大回复 Token 数'
                value={config.max_output_tokens}
                min={1}
                max={8192}
                allowDecimal={false}
                onChange={(value) => change('max_output_tokens', Number(value))}
                required
              />
              <NumberInput
                label='模型响应超时（秒）'
                value={config.timeout_ms / 1000}
                min={1}
                max={900}
                allowDecimal={false}
                onChange={(value) => change('timeout_ms', Number(value) * 1000)}
                required
              />
              <Group justify='flex-end'>
                <Button
                  variant='default'
                  disabled={!!busy || !valid}
                  loading={busy === 'test'}
                  onClick={() => void submit('test')}
                >
                  测试连接
                </Button>
                <Button
                  type='submit'
                  disabled={!!busy || !valid}
                  loading={busy === 'save'}
                >
                  保存配置
                </Button>
              </Group>
            </Stack>
          </form>
        )}
        {!config && !busy && (
          <Button variant='default' onClick={onClose}>
            关闭
          </Button>
        )}
      </Stack>
    </Modal>
  );
}
